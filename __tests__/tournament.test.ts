import { describe, expect, it } from "vitest";
import { groupMatchups, groupSegments, orientations } from "@/lib/tournament/matchups";
import { validateRound, validateSegmentPairing } from "@/lib/tournament/validate";
import { computeRound, digestEntries, isRoundComplete, standings } from "@/lib/tournament/compute";
import { ENTRIES_PER_ROUND } from "@/lib/types";
import { completeRound, meta, segment } from "./fixtures";

const codes = (entries = completeRound()) => validateRound(entries, meta).map((i) => i.code);

describe("grouping", () => {
  const entries = completeRound();

  it("splits a round into six segments of six boards", () => {
    const segments = groupSegments(entries);
    expect(segments).toHaveLength(6);
    for (const s of segments) expect(s.entries).toHaveLength(6);
  });

  it("resolves the three head-to-head matchups without knowing the movement", () => {
    const matchups = groupMatchups(entries);
    expect(matchups.map((m) => m.key)).toEqual(["A-B", "A-C", "B-C"]);
    for (const m of matchups) expect(m.segments).toHaveLength(2);
  });

  it("finds both orientations of every matchup", () => {
    for (const matchup of groupMatchups(entries)) {
      const { home, away, homeNs, awayNs } = orientations(matchup);
      expect(homeNs?.nsTeam).toBe(home);
      expect(awayNs?.nsTeam).toBe(away);
    }
  });

  it("gives every pair exactly 12 boards", () => {
    const played = new Map<string, number>();
    for (const e of entries) {
      played.set(e.nsPair, (played.get(e.nsPair) ?? 0) + 1);
      played.set(e.ewPair, (played.get(e.ewPair) ?? 0) + 1);
    }
    expect([...played.values()]).toEqual([12, 12, 12, 12, 12, 12]);
  });
});

describe("computeRound - scoring a matchup", () => {
  const result = computeRound(1, completeRound(), meta);
  const ab = result.matchups.find((m) => m.key === "A-B")!;

  it("names the four pairs from each orientation", () => {
    expect(ab.teams).toEqual(["A", "B"]);
    expect(ab.homeNsPair).toBe("A1");
    expect(ab.homeEwPair).toBe("A2");
    expect(ab.awayNsPair).toBe("B2");
    expect(ab.awayEwPair).toBe("B1");
  });

  it("scores each board as the home team's NS plus EW result", () => {
    // Hand-computed, all non-vulnerable:
    //  1  4HN=  (+420) vs 4HN=  (-420) ->    0 ->  0
    //  2  4SN+1 (+450) vs 3SN+1 (-170) -> +280 -> +7 home
    //  3  3NTE= (-400) vs 3NTE= (+400) ->    0 ->  0
    //  4  2HN+1 (+140) vs 4HN=  (-420) -> -280 -> -7 away
    //  5  5CxE-2(+300) vs 4SE=  (+420) -> +720 -> +12 home
    //  6  pass  (   0) vs pass  (   0) ->    0 ->  0
    expect(ab.boards.map((b) => [b.board, b.difference, b.imps])).toEqual([
      [1, 0, 0], [2, 280, 7], [3, 0, 0], [4, -280, -7], [5, 720, 12], [6, 0, 0],
    ]);
  });

  it("totals IMPs to each side and converts to victory points", () => {
    expect(ab.impsHome).toBe(19);
    expect(ab.impsAway).toBe(7);
    // margin 12 -> 10 + 10 * 12/37 = 13.24
    expect(ab.vpHome).toBe(13.24);
    expect(ab.vpAway).toBe(6.76);
    expect(ab.vpHome + ab.vpAway).toBe(20);
  });

  it("gives a drawn matchup ten victory points each", () => {
    const ac = result.matchups.find((m) => m.key === "A-C")!;
    expect(ac.impsHome).toBe(0);
    expect(ac.impsAway).toBe(0);
    expect(ac.vpHome).toBe(10);
    expect(ac.vpAway).toBe(10);
  });

  it("sums each team's two matchups into its round total", () => {
    const totalVp = Object.values(result.teamVp).reduce((a, b) => a + b, 0);
    expect(totalVp).toBe(60); // three matchups x 20 VP
    expect(result.status).toBe("complete");
    expect(result.validation).toEqual([]);
  });
});

describe("round completion", () => {
  it("closes once every board is in", () => {
    const entries = completeRound();
    expect(entries).toHaveLength(ENTRIES_PER_ROUND);
    expect(isRoundComplete(entries)).toBe(true);
    expect(isRoundComplete(entries.slice(0, ENTRIES_PER_ROUND - 1))).toBe(false);
  });

  it("closes on count even when the pairings are wrong, so problems stay visible", () => {
    const entries = completeRound();
    for (const e of entries.filter((e) => e.nsPair === "B2" && e.ewPair === "A2")) {
      e.nsPair = "B1";
    }
    expect(isRoundComplete(entries)).toBe(true);
    expect(computeRound(1, entries, meta).status).toBe("unresolved");
  });
});

describe("validateRound", () => {
  it("passes a clean round", () => {
    expect(codes()).toEqual([]);
  });

  it("flags a board-number typo and names both segments and the odd boards", () => {
    const entries = completeRound();
    const target = entries.find((e) => e.nsPair === "B2" && e.ewPair === "A2" && e.board === 6)!;
    target.board = 16;

    const issue = validateRound(entries, meta).find((i) => i.code === "board-mismatch")!;
    expect(issue.severity).toBe("error");
    expect(issue.matchup).toBe("A-B");
    expect(issue.boards).toEqual([6, 16]);
    expect(issue.message).toContain("Sharks A1 NS vs Eagles B1 EW");
    expect(issue.message).toContain("Eagles B2 NS vs Sharks A2 EW");
    expect(issue.message).toContain("Unmatched: 6, 16");
  });

  it("flags both halves of a matchup listing the same team as NS", () => {
    const entries = completeRound();
    for (const e of entries.filter((e) => e.nsPair === "B2" && e.ewPair === "A2")) {
      [e.nsPair, e.ewPair] = [e.ewPair, e.nsPair];
    }
    const issue = validateRound(entries, meta).find((i) => i.code === "same-team-ns-twice")!;
    expect(issue.message).toContain("both segments list Sharks as NS");
  });

  it("flags the same pair appearing in both halves of a matchup", () => {
    const entries = completeRound();
    for (const e of entries.filter((e) => e.nsPair === "B2" && e.ewPair === "A2")) {
      e.ewPair = "A1";
    }
    const found = validateRound(entries, meta);
    expect(found.map((i) => i.code)).toContain("repeated-pair-in-matchup");
    expect(found.find((i) => i.code === "repeated-pair-in-matchup")!.message).toContain("Sharks A1");
  });

  it("flags two pairs from the same team facing each other", () => {
    const entries = [...completeRound(), ...segment(1, "A1", "A2", [[19, "4HN="]])];
    expect(validateRound(entries, meta).map((i) => i.code)).toContain("same-team-segment");
  });

  it("flags a duplicated board inside one segment", () => {
    const entries = completeRound();
    entries.find((e) => e.nsPair === "A1" && e.ewPair === "B1" && e.board === 2)!.board = 1;
    expect(codes(entries)).toContain("duplicate-board-in-segment");
  });

  it("warns when a pair plays more than two segments", () => {
    const entries = [...completeRound(), ...segment(1, "A1", "B2", [[19, "4HN="]])];
    const issue = validateRound(entries, meta).find((i) => i.code === "pair-in-too-many-segments")!;
    expect(issue.severity).toBe("warning");
    expect(issue.message).toContain("Sharks A1 appears in 3 segments");
  });

  it("rejects an impossible pairing outright", () => {
    expect(validateSegmentPairing("A1", "A2")).toMatch(/same team/i);
    expect(validateSegmentPairing("A1", "A1")).toMatch(/itself/i);
    expect(validateSegmentPairing("A1", "B1")).toBeNull();
  });
});

describe("unmatched boards are excluded rather than silently scored", () => {
  it("drops the mismatched pair and reports it", () => {
    const entries = completeRound();
    entries.find((e) => e.nsPair === "B2" && e.ewPair === "A2" && e.board === 5)!.board = 15;

    const ab = computeRound(1, entries, meta).matchups.find((m) => m.key === "A-B")!;
    expect(ab.boards.map((b) => b.board)).toEqual([1, 2, 3, 4, 6]);
    expect(ab.excludedBoards).toEqual([5, 15]);
    // Board 5 was worth 12 IMPs to the home team; it must not be counted.
    expect(ab.impsHome).toBe(7);
  });
});

describe("digestEntries", () => {
  it("is stable regardless of entry order", () => {
    const entries = completeRound();
    expect(digestEntries(entries)).toBe(digestEntries([...entries].reverse()));
  });

  it("changes when any scored value changes", () => {
    const before = digestEntries(completeRound());
    const after = completeRound();
    after[0].nsScore += 10;
    expect(digestEntries(after)).not.toBe(before);
  });

  it("changes when a board number changes", () => {
    const before = digestEntries(completeRound());
    const after = completeRound();
    after[0].board = 99;
    expect(digestEntries(after)).not.toBe(before);
  });
});

describe("standings", () => {
  it("accumulates victory points across rounds and ranks by total", () => {
    const results = [1, 2, 3].map((r) => computeRound(r, completeRound(r), meta));
    const table = standings(results, meta);

    // Per round: A beats B 13.24-6.76, A draws C 10-10, C beats B 12.97-7.03.
    expect(table.map((t) => t.team)).toEqual(["A", "C", "B"]);
    expect(table[0]).toMatchObject({ team: "A", name: "Sharks", vp: 69.72, rounds: 3 });
    expect(table[1]).toMatchObject({ team: "C", name: "Owls", vp: 68.91 });
    expect(table[2]).toMatchObject({ team: "B", name: "Eagles", vp: 41.37 });
    expect(table.reduce((sum, t) => sum + t.vp, 0)).toBe(180); // 3 rounds x 60 VP
  });
});
