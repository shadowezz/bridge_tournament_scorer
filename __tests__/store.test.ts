import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStore } from "@/lib/store";
import type { Backend } from "@/lib/store/backend";
import { parseContract } from "@/lib/bridge/contract";
import { digestEntries } from "@/lib/tournament/compute";
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
    await store.writeEntries(meta.id, {
      round,
      nsPair,
      ewPair,
      clientId: group[0].clientId,
      rows: group.map((e) => ({ board: e.board, contract: e.contract })),
    });
  }
}

describe("store", () => {
  let backend: ReturnType<typeof memoryBackend>;
  let store: ReturnType<typeof createStore>;

  beforeEach(() => {
    backend = memoryBackend();
    store = createStore(backend);
  });

  afterEach(() => vi.restoreAllMocks());

  it("round-trips a game and computes its score once complete", async () => {
    await seedCompleteRound(store);
    const record = await store.loadGame(meta.id)!;

    expect(record!.entries).toHaveLength(36);
    expect(record!.results[1].status).toBe("complete");
    expect(record!.results[1].teamVp).toEqual({ A: 23.24, B: 13.79, C: 22.97 });
  });

  it("keeps the round unscored until every board is in", async () => {
    await store.createGame(meta);
    await store.writeEntries(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "c1",
      rows: rows([[1, "4HN="]]),
    });

    const record = await store.loadGame(meta.id);
    expect(record!.results[1]).toBeUndefined();
  });

  it("stores one field per board so writes never touch each other", async () => {
    await seedCompleteRound(store);
    const fields = Object.keys(backend.dump()[`g:${meta.id}`]);

    expect(fields).toContain("r1|A1|B1|1");
    expect(fields).toContain("r1|result");
    expect(fields.filter((f) => f.startsWith("r1|") && !f.endsWith("|result"))).toHaveLength(36);
  });

  it("rejects a segment whose pairs share a team", async () => {
    await store.createGame(meta);
    await expect(
      store.writeEntries(meta.id, {
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
    await store.writeEntries(meta.id, {
      round: 1,
      nsPair: "A1",
      ewPair: "B1",
      clientId: "owner",
      rows: rows([[1, "4HN="]]),
    });
  });

  it("refuses to overwrite another client's board and reports the conflict", async () => {
    const { conflicts, record } = await store.writeEntries(meta.id, {
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
    const { conflicts, record } = await store.writeEntries(meta.id, {
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
    const { conflicts, record } = await store.writeEntries(meta.id, {
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

describe("edits propagate all the way to victory points", () => {
  let store: ReturnType<typeof createStore>;
  beforeEach(async () => {
    store = createStore(memoryBackend());
    await seedCompleteRound(store);
  });

  it("moves the scoresheet, IMPs and VPs together when a contract changes", async () => {
    const before = (await store.loadGame(meta.id))!.results[1];
    expect(before.teamVp.A).toBe(23.24);

    // Board 5 was 5CxE-2 (+300 to A). Make it a made game for B instead.
    const { record } = await store.writeEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", clientId: "client-a1",
      rows: rows([[5, "5CxE="]]),
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

  it("recomputes after a delete and drops the result below a full card", async () => {
    const record = await store.deleteEntries(meta.id, {
      round: 1, nsPair: "A1", ewPair: "B1", boards: [1], clientId: "client-a1",
    });
    expect(record.entries).toHaveLength(35);
    expect(record.results[1]).toBeUndefined();
  });

  it("recomputes after a segment is repointed", async () => {
    const record = await store.repointSegment(meta.id, {
      round: 1,
      from: { nsPair: "A1", ewPair: "B1" },
      to: { nsPair: "A1", ewPair: "B2" },
      clientId: "client-a1",
    });

    expect(record.entries.filter((e) => e.ewPair === "B1" && e.nsPair === "A1")).toHaveLength(0);
    expect(record.entries.filter((e) => e.ewPair === "B2" && e.nsPair === "A1")).toHaveLength(6);
    // B2 now appears in three segments, which the validator notices.
    expect(record.results[1].validation.map((i) => i.code)).toContain("pair-in-too-many-segments");
  });
});

describe("stale results heal themselves on read", () => {
  it("recomputes and rewrites a result whose digest no longer matches", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await seedCompleteRound(store);

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

  it("computes a missing result rather than serving none", async () => {
    const backend = memoryBackend();
    const store = createStore(backend);
    await seedCompleteRound(store);
    await backend.write(`g:${meta.id}`, {}, ["r1|result"]);

    vi.spyOn(console, "warn").mockImplementation(() => {});
    const record = await store.loadGame(meta.id);
    expect(record!.results[1].teamVp.A).toBe(23.24);
  });
});

describe("visibility filter", () => {
  const entries = completeRound(1);
  const open = entries.slice(0, 30);

  it("shows a client its own boards in full and masks every other", () => {
    const view = visibleRound(1, open, null, "client-a1");
    expect(view.complete).toBe(false);

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

  it("withholds the result while the round is open, even if one is passed in", () => {
    const bogus = { round: 1, teamVp: { A: 1 } } as never;
    expect(visibleRound(1, open, bogus, "client-a1").result).toBeNull();
  });

  it("opens everything to everyone once the round closes", () => {
    const view = visibleRound(1, entries, null, "nobody");
    expect(view.complete).toBe(true);
    expect(view.entries.some(isMasked)).toBe(false);
  });

  it("reports progress without revealing content", () => {
    const view = visibleRound(1, open, null, "nobody");
    expect(view.entryCount).toBe(30);
    expect(view.expectedCount).toBe(36);
  });

  it("applies the rules independently per round", async () => {
    const store = createStore(memoryBackend());
    await seedCompleteRound(store, 1);
    await store.writeEntries(meta.id, {
      round: 2, nsPair: "A1", ewPair: "B1", clientId: "client-a1", rows: rows([[1, "4HN="]]),
    });

    const view = visibleGame((await store.loadGame(meta.id))!, "someone-else");
    expect(view.rounds[0].complete).toBe(true);
    expect(view.rounds[0].entries.some(isMasked)).toBe(false);
    expect(view.rounds[1].complete).toBe(false);
    expect(view.rounds[1].entries.every(isMasked)).toBe(true);
    expect(view.rounds[2].entries).toHaveLength(0);
  });
});
