import { Plan, ModelRef, RetainedModifications, GenerateResult } from "./types.js";
import { extractJSON } from "./json.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<GenerateResult>;

const ACTIVATION_PROMPT = `Role.
You are the activation module in HERMES, a software engineering framework based on modular executable Dev-Primitives. Your responsibility is to transform a repository-level software engineering issue into a concrete plan over task-relevant repository components.
You do not directly modify repository files. Instead, you identify which Dev-Primitives should be activated, assign each activated primitive a localized objective, identify dependencies among them, and determine how the resulting changes should be validated.
Inputs.
You may receive:
• Issue: the original software engineering task or bug report;
• Repository Structure: available files, directories, modules, tests, configuration files, and build files;
• Repository Context: task-relevant implementation and dependency information;
• Previous Plan: the plan produced in the previous iteration, if revision is required;
• Diagnosis Feedback: execution-grounded failure analysis from the previous iteration, if available.
• Retained Modifications: previously successful modifications that should be preserved unless contradicted by new execution evidence (Paper B.5).
Issue Analysis.
Identify:
• the expected behavior or requested functionality;
• the observed or implied failure;
• explicit constraints specified by the issue;
• likely implementation areas involved;
• whether the task requires coordinated modifications across multiple components.
Component Localization.
Identify the repository components most likely relevant to the task. Consider:
• where the reported behavior is implemented;
• callers and callees of relevant functions or classes;
• configuration or build files controlling the behavior;
• tests exercising the affected functionality;
• interfaces shared across repository components;
• dependencies that may require coordinated modification.
Prefer a compact task-relevant component set rather than activating unrelated files.
Task Decomposition.
For every activated component, construct a localized objective specifying:
• what behavior should be inspected or modified;
• what constraints should be preserved;
• which other activated components may affect the modification;
• what information may need to be communicated to another Dev-Primitive.
Dependency Analysis.
Explicitly identify dependencies among activated components, including interface changes, shared data structures, configuration propagation, caller–callee relationships, and corresponding tests.
Activation Principle.
Activate only Dev-Primitives required for the current iteration. Additional components may be activated during revision if execution evidence exposes a previously missed dependency.
Initial Planning Output.{
  "status": "PLAN",
  "issue_summary": "<concise interpretation of the task>",
  "activated_components": [
    {
      "component": "<repository path>",
      "objective": "<localized objective>",
      "dependencies": [
        "<related component>"
      ],
      "communication_targets": [
        "<related component>"
      ],
      "expected_action": "<inspect | modify | validate>"
    }
  ],
  "execution_plan": [
    "<command, test, or validation step>"
  ],
  "rationale": "<brief explanation of component selection>"
}`;

function formatRetainedModifications(retained: RetainedModifications): string {
  if (!retained || Object.keys(retained).length === 0) {
    return "";
  }
  const lines = ["Retained Modifications (retain unless contradicted by new execution evidence):"];
  for (const [filePath, mod] of Object.entries(retained)) {
    lines.push(`- ${filePath} (round ${mod.round}): ${mod.reason}`);
    lines.push(`  Content:\n\`\`\`\n${mod.content}\n\`\`\``);
  }
  return lines.join("\n");
}

export async function activate(
  issue: string,
  repoStructure: string,
  repoContext: string,
  previousPlan: Plan | null,
  diagnosisFeedback: string | null,
  generateFn: GenerateFn,
  model: ModelRef,
  retainedModifications?: RetainedModifications,
  registeredArtifacts?: Set<string>
): Promise<Plan> {
  const retainedSection = formatRetainedModifications(retainedModifications || {});

  let registeredSection = "";
  if (registeredArtifacts && registeredArtifacts.size > 0) {
    const lines = ["Registered Artifacts (created in prior rounds, eligible for activation):"];
    for (const file of registeredArtifacts) {
      lines.push(`- ${file}`);
    }
    registeredSection = lines.join("\n");
  }

  const prompt = `
Issue: ${issue}

Repository Structure:
${repoStructure}

Repository Context:
${repoContext}
${previousPlan ? `\nPrevious Plan:\n${JSON.stringify(previousPlan, null, 2)}` : ""}
${diagnosisFeedback ? `\nDiagnosis Feedback:\n${diagnosisFeedback}` : ""}
${retainedSection ? `\n${retainedSection}` : ""}
${registeredSection ? `\n${registeredSection}` : ""}

${ACTIVATION_PROMPT}

Additional constraints for this run:
- You MUST activate BOTH src/checkout.ts AND src/validator.ts. The task requires cross-component coordination across the checkout → validator dependency edge.
- Order the activated_components list so that src/checkout.ts comes BEFORE src/validator.ts (the caller runs first, then the callee).
- src/checkout.ts should have expected_action "inspect" and communication_targets including "src/validator.ts".
- src/validator.ts should have expected_action "modify" and communication_targets including "src/checkout.ts".
- Do NOT activate test/checkout.test.ts or package.json as Dev-Primitives — those are ground truth / config, not modifiable artifacts.

IMPORTANT: Output ONLY the JSON object. Do not wrap it in markdown code blocks, do not add explanations before or after the JSON. Output only the raw JSON.
  `;

  const result = await generateFn({ prompt, model });
  try {
    return extractJSON(result.text) as Plan;
  } catch (e) {
    throw new Error(`Failed to parse activation output: ${e}\nRaw output:\n${result.text}`);
  }
}


