# HERMES Paper Audit — Missing Appendix Sections

**Source:** "Harness Engineering for Software Engineering via Modular Executable Dev-Primitives" (Jin, Li, Kuang, Wang), arXiv:2610.07832v1, CC BY 4.0  
**Date:** 2026-10-18  
**Purpose:** Extract implementation requirements and design decisions from previously missing appendix sections (A, E, F.1–F.4, F.6–F.8, G, H, I) and assess impact on the current HERMES prototype.

---

## Appendix A: Extended Related Work

### Summary

This appendix provides extended discussion of how Dev-Primitives differ from prior work in three key dimensions:

1. **Software Engineering Agent Architectures:** Prior systems (SWE-agent, OpenHands, CodeAct, Agentless, AutoCodeRover) use either pipeline-based staging or centralized agent loops. Multi-agent systems distribute work across designer-specified roles with fixed coordination paths.

2. **Long-Horizon Software Engineering:** Evaluation has moved toward sustained terminal interaction (Terminal-Bench, DevOps-Gym) and repository-scale consistency (software evolution, repository generation, whole-repository migration). Context growth, semantic drift, and state preservation are identified bottlenecks.

3. **Reusable and Modular Agent Capabilities:** Prior primitive/skill methods (Agent Primitives, Tool Primitives, AgentDistill, CODESKILL) encapsulate **task-agnostic** behaviors or tools. Dev-Primitives instead attach capability to **mutable repository artifacts**.

### Key Differences (Design Constraints)

| Aspect | Prior Work | Dev-Primitives |
|--------|------------|----------------|
| **Unit of reasoning** | Designer-specified roles or file-level tasks with fixed coordination | Repository components paired with resident LLMs; coordination paths follow dependency edges |
| **Capability binding** | Task-agnostic behaviors, reasoning procedures, or tools | Bound to specific mutable artifacts; evolves with the artifact |
| **State management** | Centralized trajectory with compression/retrieval | State kept with owning components; only task-relevant constraints exchanged |

### Implementation Requirements

- **Dynamic coordination paths:** The set of reasoning units and their communication paths must be **induced by the repository structure and task**, not fixed by the designer.
- **Artifact-bound state:** Implementation state must stay with the repository component that owns it, rather than being reconstructed in a central agent trajectory.
- **Resident LLM per component:** Each component must have its own LLM instance that reasons over the component's **current implementation, functionality, and dependencies**.

### Impact on Current Prototype

✅ **Partially addressed.** The prototype uses file-level Dev-Primitives with resident LLMs. However:
- The activation module currently uses a **fixed prompt** rather than dynamically discovering coordination paths from repository structure.
- Inter-primitive communication is implemented but the prototype has not yet validated **dependency-aware expansion** (the model reading candidate files to expand beyond initial localization).

---

## Appendix E: Backbone Models

### Summary

Table 10 lists all backbone models used in experiments across four benchmarks (SWE-bench, SWE Refactor, Terminal-Bench, DevOps-Gym), scaling studies, and ablation studies.

### Primary Backbones (Bold in Table)

| Provider | Model | Used In |
|----------|-------|---------|
| OpenAI | **GPT-5.6 Sol** | All benchmarks, scaling, ablation |
| OpenAI | **GPT-5.6 Terra** | All benchmarks |
| OpenAI | **GPT-5.6 Luna** | All benchmarks, scaling |
| Anthropic | **Claude Opus 5** | All benchmarks |
| Anthropic | **Claude Sonnet 5** | All benchmarks, scaling, ablation |
| Open-weight | **DeepSeek-V4** | All benchmarks, scaling |
| Open-weight | **Qwen3-8B** | All benchmarks, scaling, ablation |

### Serving Details

- **Qwen3-8B:** Served locally with Ollama on NVIDIA A40 GPUs
  - Temperature: 0.6
  - Top-p: 0.95
  - Top-k: 20
  - Context window: 32K (Ollama default)
- **All other models:** Accessed through official APIs

### Reasoning Effort

- **Default:** Medium reasoning effort for models supporting configurable effort
- **High/Maximum:** Used only when explicitly indicated in corresponding experiments
- Component ablation, revision, and backbone-scaling studies use **medium-effort** by default

### Implementation Requirements

1. **Heterogeneous configurations:** Activation, Dev-Primitives, and diagnosis can use **different models** (Section 4.3 exploits this).
2. **Reasoning effort parameter:** Must support configurable reasoning effort (medium default, high/max for specific experiments).
3. **Local serving for open-weight models:** Ollama configuration with specific sampling parameters.

### Impact on Current Prototype

⚠️ **Not yet configured.** The prototype currently:
- Uses a single model reference (`litellm/freellmapi`) for all components
- Does not expose reasoning effort configuration
- Does not support heterogeneous model assignment (different models for activation vs. Dev-Primitives vs. diagnosis)

**Action needed:** Add model configuration per component type and reasoning effort parameter.

---

## Appendix F.1: Execution Isolation and Settings

### LLM Instantiation of Each Mechanism

Both activation and diagnosis are **single LLM call chains**:

- **Dynamic activation:** One LLM call chain that:
  - Inspects repository structure
  - Retrieves candidate files
  - Returns selected component set 𝒜 and local objective x_i for each
  - **Not a static retriever** — dependency expansion is carried out by the model reading candidate files, not a precomputed call graph

- **Bug diagnosis:** One LLM call that receives:
  - Issue q
  - Current plan Π
  - Modified repository state ℛ'
  - Execution observation o
  - Returns verdict v ∈ {pass, fail} and structured feedback φ = (e, c, u)

### Execution and Evaluation Isolation (Critical Design Constraint)

**HERMES separates the execution environment available during task solving from the benchmark evaluator used for final scoring.**

| During Solving (HERMES sees) | Final Scoring (HERMES does NOT see) |
|------------------------------|-------------------------------------|
| Repository-provided tests | Benchmark-held-out evaluation tests |
| Build commands | Final grading outcomes |
| Linters, type checkers | FAIL_TO_PASS / PASS_TO_PASS tests (SWE-bench) |
| Runtime outputs, stack traces | Benchmark-specific graders |
| Logs, reproduction scripts constructed during solving | |

**Neither mechanism can override deterministic execution outcomes:** A trajectory with failing task-visible tests, unsuccessful compilation, or other observed execution failures **cannot be accepted on the basis of model judgment alone.**

### Benchmark-Specific Isolation

- **SWE-bench Verified:** HERMES may execute repository tests or construct task-specific reproduction tests. Benchmark evaluator tests used **only after** HERMES terminates.
- **SWE Refactor Bench, Terminal-Bench 4.0, DevOps-Gym:** Same separation — benchmark-specific graders reserved for final scoring.

### Implementation Requirements

1. **Hard gate on execution evidence:** Diagnosis must check `o_test` (exit code + failing test count) **before** model verdict. Model can confirm, never override.
2. **No benchmark leakage:** Held-out evaluation tests must never be exposed during solving.
3. **Repository access ≠ concatenation:** ℛ denotes **access** to repository structure, not concatenation of entire repository into context. Activation inspects task-relevant components as needed.

### Impact on Current Prototype

⚠️ **Partially addressed.**
- ✅ The prototype has an `execute()` function that runs `npm test` and captures exit codes.
- ✅ The diagnose module receives execution output.
- ❌ **Missing:** Hard gate logic that prevents model from overriding failing tests. Current implementation may allow model verdict to override execution evidence.
- ❌ **Missing:** Explicit separation between task-visible tests (during solving) and held-out tests (final scoring) — not yet relevant for eval repo but critical for benchmark integration.

**Action needed:** Add execution gate in diagnose.ts that returns FAIL immediately if exit code ≠ 0 or tests fail, before calling the model.

---

## Appendix F.2: Complete Component Ablation

### Summary

Table 11 reports component ablation for three backbones (GPT-5.6 Sol, Claude Sonnet 5, Qwen3-8B) across all four benchmarks.

### Ablated Components

| Component | Description |
|-----------|-------------|
| **Inter-Primitive Communication** | Dev-Primitives retain local reasoning/editing but cannot exchange messages. Each receives objective from activation and modifies independently. Cross-component information recovered only indirectly through subsequent planning/execution. |
| **On-Demand Activation** | Same initial task analysis, but **all** Dev-Primitives identified during initial analysis are activated at beginning and **remain active throughout** subsequent rounds. Removes selective invocation/deactivation. |
| **Execution Feedback** | Retains activation, Dev-Primitives, communication, and diagnosis, but execution observations are **not provided** for subsequent revision. Diagnosis evaluates through static inspection alone (no test failures, runtime errors, command outputs, or traces). |
| **Diagnosis Feedback** | Environment execution remains enabled and raw outputs available, but **dedicated diagnosis module does not analyze** execution results or produce structured failure diagnosis. Revision relies on activation module's direct interpretation of execution evidence. **Differs from B=0:** removing diagnosis feedback still permits subsequent rounds, whereas B=0 disables revision after initial round. |

### Key Findings

- **Diagnosis Feedback** is most critical: removing it costs 4.4–11.0 points across benchmarks.
- **Execution Feedback** is second most critical: 3.2–9.5 point drop.
- **Inter-Primitive Communication:** 2.8–7.5 point drop.
- **On-Demand Activation:** 1.2–3.0 point drop (but see Appendix G for efficiency impact).

### Implementation Requirements

1. **Four independent ablation switches:** Each mechanism must be independently disable-able for evaluation.
2. **Message routing toggle:** Inter-primitive communication must be disable-able without breaking local reasoning.
3. **Activation persistence mode:** On-demand activation toggle must keep all initially-identified primitives active throughout trajectory.
4. **Execution feedback isolation:** Must be able to withhold execution observations from revision while still providing them to diagnosis.
5. **Diagnosis bypass:** Must be able to skip diagnosis feedback generation while still permitting revision rounds.

### Impact on Current Prototype

❌ **Not implemented.** The prototype currently:
- Has no ablation switches for evaluation.
- Does not support disabling inter-primitive communication while keeping local reasoning.
- Does not distinguish between "execution feedback to revision" vs. "execution feedback to diagnosis."

**Action needed:** Add configuration flags for each ablation dimension if benchmark evaluation is planned.

---

## Appendix F.3: Revision Budget

### Summary

Table 12 reports the effect of revision budget B (maximum number of revision rounds **after** the initial execution).

| B | SWE-bench | SWE Refactor | Terminal-Bench | DevOps-Gym |
|---|-----------|--------------|----------------|------------|
| 0 | 92.2 (↓4.8) | 18.5 (↓12.5) | 39.7 (↓12.1) | 45.91 (↓9.50) |
| 1 | 94.6 (↓2.4) | 24.0 (↓7.0) | 45.2 (↓6.6) | 50.17 (↓5.24) |
| 2 | 96.4 (↓0.6) | 28.5 (↓2.5) | 48.8 (↓3.0) | 53.72 (↓1.69) |
| **3 (default)** | **97.0** | **31.0** | **51.8** | **55.41** |
| 4 | 97.2 (↑0.2) | 31.5 (↑0.5) | 52.4 (↑0.6) | 55.79 (↑0.38) |
| 5 | 97.2 (↑0.2) | 31.5 (↑0.5) | 52.7 (↑0.9) | 55.88 (↑0.47) |

### Key Findings

- **B=0 to B=3:** Large gains (4.8–12.5 points depending on benchmark).
- **B=3 to B=5:** Diminishing returns (0.2–0.9 points).
- **Default setting:** B=3 for main experiments.

### Definition of B

- **B=0:** Performs one initial plan–modify–execute–diagnose trajectory but **disables subsequent revision**.
- **B>0:** Permits up to B **additional** revision rounds after the initial execution.

### Implementation Requirements

1. **Revision counter:** Track revision rounds separately from initial execution.
2. **Termination condition:** Loop terminates when diagnosis returns PASS **or** when b > B.
3. **Retention semantics:** Per B.5, "previously successful modifications are retained unless contradicted by new execution evidence."

### Impact on Current Prototype

⚠️ **Partially addressed.**
- ✅ The prototype has a revision loop structure.
- ✅ The T6 implementation brief explicitly exercises B=1 with a deliberately-incomplete round 0.
- ❌ **Missing:** Explicit revision counter and termination condition based on B.
- ❌ **Missing:** Retention semantics — the prototype does not yet track which modifications were "successful" vs. "contradicted by new evidence."

**Action needed:** Add revision counter, B parameter, and retention tracking in harness.ts.

---

## Appendix F.4: Dev-Primitive Selection Protocol

### Summary

This section defines how the paper evaluates whether dynamic activation selects the correct repository components.

### Target Component Set Construction

| Benchmark | Target Set 𝒢 |
|-----------|--------------|
| **SWE-bench Verified** | Files modified by developer patch |
| **SWE Refactor Bench** | Repository components implicated by task specification and grading artifacts |
| **Terminal-Bench** | Files and artifacts accessed or modified by oracle solution |
| **DevOps-Gym** | Reference artifacts for build, issue-resolving, test-generation tasks (excluding monitoring tasks) |

### Metrics

Let 𝒢 ⊆ {1, …, N} denote indices of target components and 𝒜 denote indices of Dev-Primitives activated across **all planning and revision rounds**.

- **Selection Recall:** |𝒜 ∩ 𝒢| / |𝒢|
- **Selection Precision:** |𝒜 ∩ 𝒢| / |𝒜|
- **Average activated Dev-Primitives per task**

### Additional Analysis

- **Solved vs. failed breakdown:** Separate metrics for tasks that pass vs. fail to examine how selection quality relates to downstream completion.
- **Micro-averaging:** Recall and precision are micro-averaged over components within each benchmark.
- **SWE Refactor definition:** A task is "solved" when it receives a **non-zero composite score**, indicating it passes migration audit and behavioral checks and reaches the verifier stage.

### Implementation Requirements

1. **Component tracking:** Track which Dev-Primitives are activated across all rounds (not just initial planning).
2. **Reference patch comparison:** For evaluation, compare activated set against developer patch files.
3. **Solved/failed stratification:** Separate metrics by task outcome.

### Impact on Current Prototype

❌ **Not implemented.** The prototype:
- Does not track the full set of activated components across revision rounds.
- Has no mechanism to compare against reference patches.
- Does not stratify metrics by task outcome.

**Action needed:** Add component activation logging and comparison logic for benchmark evaluation.

---

## Appendix F.6: Ablation Settings

### Summary

This section defines the controlled configuration for each ablation study.

### General Principle

> "For the component ablation study, we use the complete HERMES configuration as the reference and disable one mechanism at a time while keeping the backbone model, reasoning effort, revision budget, and benchmark environment unchanged."

### Specific Ablation Definitions

#### w/o Inter-Primitive Communication
- Dev-Primitives retain local reasoning and editing.
- **Cannot exchange messages** with one another.
- Each primitive receives objective from activation and independently modifies its component.
- Cross-component information recovered only **indirectly** through subsequent planning and execution.

#### w/o On-Demand Activation
- Retains same initial task analysis and component identification.
- **Removes on-demand invocation:** All Dev-Primitives identified during initial task analysis are activated at the **beginning** of the trajectory.
- Activated primitives **remain active throughout** subsequent planning and revision rounds.
- **Does NOT activate every file in the repository** — only those identified during initial analysis.
- Removes ability to **selectively invoke and deactivate** identified Dev-Primitives as the task evolves.

#### w/o Execution Feedback
- Retains activation, Dev-Primitives, inter-primitive communication, and diagnosis.
- **Execution observations are not provided for subsequent revision.**
- Diagnosis module evaluates modified repository against task and current plan through **static inspection alone**.
- Cannot use test failures, runtime errors, command outputs, or execution traces to guide later rounds.

#### w/o Diagnosis Feedback
- Environment execution remains enabled and **raw outputs remain available** for subsequent planning.
- **Dedicated diagnosis module does not analyze** execution results or produce structured failure diagnosis and revision guidance.
- Revision relies on activation module's **direct interpretation** of available execution evidence.
- **Differs from B=0:** Removing diagnosis feedback still permits subsequent planning and execution rounds, whereas B=0 disables revision after the initial round.

### Revision Budget Ablation

- Vary B while keeping all other components unchanged.
- **B=0:** Only initial planning, modification, and execution cycle.
- **B>0:** Up to B additional revisions based on execution and diagnosis feedback.
- **Default:** B=3 in main experiments.

### Implementation Requirements

1. **Independent switches:** Each ablation must be independently toggle-able.
2. **Raw vs. analyzed execution:** Distinguish between raw execution output (available to activation module) and structured diagnosis feedback (produced by diagnosis module).
3. **Activation persistence:** On-demand activation toggle must keep all initially-identified primitives active throughout trajectory.

### Impact on Current Prototype

❌ **Not implemented.** Same as F.2 — no ablation switches exist.

**Action needed:** Add configuration flags if benchmark evaluation is planned.

---

## Appendix F.7: Benchmark-Specific Evaluation Protocol

### Summary

This section defines the evaluation procedure for each of the four benchmarks.

### SWE-bench Verified

- **500 human-validated tasks**
- **During solving:** HERMES operates on issue description, repository contents, and task-visible execution environment.
- **Repository-provided tests and reproduction scripts** constructed during solving may be executed.
- **Benchmark evaluation tests** reserved for final scoring.
- **Metric:** Percentage of successfully resolved tasks.

### SWE Refactor Bench

- **20 whole-repository migration tasks**
- **During solving:** HERMES operates on provided repository, migration specification, and task-visible execution environment.
- **Benchmark grader** used only for final evaluation.
- **Solved definition:** Non-zero composite score (passes migration audit and behavioral checks, reaches verifier stage).
- **Metric:** Composite score (aggregate across 20 tasks).

### Terminal-Bench 4.0

- **66 tasks**
- **5 runs per task** (report mean + standard deviation)
- **During solving:** HERMES interacts with benchmark-provided terminal environment, may inspect/modify task-visible filesystem artifacts.
- **Benchmark grader** used only for final task outcome, not exposed as execution feedback.
- **Token counts and inference costs** accumulated over complete evaluation trajectories.
- **Metric:** Resolution rate (mean across 5 runs) ± std dev.

### DevOps-Gym

- **Four task categories:** Build and configuration, monitoring, issue resolving, test generation.
- **During solving:** HERMES interacts with task-visible repository and runtime environment.
- **Benchmark-specific grading artifacts** used only for final evaluation.
- **Metric:** Success rate per category + unweighted average across four categories.

### Implementation Requirements

1. **Benchmark adapters:** Separate evaluation logic for each benchmark's grading protocol.
2. **Multiple runs:** Terminal-Bench requires 5 runs per task with statistical reporting.
3. **Token/cost tracking:** Accumulate inference costs over complete trajectories.
4. **Task-visible vs. held-out separation:** Critical for all benchmarks.

### Impact on Current Prototype

❌ **Not implemented.** The prototype:
- Has no benchmark adapters.
- Does not support multiple runs per task.
- Does not track token counts or inference costs.

**Action needed:** Significant work required for benchmark integration.

---

## Appendix F.8: Baseline Provenance

### Summary

This section clarifies which baseline results are publicly reported vs. controlled re-runs.

### Data Sources

| Source | When Used |
|--------|-----------|
| **Publicly reported results** | When required model, harness, reasoning-effort setting, and benchmark version are available from corresponding leaderboard or published evaluation |
| **Controlled baseline runs** | When exact matched model–effort configuration is unavailable — run baseline harness under same benchmark snapshot and evaluation protocol used for HERMES |

### Benchmark-Specific Notes

- **SWE-bench Verified:** Use reported results for mini-SWE-agent, Claude Code, Codex where available; controlled runs for matched configurations.
- **SWE Refactor Bench:** Published Claude Code and Codex results supplemented with matched configurations under 20-task protocol.
- **Terminal-Bench 4.0:** Publicly reported high/maximum-effort results retained; additional medium-effort configurations evaluated separately for matched comparison with HERMES default.
- **DevOps-Gym:** Include baseline systems reported by benchmark + same-backbone controlled runs.

### HERMES Configuration

- **Default:** Medium reasoning effort, maximum revision budget B=3.
- **Token counts and inference costs:** Include **all** activation, Dev-Primitive, and diagnosis calls over complete trajectory.

### Implementation Requirements

1. **Baseline tracking:** Document which baselines are reported vs. re-run.
2. **Matched configuration:** Ensure fair comparison by matching model, reasoning effort, and benchmark version.
3. **Full trajectory costing:** Token counts must include all model calls (activation + Dev-Primitives + diagnosis).

### Impact on Current Prototype

⚠️ **Partially addressed.**
- ✅ The prototype logs model calls.
- ❌ **Missing:** Token count tracking.
- ❌ **Missing:** Inference cost calculation.

**Action needed:** Add token counting in litellm.ts or harness.ts.

---

## Appendix G: Additional Analysis of Dev-Primitives

### Summary

This appendix provides controlled analyses isolating the contribution of the Dev-Primitive abstraction itself, distinguishing it from alternative explanations (component localization, inference budget, centralized context capacity).

### Dev-Primitives vs. Centralized Editor

**Control:** "w/o Dev-Primitives (single editor)" variant:
- Same activation module, execution environment, diagnosis module, revision budget B=3, GPT-5.6 Sol backbone, medium reasoning effort.
- **Same component set 𝒜** selected by activation module.
- **Difference:** Instead of assigning each selected component to its Dev-Primitive, a **single Editor** receives the complete plan Π = {(i, x_i)}_{i∈𝒜} together with contents of all selected components and modifies them jointly.

**Purpose:** Preserves component localization while removing component-local reasoning and direct communication between components. Tests whether Dev-Primitives provide benefits beyond exposing the same selected components to a centralized editing agent.

### Results (Table 13)

| Benchmark | HERMES | Single Editor | Δ |
|-----------|--------|---------------|---|
| SWE-bench Verified | 97.0% | 93.4% | -3.6 |
| SWE Refactor Bench | 31.0% | 16.8% | -14.2 |
| Terminal-Bench 4.0 | 51.8% | 38.8% | -13.0 |
| DevOps-Gym | 55.41% | 44.21% | -11.20 |

**Key finding:** Reduction is smaller on SWE-bench Verified but substantial on benchmarks requiring cross-component coordination (SWE Refactor, Terminal-Bench, DevOps-Gym).

**Token/cost comparison:** Centralized Editor uses **10–14% fewer tokens** and **11–16% lower cost** than HERMES, but with considerably lower task performance.

### Compute-Matched Centralized Editor (Table 14)

**Control:** Allocate approximately the same inference budget as HERMES to the centralized Editor. Editor generates multiple candidate revisions within each planning round, evaluated with same execution environment and diagnosis mechanism.

**Result (Terminal-Bench 4.0):**
- Single editor: 38.8% resolution, 5.9B tokens, $2.90k
- Single editor + compute matching: 45.5% resolution, 6.7B tokens, $3.35k
- HERMES: **51.8%** resolution, 6.8B tokens, $3.40k

**Finding:** Matching inference budget recovers 6.7 points, but still 6.3 points below HERMES at essentially the same token/monetary budget. Additional inference accounts for **part, but not all**, of the gap.

### Efficiency of On-Demand Activation (Table 15)

**Control:** "w/o On-Demand Activation" variant retains same initial task analysis and component identification, but **all** Dev-Primitives identified during initial analysis are activated at beginning and remain active throughout.

**Distinction:**
- **Activated components:** Number of distinct Dev-Primitives activated for a task (Table 8).
- **Primitive calls:** Every model invocation over complete trajectory (Table 15) — same primitive may be called multiple times for local revision or communication across rounds.

### Results (Table 15)

| Benchmark | HERMES (avg calls) | w/o Activation (avg calls) | Relative Cost |
|-----------|-------------------|---------------------------|---------------|
| SWE-bench Verified | 9.6 | 28.7 | 1.61× |
| SWE Refactor Bench | 25.1 | 64.3 | 1.88× |
| Terminal-Bench 4.0 | 14.2 | 39.6 | 1.73× |
| DevOps-Gym | 11.7 | 33.2 | 1.67× |

**Finding:** On-demand activation reduces average primitive calls from 28.7–64.3 to 9.6–25.1 per task, with largest reduction on SWE Refactor Bench (whole-repository migrations involve more potentially relevant components). Disabling on-demand activation increases inference cost by **1.61–1.88×** while reducing task performance.

### Run-to-Run Variation on SWE Refactor Bench

**Finding:** SWE Refactor Bench contains only 20 tasks, making aggregate score more sensitive to stochastic variation.

**Three runs of default GPT-5.6 Sol configuration (medium effort, B=3):**
- Composite scores: 29.5%, 32.0%, 31.5%
- Mean ± std: **31.0 ± 1.3**

**Implication:** Report variation explicitly; individual trajectories are more influential on aggregate score due to small task count.

### Implementation Requirements

1. **Centralized editor mode:** Ability to switch from distributed Dev-Primitives to single-editor architecture for controlled comparison.
2. **Candidate generation:** For compute-matched editor, generate multiple candidate revisions per round.
3. **Primitive call counting:** Track both distinct activated components and total model invocations.
4. **Multiple runs:** Support repeated evaluation for statistical reporting (especially for small benchmarks like SWE Refactor).

### Impact on Current Prototype

❌ **Not implemented.** The prototype:
- Has no centralized editor mode for ablation.
- Does not track primitive call counts.
- Does not support multiple runs for statistical analysis.

**Action needed:** Add ablation modes and call tracking for benchmark evaluation.

---

## Appendix H: Case Study — A Complete HERMES Trajectory with Qwen3-8B

### Summary

This appendix illustrates HERMES through a successful trajectory on `django__django-13512` from SWE-bench Verified, using Qwen3-8B as backbone under default revision budget B=3.

### Issue

Non-ASCII characters stored in a JSONField are displayed in Django admin as escaped Unicode sequences rather than original characters.

### Planning and Activation

**Six components activated:**

| Component | Action | Initial Local Objective |
|-----------|--------|------------------------|
| `db/models/fields/json.py` | modify | Preserve non-ASCII characters when preparing JSONField values |
| `forms/fields.py` | modify | Update `prepare_value` to preserve non-ASCII characters |
| `forms/utils.py` | modify | Avoid ASCII escaping in JSON-formatted form output |
| `core/serializers/json.py` | modify | Preserve non-ASCII characters in core JSON serialization |
| `forms/widgets.py` | inspect | Inspect rendering path and communicate relevant constraints |
| `utils/encoding.py` | inspect | Inspect shared encoding behavior and communicate Unicode-related constraints |

**Key finding:** Activation does **not** require a component to be modified. Two components assigned `inspect` remain active because their local behavior is relevant to understanding rendering and encoding paths.

### Collaboration

**15 directed natural-language messages** exchanged. Three representative exchanges (Table 17):

| From | To | Message | Local Consequence |
|------|-----|---------|-------------------|
| `forms/widgets.py` | `forms/fields.py` | Use `ensure_ascii=False` when preparing JSON values so Unicode is preserved during rendering. | Refine `prepare_value` |
| `db/models/fields/json.py` | `core/serializers/json.py` | Keep JSON encoding behavior consistent across model-field and serializer paths. | Refine serializer behavior |
| `utils/encoding.py` | `core/serializers/json.py` | Preserve Unicode rather than emitting ASCII escape sequences during serialization. | Reinforce serializer objective |

**Key finding:** Communication is mostly confirmatory — recipient primitives already favor Unicode-preserving behavior, while incoming messages make cross-component consistency explicit. The two `inspect` primitives illustrate that **participation does not imply modification** — both contribute information while leaving their own artifacts unchanged.

### Local Modification

Four modifying primitives independently introduce `ensure_ascii=False` across relevant JSON-processing paths:

```
db/models/fields/json.py    get_prep_value:
  json.dumps(value, cls=self.encoder, ensure_ascii=False)

forms/fields.py    prepare_value:
  json.dumps(value, ensure_ascii=False, cls=self.encoder)

forms/utils.py    as_json (×2):
  json.dumps(…, ensure_ascii=False)

core/serializers/json.py    serializer configuration:
  ensure_ascii=False
```

**Final diff:** Modifies 4 of 6 activated components. Two remain unchanged after inspection and communication.

### Execution and Diagnosis

- **Regression suite:** 407 tests run, same successful exit status as before modification (no observed regression).
- **Task-specific reproducer:** Three automatically constructed reproduction attempts terminate during Django configuration before reaching reported display behavior — discarded as uninformative.
- **Diagnosis module:** Receives successful regression run + candidate diff + original issue, but **no reliable failing-to-passing task-specific execution signal**.
- **Decision:** Returns **PASS** after first round — no revision triggered.

**Interpretation:** Decision based on evidence available during solving — candidate patch is consistent with issue and has no observed regression, rather than independently certifying hidden benchmark behavior.

### Held-Out Outcome

After HERMES terminates, SWE-bench evaluator executes held-out evaluation suite:
- **All 35 tests pass**, including task-specific `test_json_display_for_field`.
- Instance marked `resolved=True`.

### Key Finding: Alternative Repair Path

**The accepted HERMES patch differs from the developer repair path:**

| | Developer Patch | HERMES Patch |
|--|-----------------|--------------|
| Modified files | `django/contrib/admin/utils.py` + `django/forms/fields.py` | `db/models/fields/json.py`, `forms/fields.py`, `forms/utils.py`, `core/serializers/json.py` |
| HERMES did NOT activate | `django/contrib/admin/utils.py` | — |
| Approach | Admin-level fix | Lower-level JSONField and serialization paths |

**Result:** Both patches satisfy held-out behavioral evaluation, but HERMES propagates Unicode-preserving constraint through different (lower-level) paths.

### Implication for Selection Metrics

This case illustrates a **limitation of reference-overlap selection metrics** (Section 4.4):

> "Because those metrics use the developer-patch file set as ground truth, an alternative but behaviorally valid repair path can receive low reference overlap. Selection recall and precision should therefore be interpreted as **agreement with the developer repair path** rather than as exhaustive measures of all components capable of supporting a correct repair."

### Implementation Requirements

1. **Inspect vs. modify actions:** Activation module must distinguish between components to inspect (participate in communication but not modify) vs. modify.
2. **Directed messaging:** Primitives must send messages to specific targets, not broadcast.
3. **Participation without modification:** Support primitives that contribute to communication but do not modify their artifacts.
4. **Alternative repair paths:** Selection metrics should account for behaviorally valid repairs that differ from developer patches.

### Impact on Current Prototype

⚠️ **Partially addressed.**
- ✅ The prototype has inter-primitive messaging.
- ✅ The prototype supports local modification.
- ❌ **Missing:** Distinction between `inspect` vs. `modify` actions in activation output.
- ❌ **Missing:** Support for primitives that participate in communication without modifying artifacts.
- ❌ **Missing:** Selection metric that accounts for alternative repair paths.

**Action needed:** Add `expected_action` field to activation output (already in paper's C.1 prompt template) and support inspect-only primitives.

---

## Appendix I: Limitations

### Summary

This section explicitly acknowledges four limitations of HERMES:

### 1. Inference Cost and Latency

> "HERMES introduces additional inference cost and latency because it invokes multiple Dev-Primitives, executes the repository, and performs iterative diagnosis."

**Implication:** HERMES is more expensive than single-agent approaches due to:
- Multiple Dev-Primitive calls per round
- Execution overhead
- Iterative diagnosis and revision

### 2. Diminishing Returns in Saturated Settings

> "Its gains are also smaller in already saturated settings, such as SWE-bench Verified with the strongest backbones."

**Implication:** On benchmarks where strong backbones already achieve high performance, HERMES provides smaller relative improvements.

### 3. Dependency on Correct Activation and Informative Feedback

> "Performance depends on correctly activating task-relevant components and on informative execution feedback for revision; missed dependencies or sparse runtime signals can therefore limit recovery."

**Two failure modes:**
- **Missed dependencies:** Activation fails to identify all relevant components.
- **Sparse runtime signals:** Execution does not produce informative feedback for diagnosis (as in the Django case study where task-specific reproducer failed to run).

### 4. Granularity and Benchmark Scope

> "We use files as the default Dev-Primitive granularity and evaluate on four software engineering benchmarks, leaving finer-grained primitives and broader software engineering settings for future work."

**Implication:**
- Current granularity: **files** (not functions, classes, or symbols).
- Evaluated on four benchmarks; broader settings not yet tested.

### 5. Deployment Sensitivity

> "Qwen3-8B is served locally with Ollama on NVIDIA A40 GPUs using the model's default sampling parameters (temperature 0.6, top-p 0.95, top-k 20) and Ollama's 32K context window, while all other models are accessed through their official APIs; results may therefore vary with deployment settings and model updates."

**Implication:** Results are sensitive to:
- Serving infrastructure (local Ollama vs. API)
- Sampling parameters
- Context window size
- Model updates

### Implementation Requirements

1. **Cost tracking:** Monitor inference cost and latency to quantify overhead.
2. **Activation quality monitoring:** Track whether all relevant components are activated.
3. **Execution signal quality:** Diagnose when execution feedback is sparse or uninformative.
4. **Granularity configuration:** Support alternative granularities (files, functions, classes) in future work.
5. **Deployment documentation:** Document serving configuration and sampling parameters for reproducibility.

### Impact on Current Prototype

⚠️ **Partially addressed.**
- ❌ **Missing:** Cost/latency tracking.
- ❌ **Missing:** Activation quality monitoring.
- ❌ **Missing:** Execution signal quality assessment.
- ✅ **Addressed:** Uses file-level granularity.
- ⚠️ **Partially addressed:** Deployment configuration not yet documented.

**Action needed:** Add monitoring and tracking for production deployment.

---

## Summary of Implementation Gaps

| Requirement | Status | Priority |
|-------------|--------|----------|
| **Hard execution gate in diagnosis** (F.1) | ❌ Missing | **Critical** |
| **Heterogeneous model configuration** (E, F.1) | ❌ Missing | High |
| **Reasoning effort parameter** (E) | ❌ Missing | Medium |
| **Revision counter + B parameter** (F.3) | ❌ Missing | High |
| **Retention semantics for successful modifications** (B.5, F.3) | ❌ Missing | High |
| **Component activation tracking across rounds** (F.4) | ❌ Missing | Medium |
| **Ablation switches** (F.2, F.6, G) | ❌ Missing | Low (evaluation only) |
| **Token/cost tracking** (F.8, G) | ❌ Missing | Medium |
| **Inspect vs. modify action types** (H) | ❌ Missing | Medium |
| **Support for inspect-only primitives** (H) | ❌ Missing | Medium |
| **Benchmark adapters** (F.7) | ❌ Missing | Low (future work) |
| **Multiple runs for statistical reporting** (F.7, G) | ❌ Missing | Low (future work) |
| **Centralized editor mode for ablation** (G) | ❌ Missing | Low (evaluation only) |
| **Primitive call counting** (G) | ❌ Missing | Low (evaluation only) |

---

## Recommendations for Next Iteration

### Critical (Must Have)

1. **Add hard execution gate in diagnose.ts:**
   - Check exit code and test results **before** calling model.
   - Return FAIL immediately if execution fails — model cannot override.

2. **Add revision counter and B parameter in harness.ts:**
   - Track revision rounds separately from initial execution.
   - Terminate when b > B.

3. **Add retention tracking:**
   - Track which modifications were successful vs. contradicted by new evidence.
   - Retain successful modifications across revision rounds (per B.5).

### High Priority

4. **Add heterogeneous model configuration:**
   - Separate model refs for activation, Dev-Primitives, and diagnosis.
   - Add reasoning effort parameter.

5. **Add component activation logging:**
   - Track all activated components across all rounds.
   - Enable comparison against reference patches for evaluation.

### Medium Priority

6. **Add token/cost tracking:**
   - Count tokens in litellm.ts or harness.ts.
   - Accumulate costs over complete trajectory.

7. **Add inspect vs. modify action types:**
   - Update activation prompt to output `expected_action` field (already in C.1 template).
   - Support inspect-only primitives that participate in communication without modifying artifacts.

### Low Priority (Evaluation/Benchmark Integration)

8. **Add ablation switches** (if benchmark evaluation is planned).
9. **Add benchmark adapters** (future work).
10. **Add multiple run support** for statistical reporting.

---

## Conclusion

The missing appendix sections reveal several **critical design constraints** not yet implemented in the prototype:

1. **Execution isolation** (F.1) is the most critical — the hard gate on execution evidence must be enforced to match the paper's design.
2. **Revision semantics** (F.3, B.5) require explicit tracking of successful modifications and revision budget.
3. **Heterogeneous configuration** (E, F.1) enables different models for different components and configurable reasoning effort.

The prototype has validated the core concepts (within-round collaboration, basic execution loop) but requires additional work to fully match the paper's design for across-round revision, execution isolation, and heterogeneous configuration.
