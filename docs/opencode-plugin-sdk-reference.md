# OpenCode Plugin SDK Surface — Reference

Research brief for **issue #3 "OpenCode plugin SDK surface"** (`github.com/seppaleinen/hermes-opencode-plugin`).

Answers the four questions with **primary sources only**: the official OpenCode docs (`opencode.ai`) and the OpenCode source / published `@opencode/plugin` package. Local type declarations from the installed `@opencode/plugin@2.0.26` (mirroring the `anomalyco/opencode` `dev` branch `packages/plugin/src/`) are quoted verbatim where used.

**Sources referenced below**

| # | Source | Type |
|---|--------|------|
| S1 | `opencode.ai/v2/docs/build/plugins` — Plugins (Overview) | Official V2 docs |
| S2 | `opencode.ai/v2/docs/plugins` — Configure plugins (load order, discovery) | Official V2 docs |
| S3 | `opencode.ai/v2/docs/build/plugins/migrate-v1` — Migrate plugins from V1 (context + hook mapping table) | Official V2 docs |
| S4 | `opencode.ai/v2/docs/build/plugins/cli` — CLI (TUI) plugins | Official V2 docs |
| S5 | `opencode.ai/v2/docs/build/plugins/rpc` — Plugin RPC | Official V2 docs |
| S6 | `opencode.ai/v2/docs/build/client` — `@opencode/client` | Official V2 docs |
| S7 | `opencode.ai/v2/docs/build/sdk` — SDK overview (`@opencode/client`) | Official V2 docs |
| S8 | `opencode.ai/docs/plugins` — V1 plugin docs (`@opencode-ai/plugin`) | Official V1 docs |
| S9 | `anomalyco/opencode` repo, `packages/plugin/README.md` (dev) | Official source |
| S10 | `anomalyco/opencode` repo, `packages/plugin/src/README.md` (dev) — Promise plugin API | Official source |
| S11 | Local `node_modules/@opencode/plugin@2.0.26/dist/promise/*.d.ts` (mirrors `packages/plugin/src`) | Primary package types |
| S12 | Local `node_modules/@opencode/client@2.0.26/dist/promise/generated/{client,types}.d.ts` | Primary client types |
| S13 | `opencode.ai/v2/docs/api/*` (search-indexed reference: `v2-shell-create`, `v2-shell-output`, `v2-session-shell`) | Official API reference |
| S14 | Local plugins `plugins/herdr-agent-state.js`, `plugins/paseo-terminal-activity.js` + ADR `adr-2026-10-10-opencode-v2-plugin-port.md` (this machine) | Primary live examples |

> **Version note (important).** There are **two** distinct OpenCode plugin APIs in play:
> - **V1** — package `@opencode-ai/plugin` (opencode ~1.18.x). A plugin *exports an async function* that returns a hooks object. Docs at S8.
> - **V2** — package `@opencode/plugin` (opencode 2.0.x, here **2.0.26**). A plugin **default-exports `Plugin.define({ id, setup })`** and registers behavior imperatively inside `setup(ctx)`. Docs at S1–S7.
>
> The local ADR (S14) confirms this machine runs **opencode 2.0.25 / `@opencode/plugin` 2.0.26** and that **V1 plugin code does NOT load under V2** (it crashed until ported). **HERMES must target V2.** Everything below is V2 unless explicitly labelled V1.

---

## Q1. Plugin entry point / registration

**What a plugin exports.** The V2 plugin is a **module whose default export is a `Plugin` object** produced by `Plugin.define`. `Plugin.define` is an **identity function** — the default export is effectively a plain object `{ id, setup }` (and optionally an Effect `effect()` variant, or a V1-compatible `server()` for dual support).

`Plugin.define` (local `dist/promise/plugin.js`):
```js
export function define(plugin) { return plugin; }
```

`Plugin` / `Context` shape (local `dist/promise/plugin.d.ts`, S11):
```ts
export interface Plugin {
    readonly id: string;
    readonly setup: (context: Context) => Promise<Cleanup | void> | Cleanup | void;
}
export declare function define(plugin: Plugin): Plugin;
export type Cleanup = () => Promise<void> | void;
```
- `id`: stable plugin id (scopes plugin storage, identifies the plugin in diagnostics). [S1, S3]
- `setup(ctx)`: runs **once when the plugin loads**; may return a **cleanup function** run on unload. [S1]

**Canonical V2 example** (S1, `.opencode/plugins/example/index.ts`):
```ts
import { Plugin } from "@opencode/plugin"
export default Plugin.define({
  id: "example",
  async setup(ctx) {
    await ctx.storage.set("loaded", true)
  },
})
```

**Effect variant** (S9, S10): import `Plugin` from `@opencode/plugin/effect` and export an **effect function** instead of `setup`. First-class Effect API; `effect` must be a `peerDependency` and **must not be bundled** (the host injects its single `effect` runtime). [S9]

**How a plugin is registered / discovered.** [S1, S2]

| Mechanism | Detail |
|---|---|
| Local directory auto-load | Any direct `.ts`/`.js` file or immediate plugin **package directory** under `.opencode/plugins/` (project) or `~/.config/opencode/plugins/` (global) is loaded automatically. |
| Config array | Add entries to the **`plugins`** field of `opencode.json(c)` (V2 name; V1 used `plugin`). Accepts: npm name (`opencode-acme-plugin`, `@1.2.0`, `@acme/x`), local/absolute/`file://` path, or `{ "package": "...", "options": { ... } }`. |
| Load order | Config precedence low→high: `~/.config/opencode/opencode.jsonc` → `./opencode.jsonc` → `./.opencode/opencode.jsonc`. Plugin entries processed in order; `-*` disables, `*`/`.*` wildcards; a later ID re-enables. |
| CLI management | `opencode plugin add/list/check/update/remove`. |
| CLI-only plugins | Configured separately in `cli.json` (`{ "plugins": [...] }`) and stay active when attached to a remote server. [S2, S4] |
| Entry-point resolution | The host `Host.resolve` maps a plugin package to subpaths `server`/`tui`/`rpc`/`index`. [S11 `dist/host.ts`] |

**`setup` context (`ctx`).** "The plugin context is essentially an OpenCode server client" — its read/action methods match the client, plus plugin-only `transform`, `hook`, `reload`, `registration`, and `options`. [S1] Key members (local `plugin.d.ts`, S11):
- `ctx.app` — version/channel; `ctx.location` — `directory`, optional `workspaceID`, `project` metadata (`id`, `directory`, `canonical`).
- `ctx.options` — the `options` object from the `{ package, options }` config form. [S1]
- Domain handles (each with `list`/`get` client reads, plus `transform`/`hook`/`reload` where applicable): `agent, aisdk, command, event, integration, mcp, model, provider, reference, skill, tool, vcs, websearch, worktree, rpc, storage, permission, session, shell, plugin, generate, experimental.terminal`.

**V1/V2 dual support** (S1, S3): default-export one object spreading the V2 `Plugin.define(...)` **and** a V1 `async server()` that returns the V1 hooks object. V1 calls `server()`; V2 reads `id` + `setup()` and ignores `server()`. The two do **not** translate hooks.

**Live local V2 examples** (S14): `plugins/paseo-terminal-activity.js` and `plugins/herdr-agent-state.js` both default-export `{ id, server?, setup(ctx) }`; the ADR documents the v1→v2 port (removing the dead V1 `tui`/`server` entries and migrating event names, e.g. `session.updated`→`session.renamed`).

**Answer:** A V2 plugin = a module default-exporting `Plugin.define({ id, setup })` (or the Effect variant). It is registered by placement under `.opencode/plugins/` / `~/.config/opencode/plugins/` or by name/path in the `plugins` config array. It exports an **object** (id + setup), not a function and not a config.

---

## Q2. Tool / hook exposure

A plugin exposes capabilities to the host through **domain `transform` (declarations/definitions)**, **domain `hook` (interceptors)**, **custom tools**, **custom commands**, and **RPC**. The central identifiers: `ctx.tool.transform`, `ctx.tool.hook`, `ctx.command.transform`, `ctx.session.hook`, `ctx.aisdk.hook`, `ctx.shell.hook`, `ctx.permission.hook`, `ctx.event.subscribe`, and `ctx.rpc.register`. [S1, S3, S11]

### 2a. Custom tools (the primary way to add a callable capability)

Register a tool via the **synchronous** `ctx.tool.transform` editor; define input as **JSON Schema** (or Effect `Schema` / Standard Schema) and run an **async executor**. [S1, S3]

```ts
import { Plugin } from "@opencode/plugin"
export default Plugin.define({
  id: "acme.greeting",
  async setup(ctx) {
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "greeting",
        description: "Create a greeting",
        input: { type: "object", properties: { name: { type: "string" } },
                 required: ["name"], additionalProperties: false },
        options: { namespace: "acme", codemode: true },   // namespace → "acme_greeting"
        async execute(input, context) {
          // context: { sessionID, agent, messageID, id, signal: AbortSignal, progress }
          await context.progress({ status: "greeting" })
          return { content: `Hello ${(input as any).name}!` }   // Tool.Result
        },
      })
    })
  },
})
```
- Editor: `list() / get(id) / add(tool) / update(id, fn) / remove(id) / namespace({name,description})`. `reload()` replays transforms. [S1, S11 `tool.d.ts`]
- A later valid registration **overrides** the same effective tool name; a name colliding with a built-in tool — **plugin tool wins**. [S1, S3]
- Executor returns a `Tool.Result` (local `schema/dist/tool.d.ts`): `{ output? (validated by `output` schema), content? (string | Content[]), metadata? }`. `Content` = `{type:"text",text}` or `{type:"file",uri,mime,name?}`. [S11]
- Pass `context.signal` to cancellable work (`fetch` etc.). [S1]
- **Namespacing** lets HERMES group mechanisms, e.g. `hermes_activation`, `hermes_diagnosis`, `hermes_primitive`.

### 2b. Lifecycle / interception hooks (by domain)

| Hook | Identifier | What it sees / can mutate |
|---|---|---|
| Tool exec | `ctx.tool.hook("execute.before", cb)` | `{ tool, sessionID, agent, messageID, id, input }` — can rewrite `input` or throw to abort. [S3, S11] |
| Tool exec | `ctx.tool.hook("execute.after", cb)` | `+ { status:"completed" \| "error", result \| error }` — inspect/transform results. [S3, S11] |
| Shell | `ctx.shell.hook("create.before", cb)` | `{ command, cwd, timeout, shell, env }` — e.g. inject `env`. [S3, S11] |
| Model dispatch | `ctx.session.hook("context", cb)` | mutable `system`, `messages`, `tools`, `options` immediately before agent-loop model call. [S1, S3] |
| Model request | `ctx.session.hook("model.request", cb, {providerID?})` | headers / raw request settings. [S1, S3] |
| HTTP | `ctx.session.hook("http.request" \| "http.response", cb, {providerID?})` | native provider request/response (one-shot streams; clone before read). [S1] |
| Retry | `ctx.session.hook("retry", cb)` | override `{ retry: false }` / `{ retry: true, delay }`. [S1, S10] |
| Prompt admission | `ctx.session.hook("prompt", cb)` | rewrite incoming user prompt text/files/delivery before durable admission. [S1, S3] |
| Compaction / title / generate | `ctx.session.hook("compaction" \| "title" \| "generate", cb)` | set `event.result` to short-circuit the model call. [S1, S3] |
| AI SDK | `ctx.aisdk.hook("sdk" \| "language", cb)` | swap the provider SDK / `LanguageModelV3` for a model. [S1, S10, S11 `aisdk.d.ts`] |
| Permission | `ctx.permission.hook("evaluate", cb)` | mutate the resolved `effect` for a permission decision. [S3, S11] |
| Events | `ctx.event.subscribe({signal})` | async-iterate the public server event stream (abort via cleanup). [S1, S3, S11] |

Hook registration returns a `Registration` (`{ dispose() }`); multiple plugins may register the same hook and they run **in plugin/registration order** (later hooks see earlier mutations). [S1, S11 `registration.d.ts`]

### 2c. Other exposure surfaces
- **Custom slash commands**: `ctx.command.transform((e) => e.add({ name, description, execute({ sessionID, prompt, delivery }) }))`. [S1]
- **Transforms** (declarative config changes) on `agent / command / integration / mcp / model / provider / reference / skill / tool / vcs / websearch / worktree` — synchronous editor callbacks + `reload()`. [S1, S10]
- **Plugin RPC** (expose custom server methods/events to other plugins or HTTP clients): `Rpc.define` + `ctx.rpc.register(Acme, { method: async (input, context) => ... })`, then `ctx.rpc(Acme).method(...)` or `client.rpc(Acme)`. [S5, S11 `rpc.d.ts`]
- **TUI/CLI surface** (separate `@opencode/plugin/tui` package, `./tui` entrypoint): `context.ui` (toasts, dialogs, slots, panels, tabs), `context.keymap`, `context.data.*`, `context.client`. [S4]

**Answer:** Tools = `ctx.tool.transform` (JSON Schema input + async `execute`). Hooks = `ctx.<domain>.hook(name, cb)` for interception (`execute.before/after`, `create.before`, `context`, `model.request`, `http.request/response`, `retry`, `prompt`, `aisdk`, `permission`) and `ctx.event.subscribe()` for the event stream. Commands = `ctx.command.transform`. Cross-plugin/HTTP surface = `ctx.rpc.register`.

---

## Q3. Model access (call LLMs through the host registry)

**Yes — a plugin can call models without managing providers or keys.** The host owns provider resolution, credentials, and routing; the plugin selects a model by `providerID` + `id` (optionally `variant`) and the host executes the request. There are two host model-invocation APIs, both on the plugin context. [S1, S11]

### 3a. `ctx.generate.text` — one-shot, session-less generation (best fit for Activation / Diagnosis / primitive LLMs)

`ctx.generate: GenerateApi`. [S11 `plugin.d.ts` line 39]
```ts
const review = await ctx.generate.text({
  model: { providerID: "anthropic", id: "claude-sonnet-4-6" },  // omit `model` → session/selected model
  prompt: "Review this proposed action.",
})
// → { text: string }
```
- **No session created, no tools invoked, nothing added to session history** — ideal for short, stateless mechanism LLM calls. [S1]
- `GenerateTextInput` = `{ prompt: string, model?: { providerID, id, variant? } }`; `GenerateTextOutput` = `{ text: string }`. [S12 `types.d.ts`]

### 3b. `ctx.session.*` — session-bound generation

`ctx.session: SessionDomain = Pick<SessionApi, create|get|remove|switchAgent|switchModel|prompt|generate|command|compact|synthetic|interrupt|update|move|wait|context> & { hook }`. [S11 `session.d.ts`]

| Method | Purpose |
|---|---|
| `ctx.session.generate({ sessionID, prompt, ... })` | **transient generation within a session** → `{ text: string }`; intercepted by the `generate` hook. [S1] |
| `ctx.session.prompt({ sessionID, text, model?, ... })` | durable user prompt; runs the agent loop (tools etc.). [S1, S12] |
| `ctx.session.switchModel({ sessionID, model: {providerID, id} })` | change the session's model. [S1] |
| `ctx.session.switchAgent({ sessionID, agent })` | change the session's agent. [S1] |
| `ctx.session.create / get / remove / context / wait / interrupt / compact / synthetic / command` | session lifecycle / transcript / control. [S1] |

### 3c. Reading / shaping the model registry (host-managed)

- **Read:** `ctx.model.list()` / `ctx.model.default()` (→ `ModelInfo[]` / selected), `ctx.provider.list()` / `ctx.provider.get({providerID})`. [S1, S12]
- **Transform:** `ctx.provider.transform` (contribute providers + immutable model definitions, `settings.baseURL`/headers), `ctx.model.transform` (add/remove/enable/disable models, set `default`), `editor.default.set(providerID, modelID)`. [S1, S10, S11]
- **`ModelInfo`** (S12): `{ id, modelID, providerID, canonical?, family?, name, compatibility?, package?, settings?, headers?, body?, limit?{context,output}, cost?, capabilities?... }`.
- **Hook model calls:** `ctx.session.hook("context"|"model.request"|"http.request"|"http.response"|"retry", cb, {providerID?})` and `ctx.aisdk.hook("sdk"|"language", cb)` to swap SDK/language per model. [S1, S3, S10]

**HERMES fit:** register Activation/Diagnosis/Dev-Primitive as **separate named models** (or as **agents** with per-agent models) via `ctx.provider.transform` + `ctx.model.transform`, then call each from a tool/executor with `ctx.generate.text({ model: { providerID, id }, prompt })`. The host resolves the provider, key, base URL, and protocol — **the plugin never touches providers/keys directly.** Heterogeneous routing (issue #7) = one model per mechanism, selected by id at call time.

**Answer:** Use `ctx.generate.text` for stateless mechanism LLM calls; `ctx.session.generate/prompt` for session-bound ones; `ctx.model.list/default`, `ctx.provider.*`, and `ctx.model/provider.transform` to read and register the host's model registry. All host-managed.

---

## Q4. Command execution + output capture (oshell / otest / oruntime / otrace)

There are **three** distinct execution paths. Only the first is a **host API**; the third is a fallback the V2 docs explicitly endorse. The second is an interception point, not an execution path.

### Path A — Host shell API via `@opencode/client` (location-scoped `shell.*`)
`client.shell` (S12, S13):
```
shell.create(input: { command, cwd?, timeout?, metadata? }, loc)  → ShellInfo
shell.get(id, loc)                                                 → ShellInfo
shell.output({ id, cursor?, limit? }, loc)  → { output, cursor, size, truncated }
shell.list(loc) / shell.remove(id, loc)
```
- `create` **spawns one non-interactive shell command** for a location; **combined stdout+stderr is captured to a file, pageable via `output`** (absolute byte `cursor`). [S13 `v2-shell-create`, `v2-shell-output`]
- `ShellInfo` (S12): `{ id, status: "running"|"exited"|"timeout"|"killed", command, cwd, shell, file, pid?, exit?, signal?, metadata, time:{ started, completed? } }` → **exit code (`exit`), signal, and timing are captured.**
- There is also `POST /api/session/{sessionID}/shell` (`session.shell`), which runs a command in a session's working directory and emits `shell.started` … `shell.ended` (merged output) events. [S13 `v2-session-shell`]

**⚠️ Open gap (confirmed, not guessed):** The **server-plugin** `Context` (S11 `plugin.d.ts`) exposes **`shell: ShellDomain` where `ShellDomain = { hook: Hooks<{ "create.before" }> }` only** — i.e. the plugin gets the `create.before` **hook**, but **not** the `shell.create / shell.output / shell.get / shell.remove` client methods. Likewise `ctx.session` (`SessionDomain`, S11) picks a fixed list that **does not include `shell`**. So a **server plugin cannot directly call the host shell execution API through `ctx`** as of 2.0.26. The docs do not show a `ctx.shell.create`. **This must be verified against a running 2.0.x (or a `ctx` client handle) before relying on Path A for oshell.** See "Open Gaps".

### Path B — Interception, not execution: `ctx.tool.hook("execute.before"/"execute.after")`
- The host's built-in shell/bash tool is what the agent invokes. A plugin **intercepts** each call: `execute.before` sees `{ tool, sessionID, messageID, id, input }` (can rewrite/abort); `execute.after` sees the completed **result or error**. [S3, S11 `tool.d.ts`]
- This is the natural place to **tag/capture execution evidence** (attach `ose`/`otest`/`ort` metadata, record the tool `result`/`error` into HERMES state) — it observes what the model already asked the host to run. It does **not** itself launch a command.

### Path C — Direct process spawn from the plugin (the docs-endorsed fallback)
The V1→V2 migration guide states the V1 `$` Bun shell helper is removed and the plugin must **"import and manage the process API your plugin uses."** [S3] I.e. a V2 plugin runs its own test runner / CLI via `node:child_process` (or Bun) and captures **stdout, stderr, and `exitCode`** itself. This is fully supported and is the reliable path for HERMES to run a test runner and capture exit code / runtime errors / traces **independently of the model**. [S3, S14 — local plugins already `Bun.spawn` / `net.createConnection` from inside `setup`/tools]

**HERMES fit:**
- **oshell / otest / oruntime / otrace** → implement as custom **tools** (`ctx.tool.transform`) whose `execute` uses **Path C** (spawn the command, read stdout/stderr/exitCode, return `Tool.Result.content`) — deterministic, model-independent evidence capture.
- Optionally also **Path B** (`execute.before/after` hooks) to observe and annotate the model's own shell calls.
- **Path A** (`client.shell.create`/`output`) if a `ctx` client handle is available (verify — see gap), giving host-managed, paged, file-backed output with `exit`/`signal`.

**Answer:** Host API = `shell.create/get/output` on the OpenCode client (`ShellInfo.exit`/`signal` + paged `output`); model-driven execution is the built-in shell tool, interceptable via `ctx.tool.hook("execute.before"/"execute.after")`; and a plugin may **spawn processes directly** (docs-endorsed) for independent, model-free test execution. The precise `ctx`-level shell-execution surface is a **confirmed open gap** (see below).

---

## Open Gaps (explicit — not blockers, per issue #3)

1. **Server-plugin shell execution surface.** `ctx` (Promise Context, 2.0.26) exposes `shell: { hook }` only and a `session` domain **without** a `shell` method (S11 `plugin.d.ts`, `session.d.ts`). Whether a server plugin can reach `shell.create`/`shell.output` (or a raw client) at runtime is **not documented**. **Verify on a live 2.0.x before designing oshell on Path A.** Fallback (Path C direct spawn) is guaranteed to work.
2. **Exact `ctx` → `shell`/`session.shell` binding.** The local package confirms the *types* (hook-only `ShellDomain`); a runtime check is still needed to confirm no undocumented client handle is passed.
3. **Effect vs Promise for HERMES.** Both APIs exist; `effect` must be a `peerDependency` and never bundled (S9). Which flavor to standardize on is a design decision, not an SDK gap.

Everything else — entry point, tool/hook exposure, and host model access — is **fully specified** by the official V2 docs and the `@opencode/plugin@2.0.26` package types.

---

## Minimal HERMES V2 plugin skeleton (derived from S1, S3, S11)

```ts
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "hermes",
  async setup(ctx) {
    // 1) Model registry: register Activation / Diagnosis / Dev-Primitive models (host-managed).
    //    ctx.provider.transform(...) + ctx.model.transform(...) + editor.default.set(...)
    // 2) Mechanisms as tools:
    await ctx.tool.transform((e) => {
      e.namespace({ name: "hermes", description: "HERMES mechanisms" })
      e.add({
        name: "activate",
        description: "Run the Activation LLM via the host registry",
        input: { type: "object", properties: { goal: { type: "string" } }, required: ["goal"] },
        async execute(input, context) {
          // model access through the host (no provider/key management):
          const text = await ctx.generate.text({
            model: { providerID: "<activation-provider>", id: "<activation-model>" },
            prompt: (input as any).goal,
          })
          return { content: text.text }
        },
      })
      // ...diagnosis, primitive (spawn test runner here for oshell/otest/ort)
    })
    // 3) Observe execution evidence:
    await ctx.tool.hook("execute.after", (ev) => { /* record result/error */ })
    await ctx.session.hook("context", (ev) => { /* per-mechanism system/tools/options */ })
    // 4) Events / RPC / storage:
    const ac = new AbortController()
    void (async () => { for await (const ev of ctx.event.subscribe({ signal: ac.signal })) { /* ... */ } })()
    return () => ac.abort()
  },
})
```

---

*Prepared from primary sources only. Local type citations are from `node_modules/@opencode/plugin@2.0.26/dist/promise/*.d.ts` and `@opencode/client/dist/promise/generated/*.d.ts`, which mirror the `anomalyco/opencode` `dev` branch `packages/plugin/src` and `packages/client`.*
