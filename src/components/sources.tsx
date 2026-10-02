import type { Source } from "@/lib/types";

export default function Sources({ sources }: { sources: Source[] }) {
  if (!sources.length) return null;
  return (
    <details className="sources">
      <summary>Sources ({sources.length})</summary>
      {sources.map((source) => (
        <details className="source" key={source.id}>
          <summary>
            <span className="source-heading">
              <strong>{source.meetingTitle}</strong>
              <small>
                {[
                  ...new Set(
                    source.turns.map(
                      (t) => t.speaker || "Speaker not provided",
                    ),
                  ),
                ].join(", ")}{" "}
                ·{" "}
                {source.turns.every((t) => t.timestamp)
                  ? `${source.turns[0].timestamp}${source.turns.length > 1 ? ` – ${source.turns.at(-1)?.timestamp}` : ""}`
                  : "Some or all timestamps not provided"}
              </small>
            </span>
            <span className="expand-icon" aria-hidden="true">
              +
            </span>
          </summary>
          <div className="source-turns">
            {source.turns.map((turn) => (
              <div className="source-turn" key={turn.id}>
                <div>
                  <strong>{turn.speaker || "Speaker not provided"}</strong>
                  {turn.timestamp ? (
                    <time>{turn.timestamp}</time>
                  ) : (
                    <span>Timestamp not provided</span>
                  )}
                </div>
                <p>{turn.text}</p>
              </div>
            ))}
          </div>
        </details>
      ))}
    </details>
  );
}
