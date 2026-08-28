import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { visibleRound } from "@/lib/visibility";
import { ROUNDS } from "@/lib/types";
import { MatchupCard } from "@/components/MatchupCard";
import { LocalTime } from "@/components/LocalTime";
import { ValidationBanner } from "@/components/ValidationBanner";
import { RefreshButton } from "@/components/RefreshButton";

interface Props {
  params: Promise<{ gameId: string; round: string }>;
}

export default async function ResultsPage({ params }: Props) {
  await connection();

  const { gameId, round: roundParam } = await params;
  const round = Number(roundParam);
  if (!ROUNDS.includes(round as (typeof ROUNDS)[number])) notFound();

  const record = (await store().loadGame(gameId))!;
  const view = visibleRound(round, record.entries, record.results[round] ?? null, await clientId());

  if (!view.complete || !view.result) {
    return (
      <>
        <h2 style={{ marginTop: 0 }}>Round {round}</h2>
        <p className="notice warn">
          Results appear once all {view.expectedCount} boards are in. {view.entryCount} so far.
        </p>
        <Link href={`/g/${gameId}/round/${round}`}>Enter results</Link>
      </>
    );
  }

  const { result } = view;

  return (
    <>
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Round {round} results</h2>
        <RefreshButton />
      </div>

      <ValidationBanner issues={result.validation} />

      <div className="stack" style={{ gap: "2rem" }}>
        {result.matchups.map((matchup) => (
          <MatchupCard key={matchup.key} matchup={matchup} meta={record.meta} />
        ))}
      </div>

      <h2>Round {round} victory points</h2>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Team</th>
              <th>VP this round</th>
            </tr>
          </thead>
          <tbody>
            {record.meta.teams.map((team) => (
              <tr key={team.id}>
                <td>{team.name}</td>
                <td>
                  <strong>{(result.teamVp[team.id] ?? 0).toFixed(2)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: "1rem" }}>
        Scored <LocalTime iso={result.computedAt} />.{" "}
        <Link href={`/g/${gameId}/round/${round}`}>Correct an entry</Link> if something looks wrong.
      </p>
    </>
  );
}
