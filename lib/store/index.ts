import type { Backend } from "@/lib/store/backend";
import { fsBackend } from "@/lib/store/fs";
import { redisBackend } from "@/lib/store/redis";
import { nsScore } from "@/lib/bridge/score";
import { computeRound, digestEntries, isRoundComplete, type RoundResult } from "@/lib/tournament/compute";
import { validateSegmentPairing } from "@/lib/tournament/validate";
import { ROUNDS, type Contract, type Entry, type GameMeta, type PairId } from "@/lib/types";

export interface GameRecord {
  meta: GameMeta;
  entries: Entry[];
  /** Persisted round results, keyed by round number. */
  results: Record<number, RoundResult>;
}

export interface SegmentRow {
  board: number;
  contract: Contract;
}

export interface WriteOutcome {
  /** Boards owned by another client that were not overwritten. */
  conflicts: number[];
  record: GameRecord;
}

const gameKey = (gameId: string) => `g:${gameId}`;
const resultField = (round: number) => `r${round}|result`;
const entryField = (round: number, nsPair: PairId, ewPair: PairId, board: number) =>
  `r${round}|${nsPair}|${ewPair}|${board}`;

interface StoredEntry {
  contract: Contract;
  nsScore: number;
  updatedAt: string;
  clientId: string;
}

/**
 * Entries carry their round, pairs and board in the field name rather than
 * the value, so the two can never drift apart.
 */
function decodeEntryField(field: string, raw: string): Entry | null {
  const parts = field.split("|");
  if (parts.length !== 4) return null;

  const [roundPart, nsPair, ewPair, boardPart] = parts;
  const round = Number(roundPart.slice(1));
  const board = Number(boardPart);
  if (!Number.isInteger(round) || !Number.isInteger(board)) return null;

  const stored = JSON.parse(raw) as StoredEntry;
  return { round, nsPair, ewPair, board, ...stored };
}

function encodeEntry(entry: Entry): string {
  const stored: StoredEntry = {
    contract: entry.contract,
    nsScore: entry.nsScore,
    updatedAt: entry.updatedAt,
    clientId: entry.clientId,
  };
  return JSON.stringify(stored);
}

export function createStore(backend: Backend = defaultBackend()) {
  /**
   * Recompute a round and return the fields to persist alongside whatever
   * change triggered it. Every mutation funnels through here, so no code
   * path can change an entry without its victory points following.
   */
  function resultFieldsFor(round: number, entries: Entry[], meta: GameMeta): Record<string, string> {
    const forRound = entries.filter((e) => e.round === round);
    if (!isRoundComplete(forRound)) return {};
    return { [resultField(round)]: JSON.stringify(computeRound(round, forRound, meta)) };
  }

  async function readRecord(gameId: string): Promise<GameRecord | null> {
    const fields = await backend.readAll(gameKey(gameId));
    if (!fields?.meta) return null;

    const meta = JSON.parse(fields.meta) as GameMeta;
    const entries: Entry[] = [];
    const results: Record<number, RoundResult> = {};

    for (const [field, raw] of Object.entries(fields)) {
      if (field === "meta") continue;
      if (field.endsWith("|result")) {
        const result = JSON.parse(raw) as RoundResult;
        results[result.round] = result;
        continue;
      }
      const entry = decodeEntryField(field, raw);
      if (entry) entries.push(entry);
    }

    entries.sort((a, b) => a.round - b.round || a.board - b.board);
    return { meta, entries, results };
  }

  /**
   * Read a game, repairing any round result that does not match its entries.
   *
   * The digest makes an invalidation bug degrade into a slow path instead of
   * quietly serving stale victory points, which is the one failure nobody
   * would notice during a live tournament.
   */
  async function loadGame(gameId: string): Promise<GameRecord | null> {
    const record = await readRecord(gameId);
    if (!record) return null;

    const repairs: Record<string, string> = {};

    for (const round of ROUNDS) {
      const forRound = record.entries.filter((e) => e.round === round);
      const stored = record.results[round];
      const complete = isRoundComplete(forRound);

      if (!complete) {
        // A round that has fallen back below a full card should not keep a
        // stale result hanging around.
        if (stored) delete record.results[round];
        continue;
      }

      if (stored && stored.sourceDigest === digestEntries(forRound)) continue;

      console.warn(
        `[store] round ${round} of ${gameId}: ${stored ? "stale" : "missing"} result, recomputing`,
      );
      const fresh = computeRound(round, forRound, record.meta);
      record.results[round] = fresh;
      repairs[resultField(round)] = JSON.stringify(fresh);
    }

    if (Object.keys(repairs).length > 0) {
      await backend.write(gameKey(gameId), repairs);
    }

    return record;
  }

  async function createGame(meta: GameMeta): Promise<void> {
    await backend.write(gameKey(meta.id), { meta: JSON.stringify(meta) });
  }

  /**
   * Upsert a segment's boards.
   *
   * Boards already owned by another client are skipped and reported unless
   * explicitly listed in `takeOver`, which is how a player corrects a
   * tablemate's typo without ever being shown the previous value.
   */
  async function writeEntries(
    gameId: string,
    input: {
      round: number;
      nsPair: PairId;
      ewPair: PairId;
      rows: SegmentRow[];
      clientId: string;
      takeOver?: number[];
    },
  ): Promise<WriteOutcome> {
    const { round, nsPair, ewPair, rows, clientId } = input;

    const pairingError = validateSegmentPairing(nsPair, ewPair);
    if (pairingError) throw new Error(pairingError);

    const record = await readRecord(gameId);
    if (!record) throw new Error("Game not found");

    const takeOver = new Set(input.takeOver ?? []);
    const owned = new Map(
      record.entries
        .filter((e) => e.round === round && e.nsPair === nsPair && e.ewPair === ewPair)
        .map((e) => [e.board, e]),
    );

    const conflicts: number[] = [];
    const updates: Record<string, string> = {};
    const updatedAt = new Date().toISOString();
    const nextEntries = [...record.entries];

    for (const row of rows) {
      const existing = owned.get(row.board);
      if (existing && existing.clientId !== clientId && !takeOver.has(row.board)) {
        conflicts.push(row.board);
        continue;
      }

      const entry: Entry = {
        round,
        nsPair,
        ewPair,
        board: row.board,
        contract: row.contract,
        nsScore: nsScore(row.contract, false),
        updatedAt,
        clientId,
      };

      updates[entryField(round, nsPair, ewPair, row.board)] = encodeEntry(entry);

      const index = nextEntries.findIndex(
        (e) => e.round === round && e.nsPair === nsPair && e.ewPair === ewPair && e.board === row.board,
      );
      if (index >= 0) nextEntries[index] = entry;
      else nextEntries.push(entry);
    }

    if (Object.keys(updates).length > 0) {
      Object.assign(updates, resultFieldsFor(round, nextEntries, record.meta));
      await backend.write(gameKey(gameId), updates);
    }

    const refreshed = await loadGame(gameId);
    return { conflicts, record: refreshed! };
  }

  /** Delete boards from a segment. Only the owning client may remove an entry. */
  async function deleteEntries(
    gameId: string,
    input: { round: number; nsPair: PairId; ewPair: PairId; boards: number[]; clientId: string },
  ): Promise<GameRecord> {
    const { round, nsPair, ewPair, boards, clientId } = input;

    const record = await readRecord(gameId);
    if (!record) throw new Error("Game not found");

    const removable = record.entries.filter(
      (e) =>
        e.round === round &&
        e.nsPair === nsPair &&
        e.ewPair === ewPair &&
        boards.includes(e.board) &&
        e.clientId === clientId,
    );

    if (removable.length > 0) {
      const remove = removable.map((e) => entryField(round, nsPair, ewPair, e.board));
      const removed = new Set(remove);
      const nextEntries = record.entries.filter(
        (e) => !removed.has(entryField(e.round, e.nsPair, e.ewPair, e.board)),
      );

      // Dropping below a full card invalidates the round's result.
      const stillComplete = isRoundComplete(nextEntries.filter((e) => e.round === round));
      await backend.write(
        gameKey(gameId),
        stillComplete ? resultFieldsFor(round, nextEntries, record.meta) : {},
        stillComplete ? remove : [...remove, resultField(round)],
      );
    }

    return (await loadGame(gameId))!;
  }

  /** Move this client's entries to a different pairing, when the dropdowns were wrong. */
  async function repointSegment(
    gameId: string,
    input: {
      round: number;
      from: { nsPair: PairId; ewPair: PairId };
      to: { nsPair: PairId; ewPair: PairId };
      clientId: string;
    },
  ): Promise<GameRecord> {
    const { round, from, to, clientId } = input;

    const pairingError = validateSegmentPairing(to.nsPair, to.ewPair);
    if (pairingError) throw new Error(pairingError);

    const record = await readRecord(gameId);
    if (!record) throw new Error("Game not found");

    const moving = record.entries.filter(
      (e) =>
        e.round === round &&
        e.nsPair === from.nsPair &&
        e.ewPair === from.ewPair &&
        e.clientId === clientId,
    );
    if (moving.length === 0) return record;

    const remove = moving.map((e) => entryField(round, from.nsPair, from.ewPair, e.board));
    const removed = new Set(remove);
    const updates: Record<string, string> = {};
    const nextEntries = record.entries.filter(
      (e) => !removed.has(entryField(e.round, e.nsPair, e.ewPair, e.board)),
    );

    for (const entry of moving) {
      const moved: Entry = { ...entry, nsPair: to.nsPair, ewPair: to.ewPair };
      updates[entryField(round, to.nsPair, to.ewPair, entry.board)] = encodeEntry(moved);
      nextEntries.push(moved);
    }

    Object.assign(updates, resultFieldsFor(round, nextEntries, record.meta));
    await backend.write(gameKey(gameId), updates, remove);

    return (await loadGame(gameId))!;
  }

  return { createGame, loadGame, writeEntries, deleteEntries, repointSegment, gameExists: (id: string) => backend.exists(gameKey(id)) };
}

function defaultBackend(): Backend {
  const hasRedis = Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
  return hasRedis ? redisBackend() : fsBackend();
}

let shared: ReturnType<typeof createStore> | null = null;

/** The process-wide store, chosen from the environment. */
export function store() {
  shared ??= createStore();
  return shared;
}
