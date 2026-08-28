import { describe, expect, it } from "vitest";
import { nsScore, scoreContract } from "@/lib/bridge/score";
import { impsFromDifference, signedImps } from "@/lib/bridge/imps";
import { BLITZ_MARGIN, victoryPoints } from "@/lib/bridge/vp";
import { ContractParseError, formatContract, parseContract, tricksTaken } from "@/lib/bridge/contract";

const c = (text: string) => parseContract(text);

describe("scoreContract - rows from the reference scoresheet", () => {
  // Every row of .claude/example_scoresheet.png. That sheet is a mixed-vulnerability
  // sample, so the vulnerable flag varies; our tournament is all non-vulnerable.
  const rows: Array<[string, boolean, number]> = [
    ["4HN+2", false, 480],
    ["4SE=", false, 420],
    ["3SS+2", false, 200],
    ["1NTE-2", false, -100],
    ["6SE+1", true, 1460],
    ["5DS+2", true, 640],
    ["5HxE-2", true, -500],
    ["3NTE=", false, 400],
    ["1NTS=", false, 90],
    ["2DxW-3", false, -500],
    ["4HN+1", true, 650],
    ["2HN+2", false, 170],
    ["3CW+1", false, 130],
    ["4HE-1", false, -50],
    ["3DW+1", false, 130],
    ["4HN-1", false, -50],
    ["4SW+2", false, 480],
  ];

  it.each(rows)("%s (vul=%s) scores %i", (text, vul, expected) => {
    expect(scoreContract(c(text), vul)).toBe(expected);
  });
});

describe("scoreContract - boundaries", () => {
  it("treats a doubled partscore below 100 as a partscore", () => {
    expect(scoreContract(c("2CxN="))).toBe(80 + 50 + 50);
  });

  it("treats a doubled partscore reaching 100 as a game", () => {
    expect(scoreContract(c("3HxN="))).toBe(180 + 300 + 50);
  });

  it("scores a redoubled grand slam non-vulnerable", () => {
    expect(scoreContract(c("7NTxxN="))).toBe(2280);
  });

  it("scores doubled overtricks at 100 each non-vulnerable", () => {
    expect(scoreContract(c("4HxN+1"))).toBe(690);
  });

  it("escalates doubled undertricks 100/300/500/800", () => {
    expect(scoreContract(c("4HN-1"), false)).toBe(-50);
    for (const [down, expected] of [[1, 100], [2, 300], [3, 500], [4, 800], [5, 1100]]) {
      expect(scoreContract(c(`4HxN-${down}`), false)).toBe(-expected);
    }
  });

  it("scores a minimum contract and a passed-out board", () => {
    expect(scoreContract(c("1CN="))).toBe(70);
    expect(scoreContract(c("1CN-1"))).toBe(-50);
    expect(scoreContract(c("pass"))).toBe(0);
  });
});

describe("nsScore", () => {
  it("is positive when NS declare and make", () => {
    expect(nsScore(c("4HN="))).toBe(420);
    expect(nsScore(c("4HS="))).toBe(420);
  });

  it("is negative when EW declare and make", () => {
    expect(nsScore(c("4HE="))).toBe(-420);
    expect(nsScore(c("4HW="))).toBe(-420);
  });

  it("is positive when EW declare and fail", () => {
    expect(nsScore(c("4HE-1"))).toBe(50);
  });
});

describe("impsFromDifference - differences taken from the reference scoresheet", () => {
  const rows: Array<[number, number]> = [
    [0, 0], [-60, 2], [250, 6], [-290, 7], [140, 4],
    [270, 7], [-410, 9], [200, 5], [220, 6],
  ];

  it.each(rows)("a difference of %i is %i IMPs", (difference, expected) => {
    expect(impsFromDifference(difference)).toBe(expected);
  });

  it("sits on table boundaries correctly", () => {
    expect(impsFromDifference(10)).toBe(0);
    expect(impsFromDifference(20)).toBe(1);
    expect(impsFromDifference(3990)).toBe(23);
    expect(impsFromDifference(4000)).toBe(24);
    expect(impsFromDifference(99999)).toBe(24);
  });

  it("signs IMPs towards the team the difference favours", () => {
    expect(signedImps(250)).toBe(6);
    expect(signedImps(-250)).toBe(-6);
    expect(signedImps(0)).toBe(0);
  });
});

describe("victoryPoints", () => {
  it("blitzes at 37 IMPs for a six-board match", () => {
    expect(BLITZ_MARGIN).toBe(37);
  });

  it("splits a tie evenly", () => {
    expect(victoryPoints(30, 30)).toEqual({ home: 10, away: 10 });
  });

  it("scales continuously up to the blitz", () => {
    expect(victoryPoints(10, 0)).toEqual({ home: 12.7, away: 7.3 });
    expect(victoryPoints(30, 0)).toEqual({ home: 18.11, away: 1.89 });
  });

  it("caps at the blitz and does not exceed 20", () => {
    expect(victoryPoints(37, 0)).toEqual({ home: 20, away: 0 });
    expect(victoryPoints(90, 0)).toEqual({ home: 20, away: 0 });
  });

  it("is symmetric and always totals exactly 20", () => {
    for (let margin = 0; margin <= 45; margin++) {
      const { home, away } = victoryPoints(margin, 0);
      expect(home + away).toBe(20);
      expect(victoryPoints(0, margin)).toEqual({ home: away, away: home });
    }
  });
});

describe("parseContract", () => {
  it("accepts spacing, casing and double placement variants", () => {
    const canonical = c("4HxN+1");
    for (const variant of ["4H x N +1", "4hxn+1", "4HNx+1", " 4 H X N + 1 "]) {
      expect(c(variant)).toEqual(canonical);
    }
  });

  it("reads strain greedily so N/S overlap is unambiguous", () => {
    expect(c("4NS")).toMatchObject({ strain: "N", declarer: "S", level: 4 });
    expect(c("4SN")).toMatchObject({ strain: "S", declarer: "N" });
    expect(c("4NN")).toMatchObject({ strain: "N", declarer: "N" });
    expect(c("3NTS")).toMatchObject({ strain: "N", declarer: "S" });
  });

  it("defaults an omitted result to making exactly", () => {
    expect(c("3NTS")).toMatchObject({ result: 0 });
    expect(c("3NTS=")).toMatchObject({ result: 0 });
  });

  it("recognises passed-out boards", () => {
    for (const text of ["pass", "P", "-"]) expect(c(text)).toEqual({ passedOut: true });
  });

  it("rejects malformed input", () => {
    for (const bad of ["", "8HN", "0HN", "4XN", "4H", "4HN+9", "4HN-11", "4HNQ", "4HN++1"]) {
      expect(() => c(bad), bad).toThrow(ContractParseError);
    }
  });

  it("formats for display and reports tricks taken", () => {
    expect(formatContract(c("4HxN+1"))).toBe("4♥x by N, +1");
    expect(formatContract(c("3NTS="))).toBe("3NT by S, =");
    expect(formatContract(c("pass"))).toBe("Passed out");
    expect(tricksTaken(c("4HN+2"))).toBe(12);
    expect(tricksTaken(c("pass"))).toBeNull();
  });
});
