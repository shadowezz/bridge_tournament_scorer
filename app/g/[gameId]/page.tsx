import Link from "next/link";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { standings } from "@/lib/tournament/compute";
import { visibleGame } from "@/lib/visibility";
import { Standings } from "@/components/Standings";
import { RefreshButton } from "@/components/RefreshButton";
import { ShareLink } from "@/components/ShareLink";

export default async function GamePage({ params }: { params: Promise<{ gameId: string }> }) {
  // Results change outside this render, so never serve a cached page.
  await connection();

  const { gameId } = await params;
  const record = (await store().loadGame(gameId))!;
  const view = visibleGame(record, await clientId());

  const closed = view.rounds.filter((round) => round.complete);
  const table = standings(
    closed.map((round) => round.result!).filter(Boolean),
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
              {round.complete ? (
                <span className="badge">Closed</span>
              ) : round.entryCount > 0 ? (
                <span className="badge open">In progress</span>
              ) : (
                <span className="badge empty">Not started</span>
              )}
            </div>

            <p className="muted">
              {round.entryCount} of {round.expectedCount} boards in
            </p>

            <div className="row">
              <Link href={`/g/${gameId}/round/${round.round}`}>Enter results</Link>
              {round.complete && <Link href={`/g/${gameId}/results/${round.round}`}>Scoresheets</Link>}
            </div>
          </div>
        ))}
      </div>

      <h2>Share</h2>
      <ShareLink />
      <p className="muted">
        Anyone with this link can enter and view results. While a round is open you only see
        the boards you entered yourself.
      </p>
    </>
  );
}
