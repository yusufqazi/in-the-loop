"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { completeEmailLink } from "@/lib/auth-links";

export default function ResetPassword() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    async function verify() {
      try {
        await completeEmailLink(supabaseBrowser().auth, window.location.href, true);
        window.history.replaceState(null, "", "/auth/reset-password");
        setReady(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not verify your reset link. Request a new one.");
      }
    }
    void verify();
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabaseBrowser().auth.updateUser({ password });
      if (error) throw error;
      setPassword("");
      setConfirmation("");
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your password could not be updated. Please retry.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="auth-confirm">
      <div className="auth-card">
        <p className="eyebrow">In The Loop</p>
        <h1>{saved ? "Password updated." : "Choose a new password"}</h1>
        {error ? <p className="auth-error" role="alert">{error}</p> : null}
        {saved ? (
          <><p>You can use your new password the next time you sign in.</p><Link href="/">Return to your workspace</Link></>
        ) : ready ? (
          <form className="password-form" onSubmit={save}>
            <label htmlFor="new-password">New password</label>
            <input id="new-password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} disabled={saving} />
            <small>At least 8 characters.</small>
            <label htmlFor="confirm-password">Confirm new password</label>
            <input id="confirm-password" type="password" autoComplete="new-password" required minLength={8} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={saving} />
            <button className="primary-button" type="submit" disabled={saving}>{saving ? "Updating…" : "Update password"}</button>
          </form>
        ) : !error ? <p role="status">Checking your reset link…</p> : <Link href="/?auth=reset">Request a new reset link</Link>}
        {!saved ? <Link href="/">Return to In The Loop</Link> : null}
      </div>
    </main>
  );
}
