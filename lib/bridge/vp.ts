import { BOARDS_PER_SEGMENT } from "@/lib/types";

/** Total victory points shared between the two teams in a match. */
export const VP_TOTAL = 20;

/**
 * IMP margin at which the winner takes all 20 VP. Uses the WBF-style
 * continuous scale where the blitz threshold grows with match length:
 * 15 * sqrt(6) rounds to 37 for our six-board matches.
 */
export const BLITZ_MARGIN = Math.round(15 * Math.sqrt(BOARDS_PER_SEGMENT));

/**
 * Split 20 VP between two teams given their IMP totals, on a continuous
 * scale that reaches a blitz at BLITZ_MARGIN. Results are rounded to two
 * decimals so displayed VPs always sum to exactly 20.
 */
export function victoryPoints(impsHome: number, impsAway: number): { home: number; away: number } {
  const margin = impsHome - impsAway;
  const winnerVp = Math.min(VP_TOTAL, VP_TOTAL / 2 + (VP_TOTAL / 2) * (Math.abs(margin) / BLITZ_MARGIN));

  const home = margin >= 0 ? winnerVp : VP_TOTAL - winnerVp;
  const rounded = Math.round(home * 100) / 100;

  // Derive the away score by subtraction so the pair always totals 20 exactly.
  return { home: rounded, away: Math.round((VP_TOTAL - rounded) * 100) / 100 };
}
