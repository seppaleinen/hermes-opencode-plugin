# HANDOVER: Retention Semantics for Successful Modifications Across Rounds (Issue #17)

## STATUS
[SUCCESS]

REWORK_COUNT: 0 | KILLED_BY_RESTART: 0

## SUMMARY
Implemented retention semantics for successful modifications across rounds per Paper B.5 ("Previously successful modifications are retained unless contradicted by new execution evidence"). The harness now tracks modifications that pass the execution gate (tests pass, no regressions), stores them in a `RetainedModifications` map keyed by file path, and passes them to the activation module in subsequent rounds. The activation prompt includes a "Retained Modifications" section listing each retained file's content, round number, and reason, with the directive "retain unless contradicted by new execution evidence."

## RATIONALE
- **Design choice**: Track modifications at the file level using `primitive.result.updated_artifact` from the Dev-Primitive output, since the harness already has this information after each collaboration phase.
- **Gate-based success criterion**: A modification is considered "successful" if `diagnosis.gate.gatePassed` is true (exit code 0, 0 failing tests). This aligns with Paper B.4's hard gate that execution evidence overrides model verdict.
- **Activation integration**: The retained modifications are passed as an optional 8th parameter to `activate()` and formatted into the prompt. When empty (baseline runs), no section is added — preserving byte-identical T6 baseline behavior when `intraRoundConvergence` is off.
- **Contradiction handling**: The activation model (not the harness) decides whether to keep, revise, or drop retained modifications based on the prompt instruction "retain unless contradicted by new execution evidence."

## TECHNICAL PAYLOAD

### Files Changed

**`plugins/hermes/src/types.ts`**
- Added `RetainedModification` interface with fields: `filePath`, `content`, `round`, `reason`
- Added `RetainedModifications` type alias: `Record<string, RetainedModification>`
- (Also included pre-existing `intraRoundConvergence`, `__testComponentOrderOverride`, `__testMaxPassesPerComponent` config options in diff)

**`plugins/hermes/src/activation.ts`**
- Added `RetainedModifications` import
- Updated `ACTIVATION_PROMPT` to document "Retained Modifications" as an input
- Added `formatRetainedModifications()` helper function that formats the map into a prompt section
- Updated `activate()` signature to accept optional `retainedModifications?: RetainedModifications` parameter
- Injected formatted retained section into the prompt before `ACTIVATION_PROMPT`

**`plugins/hermes/src/harness.ts`**
- Added `RetainedModifications` import
- Added `retainedModifications?: RetainedModifications` field to `HarnessLog` and `HarnessResult`
- Initialize `let retainedModifications: RetainedModifications = {}` before the round loop
- Pass `retainedModifications` to initial `activate()` call (empty on first round)
- After each round's diagnosis, if `diagnosis.gate.gatePassed`:
  - Iterate `log.primitives` for `action === "modify"` with `updated_artifact`
  - Store in `retainedModifications[filePath]` with content, round number, and reason
- Record snapshot in `log.retainedModifications = { ...retainedModifications }`
- Pass `retainedModifications` to subsequent `activate()` calls for revision rounds
- Include `retainedModifications` in both success and failure return objects

### Test Results
- **Convergence test** (T6 baseline): `SUCCESS` — Single-pass fails, convergence succeeds (byte-identical baseline preserved)
- **Activation retention test**: Verified retained modifications section appears in prompt when provided, absent when not provided
- **Eval repo state**: Byte-identical to committed state after harness run (verified via `git status eval/`)

### Constraints Satisfied
- ✅ T6 baseline (B=1, `incompleteRound0` flag off) remains byte-identical when `intraRoundConvergence` is off
- ✅ Eval repo remains byte-identical to committed state after any harness run
- ✅ Models fixed to `litellm/freellmapi` (no model changes)
- ✅ Convergence loop and other features unchanged

## TRACE
dev-team-lead → (design: skip per fast path) → implement (dev-team-lead direct) → test (convergence.test.ts) → lint (ruff check src/) → review (self-review) → docs (handover) [SUCCESS]

## IMPORTANT NOTES
- The `bus.ts` and `plugin.ts` changes shown in `git status` are pre-existing (from the intra-round convergence feature, issue #24) and not part of this implementation.
- The `RetainedModifications` map is updated only when the gate passes — failed rounds do not add to retained modifications, but previously retained ones persist and are passed forward.
- In the T6 revision trajectory (incompleteRound0=true), round 0's gate fails, so no modifications are retained from round 0. Round 1's successful modifications would be retained if B allowed further rounds.