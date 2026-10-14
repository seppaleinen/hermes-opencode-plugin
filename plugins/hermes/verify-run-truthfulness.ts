#!/usr/bin/env node
/**
 * verify-run-truthfulness.ts
 *
 * Verification tooling only — no behavioral change to the HERMES harness.
 *
 * Parses a run log's Config header for budget B, incompleteRound0 flag, and
 * every component's declared model. Extracts every `MODEL CALL: model=litellm/<id>`
 * line and the harness trajectory (EXECUTE / DIAGNOSE / roundConstraintActive).
 * Compares declared config against observed log evidence.
 *
 * Emits a JSON report to stdout and exits 0 on PASS, 1 on any mismatch.
 *
 * Usage:
 *   npx tsx plugins/hermes/verify-run-truthfulness.ts <log-path>
 *   npx tsx plugins/hermes/verify-run-truthfulness.ts          # self-test mode
 */

import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

type Report = {
  logPath: string;
  config: {
    B: number | null;
    incompleteRound0: boolean;
    declaredModels: string[];
    declaredModelCount: number;
    components: Record<string, string>;
    harness: Record<string, string>;
  };
  evidence: {
    modelCalls: Record<string, number>;
    actualModels: string[];
    actualModelCount: number;
    totalCalls: number;
    observedRounds: number | null;
    roundConstraintActive: boolean;
    roundConstraintActiveTrueCount: number;
    trajectory: {
      executeCount: number;
      diagnoseCount: number;
      roundConstraintActiveCount: number;
    };
  };
  checks: {
    modelsMatch: boolean;
    heterogeneityClaimed: boolean;
    heterogeneityVerified: boolean;
    heterogeneityMatch: boolean;
    budgetConsistent: boolean | null;
    incompleteRound0Match: boolean;
  };
  failures: string[];
  diff: Array<{ field: string; declared: unknown; actual: unknown; match: boolean }>;
  PASS: boolean;
};

function extractConfigJson(log: string): { config: any; lineNo: number } {
  const lines = log.split('\n');

  // Anchor on real log line: [timestamp] Config: {...}
  // Avoid matching 'Config:' substrings embedded in prompt bodies.
  const HEADER_RE = /^\[\S+\]\s+Config:\s*/;
  let headerIdx = -1;
  let jsonStartLine = '';
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADER_RE);
    if (m) {
      headerIdx = i;
      jsonStartLine = lines[i].slice(m[0].length);
      break;
    }
  }
  if (headerIdx === -1) throw new Error('No Config: header line found in log');

  // Accumulate JSON with proper brace depth tracking (string/escape aware)
  let buf = jsonStartLine;
  const balance = (src: string): number => {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < src.length; i++) {
      const ch = src[i];
      if (esc) { esc = false; continue; }
      if (inStr) {
        if (ch === '\\') { esc = true; }
        else if (ch === '"') { inStr = false; }
        continue;
      }
      if (ch === '"') { inStr = true; }
      else if (ch === '{') { depth++; }
      else if (ch === '}') { depth--; }
    }
    return depth;
  };

  // Ensure we start inside an object
  const firstBraceIdx = buf.indexOf('{');
  if (firstBraceIdx === -1) throw new Error('Config JSON object not found after Config:');
  let bufIdx = firstBraceIdx;
  let collected = buf.slice(bufIdx);

  // If buffer is incomplete, keep reading lines until balanced
  let lastLineIdx = headerIdx;
  while (balance(collected) !== 0 && lastLineIdx + 1 < lines.length) {
    lastLineIdx++;
    collected += '\n' + lines[lastLineIdx];
  }

  if (balance(collected) !== 0) throw new Error('Config JSON is unbalanced');

  const jsonStart = collected.indexOf('{');
  const jsonEnd = collected.lastIndexOf('}');
  if (jsonStart === -1 || jsonEnd === -1) throw new Error('Could not locate Config JSON');

  const jsonStr = collected.slice(jsonStart, jsonEnd + 1);
  let config: any;
  try {
    config = JSON.parse(jsonStr);
  } catch (e) {
    throw new Error('Config JSON is malformed: ' + (e as Error).message);
  }
  return { config, lineNo: headerIdx };
}

function declaredModels(config: any): { ids: string[]; components: Record<string, string>; harness: Record<string, string> } {
  const comps: Record<string, string> = {};
  const harness: Record<string, string> = {};
  const idSet = new Set<string>();

  const components = config.components || {};
  for (const [name, comp] of Object.entries<any>(components)) {
    const id = comp?.model?.id;
    if (id) {
      comps[name] = String(id);
      idSet.add(String(id));
    }
  }

  const h = config.harness || {};
  for (const key of ['activation', 'diagnosis'] as const) {
    const id = h[key]?.model?.id;
    if (id) {
      harness[key] = String(id);
      idSet.add(String(id));
    }
  }

  return { ids: Array.from(idSet), components: comps, harness };
}

function safeResolvePath(logPath: string): string {
  const repoRoot = resolve(process.cwd());
  let abs: string;
  try {
    abs = realpathSync(resolve(logPath));
  } catch {
    throw new Error('Log path does not exist or cannot be resolved');
  }
  if (!abs.startsWith(repoRoot + '/') && abs !== repoRoot) {
    throw new Error('Log path is outside repository root');
  }
  return abs;
}

function analyzeLog(logPath: string): Report {
  const safePath = safeResolvePath(logPath);
  const log = readFileSync(safePath, 'utf-8');

  // Config extraction
  const { config: cfg } = extractConfigJson(log);
  const B = cfg?.budget?.B ?? null;
  const incompleteRound0Claimed = Boolean(cfg?.incompleteRound0);
  const { ids: declaredIds, components, harness } = declaredModels(cfg);
  const declaredSet = new Set(declaredIds);

  // Model calls
  const CALL_RE = /MODEL CALL:\s*model=litellm\/([^\s]+)/g;
  const modelCalls: Record<string, number> = {};
  let match: RegExpExecArray | null;
  while ((match = CALL_RE.exec(log)) !== null) {
    const id = match[1];
    modelCalls[id] = (modelCalls[id] || 0) + 1;
  }
  const actualIds = Object.keys(modelCalls);
  const actualSet = new Set(actualIds);
  const totalCalls = Object.values(modelCalls).reduce((a, b) => a + b, 0);

  // Trajectory — count only log lines (timestamp prefix) to avoid matching embedded JSON
  const lines = log.split('\n');
  const lineMatches = (pattern: RegExp) => lines.filter(l => pattern.test(l)).length;
  const executeCount = lineMatches(/^\[\S+\]\s+EXECUTE exitCode=\d+$/);
  const diagnoseCount = lineMatches(/^\[\S+\]\s+DIAGNOSE verdict=\w+ /);
  const racAllCount = lineMatches(/^\[\S+\]\s+roundConstraintActive=(true|false)$/);
  const racTrueCount = lineMatches(/^\[\S+\]\s+roundConstraintActive=true$/);
  const observedRounds = Math.max(executeCount, diagnoseCount, racAllCount) || null;

  // Checks
  const modelsMatch = declaredIds.length === actualIds.length &&
    declaredIds.every(id => actualSet.has(id));
  const heterogeneityClaimed = declaredIds.length > 1;
  const heterogeneityVerified = actualIds.length > 1;
  const heterogeneityMatch = heterogeneityClaimed === heterogeneityVerified && modelsMatch;

  let budgetConsistent: boolean | null = null;
  if (B !== null && observedRounds !== null) {
    budgetConsistent = observedRounds <= B + 1;
  } else if (B !== null) {
    budgetConsistent = null; // not verifiable from log
  } else {
    budgetConsistent = null;
  }

  const incompleteRound0Observed = racTrueCount > 0;
  const incompleteRound0Match = incompleteRound0Claimed === incompleteRound0Observed;

  // Failures
  const failures: string[] = [];
  if (!modelsMatch) {
    const missingInActual = declaredIds.filter(id => !actualSet.has(id));
    const extraInActual = actualIds.filter(id => !declaredSet.has(id));
    if (missingInActual.length) failures.push(`Missing models in actual calls: ${missingInActual.join(', ')}`);
    if (extraInActual.length) failures.push(`Extra models in actual calls: ${extraInActual.join(', ')}`);
  }
  if (heterogeneityClaimed && !heterogeneityVerified) {
    failures.push('Heterogeneity claimed by config but not exercised in actual model calls');
  }
  if (!incompleteRound0Match) {
    failures.push(`incompleteRound0 mismatch: config=${incompleteRound0Claimed}, observed roundConstraintActive=true ${incompleteRound0Observed ? 'present' : 'absent'}`);
  }
  if (budgetConsistent === false) {
    failures.push(`Budget B=${B} inconsistent with observed rounds=${observedRounds} (> B+1)`);
  } else if (B !== null && observedRounds === null && totalCalls > 0) {
    // Legacy log: no trajectory, but model calls present — note not a hard failure
    failures.push(`Budget B=${B} not verifiable: no EXECUTE/DIAGNOSE/roundConstraintActive lines in log (legacy format)`);
  }

  // Filter out the legacy-format budget note: it's informational, not a hard failure
  const hardFailures = failures.filter(f => !f.includes('not verifiable'));

  // Diff
  const diff = [
    {
      field: 'models.declared',
      declared: Array.from(declaredSet).sort(),
      actual: Array.from(actualSet).sort(),
      match: modelsMatch
    },
    {
      field: 'heterogeneity.claimed',
      declared: heterogeneityClaimed,
      actual: heterogeneityVerified,
      match: heterogeneityClaimed === heterogeneityVerified
    },
    {
      field: 'budget.B',
      declared: B,
      actual: observedRounds !== null && B !== null ? observedRounds - 1 : null,
      match: budgetConsistent === null ? null : (budgetConsistent === true)
    },
    {
      field: 'incompleteRound0',
      declared: incompleteRound0Claimed,
      actual: incompleteRound0Observed,
      match: incompleteRound0Match
    }
  ];

  return {
    logPath,
    config: {
      B,
      incompleteRound0: incompleteRound0Claimed,
      declaredModels: Array.from(declaredSet).sort(),
      declaredModelCount: declaredIds.length,
      components,
      harness,
    },
    evidence: {
      modelCalls,
      actualModels: actualIds.sort(),
      actualModelCount: actualIds.length,
      totalCalls,
      observedRounds,
      roundConstraintActive: incompleteRound0Observed,
      roundConstraintActiveTrueCount: racTrueCount,
      trajectory: { executeCount, diagnoseCount, roundConstraintActiveCount: racAllCount },
    },
    checks: {
      modelsMatch,
      heterogeneityClaimed,
      heterogeneityVerified,
      heterogeneityMatch: heterogeneityClaimed === heterogeneityVerified && modelsMatch,
      budgetConsistent,
      incompleteRound0Match,
    },
    failures: hardFailures,
    diff,
    PASS: hardFailures.length === 0,
  };
}

function printReport(r: Report, label?: string) {
  if (label) console.error(`--- ${label} ---`);
  console.error(`Log: ${r.logPath}`);
  console.error(`PASS: ${r.PASS}`);
  console.error(`Failures: ${r.failures.length ? r.failures.join('; ') : 'none'}`);
  console.error('');
}

function selfTest() {
  const repoRoot = process.cwd();
  const fixtures = [
    {
      path: resolve(repoRoot, 'docs/t6-run-logs/t6-run-2026-10-14T05-54-15.log'),
      expectPass: true,
      label: 'T6 B=1 heterogeneous (should PASS)'
    },
    {
      path: resolve(repoRoot, 'plugins/hermes/run.log'),
      expectPass: false,
      label: 'T4 run.log all freellmapi (should FAIL)'
    }
  ];

  const results: Array<{ label: string; report: Report }> = [];
  for (const f of fixtures) {
    const r = analyzeLog(f.path);
    results.push({ label: f.label, report: r });
  }

  // Print JSON reports to stdout (one per line)
  for (const { report } of results) {
    console.log(JSON.stringify(report));
  }

  // Human summary to stderr
  console.error('\n=== Self-Test Summary ===');
  let allOk = true;
  for (const { label, report } of results) {
    const expected = label.includes('should PASS');
    const actual = report.PASS;
    const pass = expected === actual;
    allOk = allOk && pass;
    printReport(report, label);
    console.error(`Expected PASS=${expected}, got PASS=${actual} → ${pass ? 'OK' : 'UNEXPECTED'}`);
    if (report.failures.length) {
      console.error('  Failures:');
      for (const f of report.failures) console.error(`   - ${f}`);
    }
    console.error('');
  }

  if (!allOk) {
    console.error('Self-test FAILED: fixtures did not behave as expected');
    process.exit(1);
  }
  console.error('Self-test PASSED: fixtures behaved as expected');
  process.exit(0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    selfTest();
    return;
  }

  const report = analyzeLog(args[0]);
  console.log(JSON.stringify(report));
  if (!report.PASS) {
    // Print human-readable diff to stderr for visibility
    console.error('\nVerification FAILED');
    for (const f of report.failures) console.error(` - ${f}`);
    for (const d of report.diff) {
      if (!d.match) {
        console.error(`Diff ${d.field}: declared=${JSON.stringify(d.declared)} actual=${JSON.stringify(d.actual)}`);
      }
    }
    process.exit(1);
  }
  process.exit(0);
}

main();
