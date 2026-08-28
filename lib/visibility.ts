import { ENTRIES_PER_ROUND, ROUNDS, type Entry, type GameMeta, type MaskedEntry } from "@/lib/types";
import { isRoundComplete } from "@/lib/tournament/compute";
import type { RoundResult } from "@/lib/tournament/compute";
import type { GameRecord } from "@/lib/store";

export type VisibleEntry = Entry | MaskedEntry;

export const isMasked = (entry: VisibleEntry): entry is MaskedEntry => "masked" in entry;

export const isFullEntry = (entry: VisibleEntry): entry is Entry => !("masked" in entry);

export interface VisibleRound {
  round: number;
  complete: boolean;
  entries: VisibleEntry[];
  entryCount: number;
  expectedCount: number;
  result: RoundResult | null;
}

export interface VisibleGame {
  meta: GameMeta;
  clientId: string;
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
 * While a round is open a client sees only what it submitted itself; every
 * other board is masked. A pair's own boards in isolation reveal nothing,
 * because scoring a board needs the other table's result too. Once the round
 * closes, it is all public.
 */
export function visibleRound(
  round: number,
  entries: Entry[],
  result: RoundResult | null,
  clientId: string,
): VisibleRound {
  const forRound = entries.filter((e) => e.round === round);
  const complete = isRoundComplete(forRound);

  return {
    round,
    complete,
    entries: complete ? forRound : forRound.map((e) => (e.clientId === clientId ? e : mask(e))),
    entryCount: forRound.length,
    expectedCount: ENTRIES_PER_ROUND,
    // A result only exists for a closed round, but never serve one for an
    // open round even if a stale field somehow survived.
    result: complete ? result : null,
  };
}

/** Apply the visibility rules across a whole game. */
export function visibleGame(record: GameRecord, clientId: string): VisibleGame {
  return {
    meta: record.meta,
    clientId,
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
