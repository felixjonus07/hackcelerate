/**
 * Agreement between the system and mentors (§15.4): the share of labelled students for whom both name the same
 * persona category (including "none"), and for each persona the precision and recall, each with a 95% Wilson
 * interval because small pilot samples give unstable estimates. Pure.
 */
export interface LabelPair {
  /** What the system assigned: a persona id, or null for none. */
  system: string | null;
  /** What the mentor labelled: a persona id, or null for none. */
  mentor: string | null;
}

export interface Interval {
  value: number | null;
  low: number | null;
  high: number | null;
  /** The denominator the estimate rests on. */
  n: number;
}

/** Wilson score interval for k successes in n trials. */
export function wilson(k: number, n: number, z = 1.96): Interval {
  if (n === 0) return { value: null, low: null, high: null, n };
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return { value: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half), n };
}

export function agreement(pairs: readonly LabelPair[], personas: readonly string[]) {
  const agree = pairs.filter((p) => p.system === p.mentor).length;
  const perPersona = personas.map((persona) => {
    const flagged = pairs.filter((p) => p.system === persona);
    const labelled = pairs.filter((p) => p.mentor === persona);
    const correct = flagged.filter((p) => p.mentor === persona).length;
    return {
      persona,
      // Precision: correct flags over all flags of that persona. Recall: correct flags over everyone the mentor labelled so.
      precision: wilson(correct, flagged.length),
      recall: wilson(correct, labelled.length),
    };
  });
  return { agreement: wilson(agree, pairs.length), perPersona };
}
