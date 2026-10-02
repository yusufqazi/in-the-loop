"use client";

import { useEffect, useRef } from "react";

type Props = {
  title: string;
  text: string;
  loading: boolean;
  error: string;
  onClose: () => void;
};

export default function TranscriptViewer({ title, text, loading, error, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  return (
    <dialog ref={dialog} className="transcript-dialog" aria-labelledby="transcript-title" onCancel={(event) => { event.preventDefault(); onClose(); }}>
      <header className="transcript-dialog-header">
        <div><p className="eyebrow">Transcript</p><h2 id="transcript-title">{title}</h2></div>
        <button className="account-button" type="button" onClick={onClose} autoFocus>Close</button>
      </header>
      <div className="transcript-dialog-body" tabIndex={0} aria-label="Transcript content">
        {loading ? <p role="status">Loading transcript…</p>
          : error ? <p className="auth-error" role="alert">{error}</p>
          : <pre>{text}</pre>}
      </div>
    </dialog>
  );
}
