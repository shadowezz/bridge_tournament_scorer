import { type Entry, type PairId, type TeamId, matchupKey, teamOf } from "@/lib/types";

/** One pair-vs-pair sitting, in one orientation, with the boards it played. */
export interface Segment {
  nsPair: PairId;
  ewPair: PairId;
  nsTeam: TeamId;
  ewTeam: TeamId;
  entries: Entry[];
}

/** All segments belonging to one head-to-head team match. */
export interface Matchup {
  key: string;
  /** Sorted, so the "home" team is deterministic across recomputes. */
  teams: [TeamId, TeamId];
  segments: Segment[];
}

export function segmentKey(nsPair: PairId, ewPair: PairId): string {
  return `${nsPair}|${ewPair}`;
}

/** Group a round's entries into segments, keyed by (nsPair, ewPair). */
export function groupSegments(entries: Entry[]): Segment[] {
  const byKey = new Map<string, Segment>();

  for (const entry of entries) {
    const key = segmentKey(entry.nsPair, entry.ewPair);
    let segment = byKey.get(key);
    if (!segment) {
      segment = {
        nsPair: entry.nsPair,
        ewPair: entry.ewPair,
        nsTeam: teamOf(entry.nsPair),
        ewTeam: teamOf(entry.ewPair),
        entries: [],
      };
      byKey.set(key, segment);
    }
    segment.entries.push(entry);
  }

  for (const segment of byKey.values()) {
    segment.entries.sort((a, b) => a.board - b.board);
  }

  return [...byKey.values()].sort((a, b) =>
    segmentKey(a.nsPair, a.ewPair).localeCompare(segmentKey(b.nsPair, b.ewPair)),
  );
}

/**
 * Group a round's segments into head-to-head team matches.
 *
 * A segment where a pair from team A faces a pair from team B belongs to the
 * A-B matchup regardless of orientation, so the two halves of a match find
 * each other without the app knowing anything about the movement.
 */
export function groupMatchups(entries: Entry[]): Matchup[] {
  const byKey = new Map<string, Matchup>();

  for (const segment of groupSegments(entries)) {
    // A segment between two pairs of the same team is invalid; validation
    // reports it. Skip it here so it cannot corrupt a real matchup.
    if (segment.nsTeam === segment.ewTeam) continue;

    const key = matchupKey(segment.nsTeam, segment.ewTeam);
    let matchup = byKey.get(key);
    if (!matchup) {
      matchup = {
        key,
        teams: [segment.nsTeam, segment.ewTeam].sort() as [TeamId, TeamId],
        segments: [],
      };
      byKey.set(key, matchup);
    }
    matchup.segments.push(segment);
  }

  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * The two orientations of a matchup: the segment where the home team sat NS,
 * and the one where the away team sat NS. Either may be missing while a
 * round is still in progress, or if the pairings were entered wrongly.
 */
export function orientations(matchup: Matchup): {
  home: TeamId;
  away: TeamId;
  homeNs?: Segment;
  awayNs?: Segment;
} {
  const [home, away] = matchup.teams;
  return {
    home,
    away,
    homeNs: matchup.segments.find((s) => s.nsTeam === home),
    awayNs: matchup.segments.find((s) => s.nsTeam === away),
  };
}
