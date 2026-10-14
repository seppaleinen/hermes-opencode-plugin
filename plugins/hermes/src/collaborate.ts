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
  bus: MessageBus,
  round: number = 0,
  incompleteRound0: boolean = false
): Promise<DevPrimitiveOutput> {
  const artifact = await readFile(filePath, 'utf-8');

  const incomingMessagesText = messages.length > 0
    ? messages.map(m => `From ${m.source} to ${m.target}:\n${JSON.stringify(m, null, 2)}`).join('\n\n')
    : "None";

  const roundConstraint = (incompleteRound0 && round === 0 && component === "src/validator.ts")
    ? `
*** ROUND-0 CONSTRAINT (T6 revision exercise - controlled, deterministic) ***
You are running in round 0 of a controlled revision exercise. Your fix for
normalizeEmail MUST be deliberately incomplete in a specific, documented way:

1. You MUST add the null-guard if (m == null) return null; so that the
   TypeError crash is eliminated - the function must no longer throw.
2. You MUST ALSO strip the lowercasing: return the raw matched email
   WITHOUT calling .toLowerCase(). I.e. return the value of m[1] + '@' +
   m[2] (no .toLowerCase() suffix).

The seeded test expects the input "  Foo@Example.COM  " to normalize to
"foo@example.com". Without lowercasing, that test FAILS. So round 0 will
pass the "no crash" test but fail the "normalizes a valid email" test.

This is intentional. The purpose is to exercise the across-round revision
loop: round 0 fails -> DIAGNOSE FAIL -> ACTIVATE replans -> round 1
completes the fix (adding the lowercasing back). Do not second-guess this
constraint; follow it exactly. The model does real reasoning about the
fix; this flag only constrains round 0's on-disk artifact.
`
    : "";

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
${roundConstraint}
${DEV_PRIMITIVE_PROMPT}

IMPORTANT: Output ONLY the JSON object. Do not wrap it in markdown code blocks, do not add explanations before or after the JSON. Output only the raw JSON.
  `;

  const result = await generateFn({ prompt, model });

  try {
    const output: DevPrimitiveOutput = extractJSON(result.text);

    if (output.action === "modify" && output.updated_artifact) {
      // T6: apply the round-0 incomplete constraint to the on-disk artifact
      // deterministically, so the trajectory is reproducible regardless of
      // whether the model followed the constraint text in its output.
      let artifactToWrite = output.updated_artifact;
      if (incompleteRound0 && round === 0 && component === "src/validator.ts") {
        artifactToWrite = applyIncompleteRound0Constraint(artifactToWrite);
      }
      await writeFile(filePath, artifactToWrite, 'utf-8');
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

/**
 * T6 controlled round-0 constraint (deterministic post-pass).
 *
 * Ensures the on-disk artifact for round 0 is deliberately incomplete:
 *   1. The null-guard `if (m == null) return null;` IS present (crash eliminated).
 *   2. The `.toLowerCase()` suffix is STRIPPED (valid-email normalization fails).
 *
 * This is a mechanical post-pass over the model's own output so the
 * trajectory is reproducible on re-run — the model still does the real
 * reasoning; the flag only constrains round 0's on-disk artifact.
 */
export function applyIncompleteRound0Constraint(artifact: string): string {
  let out = artifact;

  // 1) Ensure the null-guard is present, inserted right before the return.
  //    (Regex built from a string: the literal regex form confuses esbuild's
  //    parser when it follows a template-literal block in the same file.)
  const nullGuardRe = new RegExp(
    String.raw`if\s*\(\s*m\s*==\s*null\s*\)\s*return\s+null\s*;`
  );
  if (!nullGuardRe.test(out)) {
    out = out.replace(
      /(const\s+m\s*=\s*trimmed\.match\([^)]*\);)/,
      `$1\n\n  if (m == null) return null;`
    );
  }

  // 2) Strip the .toLowerCase() suffix from the return expression.
  //
  //    The artifact contains the LITERAL text `${m[1]}@${m[2]}`.toLowerCase()
  //    (the braces are source text, not JS interpolation), so a regex over
  //    that text is fragile. We do an index-based scan instead: find every
  //    `.toLowerCase()` occurrence and delete it only when the character
  //    immediately to its left (ignoring whitespace) closes the return
  //    expression — a template-literal backtick, `}`, `]`, or `)`. That
  //    covers `...`${m[1]}@${m[2]}`.toLowerCase()`, `(...).toLowerCase()`,
  //    and index-access forms, while leaving unrelated calls (e.g. on a
  //    plain identifier like `email.toLowerCase()`) untouched.
  const SUFFIX = ".toLowerCase()";
  const CLOSERS = new Set(["`", "}", "]", ")"]);
  let idx = out.indexOf(SUFFIX);
  while (idx !== -1) {
    const left = out.slice(Math.max(0, idx - 24), idx).replace(/\s+$/, "");
    if (CLOSERS.has(left.slice(-1))) {
      out = out.slice(0, idx) + out.slice(idx + SUFFIX.length);
    }
    // Continue from the same offset: the deletion (if any) only removed
    // text AFTER `idx`, so `idx` still points into the pre-suffix region.
    idx = out.indexOf(SUFFIX, idx);
  }

  return out;
}
