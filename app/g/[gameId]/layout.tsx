import { notFound } from "next/navigation";
import Link from "next/link";
import { store } from "@/lib/store";
import { isValidGameId } from "@/lib/ids";
import { ROUNDS } from "@/lib/types";
import { SessionCode } from "@/components/SessionCode";

export default async function GameLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ gameId: string }>;
}) {
  const { gameId } = await params;
  if (!isValidGameId(gameId)) notFound();

  const record = await store().loadGame(gameId);
  if (!record) notFound();

  return (
    <>
      <div className="spread" style={{ marginBottom: "1rem" }}>
        <h1 style={{ margin: 0 }}>
          <Link href={`/g/${gameId}`} style={{ textDecoration: "none", color: "inherit" }}>
            {record.meta.teams.map((t) => t.name).join(" · ")}
          </Link>
        </h1>
        <SessionCode />
      </div>

      <nav className="nav">
        <Link href={`/g/${gameId}`}>Standings</Link>
        {ROUNDS.map((round) => (
          <Link key={round} href={`/g/${gameId}/round/${round}`}>
            Round {round}
          </Link>
        ))}
      </nav>

      {children}
    </>
  );
}
