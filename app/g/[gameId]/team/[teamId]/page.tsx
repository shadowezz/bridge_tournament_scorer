import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { standings } from "@/lib/tournament/compute";
import { teamMatchups } from "@/lib/tournament/perspective";
import { visibleGame } from "@/lib/visibility";
import { type TeamId, pairPlayers, teamName } from "@/lib/types";
import { Scoresheet } from "@/components/Scoresheet";
import { LocalTime } from "@/components/LocalTime";
import { ValidationBanner } from "@/components/ValidationBanner";
import { RefreshButton } from "@/components/RefreshButton";

interface Props {
  params: Promise<{ gameId: string; teamId: string }>;
}

/**
 * One team's evening: every scoresheet it played, fixed to its own perspective.
 *
 * Nothing here is computed or stored. An ended round's stored result already
 * holds both tables of every matchup, so a team's sheets are that result
 * rearranged by `teamMatchups` - the same rearrangement the per-round page
 * offers as a toggle, chosen once for the whole page instead.
 */
export default async function TeamPage({ params }: Props) {
  // Results change outside this render, so never serve a cached page.
  await connection();

  const { gameId, teamId: teamParam } = await params;
  const record = (await store().loadGame(gameId))!;
  if (!record.meta.teams.some((t) => t.id === teamParam)) notFound();
  const team = teamParam as TeamId;

  // visibleGame is the gate: a round an admin has not ended carries no result,
  // so a running round simply has nothing to show here.
  const view = visibleGame(record, await clientId());
  const ended = view.rounds.filter((round) => round.ended && round.result);

  const total = standings(
    ended.map((round) => round.result!),
    record.meta,
  ).find((row) => row.team === team);

  const pairs = record.meta.pairs
    .filter((pair) => pair.team === team)
    .map((pair) => pairPlayers(record.meta, pair.id))
    .join(" · ");

  // Flatten to (round, matchup-from-this-team's-side) once: the summary table
  // and the scoresheets below must not disagree about order or orientation.
  const played = ended.flatMap((round) =>
    teamMatchups(round.result!.matchups, team).map((matchup, index) => ({
      round: round.result!,
      matchup,
      // Validation belongs to the round, not the matchup, so only the first
      // sheet of each round carries the banner.
      firstOfRound: index === 0,
    })),
  );

  return (
    <>
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>{teamName(record.meta, team)}</h2>
        <RefreshButton />
      </div>
      <p className="muted" style={{ marginTop: 0 }}>{pairs}</p>

      {played.length === 0 ? (
        <>
          <p className="notice warn">
            No rounds have ended yet. This team&rsquo;s scoresheets appear once an admin ends a
            round.
          </p>
          <Link href={`/g/${gameId}`}>Back to standings</Link>
        </>
      ) : (
        <>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Opponent</th>
                  <th>IMPs</th>
                  <th>VP</th>
                </tr>
              </thead>
              <tbody>
                {played.map(({ round, matchup }) => (
                  <tr key={`${round.round}|${matchup.key}`}>
                    <td>
                      <Link href={`/g/${gameId}/results/${round.round}`}>
                        Round {round.round}
                      </Link>
                    </td>
                    <td>{teamName(record.meta, matchup.teams[1])}</td>
                    <td>
                      {matchup.impsHome} &ndash; {matchup.impsAway}
                    </td>
                    <td>
                      <strong>{matchup.vpHome.toFixed(2)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} style={{ textAlign: "right" }}>
                    Total after {total?.rounds ?? 0} round{total?.rounds === 1 ? "" : "s"}
                  </td>
                  <td>
                    <strong>{(total?.vp ?? 0).toFixed(2)}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="stack" style={{ gap: "2rem", marginTop: "2rem" }}>
            {played.map(({ round, matchup, firstOfRound }) => (
              <section key={`${round.round}|${matchup.key}`}>
                <div className="spread">
                  <div>
                    <h3 style={{ margin: 0, fontSize: "1.05rem" }}>
                      Round {round.round} vs {teamName(record.meta, matchup.teams[1])}
                    </h3>
                    <p className="muted" style={{ margin: ".15rem 0 0" }}>
                      {teamName(record.meta, team)}&rsquo;s scoresheet — their two pairs, one at
                      each table. Round ended <LocalTime iso={round.endedAt} />.
                    </p>
                  </div>

                  <div className="row">
                    <span className="badge">
                      {matchup.impsHome} – {matchup.impsAway} IMPs
                    </span>
                    <span className="badge">
                      {matchup.vpHome.toFixed(2)} – {matchup.vpAway.toFixed(2)} VP
                    </span>
                  </div>
                </div>

                {firstOfRound && <ValidationBanner issues={round.validation} />}

                {matchup.excludedBoards.length > 0 && (
                  <p className="notice error" style={{ margin: ".5rem 0" }}>
                    Board {matchup.excludedBoards.join(", ")} could not be matched across both
                    tables and is excluded from these IMPs.
                  </p>
                )}

                <Scoresheet matchup={matchup} meta={record.meta} />
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
