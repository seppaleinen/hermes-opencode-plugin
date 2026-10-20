# HERMES OpenCode Plugin

HERMES prototype as an OpenCode plugin. Implements the harness loop from
[arXiv:2610.07832](https://arxiv.org/abs/2610.07832): ACTIVATE → COLLABORATE →
EXECUTE → DIAGNOSE, with Dev-Primitives communicating over a message bus.

## Install

```bash
cd plugins/hermes
npm install
node build.mjs            # esbuild bundle → /tmp/hermes-bundled.js
cp /tmp/hermes-bundled.js ~/.config/opencode/plugins/hermes.js
```

OpenCode auto-discovers plugins from `~/.config/opencode/plugins/`. The bundle
is self-contained (esbuild bundles `@opencode/plugin` inline), so no runtime
dependencies are needed.

## Toggle

The plugin is enabled/disabled by presence of the bundle:

```bash
bash plugins/hermes/toggle.sh enable   # install bundle
bash plugins/hermes/toggle.sh disable  # remove bundle
bash plugins/hermes/toggle.sh status   # print state
```

## Configuration

Defaults are in `plugin.ts` (`DEFAULT_CONFIG`). Override via the plugin's
`ctx.options` object — deep-merged over defaults, so partial config keeps the
rest:

```json
{
  "plugins": [
    {
      "path": "~/.config/opencode/plugins/hermes.js",
      "options": {
        "budget": { "B": 2 },
        "intraRoundConvergence": true,
        "parallelPrimitives": true
      }
    }
  ]
}
```

| Option | Default | Notes |
|---|---|---|
| `budget.B` | `1` | Revision rounds after the initial execution |
| `intraRoundConvergence` | `false` | Opt-in intra-round convergence loop |
| `parallelPrimitives` | `false` | Opt-in concurrent primitive execution (DAG scheduling) |

**T6 baseline:** `intraRoundConvergence: false` reproduces the validated
`docs/t6-run-summary.md` trajectory byte-for-byte. Changing it to `true`
enables the convergence loop (single-pass fails, convergence succeeds).

## Models

All model slots default to `litellm/freellmapi`:

| Slot | Config path |
|---|---|
| Activation | `harness.activation.model` |
| Diagnosis | `harness.diagnosis.model` |
| Validator | `components.validator.model` |
| Checkout | `components.checkout.model` |

Per-component models are resolved from `config.components` keyed by bare name
(`validator`, `checkout`) — the harness normalizes the repo-relative path
(`src/validator.ts`) before lookup.

## Tests

```bash
cd plugins/hermes
npx tsx --test src/__tests__/*.test.ts
```

| Test | What it verifies |
|---|---|
| `convergence.test.ts` | Red gate: single-pass fails, convergence succeeds |
| `token-test.ts` | Per-round and cumulative token/cost tracking |
| `registration.test.ts` | New artifacts registered as Dev-Primitives |
| `parallel.test.ts` | DAG ordering in parallel mode |
| `parallel-convergence.test.ts` | Message-driven re-activation in parallel mode |

## Eval repo

The eval repo (`eval/`) must remain byte-identical to committed state after
any harness run. The harness restores it on completion.