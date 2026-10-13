import { spawnSync } from 'node:child_process';
import { Evidence } from "./types.js";

export async function execute(evalRepo: string): Promise<Evidence> {
  const result = spawnSync("npm", ["test"], {
    cwd: evalRepo,
    encoding: "utf-8",
    shell: true,
    env: process.env,
  });

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  const exitCode = result.status ?? -1;

  const o_shell = `Command: npm test\nExit code: ${exitCode}\n\nSTDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`;

  const o_test = extractTestOutput(stdout + stderr);
  const o_runtime = extractRuntimeErrors(stdout + stderr);
  const o_trace = extractTraces(stdout + stderr);

  return { o_shell, o_test, o_runtime, o_trace };
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
