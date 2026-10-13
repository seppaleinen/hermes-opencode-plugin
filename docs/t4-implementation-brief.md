# T4 Implementation Brief — HERMES prototype as an OpenCode plugin

Issue: #6 (wayfinder:task). Parent map: #2. This brief is the single source of truth for the dispatch to `dev-team-lead`.

## Goal

Implement the HERMES prototype: the ACTIVATE → COLLABORATE → EXECUTE → DIAGNOSE loop (paper Algorithm 1, Appendix D) runs on the `eval/` seeded-bug repo, the two Dev-Primitives exchange a directed message across the `checkout.ts → validator.ts` dependency edge, execution captures the four evidence buckets, and diagnosis returns PASS **only because the test suite passes** — never on model judgment (B.4).

Definition of done (from the ticket):
1. Working plugin code.
2. A run log showing the full trajectory: plan → modifications → inter-primitive message → execution evidence (4 buckets) → diagnosis PASS.
3. The PASS must be backed by `o_test` (2/2 pass). If tests fail, diagnosis must return FAIL regardless of model output.

## Architecture (decided, do not re-litigate)

**A1 — Real plugin code + standalone runner (orchestrator Q1=B).**
- The plugin is a real V2 module: default export `Plugin.define({ id: "hermes", setup(ctx) })`. `setup` wires the harness to `ctx` (options, generate, model list).
- The harness core is written as **dependency-injected pure logic**: it takes a `GenerateFn` (signature identical to `ctx.generate.text`: `(input: { prompt: string, model?: { providerID: string, id: string } }) => Promise<{ text: string }>`), a spawner, and a filesystem root. The plugin module passes `ctx.generate.text`; the standalone runner passes a real, live implementation (OpenCode server client or direct litellm-proxy HTTP — **never a stub/echo**).
- The runner drives the harness against `eval/` from plain Node (tsx), no OpenCode TUI required. If a live OpenCode server (`opencode serve`) is impractical, the runner calls the litellm proxy directly with the same model IDs shown by `opencode models`. Model calls must be REAL LLM calls.

**A2 — Sequential single-pass collaboration (orchestrator Q2).**
- Round = each activated primitive runs once, in plan order. A primitive's outgoing messages (C.3 format) are delivered into the target's communication context **before** that target runs. No within-round iteration.
- Expected seeded-bug trajectory: activation plan covers both files → `checkout` primitive runs (its file is correct; it observes the dependency) → sends a message across the edge to `validator` → `validator` primitive runs with that message in context, revises its artifact (adds the missing null-guard) → execute → tests pass → diagnosis PASS in the initial round (b=0). B=1 is the safety net for a revision round.

**A3 — Artifact application + evidence capture (orchestrator Q3).**
- Primitive output follows C.2 schema; the harness writes `updated_artifact` to disk.
- Execution = **direct process spawn** of `npm test` (vitest) in the eval repo (T1 Path C — the host shell API is NOT callable from a server plugin ctx in 2.0.26). Never intercept the model's own shell tool for this.
- Bucket output into `(o_shell, o_test, o_runtime, o_trace)` (B.3).
- Diagnosis (C.4 prompt) is a **hard gate on `o_test`**: exit code / failing test count decides pass/fail before the model's verdict is considered. Model verdict can only ever confirm, never override.

**A4 — Issue source.** The runner first executes a **baseline** `npm test` to capture the observed failure; that failure (test name + error) is the issue `q` handed to ACTIVATE. Then Algorithm 1 runs with B=1.

**A5 — Message bus (T3 resolutions, issue #5).**
- Per-round **in-memory** bus; messages flushed at round end; interface abstract (persisted variant is a full-build concern).
- A primitive MAY revise its artifact after receiving a message in the same round (that is A2).
- Message to a target NOT in the active set: **queue + flag for next-round activation** (no-op at B=1 with both files active, but implement it — no silent drops).

**A6 — Model routing config (T5 resolutions, issue #7).**
- Config comes from `ctx.options` (plugin) / runner args (runner), shape:
  ```json
  {
    "evalRepo": "./eval",
    "budget": { "B": 1 },
    "components": {
      "validator": { "file": "src/validator.ts", "model": { "providerID": "...", "id": "..." } },
      "checkout":  { "file": "src/checkout.ts",  "model": { "providerID": "...", "id": "..." } }
    },
    "harness": { "activation": { "model": {...} }, "diagnosis": { "model": {...} } }
  }
  ```
  (The `harness` block is additive: activation/diagnosis get their own model refs — the paper scales those separately from Dev-Primitives, Table 6. Keep the T3 base shape intact.)
- Per-component assignment only; no routing policy, no variants/sampling params.
- Models resolved **once at setup, cached by component name**; **fail fast at setup** if a referenced model is unknown.
- The illustrative `anthropic/claude-sonnet-4-5` refs in the T3 comment were sketches — the real config MUST use models available in this environment. `opencode models` currently lists `litellm/*` (incl. `litellm/qwen3-8b`, `litellm/gemma-4-*`, `litellm/llama-3.1-8b-instruct`, ...), `opencode/*` free models, and `lmstudio/*` local models. Verify with the model list at setup. Heterogeneity is optional but encouraged (different models per component) to exercise routing — two different available models is enough.

**A7 — Prompts verbatim.** C.1 (Activation), C.2 (Dev-Primitive), C.3 (message format), C.4 (Diagnosis), B.1–B.5, D, F.5 are excerpted verbatim in `docs/hermes-paper-excerpts.md`. Use them as the system prompts; fill placeholders from the live run (repo structure, issue, plan, evidence). JSON output schemas in C.1/C.2/C.4 are the parsing contract.

## Constraints

- TypeScript, ESM (`"type": "module"`), matching `eval/`. No new heavy dependencies; `@opencode/plugin` + `@opencode/client` (both 2.0.26, available at `~/.config/opencode/node_modules` if a local install is awkward — prefer a proper local `npm i`).
- Do NOT merge or touch the `wayfinder/t2-eval-repo` branch history; work on a new branch off current `HEAD` (currently `wayfinder/t2-eval-repo`). The eval repo must remain byte-identical to its committed state after a successful run EXCEPT the harness's fix — the run mutates `eval/src/validator.ts`; that is expected and part of the log.
- The harness must never read `eval/test/checkout.test.ts` as context for a Dev-Primitive (tests are ground truth, F.1). Primitives see their own file + dependency context; the test *output* (o_test) is execution evidence, not source context.
- Log every model call (component, model ref, prompt length, response) and every bus message verbatim into the run log.

## Suggested layout (dev lead may refine)

```
plugins/hermes/
  package.json  tsconfig.json
  plugin.ts            # Plugin.define({ id, setup }) — wires ctx into harness
  src/types.ts         # Plan, Message (C.3), Evidence, Verdict
  src/config.ts        # options validation, fail-fast model check
  src/bus.ts           # per-round in-memory bus + inactive-target queue
  src/activation.ts    # ACTIVATE (C.1)
  src/collaborate.ts   # Dev-Primitive round (C.2), sequential single pass
  src/execute.ts       # spawn npm test, bucket into 4 evidence streams
  src/diagnose.ts      # DIAGNOSE (C.4) + hard o_test gate
  src/harness.ts       # Algorithm 1 loop (B=1)
  run-prototype.ts     # standalone runner (DI GenerateFn, baseline exec, drives loop)
  run.log              # full trajectory (also summarized in a docs/ run-log writeup)
```

## Output expected

1. Code committed on a new branch (e.g. `wayfinder/t4-prototype`) with a conventional commit.
2. The actual run executed end-to-end against `eval/`, run log saved in the repo.
3. Handover: STATUS, files changed, run-log path, the PASS evidence (final `npm test` output + diagnosis gate result), and any deviations from this brief with justification.

## References

- Paper excerpts (verbatim): `docs/hermes-paper-excerpts.md`
- SDK surface (T1): `docs/opencode-plugin-sdk-reference.md`
- Eval repo (T2): `eval/` (self-documenting; spec file from T2 was lost, the source comments carry it)
- T3 resolution: issue #5 comments. T5 resolution: issue #7 comments. T4 architecture: issue #6 comments (this round).
