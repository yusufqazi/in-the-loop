"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Answer, ChatTurn, Meeting, MeetingTranscript } from "@/lib/types";
import Sources from "./sources";
import TranscriptViewer from "./transcript-viewer";
import AudioInput from "./audio-input";
import SpeakerEditor from "./speaker-editor";
import { validateAudioFile } from "@/lib/audio";
import { renameTranscriptSpeaker, type AudioTranscript, type DetectedSpeaker } from "@/lib/audio-transcript";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { authLinkDestination, isExistingAccount } from "@/lib/auth-links";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  answer?: Answer;
};
type Problem = { message: string; requestId?: string };
type TranscriptTarget = { title: string } & (
  { kind: "meeting"; id: string } | { kind: "sample"; name: string }
);
const questions = [
  "What were the main decisions?",
  "What action items were assigned?",
  "Was a deadline agreed upon?",
  "What remains unresolved?",
];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    const session = await supabaseBrowser().auth.getSession();
    if (session.data.session?.access_token)
      headers.set(
        "Authorization",
        `Bearer ${session.data.session.access_token}`,
      );
  }
  const response = await fetch(url, { ...options, headers, cache: "no-store" });
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
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameError, setRenameError] = useState("");
  const [transcriptTarget, setTranscriptTarget] = useState<TranscriptTarget | null>(null);
  const [transcriptContent, setTranscriptContent] = useState({ text: "", loading: true, error: "" });
  const [showUpload, setShowUpload] = useState(false);
  const [inputMode, setInputMode] = useState<"file" | "paste" | "audio">("file");
  const [audioRecording, setAudioRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [pastedText, setPastedText] = useState("");
  const [detectedSpeakers, setDetectedSpeakers] = useState<DetectedSpeaker[]>([]);
  const [pasteTitle, setPasteTitle] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<Problem | null>(null);
  const [notice, setNotice] = useState("");
  const [chats, setChats] = useState<Record<string, Message[]>>({});
  const [accountEmail, setAccountEmail] = useState<string | null>(null);
  const [accountReady, setAccountReady] = useState(
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
  const [showSignIn, setShowSignIn] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up" | "reset">("sign-in");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInSent, setSignInSent] = useState(false);
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false);
  const editingRef = useRef<string | null>(null);
  const titleInput = useRef<HTMLTextAreaElement>(null);
  const selected = meetings.find((m) => m.id === selectedId);
  const messages = selectedId ? chats[selectedId] || [] : [];
  const chatsRef = useRef(chats);
  const busy = uploading || asking || deletingId !== null || renamingId !== null || audioRecording || transcribing;
  useEffect(() => {
    chatsRef.current = chats;
  }, [chats]);
  useEffect(() => {
    titleInput.current?.focus();
    titleInput.current?.select();
  }, [editingId]);
  useEffect(() => {
    const input = titleInput.current;
    if (input) {
      input.style.height = "0px";
      input.style.height = `${input.scrollHeight}px`;
    }
  }, [editingId, renameTitle]);

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
    function redirectEmailLink() {
      const destination = authLinkDestination(window.location.href);
      if (!destination) return false;
      window.location.replace(`${destination}${window.location.search}${window.location.hash}`);
      return true;
    }
    if (redirectEmailLink()) return;
    window.addEventListener("hashchange", redirectEmailLink);
    if (new URLSearchParams(window.location.search).get("auth") === "reset") {
      queueMicrotask(() => {
        setAuthMode("reset");
        setShowSignIn(true);
      });
    }
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
    return () => {
      controller.abort();
      window.removeEventListener("hashchange", redirectEmailLink);
    };
  }, []);
  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    ) {
      return;
    }
    const supabase = supabaseBrowser();
    let active = true;
    const subscription = supabase.auth.onAuthStateChange((event, session) => {
      if (!active) return;
      if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
        editingRef.current = null;
        setEditingId(null);
      }
      if ((event === "SIGNED_IN" || event === "INITIAL_SESSION") && session) {
        setAccountEmail(session.user.email || null);
        setAccountReady(false);
        queueMicrotask(async () => {
          try {
            await api("/api/account/claim", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chats: Object.fromEntries(
                  Object.entries(chatsRef.current).map(([id, messages]) => [
                    id,
                    messages.map(({ role, text, answer }) => ({
                      role,
                      content: text,
                      answer: answer || null,
                    })),
                  ]),
                ),
              }),
            });
            const data = await api<{ meetings: Meeting[] }>("/api/meetings");
            setMeetings(data.meetings);
            setSelectedId((id) =>
              data.meetings.some((meeting) => meeting.id === id)
                ? id
                : data.meetings[0]?.id || null,
            );
            setAccountEmail(session.user.email || null);
            setAccountReady(true);
            setShowSignIn(false);
            setSignInSent(false);
            setSignInPassword("");
            setNotice("Your workspace is saved to your account.");
          } catch (e) {
            setError(problem(e));
            setAccountReady(true);
          }
        });
      } else if (event === "SIGNED_OUT") {
        setAccountEmail(null);
        setAccountReady(false);
        setChats({});
        setTranscriptTarget(null);
        setTranscriptContent({ text: "", loading: true, error: "" });
        void loadMeetings();
      } else if (event === "INITIAL_SESSION") {
        setAccountReady(true);
      }
    });
    void supabase.auth.getSession().then(({ data }) => {
      if (active) setAccountEmail(data.session?.user.email || null);
    });
    return () => {
      active = false;
      subscription.data.subscription.unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!accountEmail || !accountReady || !selectedId) return;
    let active = true;
    void api<{
      messages: {
        id: string;
        role: "user" | "assistant";
        content: string;
        answer: Answer | null;
      }[];
    }>(`/api/chat?meetingId=${selectedId}`)
      .then(({ messages }) => {
        if (active)
          setChats((current) => ({
            ...current,
            [selectedId]: messages.map((message) => ({
              id: message.id,
              role: message.role,
              text: message.content,
              answer: message.answer || undefined,
            })),
          }));
      })
      .catch((e) => {
        if (active) setError(problem(e));
      });
    return () => { active = false; };
  }, [accountEmail, accountReady, selectedId]);
  useEffect(() => {
    if (!showUpload && (messages.length || asking))
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, asking, showUpload]);

  useEffect(() => {
    if (!transcriptTarget) return;
    const controller = new AbortController();
    async function loadTranscript(target: TranscriptTarget) {
      try {
        let text: string;
        if (target.kind === "meeting") {
          const { transcript } = await api<{ transcript: MeetingTranscript }>(`/api/meetings/${target.id}`, { signal: controller.signal });
          text = transcript.raw_transcript;
        } else {
          const response = await fetch(`/samples/${target.name}.txt`, { signal: controller.signal });
          if (!response.ok) throw new Error("The sample transcript could not be loaded.");
          text = await response.text();
        }
        if (!controller.signal.aborted) setTranscriptContent({ text, loading: false, error: "" });
      } catch (e) {
        if (!controller.signal.aborted) setTranscriptContent({ text: "", loading: false, error: problem(e).message });
      }
    }
    void loadTranscript(transcriptTarget);
    return () => controller.abort();
  }, [transcriptTarget]);

  function viewTranscript(target: TranscriptTarget) {
    setTranscriptContent({ text: "", loading: true, error: "" });
    setTranscriptTarget(target);
  }

  async function removeMeeting(meeting: Meeting) {
    if (busyRef.current || audioRecording || !window.confirm(`Delete “${meeting.title}” and its chat? This cannot be undone.`)) return;
    busyRef.current = true;
    setDeletingId(meeting.id);
    setError(null);
    setNotice("");
    try {
      await api(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      const remaining = meetings.filter((item) => item.id !== meeting.id);
      setMeetings(remaining);
      setSelectedId((id) => id === meeting.id ? remaining[0]?.id || null : id);
      setChats((current) => {
        const next = { ...current };
        delete next[meeting.id];
        return next;
      });
      if (selectedId === meeting.id) setDraft("");
      setNotice(`“${meeting.title}” deleted.`);
    } catch (e) {
      setError(problem(e));
    } finally {
      setDeletingId(null);
      busyRef.current = false;
    }
  }

  function startRename(meeting: Meeting) {
    if (busyRef.current || audioRecording) return;
    editingRef.current = meeting.id;
    setRenameTitle(meeting.title);
    setRenameError("");
    setEditingId(meeting.id);
  }

  function cancelRename() {
    editingRef.current = null;
    setEditingId(null);
  }

  async function renameMeetingIndex(meeting: Meeting) {
    if (editingRef.current !== meeting.id || busyRef.current || audioRecording) return;
    const title = renameTitle.trim();
    if (!title || title.length > 120 || /[\u0000-\u001f\u007f]/.test(renameTitle)) {
      setRenameError("Enter a title of 1–120 characters on one line.");
      return;
    }
    if (title === meeting.title) {
      cancelRename();
      return;
    }
    busyRef.current = true;
    setRenamingId(meeting.id);
    setRenameError("");
    setError(null);
    setNotice("");
    try {
      const { meeting: updated } = await api<{ meeting: Meeting }>(`/api/meetings/${meeting.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      setMeetings((current) => current.map((item) => item.id === updated.id ? updated : item));
      if (editingRef.current === meeting.id) cancelRename();
    } catch (e) {
      if (editingRef.current === meeting.id) setRenameError(problem(e).message);
    } finally {
      setRenamingId(null);
      busyRef.current = false;
    }
  }

  async function upload(file: File) {
    if (busyRef.current || audioRecording) return;
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
      setDetectedSpeakers([]);
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

  async function transcribe(file: File) {
    if (busyRef.current || audioRecording) return;
    validateAudioFile(file);
    busyRef.current = true;
    setTranscribing(true);
    setError(null);
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const { text, speakers } = await api<AudioTranscript>("/api/transcribe", {
        method: "POST",
        body: form,
      });
      setPastedText(text);
      setDetectedSpeakers(speakers);
      setPasteTitle(file.name.replace(/\.[^.]+$/, "").slice(0, 120));
      setInputMode("paste");
      setNotice("Transcript ready. Review and edit it, then add the meeting.");
    } finally {
      setTranscribing(false);
      busyRef.current = false;
    }
  }
  function renameSpeaker(id: string, name: string) {
    const updated = renameTranscriptSpeaker(pastedText, detectedSpeakers, id, name);
    setPastedText(updated.text);
    setDetectedSpeakers(updated.speakers);
  }
  async function importSample(name: string) {
    if (busyRef.current || audioRecording) return;
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
    if (!selected || busyRef.current || audioRecording || !question.trim()) return;
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
  async function requestSignIn(event: FormEvent) {
    event.preventDefault();
    setSigningIn(true);
    setError(null);
    setAuthError("");
    try {
      const auth = supabaseBrowser().auth;
      if (authMode === "reset") {
        const { error } = await auth.resetPasswordForEmail(signInEmail.trim(), {
          redirectTo: `${window.location.origin}/auth/reset-password`,
        });
        if (error) throw error;
        setSignInSent(true);
        setSignInPassword("");
        return;
      }
      const credentials = {
        email: signInEmail.trim(),
        password: signInPassword,
      };
      const result = authMode === "sign-up"
        ? await auth.signUp({
            ...credentials,
            options: { emailRedirectTo: `${window.location.origin}/auth/confirm` },
          })
        : await auth.signInWithPassword(credentials);
      if (authMode === "sign-up" && isExistingAccount(result)) {
        setAuthMode("sign-in");
        setSignInPassword("");
        throw new Error("An account with this email already exists. Please sign in.");
      }
      const { error } = result;
      if (error) throw error;
      if (authMode === "sign-up" && !result.data.session) {
        setSignInSent(true);
        setSignInPassword("");
      } else {
        setShowSignIn(false);
      }
    } catch (e) { setAuthError(problem(e).message); }
    finally { setSigningIn(false); }
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
          disabled={busy || loading}
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
              <div key={meeting.id} className={`meeting-row ${meeting.id === selectedId ? "selected" : ""}`}>
              {editingId === meeting.id ? (
                <div className={`meeting-button ${meeting.id === selectedId ? "selected" : ""}`}>
                  <span className="meeting-glyph" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="meeting-title-edit-content">
                    <textarea
                      ref={titleInput}
                      className="meeting-title-edit"
                      aria-label="Meeting title"
                      aria-describedby={`meeting-title-help${renameError ? " meeting-title-error" : ""}`}
                      aria-invalid={!!renameError}
                      rows={1}
                      maxLength={120}
                      value={renameTitle}
                      readOnly={busy}
                      onChange={(event) => {
                        setRenameTitle(event.target.value);
                        setRenameError("");
                      }}
                      onBlur={() => void renameMeetingIndex(meeting)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || renamingId === meeting.id) return;
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void renameMeetingIndex(meeting);
                        } else if (event.key === "Escape") {
                          event.preventDefault();
                          cancelRename();
                        }
                      }}
                    />
                    <span id="meeting-title-help" className="sr-only">Enter or click away to save. Escape to cancel.</span>
                    {renameError ? <span id="meeting-title-error" className="meeting-title-error" role="alert">{renameError}</span> : null}
                    <small>
                      {meeting.meeting_date || "Date not provided"} ·{" "}
                      {meeting.turn_count}{" "}
                      {meeting.turn_count === 1 ? "entry" : "entries"}
                    </small>
                  </span>
                </div>
              ) : (
              <button
                className={`meeting-button ${meeting.id === selectedId ? "selected" : ""}`}
                aria-pressed={meeting.id === selectedId}
                disabled={busy}
                onClick={() => {
                  setSelectedId(meeting.id);
                  setShowUpload(false);
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
              )}
              <div className="meeting-actions">
              <button type="button" className="meeting-rename" disabled={busy} onClick={() => startRename(meeting)} aria-label={`Rename ${meeting.title}`} title="Rename meeting">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 12-1 5 5-1L17 7l-4-4-9 9Zm7-7 4 4M4 12l4 4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" className="meeting-delete" disabled={busy} onClick={() => void removeMeeting(meeting)} aria-label={`Delete ${meeting.title}`} title="Delete meeting">
                <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M7 5V3h6v2M5 5l1 12h8l1-12M8 8v6m4-6v6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              </div>
              </div>
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

      <main className={`main-area${showUpload ? " upload-open" : ""}`} id="conversation">
        <header className="workspace-header">
          <div>
            {!showUpload ? <>
            <h1>{selected ? selected.title : "Your meeting workspace"}</h1>
            {selected ? (
              <p>
                {selected.meeting_date || "Date not provided"}
                <span>•</span>
                {selected.turn_count} transcript{" "}
                {selected.turn_count === 1 ? "entry" : "entries"}
              </p>
            ) : null}
            </> : null}
          </div>
          <div className="account-control">
            {selected && !showUpload ? <button className="account-button" type="button" disabled={busy} onClick={() => viewTranscript({ kind: "meeting", id: selected.id, title: selected.title })}>View transcript</button> : null}
            {accountEmail ? (
              <>
                <span>{accountEmail}</span>
                <button className="account-button" disabled={busy} onClick={() => void supabaseBrowser().auth.signOut()}>Sign out</button>
              </>
            ) : (
              <button className="account-button" disabled={busy} onClick={() => { setShowSignIn((value) => !value); setSignInSent(false); setAuthError(""); }}>
                Sign in to save
              </button>
            )}
            {showSignIn && !accountEmail ? (
              <form className="sign-in-panel" onSubmit={requestSignIn}>
                {authError ? <p className="auth-error" role="alert">{authError}</p> : null}
                {signInSent ? (
                  <>
                    <p role="status">{authMode === "reset"
                      ? "If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder."
                      : "Check your email to verify your address. Open the verification link in this browser to save this session."}</p>
                    <button className="auth-text-button" type="button" onClick={() => { setSignInSent(false); setAuthMode("sign-in"); setAuthError(""); }}>Back to sign in</button>
                  </>
                ) : (
                  <>
                    <div className="auth-mode" aria-label="Account action">
                      <button type="button" disabled={signingIn} aria-pressed={authMode === "sign-in"} onClick={() => { setAuthMode("sign-in"); setSignInPassword(""); setAuthError(""); }}>Sign in</button>
                      <button type="button" disabled={signingIn} aria-pressed={authMode === "sign-up"} onClick={() => { setAuthMode("sign-up"); setSignInPassword(""); setAuthError(""); }}>Create account</button>
                    </div>
                    {authMode === "reset" ? <p>Enter your email to reset your password.</p> : null}
                    <label htmlFor="sign-in-email">Email</label>
                    <input id="sign-in-email" type="email" autoComplete="email" required disabled={signingIn} value={signInEmail} onChange={(event) => setSignInEmail(event.target.value)} placeholder="you@example.com" />
                    {authMode !== "reset" ? <>
                    <label htmlFor="sign-in-password">Password</label>
                    <input id="sign-in-password" type="password" autoComplete={authMode === "sign-in" ? "current-password" : "new-password"} minLength={authMode === "sign-up" ? 8 : 1} required disabled={signingIn} value={signInPassword} onChange={(event) => setSignInPassword(event.target.value)} />
                    </> : null}
                    <button className="primary-button" type="submit" disabled={signingIn}>{signingIn ? "Please wait…" : authMode === "reset" ? "Send reset link" : authMode === "sign-up" ? "Create account" : "Sign in"}</button>
                    {authMode === "sign-in" ? <button className="auth-text-button" type="button" disabled={signingIn} onClick={() => { setAuthMode("reset"); setSignInPassword(""); setError(null); setAuthError(""); }}>Forgot password?</button> : null}
                  </>
                )}
              </form>
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
                <p>{inputMode === "audio" ? "Upload audio or record a short clip, then review the transcript." : "Upload or paste plain text, up to 100 KiB."}</p>
              </div>
              <button
                className="close-button"
                onClick={() => setShowUpload(false)}
                aria-label="Close upload panel"
                disabled={busy}
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
              <button
                type="button"
                aria-pressed={inputMode === "audio"}
                disabled={busy}
                onClick={() => setInputMode("audio")}
              >
                Audio
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
            ) : inputMode === "audio" ? (
              <AudioInput disabled={busy} onTranscribe={transcribe} onRecordingChange={setAudioRecording} />
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
                <SpeakerEditor speakers={detectedSpeakers} disabled={busy} onRename={renameSpeaker} />
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
            {inputMode !== "audio" ? <details className="format-help">
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
            </details> : null}
          </section>
        ) : null}

        {!showUpload ? <>
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
                  <div className="sample-row">
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
                  <button className="text-button sample-preview" type="button" onClick={() => viewTranscript({ kind: "sample", name: "launch-planning", title: "Atlas launch planning" })} aria-label="Preview Atlas launch planning transcript">View transcript</button>
                  </div>
                  <div className="sample-row">
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
                  <button className="text-button sample-preview" type="button" onClick={() => viewTranscript({ kind: "sample", name: "incident-review", title: "Checkout incident review" })} aria-label="Preview Checkout incident review transcript">View transcript</button>
                  </div>
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
        </> : null}
      </main>
      {transcriptTarget ? <TranscriptViewer title={transcriptTarget.title} {...transcriptContent} onClose={() => setTranscriptTarget(null)} /> : null}
    </div>
  );
}
