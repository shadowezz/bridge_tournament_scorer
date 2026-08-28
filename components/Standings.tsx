import type { GameMeta, TeamId } from "@/lib/types";

export interface StandingRow {
  team: TeamId;
  name: string;
  vp: number;
  rounds: number;
}

export function Standings({ rows, meta }: { rows: StandingRow[]; meta: GameMeta }) {
  const scored = rows.some((row) => row.rounds > 0);

  if (!scored) {
    return (
      <p className="muted">
        No rounds have closed yet. Standings appear once every board of a round is in.
      </p>
    );
  }

  return (
    <div className="scroll-x">
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>Pairs</th>
            <th>Rounds</th>
            <th>VP</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.team}>
              <td>
                <strong>
                  {index + 1}. {row.name}
                </strong>
              </td>
              <td className="muted" style={{ textAlign: "left", whiteSpace: "normal" }}>
                {meta.pairs
                  .filter((pair) => pair.team === row.team)
                  .map((pair) => pair.players.join(" / "))
                  .join(" · ")}
              </td>
              <td>{row.rounds}</td>
              <td>
                <strong>{row.vp.toFixed(2)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
