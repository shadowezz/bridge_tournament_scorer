"use client";

import { useState } from "react";
import { Scoresheet } from "@/components/Scoresheet";
import { flipMatchup } from "@/lib/tournament/perspective";
import type { MatchupResult } from "@/lib/tournament/compute";
import { type GameMeta, teamName } from "@/lib/types";

/**
 * One matchup, viewable from either team's side.
 *
 * Switching sides is a pure rearrangement of the result already on the page,
 * so it costs no request and cannot disagree with what was scored.
 */
export function MatchupCard({ matchup, meta }: { matchup: MatchupResult; meta: GameMeta }) {
  const [first, second] = matchup.teams;
  const [viewing, setViewing] = useState(first);

  const shown = viewing === first ? matchup : flipMatchup(matchup);
  const [home, away] = shown.teams;

  return (
    <section>
      <div className="spread">
        <div>
          <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
            {teamName(meta, first)} vs {teamName(meta, second)}
          </h3>
          <p className="muted" style={{ margin: ".15rem 0 0" }}>
            {teamName(meta, home)}&rsquo;s scoresheet — their two pairs, one at each table.
          </p>
        </div>

        <div className="row">
          <span className="badge">
            {teamName(meta, home)} {shown.impsHome} – {shown.impsAway} {teamName(meta, away)} IMPs
          </span>
          <span className="badge">
            {shown.vpHome.toFixed(2)} – {shown.vpAway.toFixed(2)} VP
          </span>
        </div>
      </div>

      <div className="row" style={{ margin: ".75rem 0 .5rem" }} role="group" aria-label="Scoresheet side">
        <span className="muted">Show scoresheet for</span>
        {[first, second].map((team) => (
          <button
            key={team}
            type="button"
            className={viewing === team ? "" : "ghost"}
            aria-pressed={viewing === team}
            onClick={() => setViewing(team)}
            style={{ padding: ".3rem .75rem", fontSize: ".875rem" }}
          >
            {teamName(meta, team)}
          </button>
        ))}
      </div>

      {shown.excludedBoards.length > 0 && (
        <p className="notice error" style={{ margin: ".5rem 0" }}>
          Board {shown.excludedBoards.join(", ")} could not be matched across both tables and is
          excluded from these IMPs.
        </p>
      )}

      <Scoresheet matchup={shown} meta={meta} />
    </section>
  );
}
