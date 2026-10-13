# T6 Implementation Brief — End-to-end validation (B=1)

Issue: #8 (wayfinder:task). Parent map: #2. Single source of truth for dispatch to `dev-team-lead`.

## Goal

Validate the T4 prototype end-to-end against the `eval/` seeded-bug repo with B=1, and decide whether B=1 exercises a revision round or whether B=2 is needed. Record the trajectory, confirm diagnosis is evidence-backed, and surface the next map.

## The honest finding (do not paper over it)

In the T4 run, the seeded bug was fixed at **b=0** — the initial trajectory. The revision round available at B=1 was **never exercised**. Cross-file coordination happened *within* the collaboration round (checkout → validator message), not *across* revision rounds.

These are distinct mechanisms in the paper:
- **Within-round collaboration** — primitives exchange messages during one `Collaborate` call. Exercised in T4. ✓
- **Across-round revision** — `Diagnose` returns fail → `Activate` replans → primitives re-run, with successful modifications retained (B.5). **Not exercised in T4.** ✗

The paper's ablation (Table 9) shows "w/o Diagnosis Feedback" costs 4.4–11.0 points across benchmarks. The revision loop is load-bearing, not decorative. A loop that only ever runs once is not a loop.

## Decision (HITL, all confirmed by user)

**Q1 — Must exercise across-round revision.** Not "within-round is sufficient." The revision mechanism is a distinct, ablated component; leaving it unvalidated leaves the prototype's strongest claim unvalidated.

**Q2 — B=1 is enough.** With the revision exercise below, round 0 fails and round 1 fixes → PASS at b=1. That exercises exactly one revision round, the minimum meaningful test. B=2 adds nothing without a second failure mode. (Paper's B=3 default is for real benchmarks with many failure modes.)

**Q3 — Deliverable is trajectory + verdict + next map.** The "failure mode is the deliverable" branch only triggers if the harness itself breaks. Our harness doesn't break — it passes. So the deliverable is the validated trajectory and the forward map.

## How to exercise revision without changing the eval repo

The seeded bug is one line and fixes at b=0 — that's a property of the bug, not the harness. To exercise revision, **make the first round's `validator` primitive deliberately incomplete** via a config flag, *not* by editing `eval/`:

- Round 0: `validator` adds the null-guard but **also** breaks the valid-email path (e.g., lowercases the result incorrectly, or returns the raw input). Round 0 executes → tests still fail.
- `Diagnose` (C.4) → FAIL with structured feedback φ naming `validator.ts`.
- `Activate` replans (B.5: retain successful mods unless contradicted by evidence; revise objectives for implicated components).
- Round 1: `validator` re-activated with failure evidence in context → completes the fix correctly.
- Execute → tests pass → DIAGNOSE PASS at b=1.

This exercises the full loop: message routing (round 0) + diagnosis feedback + replan + retained-modification semantics (round 1) + PASS. Cost: one config flag, no eval-repo change.

**Deterministic, not model-dependent.** Do NOT rely on the model to spontaneously produce an incomplete fix — that would make the validation non-deterministic and un-reproducible. The incomplete-first-round behavior must be a controlled, documented flag so the trajectory is reproducible on re-run. The model still does the real reasoning in both rounds; the flag only constrains round 0's output.

## Constraints

- The eval repo must remain byte-identical to its committed (buggy) state after the run. The run applies the fix during execution and reverts afterward — confirm `eval/src/validator.ts` is back to buggy state at the end.
- Diagnosis is a **hard gate on `o_test`** (B.4): exit code + failing test count decide pass/fail before the model's verdict is considered. Model verdict can confirm, never override.
- Log every model call (component, model ref, prompt length, response) and every bus message verbatim.
- Re-run the full trajectory at least once to confirm determinism (or document the one controlled divergence).

## Output expected

1. STATUS: `[SUCCESS]` / `[REWORK]` / `[BLOCK]` / `[STUCK]`
2. Files changed (should be additions to `plugins/hermes/` + a run-log writeup; the eval repo must be unchanged at the end)
3. Run-log path + the actual end-to-end run executed against `eval/`
4. The verdict: **B=1 suffices** (with the revision exercise) — record the full trajectory: baseline → ACTIVATE → COLLABORATE (round 0, incomplete) → EXECUTE (fail) → DIAGNOSE (FAIL, φ) → ACTIVATE (replan) → COLLABORATE (round 1, complete) → EXECUTE (pass) → DIAGNOSE (PASS at b=1)
5. Confirmation diagnosis is evidence-backed (gate result JSON)
6. The next map: what real benchmark integration and full Module 1–5 would look like
7. A `TRACE` line showing the dispatch chain

## References

- Paper excerpts (verbatim): `docs/hermes-paper-excerpts.md` (B.4, B.5, F.3, Algorithm 1)
- T4 prototype: `plugins/hermes/`, run log `plugins/hermes/run.log`, summary `docs/t4-run-summary.md`
- T4 implementation brief: `docs/t4-implementation-brief.md`
- SDK surface (T1): `docs/opencode-plugin-sdk-reference.md`

## Scope discipline

This is validation, not new feature work. Do not add features beyond exercising the revision loop and recording the trajectory. If the harness genuinely cannot drive a revision round, that is a BLOCK — surface it, do not silently extend scope.