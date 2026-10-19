export interface ModelRef {
  providerID: string;
  id: string;
  variant?: string;
}

export interface Config {
  evalRepo: string;
  budget: { B: number };
  components: Record<string, { file: string; model: ModelRef }>;
  harness: {
    activation: { model: ModelRef };
    diagnosis: { model: ModelRef };
  };
  /**
   * T6 revision-exercise flag (default false).
   *
   * When true, round 0's on-disk artifact for `src/validator.ts` is
   * deterministically constrained to be deliberately incomplete (the
   * null-guard is kept but the lowercasing is stripped), so round 0
   * executes → fails → DIAGNOSE FAIL → ACTIVATE replans → round 1
   * completes the fix → EXECUTE passes → DIAGNOSE PASS at b=1.
   *
   * The model does real reasoning in both rounds; this flag only
   * constrains round 0's on-disk artifact. It makes the revision
   * trajectory reproducible on re-run — never rely on the model to
   * spontaneously produce an incomplete fix.
   */
  incompleteRound0?: boolean;
  /**
   * Intra-round convergence flag (default off).
   *
   * When true, the collaboration phase re-runs components that receive new
   * messages within the same round until no new messages are produced
   * (capped by max passes per component). Default off preserves T6 baseline.
   */
  intraRoundConvergence?: boolean;
  /**
   * Parallel primitive execution flag (default off).
   *
   * When true, the collaboration phase schedules independent primitives
   * concurrently based on the dependency DAG from plan.activated_components.
   * When false (default), the harness uses the existing sequential single-pass
   * path — byte-identical to prior behavior.
   */
  parallelPrimitives?: boolean;
  /**
   * Test-only seam to force component processing order without changing
   * default behavior. Used for deterministic mechanics tests.
   */
  __testComponentOrderOverride?: string[];
  /**
   * Test-only max passes per component for convergence loop.
   */
  __testMaxPassesPerComponent?: number;
  /**
   * Per-model pricing for cost estimation (issue #19).
   *
   * Keyed by bare model id (e.g. "freellmapi"). Values are USD per million
   * tokens. When a model has no entry, `estimatedCost` returns `null` for any
   * aggregate that includes an unpriced call — "not available" is
   * distinguishable from "free".
   */
  pricing?: Record<string, { input: number; output: number; currency?: string }>;
}

export interface Plan {
  status: "PLAN" | "REPLAN";
  issue_summary: string;
  activated_components: ActivatedComponent[];
  execution_plan: string[];
  rationale: string;
  replanned?: boolean;
}

export interface ActivatedComponent {
  component: string;
  objective: string;
  dependencies: string[];
  communication_targets: string[];
  expected_action: "inspect" | "modify" | "validate";
}

export interface Message {
  source: string;
  target: string;
  type: "interface" | "dependency" | "behavior" | "test" | "configuration";
  message: string;
  required_action: string;
}

export interface DevPrimitiveOutput {
  component: string;
  action: "modify" | "no_change";
  summary: string;
  changes: Array<{ location: string; description: string }>;
  updated_artifact: string;
  messages: Array<{ target: string; message: string }>;
  validation_notes: string[];
  createdArtifacts?: string[];
}

export interface Evidence {
  o_shell: string;
  o_test: string;
  o_runtime: string;
  o_trace: string;
}

export interface DiagnosisOutput {
  status: "PASS" | "FAIL";
  evidence?: string[];
  summary?: string;
  failure_evidence?: Array<{ source: string; evidence: string }>;
  suspected_causes?: Array<{ component: string; reason: string }>;
  missing_components?: string[];
  revision_guidance?: Array<{ component: string; action: string }>;
}

/**
 * A modification that was successful in a prior round and should be
 * retained unless contradicted by new execution evidence (Paper B.5).
 */
export interface RetainedModification {
  /** Repository path of the modified file, e.g. "src/validator.ts" */
  filePath: string;
  /** The full artifact content that was successful */
  content: string;
  /** The round number in which this modification succeeded */
  round: number;
  /** Human-readable reason for retention (e.g., "passed tests, no regressions") */
  reason: string;
}

/** Map of filePath -> RetainedModification */
export type RetainedModifications = Record<string, RetainedModification>;

/**
 * Token usage for a single model call or an aggregate.
 *
 * Paper F.8 (Baseline Provenance) and Appendix I (Limitations) require token
 * counts and inference costs to be accumulated over complete trajectories so
 * that baseline runs are reproducible and comparable. (issue #19)
 */
export interface TokenUsage {
  input: number;
  output: number;
  total: number;
}

/**
 * Estimated cost for a token aggregate, in USD.
 *
 * `null` when no model in the trajectory has a known per-token price (e.g. an
 * unknown or free-tier model) — the caller should treat cost as "not
 * available" rather than guessing zero.
 */
export interface TokenCostEstimate {
  input: number;
  output: number;
  total: number;
  currency: string;
}

export interface GenerateResult {
  text: string;
  usage?: TokenUsage;
}

/**
 * The generate function signature matches OpenCode's `ctx.generate.text`:
 * `GenerateTextOutput = { text: string }` (no usage field, see
 * docs/opencode-plugin-sdk-reference.md §3a). Token usage is therefore
 * estimated from prompt/response string lengths when the host does not
 * expose it. (issue #19)
 *
 * Callers may return a `GenerateResult` with an optional `usage` field when
 * the underlying provider exposes token counts; when absent, usage is
 * estimated by the `TokenTracker` wrapper.
 */
export type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<GenerateResult>;
