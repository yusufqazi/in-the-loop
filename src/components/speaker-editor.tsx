"use client";

import { useId, useState } from "react";
import type { DetectedSpeaker } from "@/lib/audio-transcript";

type Props = {
  speakers: DetectedSpeaker[];
  disabled: boolean;
  onRename: (id: string, name: string) => void;
};

function SpeakerName({
  speaker,
  index,
  disabled,
  onRename,
}: Omit<Props, "speakers"> & { speaker: DetectedSpeaker; index: number }) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(speaker.label);
  const [error, setError] = useState("");

  function commit() {
    if (disabled || draft === speaker.label) return;
    try {
      onRename(speaker.id, draft);
      setDraft(draft.trim());
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "This speaker name could not be saved. Please try another name.");
    }
  }

  return (
    <div className="speaker-name-row">
      <label htmlFor={inputId}>Speaker {index + 1}</label>
      <input
        id={inputId}
        value={draft}
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setError("");
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.nativeEvent.isComposing) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
      {error ? <p id={errorId} className="speaker-error" role="alert">{error}</p> : null}
    </div>
  );
}

export default function SpeakerEditor({ speakers, disabled, onRename }: Props) {
  if (!speakers.length) return null;
  return (
    <fieldset className="speaker-editor" disabled={disabled}>
      <legend>Detected speakers</legend>
      {speakers.map((speaker, index) => (
        <SpeakerName
          key={`${speaker.id}:${speaker.label}`}
          speaker={speaker}
          index={index}
          disabled={disabled}
          onRename={onRename}
        />
      ))}
    </fieldset>
  );
}
