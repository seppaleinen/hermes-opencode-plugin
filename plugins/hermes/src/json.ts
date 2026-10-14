/**
 * Repair invalid escape sequences that LLMs routinely emit when embedding
 * code snippets (regex literals, shell commands, TS source) inside JSON
 * string values.
 *
 * JSON only allows `\" \\ \/ \b \f \n \r \t \uXXXX`. A model writing a regex
 * will emit the source text `\s` / `\d` / `\w` / `\.` verbatim, which is a
 * `SyntaxError` for JSON.parse. This pass doubles the backslash for any
 * escape that is not in the valid set — it never touches already-valid
 * escapes (a `\\` in the input stays `\\`, so it is idempotent).
 *
 * Applied after fence stripping, over the whole object region. Backslashes
 * outside JSON string values are not expected in a model's JSON output, so
 * a global scan is safe here.
 */
function repairInvalidEscapes(s: string): string {
  const VALID = new Set(['"', "\\", "/", "b", "f", "n", "r", "t", "u"]);
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = s[i + 1];
    if (next === undefined) { out += ch; continue; }
    if (VALID.has(next)) { out += ch + next; i++; continue; }
    // Invalid escape (e.g. \s in a regex literal) -> double the backslash.
    out += "\\\\" + next;
    i++;
  }
  return out;
}

export function extractJSON(text: string): any {
  let t = text.trim();
  if (t.startsWith("```json")) t = t.slice(7);
  if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  t = t.trim();

  const repaired = repairInvalidEscapes(t);

  try { return JSON.parse(repaired); } catch {}

  const first = repaired.indexOf("{");
  const last = repaired.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(repaired.slice(first, last + 1)); } catch {}
  }

  throw new Error("No JSON object found in response");
}
