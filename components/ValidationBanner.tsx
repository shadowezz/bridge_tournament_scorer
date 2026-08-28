import type { ValidationIssue } from "@/lib/tournament/validate";

/**
 * Surfaced when a round has closed but its entries do not hang together.
 *
 * The round still shows its results - it really is over - but unmatched
 * boards are excluded from the IMPs rather than silently scored, so the
 * banner has to say plainly what was left out.
 */
export function ValidationBanner({ issues }: { issues: ValidationIssue[] }) {
  const errors = issues.filter((issue) => issue.severity === "error");
  const warnings = issues.filter((issue) => issue.severity === "warning");

  if (errors.length === 0 && warnings.length === 0) return null;

  return (
    <div className="stack" style={{ marginBottom: "1.5rem" }}>
      {errors.length > 0 && (
        <div className="notice error">
          <strong>
            {errors.length === 1 ? "This round needs a correction" : `${errors.length} corrections needed`}
          </strong>
          <ul style={{ margin: ".5rem 0 0", paddingLeft: "1.1rem" }}>
            {errors.map((issue, index) => (
              <li key={index} style={{ marginBottom: ".35rem" }}>
                {issue.message}
              </li>
            ))}
          </ul>
          <p style={{ marginBottom: 0 }}>
            Boards that could not be matched are left out of the IMPs below.
          </p>
        </div>
      )}

      {warnings.map((issue, index) => (
        <p key={index} className="notice warn">
          {issue.message}
        </p>
      ))}
    </div>
  );
}
