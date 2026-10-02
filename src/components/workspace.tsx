"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, ChatTurn, Meeting } from "@/lib/types";
import Sources from "./sources";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: Answer;
};
type Problem = { message: string; requestId?: string };
const questions = [
  "What were the main decisions?",
  "What action items were assigned?",
  "Was a deadline agreed upon?",
  "What remains unresolved?",
];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "The server returned an unreadable response. Please retry.",
    );
  }
  if (!response.ok) {
    const error = new Error(
      body.error?.message || "The request failed. Please retry.",
    ) as Error & { requestId?: string };
    error.requestId = body.error?.requestId;
    throw error;
  }
  return body as T;
}
function problem(error: unknown): Problem {
  return {
    message:
      error instanceof Error ? error.message : "An unexpected error occurred.",
    requestId: (error as { requestId?: string })?.requestId,
  };
}
function LoopMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`loop-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 48 24" fill="none">
        <path
          d="M24 12C20 7 17 4 12 4C6 4 3 8 3 12s3 8 9 8c5 0 8-3 12-8s7-8 12-8c6 0 9 4 9 8s-3 8-9 8c-5 0-8-3-12-8Z"
          stroke="currentColor"
          strokeWidth="3.8"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
function UploadIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path
        d="M10 13V3m0 0L6 7m4-4 4 4M4 12v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function Workspace() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "paste">("file");
  const [pastedText, setPastedText] = useState("");
  const [pasteTitle, setPasteTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<Problem | null>(null);
  const [notice, setNotice] = useState("");
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const selected = meetings.find((m) => m.id === selectedId);
  const messages = selectedId ? chats[selectedId] || [] : [];
  const busy = uploading || asking;

  async function loadMeetings(signal?: AbortSignal) {
    try {
      const data = await api<{ meetings: Meeting[] }>("/api/meetings", {
        signal,
      });
      if (signal?.aborted) return;
      setError(null);
      setMeetings(data.meetings);
      setSelectedId((current) =>
        data.meetings.some((m) => m.id === current)
          ? current
          : data.meetings[0]?.id || null,
      );
    } catch (e) {
      if (!signal?.aborted) setError(problem(e));
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    api<{ meetings: Meeting[] }>("/api/meetings", { signal: controller.signal })
      .then((data) => {
        if (!controller.signal.aborted) {
          setMeetings(data.meetings);
          setSelectedId(data.meetings[0]?.id || null);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(problem(e));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (messages.length || asking)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, asking]);

  async function upload(file: File) {
    if (busyRef.current) return;
    if (!/\.txt$/i.test(file.name) || !file.size || file.size > 100 * 1024) {
      setError({
        message: "Choose a nonempty .txt file no larger than 100 KiB.",
      });
      return;
    }
    busyRef.current = true;
    setUploading(true);
    setError(null);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const { meeting } = await api<{ meeting: Meeting }>("/api/meetings", {
        method: "POST",
        body: form,
      });
      setMeetings((current) => [meeting, ...current]);
      setSelectedId(meeting.id);
      setDraft("");
      setShowUpload(false);
      setPastedText("");
      setPasteTitle("");
      setNotice(`“${meeting.title}” added.`);
    } catch (e) {
      setError(problem(e));
    } finally {
      setUploading(false);
      busyRef.current = false;
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function importSample(name: string) {
    if (busyRef.current) return;
    try {
      const response = await fetch(`/samples/${name}.txt`);
      if (!response.ok)
        throw new Error("The sample transcript could not be loaded.");
      await upload(
        new File([await response.text()], `${name}.txt`, {
          type: "text/plain",
        }),
      );
    } catch (e) {
      setError(problem(e));
    }
  }
  async function ask(question: string) {
    if (!selected || busyRef.current || !question.trim()) return;
    const meetingId = selected.id;
    const previous = chats[meetingId] || [];
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      text: question.trim(),
    };
    busyRef.current = true;
    setAsking(true);
    setError(null);
    setNotice("");
    setDraft("");
    setChats((current) => ({
      ...current,
      [meetingId]: [...previous, userMessage],
    }));
    try {
      const history: ChatTurn[] = previous
        .slice(-6)
        .map((m) => ({ role: m.role, content: m.text.slice(0, 2000) }));
      const answer = await api<Answer>("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meetingId, question: question.trim(), history }),
      });
      const message: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        text: answer.answer,
        answer,
      };
      setChats((current) => ({
        ...current,
        [meetingId]: [...(current[meetingId] || []), message],
      }));
    } catch (e) {
      setError(problem(e));
      setDraft(question);
      setChats((current) => ({
        ...current,
        [meetingId]: (current[meetingId] || []).filter(
          (m) => m.id !== userMessage.id,
        ),
      }));
    } finally {
      setAsking(false);
      busyRef.current = false;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(draft);
  }

  return (
    <div className="workspace">
      <a href="#conversation" className="skip-link">
        Skip to conversation
      </a>
      <aside className="sidebar" aria-label="Meetings">
        <div className="brand">
          <LoopMark />
          <div>
            <strong>In The Loop</strong>
          </div>
        </div>
        <button
          className="primary-button upload-button"
          onClick={() => setShowUpload((value) => !value)}
          disabled={busy}
          aria-expanded={showUpload}
        >
          Upload transcript
          <span className="button-plus" aria-hidden="true">
            +
          </span>
        </button>
        <div className="meeting-list-heading">
          <h2>Meeting index</h2>
          <span>{meetings.length}</span>
        </div>
        <nav className="meeting-list" aria-label="Select a meeting">
          {loading ? (
            <p className="sidebar-placeholder" role="status">
              Loading meetings…
            </p>
          ) : meetings.length ? (
            meetings.map((meeting, index) => (
              <button
                key={meeting.id}
                className={`meeting-button ${meeting.id === selectedId ? "selected" : ""}`}
                aria-pressed={meeting.id === selectedId}
                disabled={busy}
                onClick={() => {
                  setSelectedId(meeting.id);
                  setDraft("");
                  setError(null);
                  setNotice("");
                }}
              >
                <span className="meeting-glyph" aria-hidden="true">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span>
                  <strong>{meeting.title}</strong>
                  <small>
                    {meeting.meeting_date || "Date not provided"} ·{" "}
                    {meeting.turn_count}{" "}
                    {meeting.turn_count === 1 ? "entry" : "entries"}
                  </small>
                </span>
              </button>
            ))
          ) : (
            <p className="sidebar-placeholder">
              Your uploaded meetings
              <br />
              will appear here.
            </p>
          )}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="text-button"
            onClick={() => {
              setLoading(true);
              setError(null);
              void loadMeetings();
            }}
            disabled={loading || busy}
          >
            Refresh meetings
          </button>
        </div>
      </aside>

      <main className="main-area" id="conversation">
        <header className="workspace-header">
          <div>
            <h1>{selected ? selected.title : "Your meeting workspace"}</h1>
            {selected ? (
              <p>
                {selected.meeting_date || "Date not provided"}
                <span>•</span>
                {selected.turn_count} transcript{" "}
                {selected.turn_count === 1 ? "entry" : "entries"}
              </p>
            ) : null}
          </div>
        </header>

        <div className="feedback-area" aria-live="polite">
          {error ? (
            <div className="error-banner" role="alert">
              <div>
                <strong>We couldn’t complete that request.</strong>
                <p>{error.message}</p>
                {error.requestId ? (
                  <small>Reference: {error.requestId}</small>
                ) : null}
              </div>
              <button onClick={() => setError(null)} aria-label="Dismiss error">
                ×
              </button>
            </div>
          ) : null}
          {notice ? (
            <div className="success-banner" role="status">
              ✓ {notice}
            </div>
          ) : null}
        </div>

        {showUpload ? (
          <section className="upload-panel" aria-labelledby="upload-title">
            <div className="upload-panel-heading">
              <div>
                <h2 id="upload-title">Add a transcript</h2>
                <p>Upload or paste plain text, up to 100 KiB.</p>
              </div>
              <button
                className="close-button"
                onClick={() => setShowUpload(false)}
                aria-label="Close upload panel"
                disabled={uploading}
              >
                ×
              </button>
            </div>
            <div className="input-mode" aria-label="Transcript input method">
              <button
                type="button"
                aria-pressed={inputMode === "file"}
                disabled={busy}
                onClick={() => setInputMode("file")}
              >
                Upload file
              </button>
              <button
                type="button"
                aria-pressed={inputMode === "paste"}
                disabled={busy}
                onClick={() => setInputMode("paste")}
              >
                Paste text
              </button>
            </div>
            {inputMode === "file" ? (
              <>
                <label className="file-label" htmlFor="transcript-file">
                  <UploadIcon />
                  <span>
                    {uploading
                      ? "Parsing and indexing your meeting…"
                      : "Choose a transcript"}
                  </span>
                </label>
                <input
                  ref={fileInput}
                  id="transcript-file"
                  type="file"
                  accept=".txt,text/plain"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void upload(file);
                  }}
                />
              </>
            ) : (
              <form
                className="paste-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void upload(
                    new File(
                      [pastedText],
                      `${pasteTitle.trim() || "Pasted meeting"}.txt`,
                      { type: "text/plain" },
                    ),
                  );
                }}
              >
                <label htmlFor="paste-title">Meeting title (optional)</label>
                <input
                  id="paste-title"
                  value={pasteTitle}
                  maxLength={120}
                  disabled={busy}
                  placeholder="e.g. Product launch planning"
                  onChange={(event) => setPasteTitle(event.target.value)}
                />
                <label htmlFor="paste-transcript">Transcript text</label>
                <textarea
                  id="paste-transcript"
                  value={pastedText}
                  maxLength={102400}
                  rows={7}
                  disabled={busy}
                  placeholder="Paste your transcript here. Speaker labels and timestamps are optional."
                  onChange={(event) => setPastedText(event.target.value)}
                />
                <button
                  className="primary-button"
                  type="submit"
                  disabled={busy || !pastedText.trim()}
                >
                  {uploading ? "Indexing transcript…" : "Add transcript"}
                </button>
              </form>
            )}
            <details className="format-help">
              <summary>Supported text layouts</summary>
              <pre>
                {
                  "Meeting Title: Launch planning\nDate: October 1, 2026\n\n[09:00] Sarah:\nLet's confirm the scope.\n\nMichael: I will send the report."
                }
              </pre>
              <p>
                Speaker labels can appear with or without timestamps, with
                dialogue on the same or following lines. Plain paragraphs also
                work. Recognized speakers and timestamps are preserved; missing
                or unrecognized metadata stays unknown. No reformatting
                required.
              </p>
              <a href="/samples/launch-planning.txt" download>
                Download a synthetic example ↗
              </a>
            </details>
          </section>
        ) : null}

        <div className="conversation-scroll">
          {!messages.length ? (
            <section className="welcome">
              <h2>
                {selected
                  ? "What would you\nlike to know?"
                  : "Add your first meeting."}
              </h2>
              {!selected ? (
                <p>Upload a transcript or choose a sample to get started.</p>
              ) : null}
              {selected ? (
                <div className="question-grid">
                  {questions.map((question, i) => (
                    <button
                      key={question}
                      disabled={busy}
                      onClick={() => void ask(question)}
                    >
                      <span className="question-number">0{i + 1}</span>
                      <span>{question}</span>
                      <span aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="sample-section">
                  <div className="sample-heading">
                    <span className="eyebrow">Sample meetings</span>
                  </div>
                  <button
                    className="sample-card"
                    disabled={loading || busy}
                    onClick={() => void importSample("launch-planning")}
                  >
                    <span className="sample-icon" aria-hidden="true">
                      ↗
                    </span>
                    <span>
                      <strong>Atlas launch planning</strong>
                      <small>
                        Release decisions, owners, and an unresolved launch date
                      </small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    className="sample-card"
                    disabled={loading || busy}
                    onClick={() => void importSample("incident-review")}
                  >
                    <span className="sample-icon" aria-hidden="true">
                      ≡
                    </span>
                    <span>
                      <strong>Checkout incident review</strong>
                      <small>A corrected diagnosis and the next steps</small>
                    </span>
                    <span aria-hidden="true">→</span>
                  </button>
                </div>
              )}
            </section>
          ) : (
            <div
              className="message-list"
              role="log"
              aria-label="Meeting conversation"
            >
              {messages.map((message) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">
                    {message.role === "assistant" ? (
                      <LoopMark small />
                    ) : (
                      <span aria-hidden="true">Y</span>
                    )}
                  </div>
                  <div className="message-body">
                    <div className="message-label">
                      {message.role === "assistant" ? "In The Loop" : "You"}
                      {message.answer?.status === "insufficient_evidence" ? (
                        <span className="uncertain-label">
                          Insufficient evidence
                        </span>
                      ) : null}
                    </div>
                    <p className="message-text">
                      {message.role === "assistant"
                        ? message.text.replace(
                            /[ \t]*\[E\d+(?:[ \t]*,[ \t]*E\d+)*\]/g,
                            "",
                          )
                        : message.text}
                    </p>
                    {message.answer ? (
                      <Sources sources={message.answer.sources} />
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          )}
          {asking || uploading ? (
            <div className="working-status" role="status">
              <span className="spinner" aria-hidden="true" />
              {uploading ? "Adding transcript…" : "Finding an answer…"}
            </div>
          ) : null}
          <div ref={bottom} />
        </div>

        <div className="composer-area">
          <form className="composer" onSubmit={submit}>
            <label htmlFor="question" className="sr-only">
              Ask a question about the selected meeting
            </label>
            <textarea
              id="question"
              rows={2}
              maxLength={2000}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              disabled={!selected || busy}
              placeholder={
                selected
                  ? "Ask about this meeting…"
                  : "Select or upload a meeting to begin…"
              }
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  void ask(draft);
                }
              }}
            />
            <div className="composer-footer">
              <button
                type="submit"
                disabled={!selected || busy || !draft.trim()}
                aria-label="Send question"
              >
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M10 15V5m0 0L6 9m4-4 4 4"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
          </form>
        </div>
      </main>
    </div>
  );
}
