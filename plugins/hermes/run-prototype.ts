import { writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Config, ModelRef, Evidence } from "./src/types.js";
import { runHarness, type HarnessLog } from "./src/harness.js";
import { callLitellm } from "./src/litellm.js";
import { modelsMatch } from "./src/truthfulness.js";

const PLUGIN_DIR = resolve(import.meta.dirname);
const REPO_ROOT = resolve(PLUGIN_DIR, "..", "..");
const EVAL_REPO = resolve(REPO_ROOT, "eval");
// T6: run logs live in docs/t6-run-logs/ with a run-start timestamp, so each
// re-run for the determinism check produces its own named artifact.
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const LOG_DIR = resolve(REPO_ROOT, "docs", "t6-run-logs");
const LOG_PATH = resolve(LOG_DIR, `t6-run-${RUN_ID}.log`);

const CONFIG: Config = {
  evalRepo: EVAL_REPO,
  // T6: B=2 to test whether the weaker per-component model (qwen2.5-coder-7b)
  // needs a second revision round. With freellmapi as the validator, B=1
  // suffices (prior runs). With qwen, round 1 places .toLowerCase() on
  // `raw.trim()` instead of the return expression, so a second round is
  // needed to move it. This is a model-dependent sufficiency result, not a
  // harness failure.
  budget: { B: 1 },
  // T6: exercise the across-round revision loop by making round 0
  // deliberately incomplete (controlled flag, see src/collaborate.ts).
  incompleteRound0: true,
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

// Keyed by bare model id so the declared-vs-actual comparison stays byte-
// equivalent with verify-run-truthfulness.ts, which parses `MODEL CALL:
// model=litellm/<id>` and counts by `<id>`. The display form below prefixes
// the provider for readability.
const modelCalls: Record<string, number> = {};
const modelProvider: Record<string, string> = {};

const generateFn = async (input: { prompt: string; model?: ModelRef }): Promise<{ text: string }> => {
  if (!input.model) throw new Error("model is required");
  const text = await callLitellm(input.prompt, input.model);
  const ref = `${input.model.providerID}/${input.model.id}`;
  log(`MODEL CALL: model=${ref} promptLen=${input.prompt.length} responseLen=${text.length}`);
  modelCalls[input.model.id] = (modelCalls[input.model.id] || 0) + 1;
  modelProvider[input.model.id] = input.model.providerID;
  log(`  PROMPT:\n${input.prompt}`);
  log(`  RESPONSE:\n${text}`);
  return { text };
};

/**
 * Build the deterministic `=== Model Call Summary ===` section.
 *
 * No timestamps inside this section — the text must be byte-identical for
 * identical runs so it can serve as stable evidence. The declared-vs-actual
 * comparison reuses `modelsMatch` from src/truthfulness.ts, the single source
 * of truth shared with verify-run-truthfulness.ts (issue #9).
 */
function buildModelCallSummary(config: Config, calls: Record<string, number>, rounds: HarnessLog[]): string {
  const declaredSet = new Set<string>();
  for (const name of Object.keys(config.components)) {
    const id = config.components[name]?.model?.id;
    if (id) declaredSet.add(id);
  }
  for (const key of ["activation", "diagnosis"] as const) {
    const id = config.harness[key]?.model?.id;
    if (id) declaredSet.add(id);
  }
  const declaredIds = Array.from(declaredSet).sort();

  const actualIds = Object.keys(calls).sort();
  const totalCalls = Object.values(calls).reduce((a, b) => a + b, 0);

  const truthfulness = modelsMatch(declaredIds, actualIds) ? "PASS" : "FAIL";
  const heterogeneityClaimed = declaredIds.length > 1;
  const heterogeneityExercised = actualIds.length > 1;
  const heterogeneityOk = heterogeneityClaimed === heterogeneityExercised && modelsMatch(declaredIds, actualIds);

  const lines: string[] = [];
  lines.push("=== Model Call Summary ===");
  lines.push(`Declared models: ${declaredIds.join(", ")} (${declaredIds.length} unique)`);
  lines.push("Actual model calls:");
  for (const id of actualIds) {
    const provider = modelProvider[id] || "litellm";
    lines.push(`  ${provider}/${id}: ${calls[id]}`);
  }
  lines.push(`  Total: ${totalCalls}`);
  lines.push(
    `Heterogeneity: claimed (${declaredIds.length} declared) ` +
    `${heterogeneityExercised ? "==" : "!="} exercised (${actualIds.length} actual) — ` +
    `${heterogeneityOk ? "PASS" : "FAIL"}`
  );
  lines.push(`Budget B=${config.budget.B}, incompleteRound0=${config.incompleteRound0 === true}`);
  lines.push("Trajectory:");
  for (let i = 0; i < rounds.length; i++) {
    const r = rounds[i];
    const verdict = r.diagnosis?.verdict ?? "unknown";
    const replan = verdict === "fail" && i + 1 < rounds.length;
    lines.push(
      `  round ${i}: roundConstraintActive=${r._roundConstraintActive === true}, verdict=${verdict}` +
      (replan ? " → replan" : "")
    );
  }
  lines.push(`Truthfulness: ${truthfulness}`);
  return lines.join("\n") + "\n";
}

async function main() {
  try { mkdirSync(LOG_DIR, { recursive: true }); } catch {}
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

  log("\n--- Per-Round Trajectory (plan + bus messages + primitives + gate) ---");
  for (const l of result.logs) {
    log(`\n##### ROUND ${l.round} #####`);
    log(`roundConstraintActive=${l._roundConstraintActive}`);
    if (l.activation) {
      log(`ACTIVATE model=${l.activation.model.providerID}/${l.activation.model.id}`);
      log(`ACTIVATE PLAN:\n${JSON.stringify(l.activation.result, null, 2)}`);
    }
    for (const p of l.primitives) {
      log(`COLLABORATE component=${p.component} model=${p.model.providerID}/${p.model.id}`);
      log(`  action=${p.result.action} summary=${p.result.summary}`);
      log(`  changes=${JSON.stringify(p.result.changes)}`);
      log(`  validation_notes=${JSON.stringify(p.result.validation_notes)}`);
      log(`  messages=${JSON.stringify(p.result.messages)}`);
    }
    if (l.messages && l.messages.length > 0) {
      log(`BUS MESSAGES (verbatim):`);
      for (const m of l.messages) {
        log(`  ${m.source} -> ${m.target} [${m.type}]: ${m.message} (required_action=${m.required_action})`);
      }
    } else {
      log(`BUS MESSAGES: none`);
    }
    if (l.execution) {
      log(`EXECUTE exitCode=${extractExitCode(l.execution.o_shell)}`);
      log(`EXECUTE o_test:\n${l.execution.o_test}`);
      if (l.execution.o_runtime) log(`EXECUTE o_runtime:\n${l.execution.o_runtime}`);
    }
    if (l.diagnosis) {
      log(`DIAGNOSE verdict=${l.diagnosis.verdict} gate=${JSON.stringify(l.diagnosis.gate)}`);
      if (l.diagnosis.modelVerdict) {
        log(`DIAGNOSE modelVerdict:\n${JSON.stringify(l.diagnosis.modelVerdict, null, 2)}`);
      }
    }
  }

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

  // T6 constraint: the eval repo must be byte-identical to its committed
  // (buggy) state after the run. The harness applied the fix during
  // execution; revert it now so the committed state is restored.
  log("\n--- Reverting eval repo to committed (buggy) state ---");
  const revert = spawnSync("git", ["checkout", "eval/src/validator.ts", "eval/src/checkout.ts"], { cwd: REPO_ROOT, encoding: "utf-8" });
  log(`Revert exit code: ${revert.status ?? -1}`);
  if (revert.stderr) log(`Revert stderr: ${revert.stderr}`);

  const postRevert = spawnSync("git", ["diff", "--stat", "eval/"], { cwd: REPO_ROOT, encoding: "utf-8" });
  log(`Post-revert git diff --stat eval/ (must be empty):\n${postRevert.stdout || "(no output — clean)"}`);
  if (postRevert.stderr) log(`Post-revert stderr: ${postRevert.stderr}`);

  // Append the deterministic model-call summary after the full trajectory and
  // final verdict. No timestamps inside this section — identical runs must
  // produce identical summary text so it is stable evidence.
  log(`\n${buildModelCallSummary(CONFIG, modelCalls, result.logs)}`);
}

main().catch(err => {
  log(`FATAL: ${err}`);
  process.exit(1);
});
