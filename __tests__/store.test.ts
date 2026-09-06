import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotAdminError, RoundEndedError, createStore, type GameRecord } from "@/lib/store";
import type { Backend } from "@/lib/store/backend";
import { parseContract } from "@/lib/bridge/contract";
import { computeRound, digestEntries } from "@/lib/tournament/compute";
import { isFullEntry, isMasked, visibleGame, visibleRound } from "@/lib/visibility";
import { completeRound, meta } from "./fixtures";

/** In-memory backend with the same field semantics as Redis and the fs adapter. */
function memoryBackend(): Backend & { dump: () => Record<string, Record<string, string>> } {
  const data = new Map<string, Record<string, string>>();
  return {
    async readAll(key) {
      const hash = data.get(key);
      return hash ? { ...hash } : null;
    },
    async write(key, fields, remove = []) {
      const hash = data.get(key) ?? {};
      for (const field of remove) delete hash[field];
      Object.assign(hash, fields);
      data.set(key, hash);
    },
    async exists(key) {
      return data.has(key);
    },
    dump: () => Object.fromEntries([...data].map(([k, v]) => [k, { ...v }])),
  };
}

const rows = (boards: Array<[number, string]>) =>
  boards.map(([board, text]) => ({ board, contract: parseContract(text) }));

/** The A1-vs-B1 segment of `completeRound`, which several tests re-post whole. */
const set1: Array<[number, string]> = [
  [1, "4HN="], [2, "4SN+1"], [3, "3NTE="], [4, "2HN+1"], [5, "5CxE-2"], [6, "pass"],
];

/**
 * Admin ids have to survive `isValidClientId`, so they are real 10-character
 * Crockford codes rather than the readable names the entries use.
 */
const ADMIN = "ADM1N00000";
const ADMIN2 = "ADM1N00001";

async function seedCompleteRound(store: ReturnType<typeof createStore>, round = 1) {
  await store.createGame(meta);
  const entries = completeRound(round);
  const segments = new Map<string, typeof entries>();
  for (const entry of entries) {
    const key = `${entry.nsPair}|${entry.ewPair}`;
    segments.set(key, [...(segments.get(key) ?? []), entry]);
  }
  for (const [key, group] of segments) {
    const [nsPair, ewPair] = key.split("|");
    await store.writeSegment(meta.id, {
      round,
      nsPair,
      ewPair,
      clientId: group[0].clientId,
      rows: group.map((e) => ({ board: e.board, contract: e.contract })),
    });
  }
}

/** Fill a round, then have an admin end it - the only way a round is scored. */
async function seedEndedRound(store: ReturnType<typeof createStore>, round = 1) {
  await seedCompleteRound(store, round);
  await store.claimAdmin(meta.id, ADMIN);
  await store.endRound(meta.id, ADMIN, round);
}

describe("store", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    backend = memoryBackend();
    store = createStore(backend);
  });

  afterEach(() => vi.restoreAllMocks());

  it("round-trips a game and computes its score once an admin ends the round", async () => {
    await seedEndedRound(store);
    const record = await store.loadGame(meta.id)!;

    expect(record!.entries).toHaveLength(36);
    expect(record!.results[1].status).toBe("complete");
    expect(record!.results[1].teamVp).toEqual({ A: 23.24, B: 13.79, C: 22.97 });
  });

  it("keeps the round unscored while boards are still coming in", async () => {
    await store.createGame(meta);
    await store.writeSegment(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "c1",
      rows: rows([[1, "4HN="]]),
    });

    const record = await store.loadGame(meta.id);
    expect(record!.results[1]).toBeUndefined();
  });

  it("does not score a full round on its own - a full card is not an ending", async () => {
    await seedCompleteRound(store);
    const record = await store.loadGame(meta.id);

    expect(record!.entries).toHaveLength(36);
    expect(record!.results[1]).toBeUndefined();
    expect(Object.keys(backend.dump()[`g:${meta.id}`])).not.toContain("r1|result");
  });

  it("stores one field per board so writes never touch each other", async () => {
    await seedEndedRound(store);
    const fields = Object.keys(backend.dump()[`g:${meta.id}`]);

    expect(fields).toContain("r1|A1|B1|1");
    expect(fields).toContain("r1|result");
    expect(fields.filter((f) => f.startsWith("r1|") && !f.endsWith("|result"))).toHaveLength(36);
  });

  it("rejects a segment whose pairs share a team", async () => {
    await store.createGame(meta);
    await expect(
      store.writeSegment(meta.id, {
        round: 1,
        nsPair: "A1",
        ewPair: "A2",
        clientId: "c1",
        rows: rows([[1, "4HN="]]),
      }),
    ).rejects.toThrow(/same team/i);
  });
});

describe("ownership", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(async () => {
    store = createStore(memoryBackend());
    await store.createGame(meta);
    await store.writeSegment(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "owner",
      rows: rows([[1, "4HN="]]),
    });
  });

  it("refuses to overwrite another client's board and reports the conflict", async () => {
    const { conflicts, record } = await store.writeSegment(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "stranger",
      rows: rows([[1, "3NTS="]]),
    });

    expect(conflicts).toEqual([1]);
    expect(record.entries[0].clientId).toBe("owner");
    expect(record.entries[0].nsScore).toBe(420);
  });

  it("transfers ownership when the board is explicitly taken over", async () => {
    const { conflicts, record } = await store.writeSegment(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "stranger",
      rows: rows([[1, "3NTS="]]),
      takeOver: [1],
    });

    expect(conflicts).toEqual([]);
    expect(record.entries[0].clientId).toBe("stranger");
    expect(record.entries[0].nsScore).toBe(400);
  });

  it("lets the owner edit their own board freely", async () => {
    const { conflicts, record } = await store.writeSegment(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "owner",
      rows: rows([[1, "4HN+1"]]),
    });
    expect(conflicts).toEqual([]);
    expect(record.entries[0].nsScore).toBe(450);
  });

  it("deletes only entries the client owns", async () => {
    let record = await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: "stranger",
    });
    expect(record.entries).toHaveLength(1);

    record = await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: "owner",
    });
    expect(record.entries).toHaveLength(0);
  });
});

describe("a segment save replaces the segment's contents", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let store: ReturnType<typeof createStore>;

  const fields = () => Object.keys(backend.dump()[`g:${meta.id}`]);

  beforeEach(async () => {
    backend = memoryBackend();
    store = createStore(backend);
    await store.createGame(meta);
    await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "owner", rows: rows(set1),
    });
  });

  it("removes a board the save no longer lists", async () => {
    const { removed, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "owner",
      rows: rows(set1.filter(([board]) => board !== 6)),
    });

    expect(removed).toEqual([6]);
    expect(record.entries).toHaveLength(5);
    expect(fields()).not.toContain("r1|A1|B1|6");
  });

  it("carries a renumbered board across instead of leaving both behind", async () => {
    const { removed } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "owner",
      rows: rows(set1.map(([board, text]) => (board === 3 ? [7, text] : [board, text]))),
    });

    expect(removed).toEqual([3]);
    expect(fields()).toContain("r1|A1|B1|7");
    expect(fields()).not.toContain("r1|A1|B1|3");
  });

  it("empties a segment when every row is cleared", async () => {
    const { removed, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "owner", rows: [],
    });

    expect(removed).toEqual([1, 2, 3, 4, 5, 6]);
    expect(record.entries).toHaveLength(0);
  });

  it("neither overwrites nor removes another client's boards while the round is open", async () => {
    const { conflicts, removed, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "stranger", rows: rows([[1, "3NTS="]]),
    });

    // Board 1 came back as a conflict, and the five boards the stranger never
    // mentioned are not theirs to reconcile away.
    expect(conflicts).toEqual([1]);
    expect(removed).toEqual([]);
    expect(record.entries).toHaveLength(6);
    expect(record.entries.every((e) => e.clientId === "owner")).toBe(true);
  });

  it("leaves the old board alone when its replacement is rejected", async () => {
    // "stranger" owns board 9 and tries to renumber it onto "owner"'s board 4.
    await store.writeSegment(meta.id, {
      round: 1, nsPair: "B2", ewPair: "C1", clientId: "stranger", rows: rows([[9, "4HS-1"]]),
    });
    const { conflicts, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "stranger", rows: rows([[4, "3NTS="]]),
    });

    expect(conflicts).toEqual([4]);
    expect(record.entries.filter((e) => e.nsPair === "A1" && e.ewPair === "B1")).toHaveLength(6);
  });
});

describe("a full round stays open until an admin ends it", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(async () => {
    store = createStore(memoryBackend());
    await seedCompleteRound(store);
  });

  it("still masks every entry from a client that submitted nothing", async () => {
    const view = visibleGame((await store.loadGame(meta.id))!, "someone-else");
    expect(view.rounds[0].ended).toBe(false);
    expect(view.rounds[0].full).toBe(true);
    expect(view.rounds[0].entries.every(isMasked)).toBe(true);
  });

  it("masks it from an admin too - admin is not early sight", async () => {
    await store.claimAdmin(meta.id, ADMIN);
    const view = visibleGame((await store.loadGame(meta.id))!, ADMIN);

    expect(view.isAdmin).toBe(true);
    expect(view.rounds[0].ended).toBe(false);
    expect(view.rounds[0].entries.every(isMasked)).toBe(true);
  });

  it("keeps the open write rules, so a stranger still gets a conflict", async () => {
    const { conflicts, removed, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "stranger", rows: rows([[1, "3NTS="]]),
    });

    expect(conflicts).toEqual([1]);
    expect(removed).toEqual([]);
    expect(record.entries.find((e) => e.board === 1 && e.nsPair === "A1")!.clientId).toBe(
      "client-a1",
    );
  });
});

describe("an ended round is frozen to everyone but an admin", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let store: ReturnType<typeof createStore>;

  beforeEach(async () => {
    backend = memoryBackend();
    store = createStore(backend);
    await seedEndedRound(store);
  });

  const segmentEntries = (record: GameRecord) =>
    record.entries.filter((e) => e.nsPair === "A1" && e.ewPair === "B1");

  it("refuses a save from a non-admin, even on their own board", async () => {
    await expect(
      store.writeSegment(meta.id, {
        round: 1, nsPair: "A1", ewPair: "B1", clientId: "client-a1", rows: rows(set1),
      }),
    ).rejects.toBeInstanceOf(RoundEndedError);

    const record = await store.loadGame(meta.id);
    expect(record!.entries).toHaveLength(36);
  });

  it("refuses a delete and a repoint from a non-admin", async () => {
    await expect(
      store.deleteEntries(meta.id, {
        round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: "client-a1",
      }),
    ).rejects.toBeInstanceOf(RoundEndedError);

    await expect(
      store.repointSegment(meta.id, {
        round: 1,
        from: { nsPair: "A1", ewPair: "B1" },
        to: { nsPair: "A1", ewPair: "B2" },
        clientId: "client-a1",
      }),
    ).rejects.toBeInstanceOf(RoundEndedError);

    expect((await store.loadGame(meta.id))!.entries).toHaveLength(36);
  });

  it("lets an admin overwrite and remove boards it never entered", async () => {
    const { conflicts, removed, record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: ADMIN,
      rows: rows(
        set1
          .filter(([board]) => board !== 6)
          .map(([board, text]) => (board === 1 ? [1, "3NTS="] : [board, text])),
      ),
    });

    expect(conflicts).toEqual([]);
    expect(removed).toEqual([6]);
    expect(segmentEntries(record)).toHaveLength(5);
    expect(segmentEntries(record).find((e) => e.board === 1)!.clientId).toBe(ADMIN);
  });

  it("lets an admin delete a board outright", async () => {
    const record = await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: ADMIN,
    });
    expect(record.entries).toHaveLength(35);
  });

  it("keeps the latch on disk, so a reload does not reopen the round", async () => {
    await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: ADMIN,
    });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = await store.loadGame(meta.id);

    expect(record!.results[1]).toBeDefined();
    expect(record!.results[1].sourceDigest).toBe(
      digestEntries(record!.entries.filter((e) => e.round === 1)),
    );
    expect(warn).not.toHaveBeenCalled();
    expect(Object.keys(backend.dump()[`g:${meta.id}`])).toContain("r1|result");
  });

  it("holds endedAt still while computedAt moves with each correction", async () => {
    const before = (await store.loadGame(meta.id))!.results[1];

    const { record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: ADMIN,
      rows: rows(set1.map((row) => (row[0] === 5 ? [5, "5CxE="] : row))),
    });

    expect(record.results[1].endedAt).toBe(before.endedAt);
    expect(record.results[1].sourceDigest).not.toBe(before.sourceDigest);
  });
});

describe("results written before rounds were ended by hand", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let store: ReturnType<typeof createStore>;

  /** Strip `endedAt`, leaving the result exactly as the old code wrote it. */
  async function ageTheResult() {
    const key = `g:${meta.id}`;
    const { endedAt: _gone, ...legacy } = JSON.parse(backend.dump()[key]["r1|result"]);
    await backend.write(key, { "r1|result": JSON.stringify(legacy) });
    return legacy.computedAt as string;
  }

  beforeEach(async () => {
    backend = memoryBackend();
    store = createStore(backend);
    await seedEndedRound(store);
  });

  it("reads as ended, with endedAt back-filled from computedAt", async () => {
    const computedAt = await ageTheResult();
    const record = await store.loadGame(meta.id);

    expect(record!.results[1].endedAt).toBe(computedAt);
    expect(visibleRound(1, record!.entries, record!.results[1], "nobody").ended).toBe(true);
  });

  it("still refuses a non-admin", async () => {
    await ageTheResult();
    await expect(
      store.deleteEntries(meta.id, {
        round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: "client-a1",
      }),
    ).rejects.toBeInstanceOf(RoundEndedError);
  });

  it("recomputes in the same write as an admin's delete, not on the next read", async () => {
    await ageTheResult();
    await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: ADMIN,
    });

    // Read the field straight off the backend: the fix is that the write
    // itself carried the new result, not that a later load healed it.
    const stored = JSON.parse(backend.dump()[`g:${meta.id}`]["r1|result"]);
    expect(stored.entryCount).toBe(35);
    expect(stored.endedAt).toBeDefined();

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await store.loadGame(meta.id);
    expect(warn).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});

describe("admin claiming", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(async () => {
    store = createStore(memoryBackend());
    await store.createGame(meta);
  });

  it("starts a game with no admins and claiming open", async () => {
    const record = await store.loadGame(meta.id);
    expect(record!.admins).toEqual([]);
    expect(record!.claimingOpen).toBe(true);
  });

  it("lets several clients hold admin at once", async () => {
    await store.claimAdmin(meta.id, ADMIN);
    const record = await store.claimAdmin(meta.id, ADMIN2);

    expect(record.admins).toEqual([ADMIN, ADMIN2]);
    expect(visibleGame(record, ADMIN).isAdmin).toBe(true);
    expect(visibleGame(record, ADMIN2).isAdmin).toBe(true);
    expect(visibleGame(record, "someone-else").isAdmin).toBe(false);
  });

  it("refuses a claim from a client with no session", async () => {
    await expect(store.claimAdmin(meta.id, "")).rejects.toThrow(/session/i);
  });

  it("only lets an admin close claiming", async () => {
    await expect(store.setClaiming(meta.id, ADMIN2, false)).rejects.toBeInstanceOf(NotAdminError);

    await store.claimAdmin(meta.id, ADMIN);
    const record = await store.setClaiming(meta.id, ADMIN, false);
    expect(record.claimingOpen).toBe(false);
  });

  it("turns latecomers away once claiming is closed, and back on when reopened", async () => {
    await store.claimAdmin(meta.id, ADMIN);
    await store.setClaiming(meta.id, ADMIN, false);

    await expect(store.claimAdmin(meta.id, ADMIN2)).rejects.toBeInstanceOf(NotAdminError);
    // An existing admin re-claiming is a no-op, not a lockout.
    await expect(store.claimAdmin(meta.id, ADMIN)).resolves.toBeDefined();

    await store.setClaiming(meta.id, ADMIN, true);
    expect((await store.claimAdmin(meta.id, ADMIN2)).admins).toContain(ADMIN2);
  });

  it("never lets an admin client id reach the browser", async () => {
    const record = await store.claimAdmin(meta.id, ADMIN);
    const view = visibleGame(record, "someone-else");

    expect(view.adminCount).toBe(1);
    expect(JSON.stringify(view)).not.toContain(ADMIN);
  });
});

describe("ending a round", () => {
  let store: ReturnType<typeof createStore>;

  beforeEach(async () => {
    store = createStore(memoryBackend());
    await seedCompleteRound(store);
  });

  it("refuses a non-admin", async () => {
    await expect(store.endRound(meta.id, "client-a1", 1)).rejects.toBeInstanceOf(NotAdminError);
    expect((await store.loadGame(meta.id))!.results[1]).toBeUndefined();
  });

  it("scores and reveals the round, and is idempotent", async () => {
    await store.claimAdmin(meta.id, ADMIN);
    const record = await store.endRound(meta.id, ADMIN, 1);

    expect(record.results[1].teamVp).toEqual({ A: 23.24, B: 13.79, C: 22.97 });
    expect(visibleRound(1, record.entries, record.results[1], "nobody").ended).toBe(true);

    const again = await store.endRound(meta.id, ADMIN, 1);
    expect(again.results[1].endedAt).toBe(record.results[1].endedAt);
  });

  it("ends a short round rather than refusing, and flags the gap", async () => {
    const store = createStore(memoryBackend());
    await store.createGame(meta);
    await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "client-a1", rows: rows(set1),
    });
    await store.claimAdmin(meta.id, ADMIN);

    const record = await store.endRound(meta.id, ADMIN, 1);
    expect(record.results[1]).toBeDefined();
    expect(record.results[1].entryCount).toBe(6);
    // One orientation is not a matchup, so nothing scores at all - which the
    // scoresheet has to say out loud rather than showing an empty round.
    expect(record.results[1].matchups).toEqual([]);
    expect(record.results[1].status).toBe("unresolved");
    expect(record.results[1].validation.map((i) => i.code)).toContain("round-incomplete");
  });

  it("leaves the other rounds running", async () => {
    await store.claimAdmin(meta.id, ADMIN);
    await store.writeSegment(meta.id, {
      round: 2, nsPair: "A1", ewPair: "B1", clientId: "client-a1", rows: rows(set1),
    });
    const record = await store.endRound(meta.id, ADMIN, 1);

    expect(record.results[1]).toBeDefined();
    expect(record.results[2]).toBeUndefined();
  });
});

describe("edits propagate all the way to victory points", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(async () => {
    store = createStore(memoryBackend());
    await seedEndedRound(store);
  });

  it("moves the scoresheet, IMPs and VPs together when a contract changes", async () => {
    const before = (await store.loadGame(meta.id))!.results[1];
    expect(before.teamVp.A).toBe(23.24);

    // Board 5 was 5CxE-2 (+300 to A). Make it a made game for B instead.
    // The whole segment is re-posted because a save replaces its contents.
    const { record } = await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: ADMIN,
      rows: rows(set1.map((row) => (row[0] === 5 ? [5, "5CxE="] : row))),
    });

    const after = record.results[1];
    const ab = after.matchups.find((m) => m.key === "A-B")!;
    const board5 = ab.boards.find((b) => b.board === 5)!;

    // 5Cx= by E non-vulnerable: 200 trick + 300 game + 50 insult = 550 to EW.
    // A now sits -550 at its NS table and +420 at its EW table: -130, 4 IMPs to B.
    expect(board5.ns.score).toBe(-550);
    expect(board5.ew.score).toBe(420);
    expect(board5.difference).toBe(-130);
    expect(board5.imps).toBe(-4);
    expect(ab.impsHome).toBe(7);
    expect(ab.impsAway).toBe(11);
    expect(after.teamVp.A).not.toBe(before.teamVp.A);
    expect(after.sourceDigest).not.toBe(before.sourceDigest);
  });

  it("recomputes after an admin deletes a board, without reopening the round", async () => {
    const record = await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: ADMIN,
    });

    // Ending latches. The round keeps its result and its place in the
    // standings; the hole shows up as a board-mismatch on the scoresheet
    // rather than as a round that silently reopened mid-tournament.
    expect(record.entries).toHaveLength(35);
    expect(record.results[1]).toBeDefined();
    expect(record.results[1].status).toBe("unresolved");
    expect(record.results[1].validation.map((i) => i.code)).toContain("board-mismatch");
  });

  it("recomputes after a segment is repointed", async () => {
    // repointSegment moves the caller's own entries, so the admin has to own
    // them first - which is what correcting the pairing after the fact means.
    await store.writeSegment(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: ADMIN, rows: rows(set1),
    });
    const record = await store.repointSegment(meta.id, {
      round: 1,
      from: { nsPair: "A1", ewPair: "B1" },
      to: { nsPair: "A1", ewPair: "B2" },
      clientId: ADMIN,
    });

    expect(record.entries.filter((e) => e.ewPair === "B1" && e.nsPair === "A1")).toHaveLength(0);
    expect(record.entries.filter((e) => e.ewPair === "B2" && e.nsPair === "A1")).toHaveLength(6);
    // B2 now appears in three segments, which the validator notices.
    expect(record.results[1].validation.map((i) => i.code)).toContain("pair-in-too-many-segments");
  });
});

describe("stale results heal themselves on read", () => {
  // The warn spies here outlive their test without this: spying twice on an
  // already-mocked console.warn hands back the same spy, call history and all.
  afterEach(() => vi.restoreAllMocks());

  it("recomputes and rewrites a result whose digest no longer matches", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await seedEndedRound(store);

    const key = `g:${meta.id}`;
    const stored = JSON.parse(backend.dump()[key]["r1|result"]);
    const tampered = {
      ...stored,
      sourceDigest: "0000000000000000",
      teamVp: { A: 99, B: 99, C: 99 },
    };
    await backend.write(key, { "r1|result": JSON.stringify(tampered) });

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = await store.loadGame(meta.id);

    expect(record!.results[1].teamVp).toEqual({ A: 23.24, B: 13.79, C: 22.97 });
    expect(record!.results[1].sourceDigest).toBe(digestEntries(record!.entries));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("stale"));

    // The repair is persisted, not just returned.
    expect(JSON.parse(backend.dump()[key]["r1|result"]).teamVp).toEqual({ A: 23.24, B: 13.79, C: 22.97 });
  });

  it("leaves a round with no result alone - there is nothing to heal", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await seedEndedRound(store);
    await backend.write(`g:${meta.id}`, {}, ["r1|result"]);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = await store.loadGame(meta.id);

    // Deleting the result is deleting the ending. The round reads as running
    // again rather than being silently re-scored behind the admin's back.
    expect(record!.results[1]).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("visibility filter", () => {
  const entries = completeRound(1);
  const open = entries.slice(0, 30);

  it("shows a client its own boards in full and masks every other", () => {
    const view = visibleRound(1, open, null, "client-a1");
    expect(view.ended).toBe(false);

    const mine = view.entries.filter(isFullEntry);
    const theirs = view.entries.filter(isMasked);

    expect(mine).toHaveLength(open.filter((e) => e.clientId === "client-a1").length);
    expect(theirs.length).toBeGreaterThan(0);
    for (const entry of mine) expect(entry.clientId).toBe("client-a1");
  });

  it("leaks nothing but the board number on a masked entry", () => {
    const view = visibleRound(1, open, null, "client-a1");
    const masked = view.entries.filter(isMasked);

    for (const entry of masked) {
      expect(Object.keys(entry).sort()).toEqual(["board", "ewPair", "masked", "nsPair", "round"]);
      expect(JSON.stringify(entry)).not.toMatch(/contract|nsScore|clientId|updatedAt/);
    }
  });

  it("masks every entry for a client that submitted nothing", () => {
    const view = visibleRound(1, open, null, "nobody");
    expect(view.entries.every(isMasked)).toBe(true);
    expect(view.entryCount).toBe(30);
  });

  it("withholds the result while the round is running", () => {
    expect(visibleRound(1, open, null, "client-a1").result).toBeNull();
  });

  it("treats a stored result as the latch, however few entries remain", () => {
    // A result only ever gets written when an admin ends the round, so its
    // presence means the round ended - even if boards have since been
    // deleted. Reopening would re-mask entries everyone has already seen.
    const result = computeRound(1, entries, meta, "2026-08-28T01:00:00.000Z");
    const view = visibleRound(1, open, result, "nobody");

    expect(view.ended).toBe(true);
    expect(view.entries.some(isMasked)).toBe(false);
    expect(view.entryCount).toBe(30);
    expect(view.result).toBe(result);
  });

  it("keeps a full round masked until it is ended", () => {
    const view = visibleRound(1, entries, null, "nobody");
    expect(view.full).toBe(true);
    expect(view.ended).toBe(false);
    expect(view.entries.every(isMasked)).toBe(true);
  });

  it("reports progress without revealing content", () => {
    const view = visibleRound(1, open, null, "nobody");
    expect(view.entryCount).toBe(30);
    expect(view.expectedCount).toBe(36);
  });

  it("applies the rules independently per round", async () => {
    const store = createStore(memoryBackend());
    await seedEndedRound(store, 1);
    await store.writeSegment(meta.id, {
      round: 2, nsPair: "A1", ewPair: "B1", clientId: "client-a1", rows: rows([[1, "4HN="]]),
    });

    const view = visibleGame((await store.loadGame(meta.id))!, "someone-else");
    expect(view.rounds[0].ended).toBe(true);
    expect(view.rounds[0].entries.some(isMasked)).toBe(false);
    expect(view.rounds[1].ended).toBe(false);
    expect(view.rounds[1].entries.every(isMasked)).toBe(true);
    expect(view.rounds[2].entries).toHaveLength(0);
  });
});
