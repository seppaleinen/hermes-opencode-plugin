export function extractJSON(text: string): any {
  let t = text.trim();
  if (t.startsWith("```json")) t = t.slice(7);
  if (t.startsWith("```")) t = t.slice(3);
  if (t.endsWith("```")) t = t.slice(0, -3);
  t = t.trim();

  try { return JSON.parse(t); } catch {}

  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first !== -1 && last !== -1 && last > first) {
    try { return JSON.parse(t.slice(first, last + 1)); } catch {}
  }

  throw new Error("No JSON object found in response");
}
