import { describe, expect, it } from "vitest";
import { computeRound } from "@/lib/tournament/compute";
import { flipMatchup } from "@/lib/tournament/perspective";
import { negate } from "@/lib/types";
import { completeRound, meta } from "./fixtures";

const round = computeRound(1, completeRound(), meta);
const ab = round.matchups.find((m) => m.key === "A-B")!;

describe("flipMatchup", () => {
  it("swaps the teams and their totals", () => {
    const flipped = flipMatchup(ab);

    expect(ab.teams).toEqual(["A", "B"]);
    expect(flipped.teams).toEqual(["B", "A"]);
    expect(flipped.impsHome).toBe(ab.impsAway);
    expect(flipped.impsAway).toBe(ab.impsHome);
    expect(flipped.vpHome).toBe(ab.vpAway);
    expect(flipped.vpAway).toBe(ab.vpHome);
    expect(flipped.vpHome + flipped.vpAway).toBe(20);
  });

  it("shows the other team's own two pairs, each against the right opponent", () => {
    const flipped = flipMatchup(ab);

    // A's sheet: A1 sat NS against B1; A2 sat EW against B2.
    expect([ab.homeNsPair, ab.awayEwPair]).toEqual(["A1", "B1"]);
    expect([ab.homeEwPair, ab.awayNsPair]).toEqual(["A2", "B2"]);

    // B's sheet is the same two tables told the other way round.
    expect([flipped.homeNsPair, flipped.awayEwPair]).toEqual(["B2", "A2"]);
    expect([flipped.homeEwPair, flipped.awayNsPair]).toEqual(["B1", "A1"]);
  });

  it("moves each table across and negates every figure", () => {
    const flipped = flipMatchup(ab);

    for (const [index, row] of ab.boards.entries()) {
      const other = flipped.boards[index];
      expect(other.board).toBe(row.board);

      // The table where A sat NS is the table where B sat EW.
      expect(other.ew.contract).toEqual(row.ns.contract);
      expect(other.ew.score).toBe(negate(row.ns.score));
      expect(other.ns.contract).toEqual(row.ew.contract);
      expect(other.ns.score).toBe(negate(row.ew.score));

      expect(other.difference).toBe(negate(row.difference));
      expect(other.imps).toBe(negate(row.imps));
      // The stored invariant still holds on the flipped side.
      expect(other.difference).toBe(other.ns.score + other.ew.score);

      // Negating a drawn board must not leave -0 behind.
      for (const value of [other.ns.score, other.ew.score, other.difference, other.imps]) {
        expect(Object.is(value, -0)).toBe(false);
      }
    }
  });

  it("agrees with the concrete numbers on a known board", () => {
    // Board 2: A1 made 4S+1 (+450); B2 made 3S+1 at the other table, so A2 as
    // EW sat -170. Net +280 to A, 7 IMPs.
    const a = ab.boards.find((b) => b.board === 2)!;
    expect([a.ns.score, a.ew.score, a.difference, a.imps]).toEqual([450, -170, 280, 7]);

    // Told from B's side: B2 made +170 sitting NS, B1 sat -450 as EW.
    const b = flipMatchup(ab).boards.find((r) => r.board === 2)!;
    expect([b.ns.score, b.ew.score, b.difference, b.imps]).toEqual([170, -450, -280, -7]);
  });

  it("is its own inverse, so toggling back and forth cannot drift", () => {
    expect(flipMatchup(flipMatchup(ab))).toEqual(ab);
  });

  it("leaves the matchup identity and unmatched boards alone", () => {
    const withGap = { ...ab, excludedBoards: [5, 16] };
    const flipped = flipMatchup(withGap);
    expect(flipped.key).toBe(ab.key);
    expect(flipped.excludedBoards).toEqual([5, 16]);
  });

  it("holds for every matchup in a round, not just the first", () => {
    for (const matchup of round.matchups) {
      expect(flipMatchup(flipMatchup(matchup))).toEqual(matchup);
      expect(flipMatchup(matchup).impsHome).toBe(matchup.impsAway);
    }
  });
});
