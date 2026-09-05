import { createHash } from "node:crypto";
import {
  ENTRIES_PER_ROUND,
  type Contract,
  type Entry,
  type GameMeta,
  type PairId,
  type TeamId,
  negate,
} from "@/lib/types";
import { signedImps } from "@/lib/bridge/imps";
import { victoryPoints } from "@/lib/bridge/vp";
import { groupMatchups, orientations } from "@/lib/tournament/matchups";
import { type ValidationIssue, validateRound } from "@/lib/tournament/validate";

/** One row of a matchup scoresheet, from the home team's perspective. */
export interface BoardRow {
  board: number;
  /** The home team's pair that sat NS. */
  ns: { contract: Contract; score: number };
  /** The home team's pair that sat EW, scored from their own perspective. */
  ew: { contract: Contract; score: number };
  /** ns.score + ew.score: the home team's net on the board. */
  difference: number;
  /** IMPs, positive to the home team. */
  imps: number;
}

export interface MatchupResult {
  key: string;
  teams: [TeamId, TeamId];
  homeNsPair: PairId;
  homeEwPair: PairId;
  awayNsPair: PairId;
  awayEwPair: PairId;
  boards: BoardRow[];
  /** Boards present in only one orientation, so not scoreable. */
  excludedBoards: number[];
  impsHome: number;
  impsAway: number;
  vpHome: number;
  vpAway: number;
}

export interface RoundResult {
  round: number;
  computedAt: string;
  sourceDigest: string;
  status: "complete" | "unresolved";
  validation: ValidationIssue[];
  matchups: MatchupResult[];
  teamVp: Partial<Record<TeamId, number>>;
  entryCount: number;
}

/**
 * Fingerprint of a round's raw entries. Stored alongside a computed result
 * so a stale cache can be detected on read and healed, rather than silently
 * serving wrong victory points.
 */
export function digestEntries(entries: Entry[]): string {
  const canonical = entries
    .map((e) =>
      [e.round, e.nsPair, e.ewPair, e.board, e.nsScore, JSON.stringify(e.contract)].join("|"),
    )
    .sort()
    .join("\n");
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * A round closes once every board has been entered. The check is a plain
 * count rather than a structural one on purpose: if the pairings were
 * entered wrongly the structure will not form, and gating on structure
 * would leave the round permanently open with nobody able to see why.
 */
export function isRoundComplete(entries: Entry[]): boolean {
  return entries.length >= ENTRIES_PER_ROUND;
}

/**
 * Whether a round is closed to the visibility rules and open to everyone's
 * edits.
 *
 * Closure latches: a round that has ever been full stays closed even if a
 * board is later deleted. The stored result is the latch - it is written the
 * first time the round fills up and never removed - because reopening a round
 * mid-tournament would re-mask entries everyone has already seen and pull the
 * scoresheets out from under them.
 */
export function isRoundClosed(
  entries: Entry[],
  result: RoundResult | null | undefined,
): boolean {
  return isRoundComplete(entries) || Boolean(result);
}

function scoreMatchup(matchup: ReturnType<typeof groupMatchups>[number]): MatchupResult | null {
  const { home, away, homeNs, awayNs } = orientations(matchup);
  if (!homeNs || !awayNs) return null;

  const awayByBoard = new Map(awayNs.entries.map((e) => [e.board, e]));
  const boards: BoardRow[] = [];
  const excludedBoards: number[] = [];

  for (const homeEntry of homeNs.entries) {
    const awayEntry = awayByBoard.get(homeEntry.board);
    if (!awayEntry) {
      excludedBoards.push(homeEntry.board);
      continue;
    }
    awayByBoard.delete(homeEntry.board);

    // The home team sits NS in one orientation and EW in the other, so its
    // score in the second is the negation of that table's NS score.
    const nsScore = homeEntry.nsScore;
    const ewScore = negate(awayEntry.nsScore);
    const difference = nsScore + ewScore;

    boards.push({
      board: homeEntry.board,
      ns: { contract: homeEntry.contract, score: nsScore },
      ew: { contract: awayEntry.contract, score: ewScore },
      difference,
      imps: signedImps(difference),
    });
  }

  // Anything left in the away orientation had no counterpart.
  excludedBoards.push(...awayByBoard.keys());
  excludedBoards.sort((a, b) => a - b);
  boards.sort((a, b) => a.board - b.board);

  let impsHome = 0;
  let impsAway = 0;
  for (const row of boards) {
    if (row.imps > 0) impsHome += row.imps;
    else impsAway += -row.imps;
  }

  const vp = victoryPoints(impsHome, impsAway);

  return {
    key: matchup.key,
    teams: [home, away],
    homeNsPair: homeNs.nsPair,
    homeEwPair: awayNs.ewPair,
    awayNsPair: awayNs.nsPair,
    awayEwPair: homeNs.ewPair,
    boards,
    excludedBoards,
    impsHome,
    impsAway,
    vpHome: vp.home,
    vpAway: vp.away,
  };
}

/** Score a whole round: every matchup, its victory points, and the team totals. */
export function computeRound(round: number, entries: Entry[], meta: GameMeta): RoundResult {
  const validation = validateRound(entries, meta);
  const matchups = groupMatchups(entries)
    .map(scoreMatchup)
    .filter((m): m is MatchupResult => m !== null);

  const teamVp: Partial<Record<TeamId, number>> = {};
  const add = (team: TeamId, vp: number) => {
    teamVp[team] = Math.round(((teamVp[team] ?? 0) + vp) * 100) / 100;
  };
  for (const matchup of matchups) {
    add(matchup.teams[0], matchup.vpHome);
    add(matchup.teams[1], matchup.vpAway);
  }

  const hasErrors = validation.some((issue) => issue.severity === "error");

  return {
    round,
    computedAt: new Date().toISOString(),
    sourceDigest: digestEntries(entries),
    status: hasErrors ? "unresolved" : "complete",
    validation,
    matchups,
    teamVp,
    entryCount: entries.length,
  };
}

/** Cumulative victory points across every scored round. */
export function standings(
  results: RoundResult[],
  meta: GameMeta,
): Array<{ team: TeamId; name: string; vp: number; rounds: number }> {
  return meta.teams
    .map((team) => {
      const scored = results.filter((r) => r.teamVp[team.id] !== undefined);
      const vp = scored.reduce((sum, r) => sum + (r.teamVp[team.id] ?? 0), 0);
      return {
        team: team.id,
        name: team.name,
        vp: Math.round(vp * 100) / 100,
        rounds: scored.length,
      };
    })
    .sort((a, b) => b.vp - a.vp);
}
