import type { Contract, Strain } from "@/lib/types";

/** Score value of one contract trick, by strain. Minors 20, majors 30. */
const TRICK_VALUE: Record<Strain, number> = { C: 20, D: 20, H: 30, S: 30, N: 30 };

/**
 * Contract trick score, before bonuses. Notrump is 40 for the first trick
 * then 30 thereafter; suits are a flat per-trick rate.
 */
function baseTrickScore(level: number, strain: Strain): number {
  return strain === "N" ? 40 + (level - 1) * 30 : level * TRICK_VALUE[strain];
}

/**
 * Penalty for going down, as a positive number.
 *
 * Undoubled is a flat per-trick rate. Doubled non-vulnerable escalates
 * 100 / 300 / 500 / 800 ... (100, then 200 for the 2nd and 3rd, then 300
 * each); doubled vulnerable is 200 / 500 / 800 ... Redoubled is double.
 */
function penalty(under: number, doubled: number, vulnerable: boolean): number {
  if (doubled === 0) return under * (vulnerable ? 100 : 50);

  let total = 0;
  for (let i = 1; i <= under; i++) {
    if (vulnerable) total += i === 1 ? 200 : 300;
    else total += i === 1 ? 100 : i <= 3 ? 200 : 300;
  }
  return doubled === 2 ? total * 2 : total;
}

/**
 * Duplicate bridge score for a made or defeated contract, from the
 * declaring side's perspective. Negative when the contract fails.
 *
 * The tournament is played all non-vulnerable, but the vulnerable branch is
 * implemented so the engine can be verified against mixed-vulnerability
 * reference scoresheets.
 */
export function scoreContract(contract: Contract, vulnerable = false): number {
  if (contract.passedOut) return 0;

  const { level, strain, doubled, result } = contract;

  if (result < 0) return -penalty(-result, doubled, vulnerable);

  const multiplier = doubled === 0 ? 1 : doubled === 1 ? 2 : 4;
  const trickScore = baseTrickScore(level, strain) * multiplier;

  let score = trickScore;

  // Game bonus applies on the doubled trick score, so 2Cx= (80) is a
  // partscore but 3Hx= (180) is a game.
  score += trickScore >= 100 ? (vulnerable ? 500 : 300) : 50;

  if (level === 6) score += vulnerable ? 750 : 500;
  if (level === 7) score += vulnerable ? 1500 : 1000;

  // Insult bonus for making a doubled or redoubled contract.
  if (doubled === 1) score += 50;
  if (doubled === 2) score += 100;

  if (doubled === 0) {
    // Notrump overtricks are worth 30, not the 40 of its first trick.
    score += result * TRICK_VALUE[strain];
  } else {
    const per = doubled === 1 ? (vulnerable ? 200 : 100) : vulnerable ? 400 : 200;
    score += result * per;
  }

  return score;
}

const DECLARER_IS_NS: Record<string, boolean> = { N: true, S: true, E: false, W: false };

/**
 * Score from North-South's perspective: positive when NS gain, negative
 * when EW gain, regardless of which side declared.
 */
export function nsScore(contract: Contract, vulnerable = false): number {
  if (contract.passedOut) return 0;
  const raw = scoreContract(contract, vulnerable);
  return DECLARER_IS_NS[contract.declarer] ? raw : -raw;
}
