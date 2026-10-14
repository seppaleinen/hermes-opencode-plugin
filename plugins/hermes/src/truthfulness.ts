/**
 * truthfulness.ts
 *
 * Shared declared-vs-actual model comparison logic.
 *
 * Single source of truth for the inline truthfulness check in
 * `run-prototype.ts` (issue #10) and the equivalent `checks.modelsMatch`
 * computation in `verify-run-truthfulness.ts` (issue #9, frozen — do not
 * edit). The two consumers must always agree; keep this function as the
 * canonical implementation rather than letting each side carry its own
 * copy of the comparison.
 *
 * The comparison is set equality over unique model ids, guarded by a length
 * check so a strict superset (extra actual models) or subset (missing
 * actual models) cannot pass. This mirrors verify-run-truthfulness.ts
 * lines 200-201 verbatim:
 *
 *   const modelsMatch = declaredIds.length === actualIds.length &&
 *     declaredIds.every(id => actualSet.has(id));
 *
 * Callers MUST pass already-unique id arrays (declaredIds from a Set,
 * actualIds from object-key counts) to stay byte-equivalent with the
 * verifier, which derives both from unique sources.
 */

/**
 * Returns true when the declared and actual model id sets are equal.
 * Order-independent; duplicates are not tolerated (callers must dedupe).
 */
export function modelsMatch(
  declaredIds: readonly string[],
  actualIds: readonly string[]
): boolean {
  const actualSet = new Set(actualIds);
  return (
    declaredIds.length === actualIds.length &&
    declaredIds.every((id) => actualSet.has(id))
  );
}