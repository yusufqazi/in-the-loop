import type { EmailOtpType, SupabaseClient } from "@supabase/supabase-js";

const emailTypes: EmailOtpType[] = ["email", "signup", "invite", "recovery", "email_change", "magiclink"];

export function authLinkDestination(url: string) {
  const parsed = new URL(url);
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  const type = parsed.searchParams.get("type") || fragment.get("type");
  if (type === "recovery") return "/auth/reset-password";
  if (parsed.searchParams.has("code") || parsed.searchParams.has("token_hash") || fragment.has("access_token")) {
    return "/auth/confirm";
  }
  return null;
}

export async function completeEmailLink(
  auth: SupabaseClient["auth"],
  url: string,
  allowExistingSession = false,
) {
  const parsed = new URL(url);
  const query = parsed.searchParams;
  const fragment = new URLSearchParams(parsed.hash.slice(1));
  if (query.has("error") || query.has("error_code") || fragment.has("error") || fragment.has("error_code")) {
    throw new Error("This email link is invalid or expired. Request a new one.");
  }
  const code = query.get("code");
  const tokenHash = query.get("token_hash");
  const type = query.get("type") || fragment.get("type");
  let recovery = type === "recovery";
  if (code) {
    const { data, error } = await auth.exchangeCodeForSession(code);
    if (error || !data.session) throw new Error("This email link could not be verified. Request a new one and open it in the browser where you requested it.");
    recovery = ("redirectType" in data && data.redirectType === "recovery") || recovery;
  } else if (tokenHash && type && emailTypes.includes(type as EmailOtpType)) {
    const { data, error } = await auth.verifyOtp({ token_hash: tokenHash, type: type as EmailOtpType });
    if (error || !data.session) throw new Error("This email link is invalid or expired. Request a new one.");
  } else if (fragment.get("access_token") && fragment.get("refresh_token")) {
    const { data, error } = await auth.setSession({
      access_token: fragment.get("access_token")!,
      refresh_token: fragment.get("refresh_token")!,
    });
    if (error || !data.session) throw new Error("This email link is invalid or expired. Request a new one.");
  } else if (allowExistingSession && !tokenHash && !fragment.has("access_token")) {
    const { data, error } = await auth.getSession();
    if (error || !data.session) throw new Error("Open your password reset email first, or request a new link.");
  } else {
    throw new Error("This email link is missing its verification token. Request a new link.");
  }
  return { recovery };
}

export function isExistingAccount(result: {
  data: { user: { identities?: unknown[] } | null };
  error: { code?: string } | null;
}) {
  return result.error?.code === "user_already_exists" ||
    result.error?.code === "email_exists" ||
    (!result.error && result.data.user?.identities?.length === 0);
}
