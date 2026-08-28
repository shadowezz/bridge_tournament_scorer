export type Strain = "C" | "D" | "H" | "S" | "N";
export type Seat = "N" | "E" | "S" | "W";
export type Doubled = 0 | 1 | 2;
export type TeamId = "A" | "B" | "C";
/** Pair identifiers are always `${TeamId}1` | `${TeamId}2`, e.g. "A1", "C2". */
export type PairId = string;

/** A parsed contract. `passedOut` boards carry no other fields. */
export type Contract =
  | { passedOut: true }
  | {
      passedOut: false;
      level: 1 | 2 | 3 | 4 | 5 | 6 | 7;
      strain: Strain;
      doubled: Doubled;
      declarer: Seat;
      /** Tricks relative to the contract: 0 = "=", +1, -2, ... */
      result: number;
    };

export interface Pair {
  id: PairId;
  team: TeamId;
  players: [string, string];
}

export interface Team {
  id: TeamId;
  name: string;
}

export interface GameMeta {
  id: string;
  createdAt: string;
  teams: Team[];
  pairs: Pair[];
}

/** One board played by one pair-vs-pair segment, in one orientation. */
export interface Entry {
  round: number;
  nsPair: PairId;
  ewPair: PairId;
  board: number;
  contract: Contract;
  /** Score from North-South's perspective. Negative means EW scored. */
  nsScore: number;
  updatedAt: string;
  clientId: string;
}

/** An entry the requester does not own: board number only, no content. */
export interface MaskedEntry {
  round: number;
  nsPair: PairId;
  ewPair: PairId;
  board: number;
  masked: true;
}

export const ROUNDS = [1, 2, 3] as const;
export const BOARDS_PER_SEGMENT = 6;
export const SEGMENTS_PER_ROUND = 6;
export const ENTRIES_PER_ROUND = BOARDS_PER_SEGMENT * SEGMENTS_PER_ROUND;

export function teamOf(pair: PairId): TeamId {
  return pair[0] as TeamId;
}

/** Canonical, order-independent key for a matchup between two teams. */
export function matchupKey(x: TeamId, y: TeamId): string {
  return [x, y].sort().join("-");
}

/** Human-readable label for a pair, e.g. "Sharks — Siok Hui / Jing Xuan". */
export function pairLabel(meta: GameMeta, pairId: PairId): string {
  const pair = meta.pairs.find((p) => p.id === pairId);
  if (!pair) return pairId;
  const team = meta.teams.find((t) => t.id === pair.team);
  return `${team?.name ?? pair.team} — ${pair.players[0]} / ${pair.players[1]}`;
}

/** Short label for a pair, e.g. "Sharks A1". */
export function pairShortLabel(meta: GameMeta, pairId: PairId): string {
  const pair = meta.pairs.find((p) => p.id === pairId);
  if (!pair) return pairId;
  const team = meta.teams.find((t) => t.id === pair.team);
  return `${team?.name ?? pair.team} ${pairId}`;
}

export function teamName(meta: GameMeta, teamId: TeamId): string {
  return meta.teams.find((t) => t.id === teamId)?.name ?? teamId;
}

/** Just the two player names, e.g. "Wj / Luke". */
export function pairPlayers(meta: GameMeta, pairId: PairId): string {
  const pair = meta.pairs.find((p) => p.id === pairId);
  return pair ? pair.players.join(" / ") : pairId;
}

/**
 * Negate a score without producing -0.
 *
 * Passed-out and flat boards score zero, and `-0` would otherwise reach stored
 * results - where it survives in memory but becomes `0` through JSON, so a
 * freshly computed round would not deep-equal the same round reloaded.
 */
export function negate(value: number): number {
  return value === 0 ? 0 : -value;
}
