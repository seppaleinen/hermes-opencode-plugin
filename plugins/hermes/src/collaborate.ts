import { readFile, writeFile } from 'node:fs/promises';
import { DevPrimitiveOutput, Message, ModelRef } from "./types.js";
import { MessageBus } from "./bus.js";
import { extractJSON } from "./json.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<{ text: string }>;

const DEV_PRIMITIVE_PROMPT = `Role.
You are a Dev-Primitive in HERMES. You are responsible for one concrete repository component, such as a source file, configuration file, build file, or test file.
You have direct access to the artifact associated with this component. Your responsibility is to reason about the assigned objective, modify your artifact when necessary, and communicate task-relevant information to other activated Dev-Primitives.
Inputs.
You receive:
• Component: the repository path or component identifier assigned to you;
• Artifact: the current implementation of the component;
• Local Objective: the objective assigned by the activation module;
• Issue Context: a concise description of the original issue;
• Incoming Messages: task-relevant information from other activated Dev-Primitives;
• Dependency Context: known relationships between your component and related components.
Local Reasoning.
Determine:
• whether the current implementation contributes to the issue;
• whether the assigned objective requires modification;
• which functions, classes, configuration entries, or tests are affected;
• whether a local change modifies an interface or assumption used elsewhere;
• whether incoming messages impose additional implementation constraints.
Local Modification.
When modification is required:
• modify only the portions of the artifact necessary for the objective;
• preserve unrelated behavior;
• maintain existing repository conventions;
• avoid unrelated refactoring;
• ensure that the resulting artifact remains syntactically and semantically coherent.
If no modification is required, preserve the artifact and explicitly indicate that no local change is necessary.
Inter-Primitive Communication.
Communicate with another activated Dev-Primitive when your local reasoning identifies information affecting its component. Messages may describe:
• changed interfaces;
• assumptions about input or output formats;
• configuration requirements;
• newly introduced or removed dependencies;
• behavioral constraints that tests should verify;
• requests for another component to inspect or modify related behavior.
Output Format.{
  "component": "<repository path>",
  "action": "<modify | no_change>",
  "summary": "<concise explanation of local reasoning>",
  "changes": [
    {
      "location": "<function, class, or code region>",
      "description": "<what was changed and why>"
    }
  ],
  "updated_artifact": "<updated artifact or patch>",
  "messages": [
    {
      "target": "<related component>",
      "message": "<task-relevant requirement>"
    }
  ],
  "validation_notes": [
    "<behavior that should be checked during execution>"
  ]
}`;

export async function collaborate(
  component: string,
  filePath: string,
  objective: string,
  issueContext: string,
  messages: Message[],
  dependencyContext: string,
  generateFn: GenerateFn,
  model: ModelRef,
  bus: MessageBus
): Promise<DevPrimitiveOutput> {
  const artifact = await readFile(filePath, 'utf-8');

  const incomingMessagesText = messages.length > 0
    ? messages.map(m => `From ${m.source} to ${m.target}:\n${JSON.stringify(m, null, 2)}`).join('\n\n')
    : "None";

  const prompt = `
Component: ${component}
Artifact:
\`\`\`
${artifact}
\`\`\`
Local Objective: ${objective}
Issue Context: ${issueContext}
Incoming Messages:
${incomingMessagesText}
Dependency Context: ${dependencyContext}

${DEV_PRIMITIVE_PROMPT}

IMPORTANT: Output ONLY the JSON object. Do not wrap it in markdown code blocks, do not add explanations before or after the JSON. Output only the raw JSON.
  `;

  const result = await generateFn({ prompt, model });

  try {
    const output: DevPrimitiveOutput = extractJSON(result.text);

    if (output.action === "modify" && output.updated_artifact) {
      await writeFile(filePath, output.updated_artifact, 'utf-8');
    }

    for (const msg of output.messages || []) {
      bus.send({
        source: component,
        target: msg.target,
        type: "dependency",
        message: msg.message,
        required_action: "review"
      });
    }

    return output;
  } catch (e) {
    throw new Error(`Failed to parse Dev-Primitive output for ${component}: ${e}\nRaw output:\n${result.text}`);
  }
}
