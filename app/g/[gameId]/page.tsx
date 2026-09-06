import Link from "next/link";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { standings } from "@/lib/tournament/compute";
import { visibleGame } from "@/lib/visibility";
import { Standings } from "@/components/Standings";
import { RefreshButton } from "@/components/RefreshButton";
import { ShareLink } from "@/components/ShareLink";
import { AdminPanel } from "@/components/AdminPanel";
import { EndRoundButton } from "@/components/EndRoundButton";

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  // Results change outside this render, so never serve a cached page.
  await connection();

  const { gameId } = await params;
  const record = (await store().loadGame(gameId))!;
  const view = visibleGame(record, await clientId());

  const ended = view.rounds.filter((round) => round.ended);
  const table = standings(
    ended.map((round) => round.result!).filter(Boolean),
    record.meta,
  );

  return (
    <>
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Standings</h2>
        <RefreshButton />
      </div>

      <Standings rows={table} meta={record.meta} />

      <h2>Rounds</h2>
      <div className="grid-3">
        {view.rounds.map((round) => (
          <div key={round.round} className="card">
            <div className="spread">
              <h3 style={{ margin: 0 }}>Round {round.round}</h3>
              {round.ended ? (
                <span className="badge">Ended</span>
              ) : round.entryCount > 0 ? (
                <span className="badge open">In progress</span>
              ) : (
                <span className="badge empty">Not started</span>
              )}
            </div>

            <p className="muted">
              {round.entryCount} of {round.expectedCount} boards in
              {!round.ended && round.full && (
                <>
                  <br />
                  All boards in — waiting for an admin to end the round.
                </>
              )}
            </p>

            <div className="row">
              <Link href={`/g/${gameId}/round/${round.round}`}>
                {round.ended ? "Board results" : "Enter results"}
              </Link>
              {round.ended && <Link href={`/g/${gameId}/results/${round.round}`}>Scoresheets</Link>}
            </div>

            {view.isAdmin && !round.ended && (
              <div className="row" style={{ marginTop: ".75rem" }}>
                <EndRoundButton gameId={gameId} round={round.round} full={round.full} />
              </div>
            )}
          </div>
        ))}
      </div>

      <h2>Admin</h2>
      <AdminPanel gameId={gameId} view={view} />

      <h2>Share</h2>
      <ShareLink />
      <p className="muted">
        Anyone with this link can enter and view results. Until an admin ends a round you only
        see the boards you entered yourself; after that everything is public and only admins
        can change it.
      </p>
    </>
  );
}
