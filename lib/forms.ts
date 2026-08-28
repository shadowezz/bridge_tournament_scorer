import { BOARDS_PER_SEGMENT, type Contract } from "@/lib/types";
import { ContractParseError, parseContract } from "@/lib/bridge/contract";

/** Result of saving one segment, shared between the server action and the form. */
export interface SegmentSubmission {
  ok: boolean;
  /** Field errors keyed by row index. */
  errors: Record<number, string>;
  /** Boards owned by another client that were left untouched. */
  conflicts: number[];
  message?: string;
}

export const emptySubmission: SegmentSubmission = { ok: false, errors: {}, conflicts: [] };

/**
 * Whether a row belongs to someone else at the table and must stay read-only.
 *
 * Both of the row's inputs are disabled when this is true. Disabled fields are
 * not submitted, which is what makes the server skip the row entirely - if only
 * the contract were disabled, the row would post a board number with no
 * contract and the whole save would be rejected.
 */
export function isClaimedByOther(input: {
  board: number;
  lockedBoards: readonly number[];
  takeOver: readonly number[];
  roundClosed: boolean;
}): boolean {
  const { board, lockedBoards, takeOver, roundClosed } = input;
  if (roundClosed) return false;
  if (!Number.isInteger(board)) return false;
  return lockedBoards.includes(board) && !takeOver.includes(board);
}

export interface ParsedRows {
  rows: Array<{ board: number; contract: Contract }>;
  errors: Record<number, string>;
  /** Boards typed on more than one row. */
  duplicates: number[];
}

/**
 * Read the six board rows out of a submitted segment form.
 *
 * A row with neither field filled is simply not being entered yet and is
 * skipped; a half-filled row is an error the player has to resolve.
 */
export function parseSegmentRows(form: Pick<FormData, "get">): ParsedRows {
  const rows: ParsedRows["rows"] = [];
  const errors: Record<number, string> = {};

  for (let index = 0; index < BOARDS_PER_SEGMENT; index++) {
    const boardText = String(form.get(`board-${index}`) ?? "").trim();
    const contractText = String(form.get(`contract-${index}`) ?? "").trim();

    if (boardText === "" && contractText === "") continue;

    const board = Number(boardText);
    if (!Number.isInteger(board) || board < 1) {
      errors[index] = "Board number required";
      continue;
    }
    if (contractText === "") {
      errors[index] = "Contract required";
      continue;
    }

    try {
      rows.push({ board, contract: parseContract(contractText) });
    } catch (error) {
      errors[index] =
        error instanceof ContractParseError ? error.message : "Could not read that contract";
    }
  }

  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row.board, (counts.get(row.board) ?? 0) + 1);

  return {
    rows,
    errors,
    duplicates: [...counts].filter(([, n]) => n > 1).map(([board]) => board),
  };
}
