import { readFile } from 'node:fs/promises';
import { Config, ModelRef, Plan, Message, Evidence, DiagnosisOutput, DevPrimitiveOutput } from "./types.js";
import { MessageBus } from "./bus.js";
import { activate } from "./activation.js";
import { collaborate } from "./collaborate.js";
import { execute } from "./execute.js";
import { diagnose, gateOnTestEvidence, DiagnosisResult } from "./diagnose.js";

type GenerateFn = (input: { prompt: string; model?: ModelRef }) => Promise<{ text: string }>;

export interface HarnessLog {
  round: number;
  activation?: { model: ModelRef; result: Plan };
  primitives: Array<{
    component: string;
    model: ModelRef;
    result: DevPrimitiveOutput;
  }>;
  messages: Message[];
  execution?: Evidence;
  diagnosis?: DiagnosisResult;
}

export interface HarnessResult {
  success: boolean;
  logs: HarnessLog[];
  finalEvidence: Evidence | null;
  finalDiagnosis: DiagnosisResult | null;
}

function extractExitCode(output: string): number {
  const match = output.match(/Exit code:\s*(\d+)/);
  return match ? parseInt(match[1]) : -1;
}

/**
 * Only source files under src/ are eligible for Dev-Primitive collaboration.
 * Test files and package.json are ground truth / config — never modified.
 */
function isEligibleComponent(component: string): boolean {
  return component.startsWith("src/") && component.endsWith(".ts");
}

export async function runHarness(
  config: Config,
  generateFn: GenerateFn,
  issue: string,
  baselineEvidence: Evidence
): Promise<HarnessResult> {
  const logs: HarnessLog[] = [];
  const evalRepo = config.evalRepo;
  const B = config.budget.B;

  const repoStructure = `src/checkout.ts\nsrc/validator.ts\ntest/checkout.test.ts\npackage.json`;
  const repoContext = `checkout.ts imports normalizeEmail from validator.ts\nvalidator.ts exports normalizeEmail function\nTest file: test/checkout.test.ts`;

  const checkoutContent = await readFile(`${evalRepo}/src/checkout.ts`, 'utf-8');
  const validatorContent = await readFile(`${evalRepo}/src/validator.ts`, 'utf-8');

  let plan = await activate(
    issue,
    repoStructure,
    `src/checkout.ts:\n\`\`\`\n${checkoutContent}\n\`\`\`\n\nsrc/validator.ts:\n\`\`\`\n${validatorContent}\n\`\`\``,
    null,
    null,
    generateFn,
    config.harness.activation.model
  );

  let previousFeedback = null;

  for (let b = 0; b <= B; b++) {
    const log: HarnessLog = { round: b };
    log.activation = {
      model: config.harness.activation.model,
      result: plan,
    };

    const bus = new MessageBus();
    const activeComponents = new Set<string>();
    for (const comp of plan.activated_components) {
      if (isEligibleComponent(comp.component)) {
        activeComponents.add(comp.component);
      }
    }

    log.primitives = [];

    // Sequential single-pass collaboration — only eligible source components
    for (const comp of plan.activated_components) {
      if (!isEligibleComponent(comp.component)) continue;

      const incomingMessages = bus.getMessagesFor(comp.component);
      const dependencyContext = `Dependencies: ${comp.dependencies.join(', ') || 'none'}`;

      const result = await collaborate(
        comp.component,
        `${evalRepo}/${comp.component}`,
        comp.objective,
        issue,
        incomingMessages,
        dependencyContext,
        generateFn,
        config.components[comp.component]?.model || config.harness.activation.model,
        bus
      );

      log.primitives.push({
        component: comp.component,
        model: config.components[comp.component]?.model || config.harness.activation.model,
        result,
      });

      // Handle messages to non-active targets
      for (const msg of result.messages || []) {
        if (!activeComponents.has(msg.target)) {
          bus.queueForNextRound(msg.target, {
            source: comp.component,
            target: msg.target,
            type: "dependency",
            message: msg.message,
            required_action: "review"
          });
        }
      }
    }

    // Collect all bus messages
    log.messages = bus.getAllMessages();

    // Execute
    const evidence = await execute(evalRepo);
    log.execution = evidence;

    const exitCode = extractExitCode(evidence.o_shell);

    // Diagnose
    const diagnosis = await diagnose(
      issue,
      plan,
      plan.activated_components.map(c => c.component),
      evidence,
      exitCode,
      previousFeedback,
      generateFn,
      config.harness.diagnosis.model
    );
    log.diagnosis = diagnosis;

    logs.push(log);

    if (diagnosis.verdict === "pass") {
      return {
        success: true,
        logs,
        finalEvidence: evidence,
        finalDiagnosis: diagnosis,
      };
    }

    // Prepare for next revision round
    previousFeedback = JSON.stringify(diagnosis.modelVerdict, null, null);

    const newCheckoutContent = await readFile(`${evalRepo}/src/checkout.ts`, 'utf-8');
    const newValidatorContent = await readFile(`${evalRepo}/src/validator.ts`, 'utf-8');

    plan = await activate(
      issue,
      repoStructure,
      `src/checkout.ts:\n\`\`\`\n${newCheckoutContent}\n\`\`\`\n\nsrc/validator.ts:\n\`\`\`\n${newValidatorContent}\n\`\`\``,
      plan,
      previousFeedback,
      generateFn,
      config.harness.activation.model
    );
  }

  const finalLog = logs[logs.length - 1];
  return {
    success: false,
    logs,
    finalEvidence: finalLog?.execution || null,
    finalDiagnosis: finalLog?.diagnosis || null,
  };
}
