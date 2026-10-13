/**
 * Email validation + normalization.
 *
 * FILE A — the component that carries the seeded bug.
 *
 * Contract: normalizeEmail(raw) returns the lowercased, trimmed email, or
 * null when the input is not a valid email address. It must never throw.
 */

export function normalizeEmail(raw: string | null): string | null {
  if (raw == null) return null;

  const trimmed = raw.trim();
  const m = trimmed.match(/^([^@\s]+)@([^@\s]+)$/);

  // BUG (seeded): the null-guard is missing.
  //
  // When the input has no '@', `match()` returns null. The line below
  // dereferences that null and throws `TypeError: Cannot read properties of
  // null (reading '1')`. A correct implementation returns null here so that
  // callers can distinguish "invalid" from "crash".
  //
  // Fix (one line, in this file): insert `if (m == null) return null;` above
  // the return statement.
  return `${m![1]}@${m![2]}`.toLowerCase();
}