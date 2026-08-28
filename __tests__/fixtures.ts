import { parseContract } from "@/lib/bridge/contract";
import { nsScore } from "@/lib/bridge/score";
import type { Entry, GameMeta, PairId, TeamId } from "@/lib/types";

export const meta: GameMeta = {
  id: "testgame1234",
  createdAt: "2026-08-28T00:00:00.000Z",
  teams: [
    { id: "A", name: "Sharks" },
    { id: "B", name: "Eagles" },
    { id: "C", name: "Owls" },
  ],
  pairs: [
    { id: "A1", team: "A", players: ["Siok Hui", "Jing Xuan"] },
    { id: "A2", team: "A", players: ["Ryan", "Bryan"] },
    { id: "B1", team: "B", players: ["Bee One", "Bee Two"] },
    { id: "B2", team: "B", players: ["Bee Three", "Bee Four"] },
    { id: "C1", team: "C", players: ["Cee One", "Cee Two"] },
    { id: "C2", team: "C", players: ["Cee Three", "Cee Four"] },
  ],
};

/** Build one segment's entries. All boards are non-vulnerable. */
export function segment(
  round: number,
  nsPair: PairId,
  ewPair: PairId,
  boards: Array<[board: number, contract: string]>,
  clientId = "client-1",
): Entry[] {
  return boards.map(([board, text]) => {
    const contract = parseContract(text);
    return {
      round,
      nsPair,
      ewPair,
      board,
      contract,
      nsScore: nsScore(contract, false),
      updatedAt: "2026-08-28T00:00:00.000Z",
      clientId,
    };
  });
}

/**
 * A complete, valid round following the tournament's actual movement:
 * NS pairs stay, EW pairs rotate, boards rotate the other way. The app does
 * not model this, but a realistic fixture proves the matchups still resolve.
 */
export function completeRound(round = 1): Entry[] {
  const set1: Array<[number, string]> = [
    [1, "4HN="], [2, "4SN+1"], [3, "3NTE="], [4, "2HN+1"], [5, "5CxE-2"], [6, "pass"],
  ];
  const set1Mirror: Array<[number, string]> = [
    [1, "4HN="], [2, "3SN+1"], [3, "3NTE="], [4, "4HN="], [5, "4SE="], [6, "pass"],
  ];
  const set2: Array<[number, string]> = [
    [7, "3NTS="], [8, "2SW+1"], [9, "4HS-1"], [10, "1NTN="], [11, "6SS="], [12, "3DW="],
  ];
  const set2Mirror: Array<[number, string]> = [
    [7, "3NTS+1"], [8, "2SW+1"], [9, "4HS="], [10, "1NTN="], [11, "6SS="], [12, "3DW="],
  ];
  const set3: Array<[number, string]> = [
    [13, "4SN="], [14, "3CE-1"], [15, "2NTS+2"], [16, "4HW="], [17, "5DN-1"], [18, "1SS+2"],
  ];
  const set3Mirror: Array<[number, string]> = [
    [13, "4SN="], [14, "3CE-1"], [15, "2NTS+2"], [16, "4HW="], [17, "5DN-1"], [18, "1SS+2"],
  ];

  return [
    ...segment(round, "A1", "B1", set1, "client-a1"),
    ...segment(round, "B2", "C1", set2, "client-b2"),
    ...segment(round, "C2", "A2", set3, "client-c2"),
    ...segment(round, "A1", "C1", set3Mirror, "client-a1"),
    ...segment(round, "B2", "A2", set1Mirror, "client-b2"),
    ...segment(round, "C2", "B1", set2Mirror, "client-c2"),
  ];
}

export const teams: TeamId[] = ["A", "B", "C"];
