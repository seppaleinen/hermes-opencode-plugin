## T6 decisions (HITL, all confirmed by user)

**Q1 — Must exercise across-round revision (not just within-round collaboration).**

Honest finding: in the T4 run the seeded bug was fixed at **b=0**, so the revision round available at B=1 was never exercised. Within-round collaboration (checkout → validator message) and across-round revision (Diagnose FAIL → Activate replan → re-run, with successful mods retained per B.5) are *distinct* mechanisms. The ablation (Table 9: w/o Diagnosis Feedback costs 4.4–11.0 pts) shows the revision loop is load-bearing. A loop that only ever runs once is not a loop. So T6 must drive a revision round.

**Q2 — B=1 is enough.** With a deliberately-incomplete round 0, round 0 fails and round 1 fixes → PASS at b=1. That exercises exactly one revision round, the minimum meaningful test. B=2 adds nothing without a second failure mode.

**Q3 — Deliverable is trajectory + verdict + next map.** The "failure mode is the deliverable" branch only triggers if the harness itself breaks; ours doesn't.

**Mechanism to exercise revision (no eval-repo change):** a config flag makes round 0's `validator` deliberately incomplete (adds the null-guard but also breaks the valid-email path) so round 0 executes → tests fail → Diagnose FAIL (φ names validator.ts) → Activate replans → round 1 completes the fix → PASS at b=1. Deterministic, not model-dependent — the flag only constrains round 0's output; the model does real reasoning in both rounds. This is reproducible on re-run.

Full implementation brief: `docs/t6-implementation-brief.md` (committed).

Next: dispatch to dev pipeline.