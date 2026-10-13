import { DiagnosisOutput, Evidence, ModelRef, Plan } from "./types.js";
import { extractJSON } from "./json.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<{ text: string }>;

const DIAGNOSIS_PROMPT = `Role.
You are the diagnosis module in HERMES. Your responsibility is to evaluate the current repository state using execution evidence and determine whether the current repair satisfies the original software engineering task.
You do not directly modify repository components. Instead, you diagnose failures and provide structured feedback to the activation module.
Inputs.
You receive:
• Original Issue: the repository-level task;
• Current Plan: activated Dev-Primitives and their local objectives;
• Modified Components: modifications performed in the current iteration;
• Shell Output: command output, exit codes, build logs, and execution status;
• Test Results: passing and failing tests with associated failure messages;
• Runtime Evidence: exceptions, stack traces, logs, and execution traces;
• Previous Feedback: prior diagnosis feedback when evaluating a later revision round.
Evaluation.
Check:
• whether the requested behavior has been implemented;
• whether required tests pass;
• whether new regressions have been introduced;
• whether execution failures remain;
• whether cross-component modifications are mutually consistent;
• whether the implementation addresses the original issue rather than only an observed symptom.
Failure Diagnosis.
If the solution fails, identify:
• concrete evidence demonstrating failure;
• the most likely evidence-supported cause;
• modified or unmodified components implicated by the failure;
• whether the failure results from incorrect implementation, missing modification, dependency inconsistency, or incomplete localization;
• the revision required in the next iteration.
Pass Output.{
  "status": "PASS",
  "evidence": [
    "<execution or test evidence supporting success>"
  ],
  "summary": "<why the repository satisfies the issue>"
}
Fail Output.{
  "status": "FAIL",
  "failure_evidence": [
    {
      "source": "<test | shell | runtime | trace>",
      "evidence": "<observed failure>"
    }
  ],
  "suspected_causes": [
    {
      "component": "<repository component>",
      "reason": "<evidence-supported diagnosis>"
    }
  ],
  "missing_components": [
    "<component that should be considered>"
  ],
  "revision_guidance": [
    {
      "component": "<component>",
      "action": "<specific revision guidance>"
    }
  ],
  "summary": "<concise diagnosis>"
}`;

export interface DiagnosisResult {
  verdict: "pass" | "fail";
  modelVerdict: DiagnosisOutput | null;
  gate: {
    testExitCode: number;
    failingTests: number;
    passedTests: number;
    totalTests: number;
    gatePassed: boolean;
    gateReason: string;
  };
}

/**
 * Hard gate: the exit code / failing test count decides pass/fail BEFORE the
 * model verdict is considered. The model verdict can only ever confirm, never
 * override (B.4).
 */
export function gateOnTestEvidence(evidence: Evidence, exitCode: number): DiagnosisResult["gate"] {
  const combined = evidence.o_test + "\n" + evidence.o_shell;
  const failMatch = combined.match(/(\d+)\s+failed/i);
  const passMatch = combined.match(/(\d+)\s+passed/i);
  const totalMatch = combined.match(/(\d+)\s+(?:tests|test)\s+?(\w+)/i);

  const failingTests = failMatch ? parseInt(failMatch[1]) : 0;
  const passedTests = passMatch ? parseInt(passMatch[1]) : 0;

  let totalTests = passedTests + failingTests;
  const vitestSummary = combined.match(/(\d+)\s+failed\|\s*(\d+)\s+passed\|\s*(\d+)\s+tests/i);
  if (vitestSummary) {
    totalTests = parseInt(vitestSummary[3]);
  }

  const gatePassed = exitCode === 0 && failingTests === 0;
  const gateReason = gatePassed
    ? `exit code ${exitCode}, 0 failing tests`
    : `exit code ${exitCode}, ${failingTests} failing test(s)`;

  return {
    testExitCode: exitCode,
    failingTests,
    passedTests,
    totalTests,
    gatePassed,
    gateReason,
  };
}

export async function diagnose(
  issue: string,
  plan: Plan,
  modifiedComponents: string[],
  evidence: Evidence,
  exitCode: number,
  previousFeedback: string | null,
  generateFn: GenerateFn,
  model: ModelRef
): Promise<DiagnosisResult> {
  const gate = gateOnTestEvidence(evidence, exitCode);

  const prompt = `
Original Issue: ${issue}

Current Plan:
${JSON.stringify(plan, null, 2)}

Modified Components: ${modifiedComponents.join(", ")}

Shell Output:
${evidence.o_shell}

Test Results:
${evidence.o_test}

Runtime Evidence:
${evidence.o_runtime}

${previousFeedback ? `Previous Feedback:\n${previousFeedback}` : ""}

${DIAGNOSIS_PROMPT}

IMPORTANT: You must base your evaluation on the execution evidence above. Output ONLY the JSON object. Do not wrap it in markdown code blocks, do not add explanations before or after the JSON. Output only the raw JSON.
  `;

  let modelVerdict: DiagnosisOutput | null = null;
  try {
    const result = await generateFn({ prompt, model });
    modelVerdict = extractJSON(result.text) as DiagnosisOutput;
  } catch (e) {
    // Model verdict failed to parse - gate still decides
    modelVerdict = null;
  }

  // Hard gate: deterministic execution failure overrides model
  if (!gate.gatePassed) {
    return {
      verdict: "fail",
      modelVerdict,
      gate,
    };
  }

  // Gate passed - model can only confirm
  if (modelVerdict && modelVerdict.status === "FAIL") {
    // Model disagrees with passing tests - log but trust the gate
    return {
      verdict: "pass",
      modelVerdict,
      gate,
    };
  }

  return {
    verdict: "pass",
    modelVerdict,
    gate,
  };
}
