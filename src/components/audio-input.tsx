"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AUDIO_ACCEPT,
  MAX_AUDIO_BYTES,
  MAX_RECORDING_SECONDS,
  validateAudioFile,
} from "@/lib/audio";

type Props = {
  disabled: boolean;
  onTranscribe: (file: File) => Promise<void>;
  onRecordingChange: (active: boolean) => void;
};

export default function AudioInput({ disabled, onTranscribe, onRecordingChange }: Props) {
  const inputId = useId();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const mounted = useRef(true);
  const operation = useRef(0);
  const phase = useRef<"idle" | "starting" | "recording" | "stopping">("idle");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const interval = useRef<number | null>(null);
  const timeout = useRef<number | null>(null);
  const previewUrl = useRef("");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current += 1;
      if (interval.current !== null) window.clearInterval(interval.current);
      if (timeout.current !== null) window.clearTimeout(timeout.current);
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      if (phase.current !== "idle") onRecordingChange(false);
      phase.current = "idle";
    };
  }, [onRecordingChange]);

  function chooseFile(next: File) {
    validateAudioFile(next);
    clearFile();
    previewUrl.current = URL.createObjectURL(next);
    setFile(next);
    setPreview(previewUrl.current);
    setError("");
  }

  function clearFile() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setFile(null);
    setPreview("");
  }

  function stopRecording() {
    if (phase.current === "starting") {
      operation.current += 1;
      phase.current = "idle";
      setStarting(false);
      onRecordingChange(false);
      return;
    }
    if (recorder.current?.state === "recording") {
      phase.current = "stopping";
      setStopping(true);
      recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
    }
  }

  async function startRecording() {
    if (disabled || transcribing || phase.current !== "idle") return;
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Microphone recording requires HTTPS or localhost and a browser with microphone support. You can upload an audio file instead.");
      return;
    }
    if (typeof MediaRecorder === "undefined") {
      setError("This browser cannot record audio. Upload an audio file instead.");
      return;
    }

    const currentOperation = ++operation.current;
    phase.current = "starting";
    setStarting(true);
    onRecordingChange(true);
    try {
      const microphone = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || currentOperation !== operation.current) {
        microphone.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = microphone;
      const mimeType = [
        "audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const capture = new MediaRecorder(microphone, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: 64_000,
      });
      recorder.current = capture;
      clearFile();
      const chunks: Blob[] = [];
      let bytes = 0;
      let failed = false;
      let finished = false;
      const isCurrent = () => mounted.current && currentOperation === operation.current;

      capture.ondataavailable = (event) => {
        if (!isCurrent() || failed || !event.data.size) return;
        bytes += event.data.size;
        if (bytes > MAX_AUDIO_BYTES) {
          failed = true;
          setError("The recording exceeded 4 MiB. Please record a shorter clip.");
          stopRecording();
          return;
        }
        chunks.push(event.data);
      };
      capture.onerror = () => {
        failed = true;
        if (isCurrent()) setError("Audio recording failed. Check your microphone and try again.");
        stopRecording();
        finish();
      };
      function finish() {
        if (finished) return;
        finished = true;
        microphone.getTracks().forEach((track) => track.stop());
        if (!isCurrent()) return;
        if (interval.current !== null) window.clearInterval(interval.current);
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        interval.current = null;
        timeout.current = null;
        recorder.current = null;
        stream.current = null;
        phase.current = "idle";
        setStarting(false);
        setRecording(false);
        setStopping(false);
        onRecordingChange(false);
        if (failed) return;
        if (!bytes) {
          setError("No audio was recorded. Check your microphone and try again.");
          return;
        }
        const type = capture.mimeType || mimeType || "audio/webm";
        const extension = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        try {
          chooseFile(new File(chunks, `recorded-meeting.${extension}`, { type }));
        } catch (e) {
          setError(e instanceof Error ? e.message : "The recording could not be used.");
        }
      }
      capture.onstop = finish;
      capture.start(1000);
      phase.current = "recording";
      setStarting(false);
      setRecording(true);
      setElapsed(0);
      const startedAt = Date.now();
      interval.current = window.setInterval(() => {
        if (isCurrent()) setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
      timeout.current = window.setTimeout(stopRecording, MAX_RECORDING_SECONDS * 1000);
    } catch (e) {
      if (!mounted.current || currentOperation !== operation.current) return;
      stream.current?.getTracks().forEach((track) => track.stop());
      stream.current = null;
      recorder.current = null;
      phase.current = "idle";
      setStarting(false);
      setRecording(false);
      onRecordingChange(false);
      const name = e instanceof Error ? e.name : "";
      setError(name === "NotAllowedError"
        ? "Microphone permission was denied. Allow microphone access in your browser or upload an audio file."
        : name === "NotFoundError"
          ? "No microphone was found. Connect a microphone or upload an audio file."
          : name === "NotReadableError"
            ? "The microphone is unavailable or in use by another application."
            : "Could not start recording. Check your microphone and try again.");
    }
  }

  async function transcribe() {
    if (!file || disabled || transcribing || phase.current !== "idle") return;
    setTranscribing(true);
    setError("");
    try {
      validateAudioFile(file);
      await onTranscribe(file);
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "Audio transcription failed. Please try again.");
    } finally {
      if (mounted.current) setTranscribing(false);
    }
  }

  const busy = disabled || starting || recording || stopping || transcribing;
  return (
    <div className="audio-input" aria-busy={starting || stopping || transcribing}>
      <label htmlFor={inputId}>Choose an audio file</label>
      <input
        id={inputId}
        type="file"
        accept={AUDIO_ACCEPT}
        disabled={busy}
        onChange={(event) => {
          const next = event.target.files?.[0];
          event.target.value = "";
          if (!next) return;
          try { chooseFile(next); }
          catch (e) {
            clearFile();
            setError(e instanceof Error ? e.message : "The audio file could not be used.");
          }
        }}
      />
      <div className="audio-controls">
        {starting ? (
          <button type="button" className="text-button" onClick={stopRecording}>Cancel microphone request</button>
        ) : recording ? (
          <button type="button" className="text-button" onClick={stopRecording} disabled={stopping}>
            {stopping ? "Stopping…" : "Stop recording"}
          </button>
        ) : (
          <button type="button" className="text-button" disabled={busy} onClick={() => void startRecording()}>Record with microphone</button>
        )}
        <button type="button" className="primary-button" disabled={busy || !file} onClick={() => void transcribe()}>
          {transcribing ? "Transcribing…" : "Transcribe audio"}
        </button>
      </div>
      <div className="audio-status" role="status">
        {starting ? "Waiting for microphone permission…" : recording
          ? `Recording · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")} / 5:00`
          : transcribing ? "Converting audio to text…" : file ? `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MiB` : "Upload up to 4 MiB, or record up to 5 minutes."}
      </div>
      {preview && !starting && !recording ? <audio key={preview} controls src={preview} aria-label="Preview selected audio" preload="metadata" /> : null}
      <p>Audio is sent to OpenAI only when you choose Transcribe audio. Review the text and speaker labels before adding the meeting.</p>
      {error ? <p className="audio-error" role="alert">{error}</p> : null}
    </div>
  );
}
