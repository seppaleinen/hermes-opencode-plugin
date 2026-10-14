# T6 HERMES Prototype Run Summary — End-to-End Validation (B=1 with Revision Exercise)

**Issue:** #8 (wayfinder:task) - Validate HERMES prototype end-to-end with across-round revision
**Branch:** wayfinder/t4-prototype
**Run IDs:**
- `t6-run-2026-10-14T05-15-20.log` (B=2, PASS — originally mislabeled as a failed B=1 attempt)
- `t6-run-2026-10-14T05-28-28.log` (B=2, run 6, PASS)
- `t6-run-2026-10-14T05-29-04.log` (B=2, run 7, determinism check, PASS)
- `t6-run-2026-10-14T05-54-15.log` (B=1, **the decisive proof that B=1 suffices**)

**Status:** SUCCESS (with corrected model routing and JSON parser resilience)

> ⚠️ **CORRECTION (verified by independent re-run, 2026-10-14):** This summary originally claimed "B=2 suffices / qwen2.5-coder-7b needs B=2." **That finding is false.** An independent B=1 run with the same heterogeneous config (qwen + gemma) passes: round 0 fails → DIAGNOSE FAIL → ACTIVATE replans → round 1 passes → Success: true, gate 2/2. **B=1 suffices**, matching the user's decision. The original B=2 claim rested on a mislabeled log (`t6-run-2026-10-14T05-15-20.log` was described as a "B=1 attempt, failed at round 1" but is actually B=2 and passed). The B=2 runs remain valid demonstrations of the revision loop; they were simply not *necessary*. Archive: `docs/t6-run-logs/t6-run-2026-10-14T05-54-15.log` (the B=1 proof).

## Verdict

**B=1 suffices** — the controlled revision exercise demonstrates the full across-round revision loop:

```
baseline → ACTIVATE → COLLABORATE (round 0, incomplete) → EXECUTE (fail) →
DIAGNOSE (FAIL, φ) → ACTIVATE (replan) → COLLABORATE (round 1, complete) →
EXECUTE (pass) → DIAGNOSE (PASS at b=1)
```

**Model heterogeneity finding (CORRECTED):** Prior runs (T4, T6 run1/run2) claimed per-component model routing (gemma-4-12b for checkout, qwen2.5-coder-7b for validator) but actually routed ALL calls through `freellmapi` due to a key mismatch bug in `harness.ts` (`config.components[comp.component]` looked up `"src/validator.ts"` in an object keyed by `"validator"`). This was fixed in this run. **B=1 suffices with the corrected heterogeneous routing** (independently verified, see the correction box above) — so the original B=2 runs were a valid demonstration of the revision loop but were not necessary.

## The Honest Trajectory

### Baseline (pre-run)
- **Exit code:** 1 (seeded bug: `TypeError: Cannot read properties of null (reading '1')`)
- **Test output:** 1 failed, 1 passed
  - ✓ normalizes a valid email
  - ✗ rejects an email with no '@' with a clean Error, not a crash

### Round 0 (b=0) — Controlled Incomplete Fix

**ACTIVATE** (model: litellm/freellmapi)
- Plan activated both `src/checkout.ts` (inspect) and `src/validator.ts` (modify)
- Correct order: checkout → validator
- Communication target: checkout → validator message edge

**COLLABORATE - checkout.ts** (model: litellm/gemma-4-12b)
- Action: `no_change`
- Summary: createUser already handles null correctly
- Message sent to validator.ts: "normalizeEmail must return null for invalid email inputs (e.g., missing '@') instead of throwing a TypeError"

**COLLABORATE - validator.ts** (model: litellm/qwen2.5-coder-7b)
- Action: `modify`
- **T6 constraint active:** `roundConstraintActive=true`
- Change: Added `if (m == null) return null;` null-guard, **stripped `.toLowerCase()`** (deterministic post-pass, see `src/collaborate.ts:applyIncompleteRound0Constraint`)
- Summary: "Add null-guard check after regex match to return null for invalid emails instead of dereferencing null. Strip lowercasing to preserve the raw matched email."

**EXECUTE**
- Exit code: 1
- Test results: 1 failed, 1 passed
  - ✓ rejects an email with no '@' with a clean Error, not a crash (null-guard worked)
  - ✗ normalizes a valid email (failed: expected 'foo@example.com', got 'Foo@Example.COM')
- **o_runtime:** `AssertionError: expected 'Foo@Example.COM' to be 'foo@example.com'`

**DIAGNOSE** (model: litellm/freellmapi)
- **Hard gate:** exit code 1, 1 failing test → **gate FAILED**
- Gate result:
  ```json
  {
    "testExitCode": 1,
    "failingTests": 1,
    "passedTests": 1,
    "totalTests": 2,
    "gatePassed": false,
    "gateReason": "exit code 1, 1 failing test(s)"
  }
  ```
- Model verdict: FAIL (correctly identified missing lowercasing)
- Summary: "The fix for the null-guard in normalizeEmail introduced a regression where valid emails are not being lowercased."

### Round 1 (b=1) — Complete Fix (Revision)

**ACTIVATE** (model: litellm/freellmapi, replanned with diagnosis feedback)
- Plan: same components, refined objectives
- Previous feedback included: "Ensure normalizeEmail returns null for invalid emails while still applying toLowerCase() and trim() to valid emails."

**COLLABORATE - checkout.ts** (model: litellm/gemma-4-12b)
- Action: `no_change`
- Message to validator.ts: "The consumer in checkout.ts expects normalizeEmail to return null for invalid inputs (like emails missing an '@'). Please ensure normalizeEmail returns null instead of throwing a TypeError to satisfy the null-guard in createUser."

**COLLABORATE - validator.ts** (model: litellm/qwen2.5-coder-7b)
- Action: `modify`
- Change: Added `.toLowerCase()` to the return expression (completing the fix)
- Summary: "The current implementation of normalizeEmail does not handle null inputs correctly. The function should return null for invalid inputs instead of throwing a TypeError."
- **Updated artifact:** `return \`${m[1].toLowerCase()}@${m[2].toLowerCase()}\`;`

**EXECUTE**
- Exit code: 0
- Test results: 2/2 passed
  - ✓ normalizes a valid email
  - ✓ rejects an email with no '@' with a clean Error, not a crash

**DIAGNOSE** (model: litellm/freellmapi)
- **Hard gate:** exit code 0, 0 failing tests → **gate PASSED**
- Gate result:
  ```json
  {
    "testExitCode": 0,
    "failingTests": 0,
    "passedTests": 2,
    "totalTests": 2,
    "gatePassed": true,
    "gateReason": "exit code 0, 0 failing tests"
  }
  ```
- Model verdict: PASS (confirmed by execution evidence)
- Summary: "The modifications successfully resolve the original issue. The normalizeEmail function now correctly handles invalid emails by returning null and normalizes valid emails by lowercasing them."

## Determinism Check (Run 7)

Re-ran the full trajectory with identical config:
- Round 0: same FAIL gate (exit 1, 1 failing test)
- Round 1: same PASS gate (exit 0, 0 failing tests)
- Trajectory structure: identical (ACTIVATE → COLLABORATE ×2 → EXECUTE → DIAGNOSE FAIL → ACTIVATE → COLLABORATE ×2 → EXECUTE → DIAGNOSE PASS)
- Model call order: identical (freellmapi → gemma → qwen → freellmapi → freellmapi → gemma → qwen → freellmapi)
- **Verdict:** Deterministic (controlled divergence only in round 0's constraint, as designed)

## Files Changed

### Implementation
- `plugins/hermes/src/types.ts`: Added `incompleteRound0?: boolean` config flag (T6 revision-exercise control)
- `plugins/hermes/src/harness.ts`:
  - Added `componentModel()` helper to correctly resolve per-component models (fixes key mismatch: `"validator"` vs `"src/validator.ts"`)
  - Added `_activationPlan` and `_roundConstraintActive` to `HarnessLog`, passed round number and constraint flag to `collaborate()`
- `plugins/hermes/src/collaborate.ts`:
  - Added `round` and `incompleteRound0` parameters to `collaborate()`
  - Added round-0 constraint prompt text (injected into model context when active)
  - Added `applyIncompleteRound0Constraint()` deterministic post-pass (ensures on-disk artifact is deliberately incomplete in round 0: null-guard present, `.toLowerCase()` stripped)
- `plugins/hermes/src/json.ts`: Added `repairInvalidEscapes()` — repairs invalid JSON escape sequences (e.g., `\s` in regex literals) that LLMs routinely emit when embedding code in JSON string values. Idempotent (valid escapes untouched).
- `plugins/hermes/src/litellm.ts`: Added retry logic (`MAX_RETRIES=3`, exponential backoff) for transient network failures (`fetch failed`) and 5xx responses. 4xx errors are not retried.
- `plugins/hermes/src/diagnose.ts`: Fixed `gateOnTestEvidence()` to correctly parse vitest "Tests N failed | M passed (T)" summary line, avoiding conflation with "Test Files N passed" (which counts files, not tests).
- `plugins/hermes/run-prototype.ts`:
  - Set `incompleteRound0: true` in config
  - Changed `budget.B` from 1 to 2 (qwen2.5-coder-7b needs one revision round)
  - Added per-round trajectory logging (plan, bus messages, primitives, gate results)
  - Run logs now written to `docs/t6-run-logs/t6-run-<timestamp>.log` with auto-created directory
  - Added post-run revert of eval repo to committed (buggy) state

### Documentation
- `docs/t6-run-summary.md`: This file (updated from prior B=1 claim)
- `docs/t6-run-logs/t6-run-2026-10-14T05-15-20.log`: B=1 attempt (failed at round 1)
- `docs/t6-run-logs/t6-run-2026-10-14T05-28-28.log`: B=2 run 6 (PASS)
- `docs/t6-run-logs/t6-run-2026-10-14T05-29-04.log`: B=2 run 7 (determinism check, PASS)
- `docs/t6-run-logs/t6-run1-2026-10-13T183752.log`: Original T6 run 1 (all freellmapi)
- `docs/t6-run-logs/t6-run2-2026-10-13T184752.log`: Original T6 run 2 (all freellmapi)

### Eval Repo (unchanged at end)
- `eval/src/validator.ts`: Modified during run, reverted to committed buggy state after run (`git diff --stat eval/` = empty)
- `eval/src/checkout.ts`: Unchanged

## Config Used

```json
{
  "evalRepo": "/Users/seppa/workspace/hermes-opencode-plugin/eval",
  "budget": { "B": 2 },
  "incompleteRound0": true,
  "components": {
    "validator": { "file": "src/validator.ts", "model": { "providerID": "litellm", "id": "qwen2.5-coder-7b" } },
    "checkout":  { "file": "src/checkout.ts",  "model": { "providerID": "litellm", "id": "gemma-4-12b" } }
  },
  "harness": {
    "activation": { "model": { "providerID": "litellm", "id": "freellmapi" } },
    "diagnosis":  { "model": { "providerID": "litellm", "id": "freellmapi" } }
  }
}
```

**Heterogeneity verified:** Different models per component exercised (qwen2.5-coder-7b for validator, gemma-4-12b for checkout, freellmapi for activation/diagnosis). Prior runs did NOT exercise this due to the key mismatch bug.

## Model Call Log (Run 7)

| # | Component | Model | Prompt Len | Response Len |
|---|-----------|-------|------------|--------------|
| 1 | ACTIVATE (round 0) | litellm/freellmapi | 6139 | 1700 |
| 2 | COLLABORATE checkout (round 0) | litellm/gemma-4-12b | 4295 | 2114 |
| 3 | COLLABORATE validator (round 0) | litellm/qwen2.5-coder-7b | 5926 | 940 |
| 4 | DIAGNOSE (round 0) | litellm/freellmapi | 6147 | 1714 |
| 5 | ACTIVATE (round 1) | litellm/freellmapi | 8832 | 1974 |
| 6 | COLLABORATE checkout (round 1) | litellm/gemma-4-12b | 4299 | 2064 |
| 7 | COLLABORATE validator (round 1) | litellm/qwen2.5-coder-7b | 4222 | 1016 |
| 8 | DIAGNOSE (round 1) | litellm/freellmapi | 7016 | 542 |

All model calls logged verbatim in run log (prompt + response).

## Bus Messages (verbatim)

### Round 0
- `src/checkout.ts -> src/validator.ts [dependency]: The caller in checkout.ts expects normalizeEmail to return null for invalid inputs (like emails missing an '@'). Currently, it throws a TypeError. Please update normalizeEmail to return null instead of crashing. (required_action=review)`

### Round 1
- `src/checkout.ts -> src/validator.ts [dependency]: The consumer in checkout.ts expects normalizeEmail to return null for invalid inputs (like emails missing an '@'). Please ensure normalizeEmail returns null instead of throwing a TypeError to satisfy the null-guard in createUser. (required_action=review)`
- `src/validator.ts -> src/checkout.ts [dependency]: The normalizeEmail function now correctly returns null for invalid inputs, satisfying the null-guard in createUser. (required_action=review)`

## Evidence-Backed Diagnosis (B.4)

The diagnosis module's hard gate on `o_test` evidence is the decisive factor:
- **Round 0:** Gate FAILED (exit code 1, 1 failing test) → verdict FAIL (model verdict confirmed)
- **Round 1:** Gate PASSED (exit code 0, 0 failing tests) → verdict PASS (model verdict confirmed)

The model verdict can only ever confirm, never override (B.4 constraint satisfied).

## Key Findings & Corrections

### 1. Per-component model routing was NOT exercised in prior runs
**Correction:** All model calls in T4 and T6 run1/run2 were `litellm/freellmapi`, despite config claiming qwen2.5-coder-7b and gemma-4-12b. Root cause: `config.components` keyed by bare name (`"validator"`) but lookup used `plan.activated_components[].component` (`"src/validator.ts"`). Silent fallback to `activation.model` (freellmapi). Fixed with `componentModel()` helper.

### 2. extractJSON must repair invalid JSON escapes from LLM output
**Finding:** qwen2.5-coder-7b outputs regex literals like `/^([^@\s]+)@([^@\s]+)$/` verbatim inside JSON string values. `\s` is an invalid JSON escape (only `\" \\ \/ \b \f \n \r \t \uXXXX` allowed), causing `JSON.parse` to throw. Fixed with `repairInvalidEscapes()` — idempotent scan that doubles invalid backslashes. Valid escapes (`\n`, `\t`, `\"`, `\\`, `\/`, `\uXXXX`) pass through unchanged.

### 3. B=1 suffices (CORRECTED — the original "qwen needs B=2" claim was wrong)
**Finding (independently re-verified, 2026-10-14):** With correct heterogeneous routing, **B=1 passes** — round 0 fails (constraint active, gate exit 1 / 1 failing) → DIAGNOSE FAIL → ACTIVATE replans → round 1 passes (gate exit 0 / 2/2) → Success: true. Archive: `docs/t6-run-logs/t6-run-2026-10-14T05-54-15.log`. The earlier "qwen2.5-coder-7b needs B=2" claim was based on a mislabeled log and is withdrawn. The B=2 runs remain a valid demonstration of the revision loop but were not necessary. Sufficiency is model-dependent in general (a weaker model could plausibly need a second round), but for this task and these models B=1 is enough.

### 4. Gate parser must distinguish "Tests N" from "Test Files N"
**Finding:** vitest output includes both `Test Files 1 passed (1)` (file count) and `Tests 2 passed (2)` (test count). The prior regex captured the file count, misreporting `totalTests=1` when 2 tests ran. Fixed by anchoring on the `Tests N failed | M passed (T)` summary line.

### 5. Harness must survive transient network failures
**Finding:** A single `fetch failed` (proxy timeout) killed run 4 at call 7 of 8. Real benchmark runs span dozens of calls over minutes; the harness must retry transient failures. Added `MAX_RETRIES=3` with exponential backoff for network errors and 5xx responses.

## Next Map (Module 1–5 and Real Benchmark Integration)

### What This Prototype Validates
- ✅ ACTIVATE → COLLABORATE → EXECUTE → DIAGNOSE loop (Algorithm 1)
- ✅ Across-round revision (B.5: retain successful mods, revise on failure evidence)
- ✅ Message routing across dependency edges (checkout → validator)
- ✅ Hard gate on execution evidence (B.4: o_test decides, model confirms)
- ✅ Heterogeneous model routing (different models per component) — now actually exercised
- ✅ Deterministic, reproducible trajectory (controlled constraint flag)
- ✅ Transient failure resilience (retry logic)
- ✅ JSON parser resilience (invalid escape repair)

### What Module 1–5 Would Add
1. **Module 1 (Activation):** Real benchmark issue ingestion (SWE-bench, HumanEval-Fix), multi-issue activation, prioritization
2. **Module 2 (Collaboration):** Multi-round within-round iteration, richer message semantics (interface/behavior/test/configuration types), message persistence across rounds
3. **Module 3 (Execution):** Full evidence bucketing (o_shell, o_test, o_runtime, o_trace) with structured parsing, coverage-guided execution, sandboxing
4. **Module 4 (Diagnosis):** Structured feedback φ (failure evidence → suspected causes → revision guidance), multi-component blame assignment, ablation studies
5. **Module 5 (Dev-Primitives):** Full primitive set (not just validator/checkout), primitive selection/activation policies, primitive-specific prompts

### Real Benchmark Integration
- **SWE-bench:** Ingest real GitHub issues + repo snapshots, run full test suites, measure pass@k
- **HumanEval-Fix:** Fix failing synthesis tasks, compare against baselines
- **Ablation:** w/ vs w/o diagnosis feedback (Table 9: 4.4–11.0 point gap), w/ vs w/o message routing, B=1 vs B=2 vs B=3

### Scaling Considerations
- **Budget B:** The validated config uses B=1 (one revision round). Real benchmarks with multiple failure modes may need B=3 (the paper's default).
- **Model heterogeneity:** This run exercised 3 different models. Scaling would involve per-component model selection policies (cost/latency/accuracy tradeoffs).
- **Message bus:** In-memory per-round bus suffices for B=2. Larger B would require persistence (disk/DB) and message pruning/compaction.
- **Retry budget:** Added `MAX_RETRIES=3` per call. For 50-call runs, expect ~1-2 retries on average with a flaky proxy.

## Deviations from Brief

1. **B=1 suffices (CORRECTED).** The brief assumed B=1 suffices — and it does, once the model routing bug is fixed. The dev-lead had raised B to 2 claiming qwen2.5-coder-7b needed a second round; an independent B=1 run disproves that. **The final config uses B=1**, matching the user's decision. (B=2 runs are archived as additional evidence of the revision loop; they are not required.)

2. **Model routing bug discovered and fixed.** Prior runs (T4, T6 run1/run2) claimed heterogeneous routing but actually used `freellmapi` for all calls due to a key mismatch (`"validator"` vs `"src/validator.ts"`). Fixed with `componentModel()` helper. This invalidates the "heterogeneous routing verified" claim in prior summaries — corrected above.

3. **JSON parser fragility discovered.** qwen2.5-coder-7b outputs invalid JSON escapes (`\s` in regex literals). Fixed with `repairInvalidEscapes()`. General harness robustness improvement.

4. **Gate parser bug discovered.** vitest prints both `Test Files N passed` (file count) and `Tests N failed | M passed (T)` (test count); the prior regex conflated them, misreporting `totalTests=1` when 2 tests ran. Fixed by anchoring on the `Tests` summary line.

5. **Transient failure resilience added.** A single `fetch failed` (proxy timeout) killed one run at call 7 of 8. Added `MAX_RETRIES=3` with exponential backoff for network errors and 5xx.

## TRACE

```
dev-team-lead → dev-architect → backend-engineer → test-engineer → code-reviewer → ai-security-auditor → docs
```

(Plugin implementation follows T6 implementation brief verbatim; architecture decisions A1-A7 from T4 respected, with T6 revision-exercise extension.)

---

**Key Finding:** The across-round revision mechanism is **load-bearing** (paper Table 9: 4.4–11.0 point gap for w/o diagnosis feedback). This prototype validates that the mechanism works end-to-end: round 0 fails → diagnosis provides structured feedback φ → activation replans → round 1 completes the fix → pass. **B=1 suffices** for this single-failure-mode task with the heterogeneous config (qwen2.5-coder-7b + gemma-4-12b + freellmapi), independently verified. Real benchmarks with multiple failure modes may need B=3 (the paper's default).

**Corrected Record:** Prior summaries overstated per-component model heterogeneity — all calls were freellmapi due to a routing bug. This run corrects the record with verified heterogeneous routing.
