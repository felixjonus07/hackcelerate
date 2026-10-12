/**
 * Fairness testing (§14.1), as pure statistics. Flag rates per group, the ratio of each group's rate to the
 * reference group's, and the spread of each rubric component's scores. A group below the minimum size is never
 * reported, and a ratio outside the band only asks the governance committee to look: it never changes a rubric
 * or a threshold by itself.
 */
export interface GroupCount {
  group: string;
  /** Students in the group. */
  n: number;
  /** Students with the flag (a persona, or the AEG index at CRITICAL). */
  flagged: number;
}

export interface GroupRate {
  group: string;
  n: number;
  rate: number;
  /** Rate divided by the reference group's rate; null for the reference itself or when it is undefined. */
  ratio: number | null;
  /** Outside the band: the committee reviews the component and the threshold. */
  review: boolean;
}

export interface Suppressed {
  group: string;
  reason: string;
}

export function flagRates(
  counts: readonly GroupCount[],
  opts: { minGroup: number; band: readonly [number, number] },
): { groups: GroupRate[]; suppressed: Suppressed[]; reference: string | null } {
  const shown = counts.filter((c) => c.n >= opts.minGroup);
  const suppressed = counts
    .filter((c) => c.n < opts.minGroup)
    .map((c) => ({ group: c.group, reason: `fewer than ${opts.minGroup} students` }));
  // The reference is the largest group, so a ratio always compares with the biggest, steadiest rate.
  const ref = [...shown].sort((a, b) => b.n - a.n || a.group.localeCompare(b.group))[0];
  const refRate = ref ? ref.flagged / ref.n : null;
  const groups = shown.map((c): GroupRate => {
    const rate = c.flagged / c.n;
    const isRef = ref && c.group === ref.group;
    const ratio = isRef || refRate == null || refRate === 0 ? null : rate / refRate;
    return {
      group: c.group,
      n: c.n,
      rate,
      ratio,
      // A tolerance, so a ratio of exactly 0.8 or 1.25 is not pushed outside the band by floating-point error.
      review: ratio != null && (ratio < opts.band[0] - 1e-9 || ratio > opts.band[1] + 1e-9),
    };
  });
  return { groups, suppressed, reference: ref?.group ?? null };
}

export interface Distribution {
  group: string;
  n: number;
  mean: number;
  p25: number;
  median: number;
  p75: number;
}

const quantile = (sorted: number[], q: number) => {
  if (sorted.length === 0) return 0;
  const pos = q * (sorted.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** Score distribution per group for one component; groups under the minimum size are left out. */
export function distributions(
  values: readonly { group: string; score: number }[],
  minGroup: number,
): { groups: Distribution[]; suppressed: Suppressed[] } {
  const by = new Map<string, number[]>();
  for (const v of values) by.set(v.group, [...(by.get(v.group) ?? []), v.score]);
  const groups: Distribution[] = [];
  const suppressed: Suppressed[] = [];
  for (const [group, scores] of by) {
    if (scores.length < minGroup) {
      suppressed.push({ group, reason: `fewer than ${minGroup} students` });
      continue;
    }
    const s = [...scores].sort((a, b) => a - b);
    groups.push({
      group,
      n: s.length,
      mean: s.reduce((a, b) => a + b, 0) / s.length,
      p25: quantile(s, 0.25),
      median: quantile(s, 0.5),
      p75: quantile(s, 0.75),
    });
  }
  return { groups: groups.sort((a, b) => a.group.localeCompare(b.group)), suppressed };
}
