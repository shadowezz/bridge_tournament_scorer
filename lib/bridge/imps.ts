/**
 * Standard IMP table: upper bound of the score difference for each IMP value.
 * A difference of 0-10 is 0 IMPs, 20-40 is 1, and so on up to 24 IMPs.
 */
const IMP_TABLE: ReadonlyArray<readonly [maxDiff: number, imps: number]> = [
  [10, 0], [40, 1], [80, 2], [120, 3], [160, 4], [210, 5], [260, 6], [310, 7],
  [360, 8], [420, 9], [490, 10], [590, 11], [740, 12], [890, 13], [1090, 14],
  [1290, 15], [1490, 16], [1740, 17], [1990, 18], [2240, 19], [2490, 20],
  [2990, 21], [3490, 22], [3990, 23],
];

const MAX_IMPS = 24;

/** Convert an absolute score difference to IMPs. */
export function impsFromDifference(difference: number): number {
  const magnitude = Math.abs(difference);
  for (const [maxDiff, imps] of IMP_TABLE) {
    if (magnitude <= maxDiff) return imps;
  }
  return MAX_IMPS;
}

/**
 * IMPs won on a board, signed towards the team the difference favours.
 * Positive means the difference favours that team.
 */
export function signedImps(difference: number): number {
  return Math.sign(difference) * impsFromDifference(difference);
}
