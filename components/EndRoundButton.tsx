"use client";

import { useRef } from "react";
import { useFormStatus } from "react-dom";
import { endRound } from "@/app/actions";

/** Lives inside the form so it can read that form's pending state. */
function ConfirmButton({ round }: { round: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? "Ending…" : `End round ${round}`}
    </button>
  );
}

/**
 * End a round, behind a confirmation dialog.
 *
 * Ending is one-way and reveals every table's results at once, so it should
 * not be one stray tap away. A native `<dialog>` rather than `window.confirm`:
 * it can carry the specific warning about missing boards, styles with the rest
 * of the app, and brings focus trapping and escape-to-close with it.
 */
export function EndRoundButton({
  gameId,
  round,
  full,
}: {
  gameId: string;
  round: number;
  /** Whether every board is in. Decides how loud the warning has to be. */
  full: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button type="button" className="ghost" onClick={() => dialog.current?.showModal()}>
        End round {round}
      </button>

      {/*
        The dialog closes itself when the round ends, because the card stops
        rendering this component and the node leaves the DOM with it.
      */}
      <dialog ref={dialog} aria-labelledby={`end-round-${round}-title`}>
        <h3 id={`end-round-${round}-title`} style={{ marginTop: 0 }}>
          End round {round}?
        </h3>

        <p className="muted">
          Every table&rsquo;s results become visible to everyone, and this cannot be undone.
          Afterwards only admins can correct a board.
        </p>

        {!full && (
          <p className="notice warn">
            Not every board is in yet. Anything a missing table would have scored will be left
            out of the results, and the scoresheet will say so.
          </p>
        )}

        <form action={endRound} className="row">
          <input type="hidden" name="gameId" value={gameId} />
          <input type="hidden" name="round" value={round} />
          <ConfirmButton round={round} />
          <button type="button" className="link" onClick={() => dialog.current?.close()}>
            Cancel
          </button>
        </form>
      </dialog>
    </>
  );
}
