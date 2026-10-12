/**
 * Choosing quests from the remediation library (§9.1: action plans are
 * constrained to the library). The order is rules first (the component whose gap
 * costs the most, then an item the student lacks), and semantic closeness of the
 * gap to the library entry (pgvector) decides among the rest when embeddings exist.
 */
export interface RemediationCandidate {
  id: string;
  componentKey: string;
  standardItem: string | null;
}

export function selectRemediation<T extends RemediationCandidate>(
  candidates: readonly T[],
  /** Components with a gap, most costly first. */
  gapComponents: readonly string[],
  /** Standard items with no counted evidence. */
  missingItems: ReadonlySet<string>,
  /** Cosine distance from the gap text to each candidate; null when no embeddings are available. */
  distances: ReadonlyMap<string, number> | null,
  limit: number,
): T[] {
  const rank = (c: T) => gapComponents.indexOf(c.componentKey);
  return candidates
    .filter((c) => rank(c) >= 0)
    .map((c) => ({ c, lacks: c.standardItem != null && missingItems.has(c.standardItem) }))
    .sort((a, b) => {
      if (rank(a.c) !== rank(b.c)) return rank(a.c) - rank(b.c);
      if (a.lacks !== b.lacks) return a.lacks ? -1 : 1;
      const da = distances?.get(a.c.id);
      const db = distances?.get(b.c.id);
      if (da != null && db != null && da !== db) return da - db;
      return a.c.id.localeCompare(b.c.id);
    })
    .slice(0, limit)
    .map((x) => x.c);
}
