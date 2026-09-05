import { describe, expect, it } from "vitest";
import { droppedBoards, isClaimedByOther, parseSegmentRows } from "@/lib/forms";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("isClaimedByOther", () => {
  const base = { lockedBoards: [3, 4], takeOver: [] as number[], roundClosed: false };

  it("locks a board entered by someone else at the table", () => {
    expect(isClaimedByOther({ ...base, board: 3 })).toBe(true);
  });

  it("leaves the player's own and unentered boards editable", () => {
    expect(isClaimedByOther({ ...base, board: 1 })).toBe(false);
  });

  it("unlocks a board once explicitly taken over", () => {
    expect(isClaimedByOther({ ...base, board: 3, takeOver: [3] })).toBe(false);
  });

  it("unlocks everything once the round has closed", () => {
    expect(isClaimedByOther({ ...base, board: 3, roundClosed: true })).toBe(false);
  });

  it("does not lock a row whose board number is not yet typed", () => {
    expect(isClaimedByOther({ ...base, board: Number("") })).toBe(false);
    expect(isClaimedByOther({ ...base, board: Number("abc") })).toBe(false);
  });
});

describe("parseSegmentRows", () => {
  it("reads a full segment", () => {
    const { rows, errors, duplicates } = parseSegmentRows(
      form({
        "board-0": "1", "contract-0": "4HN=",
        "board-1": "2", "contract-1": "3NTE+1",
      }),
    );

    expect(errors).toEqual({});
    expect(duplicates).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].board).toBe(1);
    expect(rows[0].contract).toMatchObject({ level: 4, strain: "H", declarer: "N" });
  });

  it("skips rows a masked segment leaves entirely blank", () => {
    // Regression: masked rows used to submit a board number with no contract,
    // which failed the whole save when taking over a single board.
    const { rows, errors } = parseSegmentRows(
      // Rows 1-5 are masked, so their disabled inputs submit no fields at all.
      form({ "board-0": "13", "contract-0": "6NTxxS+1" }),
    );

    expect(errors).toEqual({});
    expect(rows).toHaveLength(1);
    expect(rows[0].board).toBe(13);
  });

  it("reports a half-filled row rather than dropping it", () => {
    expect(parseSegmentRows(form({ "board-0": "5" })).errors).toEqual({ 0: "Contract required" });
    expect(parseSegmentRows(form({ "contract-0": "4HN=" })).errors).toEqual({
      0: "Board number required",
    });
  });

  it("surfaces the parser's own message for a bad contract", () => {
    const { errors } = parseSegmentRows(form({ "board-0": "1", "contract-0": "9ZZ" }));
    expect(errors[0]).toMatch(/1-7/);
  });

  it("rejects a non-positive board number", () => {
    expect(parseSegmentRows(form({ "board-0": "0", "contract-0": "4HN=" })).errors[0]).toMatch(
      /Board number/,
    );
  });

  it("detects the same board typed on two rows", () => {
    const { duplicates } = parseSegmentRows(
      form({ "board-0": "7", "contract-0": "4HN=", "board-1": "7", "contract-1": "3NTS=" }),
    );
    expect(duplicates).toEqual([7]);
  });

  it("treats an untouched form as nothing to save", () => {
    expect(parseSegmentRows(form({})).rows).toEqual([]);
  });
});

describe("droppedBoards", () => {
  const seeded = [12, 13, null, null, null, null];

  it("drops the old number when a row is renumbered", () => {
    expect(droppedBoards(seeded, ["14", "13", "", "", "", ""])).toEqual([12]);
  });

  it("drops the board when a row is cleared", () => {
    expect(droppedBoards(seeded, ["", "13", "", "", "", ""])).toEqual([12]);
  });

  it("drops nothing when two rows swap numbers", () => {
    expect(droppedBoards(seeded, ["13", "12", "", "", "", ""])).toEqual([]);
  });

  it("drops nothing for a row that was never seeded", () => {
    expect(droppedBoards([null, null], ["", "7"])).toEqual([]);
  });

  it("keeps a board moved to a different row", () => {
    expect(droppedBoards(seeded, ["", "13", "12", "", "", ""])).toEqual([]);
  });

  it("ignores half-typed numbers rather than treating them as a keep", () => {
    expect(droppedBoards(seeded, ["1x", "13", "", "", "", ""])).toEqual([12]);
  });

  it("lists every board when the whole segment is cleared", () => {
    expect(droppedBoards(seeded, ["", "", "", "", "", ""])).toEqual([12, 13]);
  });
});
