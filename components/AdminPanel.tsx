import { setAdminClaiming, claimAdmin } from "@/app/actions";
import type { VisibleGame } from "@/lib/visibility";

/**
 * Claim admin, lock claiming, and end rounds.
 *
 * The game link has always been the only access control here, so claiming is
 * open to anyone holding it. What stops a passer-by is an admin closing
 * claiming once the directors have themselves.
 */
export function AdminPanel({ gameId, view }: { gameId: string; view: VisibleGame }) {
  const { isAdmin, adminCount, claimingOpen } = view;

  return (
    <div className="card">
      <div className="spread">
        <h3 style={{ margin: 0 }}>Admins</h3>
        <span className={`badge ${isAdmin ? "" : "empty"}`}>
          {adminCount === 1 ? "1 admin" : `${adminCount} admins`}
        </span>
      </div>

      {isAdmin ? (
        <p className="muted">
          You are an admin. Rounds do not end on their own — use the End round button on a
          round above once every table has reported. After that only admins can correct a
          board.
        </p>
      ) : claimingOpen ? (
        <p className="muted">
          Admins end rounds and correct results afterwards. Claim it if you are running this
          tournament — anyone with the link can, until an admin turns claiming off.
        </p>
      ) : (
        <p className="muted">
          Admin claiming is closed for this game. Ask an admin to reopen it if you need to end
          a round.
        </p>
      )}

      <div className="row">
        {!isAdmin && claimingOpen && (
          <form action={claimAdmin}>
            <input type="hidden" name="gameId" value={gameId} />
            <button type="submit">Claim admin</button>
          </form>
        )}

        {isAdmin && (
          <form action={setAdminClaiming}>
            <input type="hidden" name="gameId" value={gameId} />
            <input type="hidden" name="open" value={claimingOpen ? "false" : "true"} />
            <button type="submit">
              {claimingOpen ? "Turn off admin claiming" : "Turn admin claiming back on"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
