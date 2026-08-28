import {
  BOARDS_PER_SEGMENT,
  type Entry,
  type GameMeta,
  type PairId,
  pairShortLabel,
  teamName,
  teamOf,
} from "@/lib/types";
import { groupMatchups, groupSegments, orientations, segmentKey } from "@/lib/tournament/matchups";

export type IssueCode =
  | "same-team-segment"
  | "duplicate-board-in-segment"
  | "same-team-ns-twice"
  | "repeated-pair-in-matchup"
  | "pair-in-too-many-segments"
  | "board-mismatch"
  | "wrong-segment-count"
  | "wrong-board-count";

export interface ValidationIssue {
  code: IssueCode;
  /** "error" blocks clean scoring; "warning" is advisory only. */
  severity: "error" | "warning";
  message: string;
  matchup?: string;
  segments?: string[];
  boards?: number[];
}

const list = (values: Array<string | number>) => values.join(", ");

/**
 * Check a round's entries for the mistakes that hand-entered pairings and
 * board numbers make possible.
 *
 * The load-bearing check is `board-mismatch`: the two orientations of a
 * matchup must cover the same six boards, so a mistyped board number shows
 * up as unmatched on exactly one side and can be named precisely. Without
 * it, a typo would silently drop a board from the IMP total.
 */
export function validateRound(entries: Entry[], meta: GameMeta): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pair = (id: PairId) => pairShortLabel(meta, id);
  const segLabel = (nsPair: PairId, ewPair: PairId) => `${pair(nsPair)} NS vs ${pair(ewPair)} EW`;

  const segments = groupSegments(entries);

  for (const segment of segments) {
    const label = segLabel(segment.nsPair, segment.ewPair);

    if (segment.nsTeam === segment.ewTeam) {
      issues.push({
        code: "same-team-segment",
        severity: "error",
        message: `${label} puts two pairs from ${teamName(meta, segment.nsTeam)} against each other. Check the NS/EW dropdowns.`,
        segments: [segmentKey(segment.nsPair, segment.ewPair)],
      });
    }

    const seen = new Map<number, number>();
    for (const entry of segment.entries) seen.set(entry.board, (seen.get(entry.board) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([board]) => board);
    if (duplicates.length > 0) {
      issues.push({
        code: "duplicate-board-in-segment",
        severity: "error",
        message: `${label} has board ${list(duplicates)} entered more than once.`,
        segments: [segmentKey(segment.nsPair, segment.ewPair)],
        boards: duplicates,
      });
    }

    if (segment.entries.length > BOARDS_PER_SEGMENT) {
      issues.push({
        code: "wrong-board-count",
        severity: "error",
        message: `${label} has ${segment.entries.length} boards; a segment should have ${BOARDS_PER_SEGMENT}.`,
        segments: [segmentKey(segment.nsPair, segment.ewPair)],
      });
    }
  }

  const appearances = new Map<PairId, number>();
  for (const segment of segments) {
    appearances.set(segment.nsPair, (appearances.get(segment.nsPair) ?? 0) + 1);
    appearances.set(segment.ewPair, (appearances.get(segment.ewPair) ?? 0) + 1);
  }
  for (const [pairId, count] of appearances) {
    if (count > 2) {
      issues.push({
        code: "pair-in-too-many-segments",
        severity: "warning",
        message: `${pair(pairId)} appears in ${count} segments this round; a pair should play exactly 2.`,
      });
    }
  }

  for (const matchup of groupMatchups(entries)) {
    const [home, away] = matchup.teams;
    const title = `${teamName(meta, home)} vs ${teamName(meta, away)}`;

    if (matchup.segments.length !== 2) {
      // One segment is normal mid-round; more than two never is.
      if (matchup.segments.length > 2) {
        issues.push({
          code: "wrong-segment-count",
          severity: "error",
          message: `${title} has ${matchup.segments.length} segments; a matchup should have exactly 2.`,
          matchup: matchup.key,
          segments: matchup.segments.map((s) => segmentKey(s.nsPair, s.ewPair)),
        });
      }
      continue;
    }

    const { homeNs, awayNs } = orientations(matchup);

    if (!homeNs || !awayNs) {
      const nsTeam = matchup.segments[0].nsTeam;
      issues.push({
        code: "same-team-ns-twice",
        severity: "error",
        message: `${title}: both segments list ${teamName(meta, nsTeam)} as NS. One of them should have ${teamName(meta, nsTeam === home ? away : home)} sitting NS — check the NS/EW dropdowns.`,
        matchup: matchup.key,
        segments: matchup.segments.map((s) => segmentKey(s.nsPair, s.ewPair)),
      });
      continue;
    }

    const involved = [homeNs.nsPair, homeNs.ewPair, awayNs.nsPair, awayNs.ewPair];
    if (new Set(involved).size !== 4) {
      const repeated = involved.filter((p, i) => involved.indexOf(p) !== i);
      issues.push({
        code: "repeated-pair-in-matchup",
        severity: "error",
        message: `${title}: ${list([...new Set(repeated)].map(pair))} appears in both halves. Each team's two pairs should play one half each.`,
        matchup: matchup.key,
        segments: [segmentKey(homeNs.nsPair, homeNs.ewPair), segmentKey(awayNs.nsPair, awayNs.ewPair)],
      });
    }

    const homeBoards = new Set(homeNs.entries.map((e) => e.board));
    const awayBoards = new Set(awayNs.entries.map((e) => e.board));
    const onlyHome = [...homeBoards].filter((b) => !awayBoards.has(b)).sort((a, b) => a - b);
    const onlyAway = [...awayBoards].filter((b) => !homeBoards.has(b)).sort((a, b) => a - b);

    if (onlyHome.length > 0 || onlyAway.length > 0) {
      issues.push({
        code: "board-mismatch",
        severity: "error",
        message:
          `${title} — board mismatch. ${segLabel(homeNs.nsPair, homeNs.ewPair)} has ${list([...homeBoards].sort((a, b) => a - b))}. ` +
          `${segLabel(awayNs.nsPair, awayNs.ewPair)} has ${list([...awayBoards].sort((a, b) => a - b))}. ` +
          `Unmatched: ${list([...onlyHome, ...onlyAway])}. Likely a typo — one of these should be corrected.`,
        matchup: matchup.key,
        segments: [segmentKey(homeNs.nsPair, homeNs.ewPair), segmentKey(awayNs.nsPair, awayNs.ewPair)],
        boards: [...onlyHome, ...onlyAway],
      });
    }
  }

  return issues;
}

/** Reject an impossible pairing before it is ever stored. */
export function validateSegmentPairing(nsPair: PairId, ewPair: PairId): string | null {
  if (nsPair === ewPair) return "A pair cannot play against itself.";
  if (teamOf(nsPair) === teamOf(ewPair)) {
    return "Both pairs are from the same team. NS and EW must be from different teams.";
  }
  return null;
}
