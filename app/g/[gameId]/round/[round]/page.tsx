import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { clientId } from "@/lib/session";
import { isFullEntry, segmentView, visibleRound } from "@/lib/visibility";
import { formatContract } from "@/lib/bridge/contract";
import { validateSegmentPairing } from "@/lib/tournament/validate";
import { ROUNDS, pairLabel, type PairId } from "@/lib/types";
import { PairPicker } from "@/components/PairPicker";
import { SegmentForm, type RowSeed } from "@/components/SegmentForm";
import { RefreshButton } from "@/components/RefreshButton";

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
          <span className={`badge ${view.complete ? "" : "open"}`}>
            {view.entryCount} / {view.expectedCount} boards
          </span>
          <RefreshButton />
        </div>
      </div>

      {view.complete ? (
        <p className="notice info">
          This round is closed — every board is in.{" "}
          <Link href={`/g/${gameId}/results/${round}`}>See the scoresheets</Link>. Anyone can
          correct or remove a board here now and the scores follow; the round stays closed
          either way, and a removed board is flagged on the scoresheet.
        </p>
      ) : (
        <p className="muted">
          While the round is open you only see boards you entered yourself. Everything opens up
          once all {view.expectedCount} boards are in.
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
            roundClosed={view.complete}
          />
        </>
      ) : (
        <p className="muted" style={{ marginTop: "1rem" }}>
          Pick both pairs to enter this table&rsquo;s six boards.
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
