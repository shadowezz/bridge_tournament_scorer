"use client";

import { useActionState, useMemo, useState } from "react";
import { saveSegment } from "@/app/actions";
import { emptySubmission, isClaimedByOther } from "@/lib/forms";
import { ContractParseError, formatContract, parseContract, tricksTaken } from "@/lib/bridge/contract";
import { nsScore } from "@/lib/bridge/score";
import { BOARDS_PER_SEGMENT, type GameMeta, type Pair, teamOf } from "@/lib/types";

export interface RowSeed {
  board: string;
  contract: string;
  /** Entered by someone else at the table; content is not sent to us. */
  locked: boolean;
}

interface Props {
  gameId: string;
  round: number;
  meta: GameMeta;
  nsPair: string;
  ewPair: string;
  seeds: RowSeed[];
  /** Boards in this segment entered by another client. */
  lockedBoards: number[];
  roundClosed: boolean;
}

/** Parse a contract for the live echo, without throwing on half-typed input. */
function preview(text: string): { label: string; score: number | null; error: string | null } {
  const trimmed = text.trim();
  if (trimmed === "") return { label: "", score: null, error: null };

  try {
    const contract = parseContract(trimmed);
    const score = nsScore(contract, false);
    const tricks = tricksTaken(contract);
    return {
      label: formatContract(contract) + (tricks === null ? "" : ` · ${tricks} tricks`),
      score,
      error: null,
    };
  } catch (error) {
    return {
      label: "",
      score: null,
      error: error instanceof ContractParseError ? error.message : "Unreadable",
    };
  }
}

export function SegmentForm(props: Props) {
  const { gameId, round, meta, seeds, lockedBoards, roundClosed } = props;

  const [state, action, pending] = useActionState(saveSegment, emptySubmission);
  const [rows, setRows] = useState<RowSeed[]>(() => {
    const padded = [...seeds];
    while (padded.length < BOARDS_PER_SEGMENT) padded.push({ board: "", contract: "", locked: false });
    return padded.slice(0, BOARDS_PER_SEGMENT);
  });
  const [takeOver, setTakeOver] = useState<number[]>([]);

  const update = (index: number, patch: Partial<RowSeed>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const board = row.board.trim();
      if (board !== "") counts.set(board, (counts.get(board) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([board]) => board));
  }, [rows]);

  return (
    <form action={action} className="stack">
      <input type="hidden" name="gameId" value={gameId} />
      <input type="hidden" name="round" value={round} />
      <input type="hidden" name="nsPair" value={props.nsPair} />
      <input type="hidden" name="ewPair" value={props.ewPair} />
      <input type="hidden" name="takeOver" value={takeOver.join(",")} />

      <div className="stack">
        {rows.map((row, index) => {
          const boardNumber = Number(row.board);
          const claimedByOther = isClaimedByOther({
            board: boardNumber,
            lockedBoards,
            takeOver,
            roundClosed,
          });

          const parsed = claimedByOther ? null : preview(row.contract);
          const duplicated = row.board.trim() !== "" && duplicates.has(row.board.trim());

          return (
            <div key={index} className="card" style={{ padding: ".75rem" }}>
              <div className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
                <div style={{ width: "5.5rem", flexShrink: 0 }}>
                  <label htmlFor={`board-${index}`}>Board</label>
                  <input
                    id={`board-${index}`}
                    name={`board-${index}`}
                    inputMode="numeric"
                    value={row.board}
                    onChange={(event) => update(index, { board: event.target.value })}
                    autoComplete="off"
                    aria-invalid={duplicated}
                    disabled={claimedByOther}
                  />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <label htmlFor={`contract-${index}`}>Contract</label>
                  <input
                    id={`contract-${index}`}
                    name={`contract-${index}`}
                    value={claimedByOther ? "" : row.contract}
                    onChange={(event) => update(index, { contract: event.target.value })}
                    placeholder="4HxN+1"
                    autoComplete="off"
                    autoCapitalize="characters"
                    spellCheck={false}
                    disabled={claimedByOther}
                  />
                </div>
              </div>

              <div style={{ marginTop: ".4rem", minHeight: "1.25rem" }}>
                {duplicated && (
                  <span className="muted" style={{ color: "var(--danger)" }}>
                    Board {row.board} is on two rows.
                  </span>
                )}

                {claimedByOther ? (
                  <span className="muted">
                    Already entered by someone else at your table.{" "}
                    <button
                      type="button"
                      className="link"
                      onClick={() => setTakeOver((current) => [...current, boardNumber])}
                    >
                      Enter it myself instead
                    </button>
                  </span>
                ) : parsed?.error ? (
                  <span className="muted" style={{ color: "var(--danger)" }}>{parsed.error}</span>
                ) : parsed?.label ? (
                  <span className="muted">
                    {parsed.label} ·{" "}
                    <strong style={{ color: "var(--text)" }}>
                      NS {parsed.score === 0 ? "0" : parsed.score! > 0 ? `+${parsed.score}` : `−${-parsed.score!}`}
                    </strong>
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      {state.message && (
        <p className={`notice ${state.ok ? "info" : "error"}`}>{state.message}</p>
      )}

      <div className="row">
        <button type="submit" disabled={pending || duplicates.size > 0}>
          {pending ? "Saving…" : "Save results"}
        </button>
        <span className="muted">
          Type the contract as <code>4HxN+1</code> — level, suit, doubles, declarer, result.
        </span>
      </div>
    </form>
  );
}

/** Pairs eligible to sit opposite the given pair: anyone from another team. */
export function opponentsOf(meta: GameMeta, pairId: string): Pair[] {
  if (!pairId) return meta.pairs;
  return meta.pairs.filter((pair) => teamOf(pair.id) !== teamOf(pairId));
}
