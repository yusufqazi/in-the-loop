"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { supabaseBrowser } from "@/lib/supabase-browser";
import { completeEmailLink } from "@/lib/auth-links";

export default function ConfirmSignIn() {
  const [message, setMessage] = useState("Confirming your sign-in…");
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    try {
      completeEmailLink(supabaseBrowser().auth, window.location.href)
        .then(({ recovery }) => window.location.replace(recovery ? "/auth/reset-password" : "/"))
        .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "This email link could not be verified. Request a new one."));
    } catch {
      queueMicrotask(() => setMessage("Sign-in is not configured yet. Add the Supabase public auth key."));
    }
  }, []);
  return <main className="auth-confirm"><p>{message}</p><Link href="/">Return to In The Loop</Link></main>;
}
