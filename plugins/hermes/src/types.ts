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
