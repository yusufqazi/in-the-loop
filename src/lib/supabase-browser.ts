"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;
export function supabaseBrowser() {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Add the Supabase URL and anon key to .env.local.");
    // Callback pages consume links explicitly so the SDK cannot exchange a code twice.
    client = createClient(url, key, { auth: { detectSessionInUrl: false } });
  }
  return client;
}
