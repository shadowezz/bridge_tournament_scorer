import { formatContract, tricksTaken } from "@/lib/bridge/contract";
import type { MatchupResult } from "@/lib/tournament/compute";
import { type GameMeta, pairPlayers, teamName } from "@/lib/types";

/** Positive numbers only in the +/- columns; blank when the side did not score. */
function split(score: number): { plus: string; minus: string } {
  if (score > 0) return { plus: String(score), minus: "" };
  if (score < 0) return { plus: "", minus: String(-score) };
  return { plus: "0", minus: "" };
}

function bid(contract: Parameters<typeof formatContract>[0]): { label: string; by: string; tricks: string } {
  if (contract.passedOut) return { label: "Pass", by: "—", tricks: "—" };

  const marks = contract.doubled === 2 ? "xx" : contract.doubled === 1 ? "x" : "";
  const strain = contract.strain === "N" ? "NT" : contract.strain;
  const result =
    contract.result === 0 ? "=" : contract.result > 0 ? `+${contract.result}` : `${contract.result}`;

  return {
    label: `${contract.level}${strain}${marks}${result}`,
    by: contract.declarer,
    tricks: String(tricksTaken(contract)),
  };
}

/** Column-block heading: one of our pairs, where they sat, and who they faced. */
function BlockHeader({ ours, seat, against }: { ours: string; seat: string; against: string }) {
  return (
    <>
      <div>
        {ours} <span style={{ fontWeight: 400, opacity: 0.7 }}>({seat})</span>
      </div>
      <div style={{ fontWeight: 400, opacity: 0.7 }}>vs {against}</div>
    </>
  );
}

/**
 * A team match is scored by comparing a team's OWN two pairs, one at each
 * table, so both column blocks belong to the home team. Each block therefore
 * names the opponent that pair faced, otherwise the sheet reads as though a
 * team were playing itself.
 */
export function Scoresheet({ matchup, meta }: { matchup: MatchupResult; meta: GameMeta }) {
  const [homeTeam, awayTeam] = matchup.teams;

  return (
    <div className="scroll-x">
      <table>
        <thead>
          <tr>
            <th />
            <th colSpan={5} style={{ background: "var(--ns)", textAlign: "center" }}>
              <BlockHeader
                ours={pairPlayers(meta, matchup.homeNsPair)}
                seat="N–S"
                against={pairPlayers(meta, matchup.awayEwPair)}
              />
            </th>
            <th colSpan={5} style={{ background: "var(--ew)", textAlign: "center" }}>
              <BlockHeader
                ours={pairPlayers(meta, matchup.homeEwPair)}
                seat="E–W"
                against={pairPlayers(meta, matchup.awayNsPair)}
              />
            </th>
            <th colSpan={2} style={{ background: "var(--imp)", textAlign: "center" }}>
              IMPs to
            </th>
          </tr>
          <tr>
            <th>Board</th>
            <th>Bid</th>
            <th>By</th>
            <th>Result</th>
            <th>NS+</th>
            <th>NS−</th>
            <th>Bid</th>
            <th>By</th>
            <th>Result</th>
            <th>EW+</th>
            <th>EW−</th>
            <th>{teamName(meta, homeTeam)}</th>
            <th>{teamName(meta, awayTeam)}</th>
          </tr>
        </thead>

        <tbody>
          {matchup.boards.map((row) => {
            const ns = bid(row.ns.contract);
            const ew = bid(row.ew.contract);
            const nsScore = split(row.ns.score);
            const ewScore = split(row.ew.score);

            return (
              <tr key={row.board}>
                <td>
                  <strong>{row.board}</strong>
                </td>
                <td style={{ background: "var(--ns)" }}>{ns.label}</td>
                <td style={{ background: "var(--ns)" }}>{ns.by}</td>
                <td style={{ background: "var(--ns)" }}>{ns.tricks}</td>
                <td style={{ background: "var(--ns)" }}>{nsScore.plus}</td>
                <td style={{ background: "var(--ns)" }}>{nsScore.minus}</td>
                <td style={{ background: "var(--ew)" }}>{ew.label}</td>
                <td style={{ background: "var(--ew)" }}>{ew.by}</td>
                <td style={{ background: "var(--ew)" }}>{ew.tricks}</td>
                <td style={{ background: "var(--ew)" }}>{ewScore.plus}</td>
                <td style={{ background: "var(--ew)" }}>{ewScore.minus}</td>
                <td style={{ background: "var(--imp)" }}>
                  <strong>{row.imps > 0 ? row.imps : ""}</strong>
                </td>
                <td style={{ background: "var(--imp)" }}>
                  <strong>{row.imps < 0 ? -row.imps : ""}</strong>
                </td>
              </tr>
            );
          })}
        </tbody>

        <tfoot>
          <tr>
            <td colSpan={11} style={{ textAlign: "right" }}>
              Overall IMPs
            </td>
            <td style={{ background: "var(--imp)" }}>{matchup.impsHome}</td>
            <td style={{ background: "var(--imp)" }}>{matchup.impsAway}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
