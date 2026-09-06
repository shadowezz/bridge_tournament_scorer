import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { isFullEntry, segmentView, visibleRound } from "@/lib/visibility";
import { formatContract } from "@/lib/bridge/contract";
import { validateSegmentPairing } from "@/lib/tournament/validate";
import { ROUNDS, pairLabel, type PairId } from "@/lib/types";
import { PairPicker } from "@/components/PairPicker";
import { SegmentForm, type RowSeed } from "@/components/SegmentForm";
import { RefreshButton } from "@/components/RefreshButton";
import { EndRoundButton } from "@/components/EndRoundButton";

interface Props {
  params: Promise<{ gameId: string; round: string }>;
  searchParams: Promise<{ ns?: string; ew?: string }>;
}

export default async function RoundPage({ params, searchParams }: Props) {
  await connection();

  const { gameId, round: roundParam } = await params;
  const round = Number(roundParam);
  if (!ROUNDS.includes(round as (typeof ROUNDS)[number])) notFound();

  const { ns = "", ew = "" } = await searchParams;
  const record = (await store().loadGame(gameId))!;
  const me = await clientId();

  const view = visibleRound(round, record.entries, record.results[round] ?? null, me);
  const admin = isAdmin(record.admins, me);
  // An ended round is frozen to everyone but an admin - including the boards
  // you entered yourself.
  const readOnly = view.ended && !admin;

  const knownPair = (id: string): id is PairId => record.meta.pairs.some((p) => p.id === id);
  const nsPair = knownPair(ns) ? ns : "";
  const ewPair = knownPair(ew) ? ew : "";
  const pairingError = nsPair && ewPair ? validateSegmentPairing(nsPair, ewPair) : null;
  const ready = Boolean(nsPair && ewPair && !pairingError);

  const entries = ready ? segmentView(view, nsPair, ewPair) : [];
  const seeds: RowSeed[] = entries.map((entry) =>
    isFullEntry(entry)
      ? {
          board: String(entry.board),
          contract: formatContractInput(entry),
          locked: false,
          origBoard: entry.board,
        }
      : { board: String(entry.board), contract: "", locked: true, origBoard: entry.board },
  );
  const lockedBoards = entries.filter((entry) => !isFullEntry(entry)).map((entry) => entry.board);

  return (
    <>
      <div className="spread">
        <h2 style={{ marginTop: 0 }}>Round {round}</h2>
        <div className="row">
          <span className={`badge ${view.ended ? "" : "open"}`}>
            {view.entryCount} / {view.expectedCount} boards
          </span>
          {view.ended && <span className="badge">Ended</span>}
          {!view.ended && admin && (
            <EndRoundButton gameId={gameId} round={round} full={view.full} />
          )}
          <RefreshButton />
        </div>
      </div>

      {view.ended ? (
        admin ? (
          <p className="notice info">
            This round has ended.{" "}
            <Link href={`/g/${gameId}/results/${round}`}>See the scoresheets</Link>. As an admin
            you can still correct or remove any board here and the scores follow; the round
            stays ended either way, and a removed board is flagged on the scoresheet.
          </p>
        ) : (
          <p className="notice info">
            This round has ended, so the boards are view-only — including the ones you entered.{" "}
            <Link href={`/g/${gameId}/results/${round}`}>See the scoresheets</Link>, and ask an
            admin if something needs correcting.
          </p>
        )
      ) : (
        <p className="muted">
          While the round is running you only see boards you entered yourself. Everything opens
          up when an admin ends the round
          {view.full ? " — all " + view.expectedCount + " boards are in, so it is ready." : "."}
        </p>
      )}

      <h2>Who played?</h2>
      <PairPicker meta={record.meta} nsPair={nsPair} ewPair={ewPair} />

      {pairingError && <p className="notice error" style={{ marginTop: ".75rem" }}>{pairingError}</p>}

      {ready ? (
        <>
          <h2>
            {pairLabel(record.meta, nsPair)} <span className="muted">vs</span>{" "}
            {pairLabel(record.meta, ewPair)}
          </h2>
          {/*
            Keying on the segment remounts the form when the pairs change.
            Without it React reuses the instance, so the previous segment's
            typed rows, taken-over boards and save message all carry over -
            and a board unlocked by "enter it myself" would stay unlocked
            against a different table.
          */}
          <SegmentForm
            key={`${round}|${nsPair}|${ewPair}`}
            gameId={gameId}
            round={round}
            meta={record.meta}
            nsPair={nsPair}
            ewPair={ewPair}
            seeds={seeds}
            lockedBoards={lockedBoards}
            roundEnded={view.ended}
            readOnly={readOnly}
          />
        </>
      ) : (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Pick both pairs to {readOnly ? "see" : "enter"} this table&rsquo;s six boards.
        </p>
      )}
    </>
  );
}

/** Render a stored entry back into the shorthand the form accepts. */
function formatContractInput(entry: { contract: Parameters<typeof formatContract>[0] }): string {
  const { contract } = entry;
  if (contract.passedOut) return "Pass";

  const marks = contract.doubled === 2 ? "xx" : contract.doubled === 1 ? "x" : "";
  const strain = contract.strain === "N" ? "NT" : contract.strain;
  const result =
    contract.result === 0 ? "=" : contract.result > 0 ? `+${contract.result}` : `${contract.result}`;
  return `${contract.level}${strain}${marks}${contract.declarer}${result}`;
}
