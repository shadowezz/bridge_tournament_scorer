import { createGame } from "@/app/actions";
import { TEAM_IDS, playerField, teamField } from "@/lib/tournament/setup";

const PLACEHOLDERS: Record<string, string> = { A: "Sharks", B: "Eagles", C: "Owls" };

export default function LandingPage() {
  return (
    <>
      <h1>New tournament</h1>
      <p className="sub">
        Three teams of four, three rounds of duplicate IMPs teams. Enter everyone once, then
        share the link that follows.
      </p>

      <form action={createGame} className="stack">
        <div className="grid-3">
          {TEAM_IDS.map((team) => (
            <fieldset key={team} className="card">
              <label htmlFor={teamField(team)}>Team {team} name</label>
              <input
                id={teamField(team)}
                name={teamField(team)}
                placeholder={PLACEHOLDERS[team]}
                autoComplete="off"
              />

              {([1, 2] as const).map((index) => (
                <div key={index} style={{ marginTop: "1rem" }}>
                  <label>
                    Pair {team}
                    {index}
                  </label>
                  <div className="stack" style={{ gap: ".4rem" }}>
                    {([1, 2] as const).map((slot) => (
                      <input
                        key={slot}
                        name={playerField(team, index, slot)}
                        placeholder={`Player ${slot}`}
                        autoComplete="off"
                      />
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        <div className="row">
          <button type="submit">Create tournament</button>
          <span className="muted">
            No accounts — anyone with the link can enter results.
          </span>
        </div>
      </form>
    </>
  );
}
