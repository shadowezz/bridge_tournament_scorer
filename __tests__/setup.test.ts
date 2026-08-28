import { describe, expect, it } from "vitest";
import { TEAM_IDS, buildGameMeta, playerField, teamField } from "@/lib/tournament/setup";
import { isValidGameId, newClientId, newGameId, isValidClientId } from "@/lib/ids";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

describe("buildGameMeta", () => {
  it("builds three teams of two pairs from the form", () => {
    const values: Record<string, string> = {};
    for (const team of TEAM_IDS) {
      values[teamField(team)] = `Team ${team} Name`;
      for (const pair of [1, 2] as const) {
        for (const slot of [1, 2] as const) {
          values[playerField(team, pair, slot)] = `${team}${pair}p${slot}`;
        }
      }
    }

    const meta = buildGameMeta(form(values), "AAAAAAAAAAAA");

    expect(meta.teams.map((t) => t.name)).toEqual(["Team A Name", "Team B Name", "Team C Name"]);
    expect(meta.pairs.map((p) => p.id)).toEqual(["A1", "A2", "B1", "B2", "C1", "C2"]);
    expect(meta.pairs[0]).toEqual({ id: "A1", team: "A", players: ["A1p1", "A1p2"] });
    expect(meta.pairs.every((p) => p.team === p.id[0])).toBe(true);
  });

  it("falls back to placeholders rather than failing on a blank field", () => {
    const meta = buildGameMeta(form({ [teamField("A")]: "  " }), "AAAAAAAAAAAA");
    expect(meta.teams[0].name).toBe("Team A");
    expect(meta.pairs[0].players).toEqual(["Player A1.1", "Player A1.2"]);
  });

  it("trims surrounding whitespace", () => {
    const meta = buildGameMeta(form({ [playerField("B", 2, 1)]: "  Jing Xuan  " }), "AAAAAAAAAAAA");
    expect(meta.pairs.find((p) => p.id === "B2")!.players[0]).toBe("Jing Xuan");
  });
});

describe("identifiers", () => {
  it("mints unguessable game ids of the expected shape", () => {
    const ids = new Set(Array.from({ length: 500 }, newGameId));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isValidGameId(id)).toBe(true);
  });

  it("mints client ids that are readable aloud", () => {
    const id = newClientId();
    expect(isValidClientId(id)).toBe(true);
    // Crockford base32 omits I, L, O and U so codes cannot be misheard.
    expect(id).not.toMatch(/[ILOU]/);
  });

  it("rejects malformed ids", () => {
    expect(isValidGameId("short")).toBe(false);
    expect(isValidGameId("AAAAAAAAAAAI")).toBe(false);
    expect(isValidGameId("aaaaaaaaaaaa")).toBe(false);
  });
});
