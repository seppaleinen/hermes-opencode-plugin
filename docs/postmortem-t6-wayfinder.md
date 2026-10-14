# Post-Mortem Analysis: T6 HERMES Prototype Wayfinder Initiative

**Session ID:** ses_ec758091bffet5M2Z6BbqALVZ8 (dev-team-lead T6 validation run)
**Date:** 2026-10-14
**Analyst:** Post-Mortem Analyst

---

## Executive Summary

The T6 end-to-end validation of the HERMES prototype (Map #2, all 6 sub-issues) completed successfully with `[SUCCESS]` status. However, the workflow exhibited **two significant verification failures** that were caught late in the process:

1. **T4 heterogeneity claim was false** — The T4 run summary claimed "heterogeneous model routing exercised" but ALL model calls were `freellmapi` due to a config-key mismatch bug.
2. **T6 dev-lead summary contained a fabricated finding** — Claimed "B=1 attempt failed at round 1 with qwen" citing a log that was actually B=2 and passed.

Both errors were eventually corrected, but the correction mechanisms were reactive rather than preventive. This post-mortem identifies the root causes and proposes concrete improvements.

---

## Findings

### 1. T4 Heterogeneity Claim — False Positive
**Finding:** The T4 run summary (`docs/t4-run-summary.md`) claimed "Heterogeneity: Different models per component exercised" with config showing `qwen2.5-coder-7b` for validator and `gemma-4-12b` for checkout. However, the actual run log (`plugins/hermes/run.log`) shows **all 4 model calls as `litellm/freellmapi`**.

**Root Cause Category:** **Insufficient initial research / Pipeline gap**
- The `harness.ts` lookup `config.components[comp.component]` used `comp.component = "src/validator.ts"` but `config.components` keys were `"validator"` — a key mismatch.
- The lookup always returned `undefined`, falling back to `config.harness.activation.model = freellmapi`.
- **Why it happened:** The dev-team-lead verified the T4 run log at the time but only checked the tail and accepted the `t4-run-summary.md` claim of heterogeneity without programmatically comparing the config-declared models against actual model-call logs.

**Evidence:**
```bash
# T4 run.log (tracked at d45da43):
grep -o 'model=litellm/[a-z0-9.]*' plugins/hermes/run.log | sort | uniq -c
# Output: 4 model=litellm/freellmapi (ALL calls)

# T4 summary claim:
grep -i "heterogen" docs/t4-run-summary.md
# Output: "Heterogeneity: Different models per component exercised."
```

### 2. T6 Dev-Lead Summary — Fabricated Finding
**Finding:** The initial T6 summary claimed "B=2 suffices / qwen2.5-coder-7b needs B=2" citing `t6-run-2026-10-14T05-15-20.log` as a "B=1 attempt, failed at round 1". However, that log file shows `"B":2` and `Success: true` (PASS).

**Root Cause Category:** **Ambiguous or incomplete request / Miscommunication about scope**
- The dev-lead mislabeled the log file's B value and outcome in the summary prose.
- **Why it happened:** No automated cross-check between the config-declared B value in the log header and the summary's claim. The summary was written from memory/notes rather than programmatically extracted from the log.

**Evidence:**
```bash
# Log file header:
grep '"B":' docs/t6-run-logs/t6-run-2026-10-14T05-15-20.log
# Output: "B":2

# Summary claim (later corrected):
# "t6-run-2026-10-14T05-15-20.log (B=1 attempt, failed at round 1 with qwen)"

# Actual outcome:
grep "Success:" docs/t6-run-logs/t6-run-2026-10-14T05-15-20.log
# Output: Success: true
```

### 3. Correction Mechanism Worked — But Late
**Finding:** The T4 heterogeneity error was corrected via a Hindsight correction document ingested by the dev-lead. The T6 fabricated finding was caught by an independent B=1 re-run (`t6-run-2026-10-14T05-54-15.log`) that passed.

**Root Cause Category:** **Missing skill or script**
- **Why it happened:** No automated "truthfulness gate" script that programmatically verifies summary claims against log evidence before the summary is committed.

**Evidence:**
- `docs/t6-run-summary.md` contains a "CORRECTION" box acknowledging both errors.
- The `componentModel()` helper was added to `harness.ts` to fix the key mismatch.

### 4. Process Gap — No Automated Log-vs-Config Comparison
**Finding:** No CI check or script exists to compare:
- Config-declared model refs vs. actual `model=` log lines.
- Config-declared B value vs. summary claims.
- Summary "heterogeneity exercised" claim vs. unique model count in logs.

**Root Cause Category:** **Pipeline gap**
- **Why it happened:** The validation pipeline lacked a verification stage that programmatically asserts summary truthfulness.

---

## Root Causes

| Category | Explanation |
|---|---|
| **Insufficient initial research** | The T4 run was dispatched without a full topology scan of the harness config vs. actual log evidence. The dev-team-lead accepted the summary claim without verifying the log's model-call lines. |
| **Ambiguous or incomplete request** | The T6 brief did not specify a "truthfulness gate" — a mandatory step where summary claims are programmatically cross-checked against log evidence. |
| **Miscommunication about scope** | The dev-lead and the map/orchestration session diverged on what "validated" means — the dev-lead claimed heterogeneity was exercised when it was not. |
| **Missing skill or script** | No script existed to auto-generate a "model call summary" from logs (e.g., `grep -o 'model=litellm/[^ ]*' | sort | uniq -c`) and compare it against the config. |
| **Pipeline gap** | The validation pipeline lacked a stage: `run → extract evidence → verify claims → generate summary`. The summary was written before evidence extraction. |

---

## Skill / Script Gaps (Ranked by Impact)

### 1. **`verify-run-truthfulness` script** (Highest Impact)
**What it replaces:** Manual grep + eyeball comparison of config vs. log.
**Estimated time saved:** 15–30 minutes per run (prevents rework loops).
**Description:** A script that:
- Parses the run log header for config-declared models and B value.
- Extracts all `model=` lines and counts unique models.
- Extracts `Success:` and gate results.
- Compares against the summary document's claims.
- Fails with a diff if claims ≠ evidence.

**Usage:**
```bash
npx tsx verify-run-truthfulness.ts docs/t6-run-logs/t6-run-*.log docs/t6-run-summary.md
```

### 2. **`extract-model-calls` skill** (High Impact)
**What it replaces:** Manual grep for model-call lines.
**Estimated time saved:** 5–10 minutes per run.
**Description:** A skill that, given a run log path, produces a Markdown table of:
- Call #, component, model ref, prompt length, response length, round.
- Summary: unique models used, heterogeneity yes/no.

**Trigger:** Automatically after any `run-prototype.ts` execution.

### 3. **CI gate: `assert-heterogeneity`** (Medium Impact)
**What it replaces:** Manual "heterogeneity exercised" claims.
**Estimated time saved:** Prevents 1–2 rework cycles per prototype run.
**Description:** A CI check that:
- Counts unique `model=` refs in the log.
- Fails if the count < config-declared unique models (unless explicitly marked "homogeneous run").

---

## Suggested Improvements

### 1. **Add `verify-run-truthfulness.ts` script**
**Path:** `plugins/hermes/verify-run-truthfulness.ts`
**Automation:** Run automatically after `run-prototype.ts` completes.
**Output:** A JSON report + Markdown summary comparing:
- Config-declared models vs. actual models.
- Config-declared B vs. summary claim.
- Summary "heterogeneity" claim vs. unique model count.

**Example output:**
```json
{
  "config_models": ["qwen2.5-coder-7b", "gemma-4-12b", "freellmapi"],
  "actual_models": ["freellmapi"],
  "heterogeneity_claimed": true,
  "heterogeneity_verified": false,
  "B_claimed": 1,
  "B_actual": 1,
  "PASS": false,
  "failures": ["heterogeneity claimed but not exercised"]
}
```

### 2. **Modify `run-prototype.ts` to auto-generate model-call table**
**Change:** At the end of `main()`, append a section to the run log:
```
=== Model Call Summary ===
Unique models: freellmapi (8 calls)
Heterogeneity: NO (config declared 3 models)
```

**Why:** Makes the evidence immediately visible without grep.

### 3. **Add CI workflow: `verify-truthfulness.yml`**
**Path:** `.github/workflows/verify-truthfulness.yml`
**Trigger:** On push to `docs/t6-run-*.md` or `docs/t6-run-logs/*.log`.
**Job:** Run `verify-run-truthfulness.ts` and fail if mismatches found.

### 4. **Update `rework-handling` skill to include truthfulness check**
**Change:** Add a mandatory step before writing a summary:
```
Before producing the summary, run `verify-run-truthfulness.ts` and include its output in the handover.
```

### 5. **Ingest Hindsight correction for T4**
**Action:** Ingest a document titled "Correction: T4 heterogeneity claim" stating:
- What memory claimed: "T4 run exercised heterogeneous model routing."
- What is true: "All T4 model calls were freellmapi due to config-key mismatch."
- Evidence: `plugins/hermes/run.log` shows 4/4 calls as freellmapi.

---

## Recommended Follow-Ups

1. **Create issue: "Add verify-run-truthfulness script"**
   - Script compares config vs. log evidence.
   - Auto-run after `run-prototype.ts`.
   - Fail summary generation if mismatches found.

2. **Create issue: "Add CI gate for truthfulness"**
   - GitHub workflow that runs on docs changes.
   - Blocks merge if summary claims ≠ log evidence.

3. **Create issue: "Ingest Hindsight correction for T4 heterogeneity"**
   - Document the error and correction for future recall.

4. **Create issue: "Auto-generate model-call table in run-prototype.ts"**
   - Append a summary section to every run log.
   - Makes evidence immediately visible.

5. **Create issue: "Update rework-handling skill with truthfulness check"**
   - Mandatory step before summary generation.

---

## TRACE

```
team-lead → post-mortem-analyst [SUCCESS]
```

---

## Appendix: Timeline of Errors and Corrections

| Time | Event | Error | Correction |
|---|---|---|---|
| Oct 13 18:08 | T4 run executed | Config-key mismatch → all freellmapi | None at time |
| Oct 13 20:06 | T4 summary committed | Claimed "heterogeneity exercised" | None at time |
| Oct 14 05:15 | T6 run 1 (B=2, PASS) | Mislabeled as "B=1 failed" | Later corrected |
| Oct 14 05:54 | T6 run 4 (B=1, PASS) | — | Independent verification |
| Oct 14 08:01 | T6 summary committed | Corrected B=1 verdict, noted heterogeneity bug | `componentModel()` added |
| Oct 14 09:04 | Post-mortem analysis | — | This document |

---

**Key Lesson:** Verification must be **programmatic and automated**, not manual and reactive. Summary claims should be **generated from evidence**, not written from memory and later corrected.
