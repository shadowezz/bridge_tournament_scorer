// Type-only import: erased at compile time, so this module stays safe to load
// in a client component even though compute.ts itself pulls node:crypto.
import type { MatchupResult } from "@/lib/tournament/compute";
import { negate, type TeamId } from "@/lib/types";

/**
 * Retell a matchup from the other team's point of view.
 *
 * A result is stored once, from the home team's side. Both tables are already
 * in it, so the away team's sheet is a pure rearrangement - no refetch, and no
 * second copy of the scores to drift out of step.
 *
 * The two orientations swap roles: the away team's NS pair sat at the table
 * where the home team's EW pair played, so that table's row moves across and
 * every figure negates.
 */
export function flipMatchup(matchup: MatchupResult): MatchupResult {
  return {
    key: matchup.key,
    teams: [matchup.teams[1], matchup.teams[0]],
    homeNsPair: matchup.awayNsPair,
    homeEwPair: matchup.awayEwPair,
    awayNsPair: matchup.homeNsPair,
    awayEwPair: matchup.homeEwPair,
    boards: matchup.boards.map((row) => ({
      board: row.board,
      ns: { contract: row.ew.contract, score: negate(row.ew.score) },
      ew: { contract: row.ns.contract, score: negate(row.ns.score) },
      difference: negate(row.difference),
      imps: negate(row.imps),
    })),
    excludedBoards: matchup.excludedBoards,
    impsHome: matchup.impsAway,
    impsAway: matchup.impsHome,
    vpHome: matchup.vpAway,
    vpAway: matchup.vpHome,
  };
}

/**
 * The matchups one team played in a round, each retold from that team's side.
 *
 * A result is stored once from the sorted-first team's point of view, so a team
 * is home in some of its matchups and away in the others. Orienting them all
 * one way is what lets a team's page read straight down the sheets without the
 * reader having to track which side they are on: after this `teams[0]`,
 * `impsHome`, `vpHome` and the home pairs always belong to `team`.
 */
export function teamMatchups(matchups: MatchupResult[], team: TeamId): MatchupResult[] {
  return matchups
    .filter((matchup) => matchup.teams.includes(team))
    .map((matchup) => (matchup.teams[0] === team ? matchup : flipMatchup(matchup)));
}
