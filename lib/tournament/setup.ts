import { newGameId } from "@/lib/ids";
import type { GameMeta, Pair, TeamId } from "@/lib/types";

export const TEAM_IDS: TeamId[] = ["A", "B", "C"];

/** Field names the creation form must use, kept next to the code that reads them. */
export const teamField = (team: TeamId) => `team-${team}`;
export const playerField = (team: TeamId, pair: 1 | 2, slot: 1 | 2) =>
  `player-${team}${pair}-${slot}`;

type Fields = Pick<FormData, "get">;

/**
 * Build a game from the creation form.
 *
 * Every field falls back to a placeholder rather than failing: a tournament
 * about to start should never be blocked by a missing surname, and names can
 * be corrected later without touching any results.
 */
export function buildGameMeta(form: Fields, id: string = newGameId()): GameMeta {
  const text = (name: string, fallback: string) =>
    String(form.get(name) ?? "").trim() || fallback;

  const teams = TEAM_IDS.map((team) => ({
    id: team,
    name: text(teamField(team), `Team ${team}`),
  }));

  const pairs: Pair[] = [];
  for (const team of TEAM_IDS) {
    for (const index of [1, 2] as const) {
      pairs.push({
        id: `${team}${index}`,
        team,
        players: [1, 2].map((slot) =>
          text(playerField(team, index, slot as 1 | 2), `Player ${team}${index}.${slot}`),
        ) as [string, string],
      });
    }
  }

  return { id, createdAt: new Date().toISOString(), teams, pairs };
}
