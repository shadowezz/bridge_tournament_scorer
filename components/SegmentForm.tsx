"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { saveSegment } from "@/app/actions";
import { droppedBoards, emptySubmission, isClaimedByOther } from "@/lib/forms";
import { ContractParseError, formatContract, parseContract, tricksTaken } from "@/lib/bridge/contract";
import { nsScore } from "@/lib/bridge/score";
import { BOARDS_PER_SEGMENT, type GameMeta, type Pair, teamOf } from "@/lib/types";

export interface RowSeed {
  board: string;
  contract: string;
  /** Entered by someone else at the table; content is not sent to us. */
  locked: boolean;
  /**
   * The board this row was seeded with, or null for an untouched row. Client
   * state only - it never reaches the server, which works out what to delete
   * from the segment's submitted contents.
   */
  origBoard: number | null;
}

/**
 * A row as the form holds it. `removing` is a mark, not an erasure: the board
 * and contract stay on screen so the player can see - and undo - what they are
 * about to delete.
 */
interface RowState extends RowSeed {
  removing: boolean;
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
  const [rows, setRows] = useState<RowState[]>(() => {
    const padded: RowState[] = seeds.map((seed) => ({ ...seed, removing: false }));
    while (padded.length < BOARDS_PER_SEGMENT)
      padded.push({ board: "", contract: "", locked: false, origBoard: null, removing: false });
    return padded.slice(0, BOARDS_PER_SEGMENT);
  });
  const [takeOver, setTakeOver] = useState<number[]>([]);

  /**
   * The last save's message.
   *
   * A successful one fades out and unmounts, so the next save reappears as a
   * fresh banner rather than leaving identical "Saved." text on screen that
   * gives the player nothing to see.
   */
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);

  const update = (index: number, patch: Partial<RowState>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  useEffect(() => {
    const { ok, message } = state;
    if (message) setFlash({ ok, message });
  }, [state]);

  /**
   * Re-baseline the rows once a save lands.
   *
   * The form is keyed on the segment, so a save does not remount it and the
   * seeds it was built from go stale: without this, a row renumbered from 3 to
   * 7 would keep offering to delete board 3 on every later save. The rows are
   * re-seeded from what was just written rather than from the revalidated
   * props, which arrive on their own schedule and would clobber anything typed
   * in the meantime.
   */
  useEffect(() => {
    if (!state.ok) return;
    setRows((current) =>
      current.map((row) =>
        row.removing
          ? { board: "", contract: "", locked: false, origBoard: null, removing: false }
          : { ...row, origBoard: row.board.trim() === "" ? null : Number(row.board) },
      ),
    );
  }, [state]);

  // A marked row's inputs are disabled, so it submits nothing and the segment
  // reconcile drops the board. That also keeps it out of both tallies below:
  // it is neither a board being kept nor a board being typed twice.
  const submittedBoards = useMemo(
    () => rows.map((row) => (row.removing ? "" : row.board)),
    [rows],
  );

  const dropped = useMemo(
    () => droppedBoards(rows.map((row) => row.origBoard), submittedBoards),
    [rows, submittedBoards],
  );

  const duplicates = useMemo(() => {
    const counts = new Map<string, number>();
    for (const board of submittedBoards) {
      const trimmed = board.trim();
      if (trimmed !== "") counts.set(trimmed, (counts.get(trimmed) ?? 0) + 1);
    }
    return new Set([...counts].filter(([, n]) => n > 1).map(([board]) => board));
  }, [submittedBoards]);

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
          const duplicated =
            !row.removing && row.board.trim() !== "" && duplicates.has(row.board.trim());

          return (
            <div
              key={index}
              className="card"
              style={{ padding: ".75rem", opacity: row.removing ? 0.55 : 1 }}
            >
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
                    // Disabled inputs submit nothing, which is how both a
                    // marked row and someone else's row stay out of the save.
                    disabled={claimedByOther || row.removing}
                    style={row.removing ? { textDecoration: "line-through" } : undefined}
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
                    disabled={claimedByOther || row.removing}
                    style={row.removing ? { textDecoration: "line-through" } : undefined}
                  />
                </div>

                {row.origBoard !== null && !claimedByOther && (
                  <button
                    type="button"
                    className="link"
                    style={{ flexShrink: 0, alignSelf: "flex-end", paddingBottom: ".55rem" }}
                    onClick={() => update(index, { removing: !row.removing })}
                    aria-pressed={row.removing}
                    aria-label={
                      row.removing
                        ? `Keep board ${row.origBoard}`
                        : `Remove board ${row.origBoard}`
                    }
                  >
                    {row.removing ? "Keep" : "Remove"}
                  </button>
                )}
              </div>

              <div style={{ marginTop: ".4rem", minHeight: "1.25rem" }}>
                {duplicated && (
                  <span className="muted" style={{ color: "var(--danger)" }}>
                    Board {row.board} is on two rows.
                  </span>
                )}

                {row.removing ? (
                  <span className="muted" style={{ color: "var(--danger)" }}>
                    Marked for deletion — press Keep to change your mind.
                  </span>
                ) : claimedByOther ? (
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

      {dropped.length > 0 && (
        <p className="notice warn">
          Saving will delete board {dropped.join(", ")} from this table.{" "}
          {roundClosed
            ? "The round stays closed, but the scoresheet will flag the missing board."
            : "You can enter it again afterwards."}
        </p>
      )}

      {flash && (
        <p
          className={`notice ${flash.ok ? "info fading" : "error"}`}
          onAnimationEnd={() => setFlash(null)}
        >
          {flash.message}
        </p>
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
