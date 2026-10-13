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
