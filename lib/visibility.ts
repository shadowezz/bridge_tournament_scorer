import { ENTRIES_PER_ROUND, ROUNDS, type Entry, type GameMeta, type MaskedEntry } from "@/lib/types";
import { isRoundComplete, isRoundEnded } from "@/lib/tournament/compute";
import { isAdmin } from "@/lib/admin";
import type { RoundResult } from "@/lib/tournament/compute";
import type { GameRecord } from "@/lib/store";

export type VisibleEntry = Entry | MaskedEntry;

export const isMasked = (entry: VisibleEntry): entry is MaskedEntry => "masked" in entry;

export const isFullEntry = (entry: VisibleEntry): entry is Entry => !("masked" in entry);

export interface VisibleRound {
  round: number;
  /** An admin has ended this round: results are public and frozen to admins. */
  ended: boolean;
  /** Every board is in. Says the round looks ready to end, nothing more. */
  full: boolean;
  entries: VisibleEntry[];
  entryCount: number;
  expectedCount: number;
  result: RoundResult | null;
}

export interface VisibleGame {
  meta: GameMeta;
  clientId: string;
  /** Whether this client holds admin. The admin ids themselves never ship. */
  isAdmin: boolean;
  adminCount: number;
  claimingOpen: boolean;
  rounds: VisibleRound[];
}

/**
 * Strip an entry down to the fact that a board was played.
 *
 * The pairing survives because the viewer chose it to reach this segment,
 * and the board number is what makes duplicate entry impossible. Everything
 * that could reveal a result - contract, declarer, score, author, timing -
 * is dropped.
 */
function mask(entry: Entry): MaskedEntry {
  return {
    round: entry.round,
    nsPair: entry.nsPair,
    ewPair: entry.ewPair,
    board: entry.board,
    masked: true,
  };
}

/**
 * Decide what one client may see of one round.
 *
 * Until an admin ends the round a client sees only what it submitted itself;
 * every other board is masked, admins included - admin is the power to end a
 * round and correct it afterwards, not to peek at one in progress. A pair's
 * own boards in isolation reveal nothing, because scoring a board needs the
 * other table's result too. Once the round is ended it is all public, and it
 * stays ended, so deleting a board later does not put the genie back in
 * the bottle.
 */
export function visibleRound(
  round: number,
  entries: Entry[],
  result: RoundResult | null,
  clientId: string,
): VisibleRound {
  const forRound = entries.filter((e) => e.round === round);
  const ended = isRoundEnded(result);

  return {
    round,
    ended,
    full: isRoundComplete(forRound),
    entries: ended ? forRound : forRound.map((e) => (e.clientId === clientId ? e : mask(e))),
    entryCount: forRound.length,
    expectedCount: ENTRIES_PER_ROUND,
    // A result only exists for an ended round, but never serve one for a round
    // still running even if a stale field somehow survived.
    result: ended ? result : null,
  };
}

/**
 * Apply the visibility rules across a whole game.
 *
 * `record.admins` stops here: a client id is a bearer credential, so the page
 * gets a boolean and a count and never the ids themselves.
 */
export function visibleGame(record: GameRecord, clientId: string): VisibleGame {
  return {
    meta: record.meta,
    clientId,
    isAdmin: isAdmin(record.admins, clientId),
    adminCount: record.admins.length,
    claimingOpen: record.claimingOpen,
    rounds: ROUNDS.map((round) =>
      visibleRound(round, record.entries, record.results[round] ?? null, clientId),
    ),
  };
}

/** The boards of one segment, as the entry form needs to render them. */
export function segmentView(round: VisibleRound, nsPair: string, ewPair: string) {
  return round.entries
    .filter((e) => e.nsPair === nsPair && e.ewPair === ewPair)
    .sort((a, b) => a.board - b.board);
}
