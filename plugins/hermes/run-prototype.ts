import { writeFileSync, appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Config, ModelRef, Evidence } from "./src/types.js";
import { runHarness } from "./src/harness.js";
import { callLitellm } from "./src/litellm.js";

const PLUGIN_DIR = resolve(import.meta.dirname);
const REPO_ROOT = resolve(PLUGIN_DIR, "..", "..");
const EVAL_REPO = resolve(REPO_ROOT, "eval");
const LOG_PATH = resolve(REPO_ROOT, "run.log");

const CONFIG: Config = {
  evalRepo: EVAL_REPO,
  budget: { B: 1 },
  components: {
    validator: { file: "src/validator.ts", model: { providerID: "litellm", id: "qwen2.5-coder-7b" } },
    checkout: { file: "src/checkout.ts", model: { providerID: "litellm", id: "gemma-4-12b" } }
  },
  harness: {
    activation: { model: { providerID: "litellm", id: "freellmapi" } },
    diagnosis: { model: { providerID: "litellm", id: "freellmapi" } }
  }
};

function log(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  appendFileSync(LOG_PATH, line);
  process.stdout.write(line);
}

function runTest(): Evidence {
  const result = spawnSync("npm", ["test"], { cwd: EVAL_REPO, encoding: "utf-8", shell: true, env: process.env });
  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const exitCode = result.status ?? -1;

  return {
    o_shell: `Command: npm test\nExit code: ${exitCode}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`,
    o_test: extractTestOutput(stdout + stderr),
    o_runtime: extractRuntimeErrors(stdout + stderr),
    o_trace: extractTraces(stdout + stderr),
  };
}

function extractTestOutput(output: string): string {
  return output.split("\n").filter(l =>
    l.includes("✓") || l.includes("✗") || l.includes("FAIL") ||
    l.includes("Test Files") || l.includes("Tests:") || l.includes("passed") || l.includes("failed")
  ).join("\n");
}

function extractRuntimeErrors(output: string): string {
  return output.split("\n").filter(l =>
    l.includes("Error:") || l.includes("TypeError:") || l.includes("Cannot read properties")
  ).slice(0, 50).join("\n");
}

function extractTraces(output: string): string {
  return output.split("\n").filter(l =>
    l.includes("at ") && !l.includes("✓") && !l.includes("✗")
  ).slice(0, 100).join("\n");
}

function extractExitCode(output: string): number {
  const match = output.match(/Exit code:\s*(\d+)/);
  return match ? parseInt(match[1]) : -1;
}

const generateFn = async (input: { prompt: string; model?: ModelRef }): Promise<{ text: string }> => {
  if (!input.model) throw new Error("model is required");
  const text = await callLitellm(input.prompt, input.model);
  log(`MODEL CALL: model=${input.model.providerID}/${input.model.id} promptLen=${input.prompt.length} responseLen=${text.length}`);
  log(`  PROMPT:\n${input.prompt}`);
  log(`  RESPONSE:\n${text}`);
  return { text };
};

async function main() {
  try { writeFileSync(LOG_PATH, ""); } catch {}

  log("=== HERMES Prototype Run ===");
  log(`Config: ${JSON.stringify(CONFIG)}`);

  // Restore eval repo to committed state before run
  log("\n--- Restoring eval repo to committed state ---");
  spawnSync("git", ["checkout", "eval/src/validator.ts", "eval/src/checkout.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });

  log("\n--- Baseline: npm test ---");
  const baseline = runTest();
  log(`Baseline exit code: ${extractExitCode(baseline.o_shell)}`);
  log(`Baseline test output:\n${baseline.o_test}`);

  const issue = `checkout.ts/createUser fails when email has no '@': normalizeEmail in validator.ts returns null but the current implementation dereferences null and throws TypeError. Fix: add null-guard in normalizeEmail so it returns null for invalid input instead of crashing.`;

  log("\n--- Running HERMES harness ---");
  const result = await runHarness(CONFIG, generateFn, issue, baseline);

  log("\n--- Final Result ---");
  log(`Success: ${result.success}`);
  if (result.finalDiagnosis) {
    log(`Final diagnosis verdict: ${result.finalDiagnosis.verdict}`);
    log(`Gate: ${JSON.stringify(result.finalDiagnosis.gate)}`);
  }

  log("\n--- Final npm test ---");
  const finalTest = runTest();
  log(`Final exit code: ${extractExitCode(finalTest.o_shell)}`);
  log(`Final test output:\n${finalTest.o_test}`);
}

main().catch(err => {
  log(`FATAL: ${err}`);
  process.exit(1);
});
