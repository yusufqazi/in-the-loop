import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authLinkDestination, completeEmailLink, isExistingAccount } from "@/lib/auth-links";

const session = { user: { id: "synthetic-user" } };
const auth = {
  exchangeCodeForSession: vi.fn(),
  verifyOtp: vi.fn(),
  setSession: vi.fn(),
  getSession: vi.fn(),
};
const client = auth as unknown as SupabaseClient["auth"];

beforeEach(() => {
  for (const method of Object.values(auth)) method.mockReset();
});

describe("Supabase email links", () => {
  it("routes dashboard recovery fragments to the password form instead of normal sign-in", () => {
    expect(authLinkDestination("https://app.example/#access_token=test&refresh_token=test&type=recovery"))
      .toBe("/auth/reset-password");
    expect(authLinkDestination("https://app.example/?token_hash=test&type=recovery"))
      .toBe("/auth/reset-password");
    expect(authLinkDestination("https://app.example/#access_token=test&refresh_token=test&type=signup"))
      .toBe("/auth/confirm");
    expect(authLinkDestination("https://app.example/?auth=reset")).toBeNull();
  });

  it("establishes the session from an implicit recovery link without losing its recovery intent", async () => {
    auth.setSession.mockResolvedValue({ data: { session }, error: null });
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password#access_token=test-access&refresh_token=test-refresh&type=recovery"))
      .resolves.toEqual({ recovery: true });
    expect(auth.setSession).toHaveBeenCalledWith({ access_token: "test-access", refresh_token: "test-refresh" });
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies token-hash recovery links", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password?token_hash=test&type=recovery"))
      .resolves.toEqual({ recovery: true });
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "test", type: "recovery" });
  });

  it("preserves recovery intent when exchanging a PKCE code", async () => {
    auth.exchangeCodeForSession.mockResolvedValue({ data: { session, redirectType: "recovery" }, error: null });
    await expect(completeEmailLink(client, "https://app.example/auth/confirm?code=test"))
      .resolves.toEqual({ recovery: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledOnce();
  });

  it("rejects expired links before falling back to a previously signed-in account", async () => {
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password#error=access_denied&error_code=otp_expired", true))
      .rejects.toThrow("invalid or expired");
    expect(auth.getSession).not.toHaveBeenCalled();
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: "Expired" } });
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password?token_hash=old&type=recovery", true))
      .rejects.toThrow("invalid or expired");
  });

  it("rejects missing or unsupported tokens and does not claim a link was confirmed", async () => {
    await expect(completeEmailLink(client, "https://app.example/auth/confirm")).rejects.toThrow("missing");
    await expect(completeEmailLink(client, "https://app.example/auth/confirm?token_hash=test&type=unsupported"))
      .rejects.toThrow("missing");
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it("allows a verified session to revisit the reset page but rejects signed-out visitors", async () => {
    auth.getSession.mockResolvedValue({ data: { session }, error: null });
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password", true)).resolves.toEqual({ recovery: false });
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(completeEmailLink(client, "https://app.example/auth/reset-password", true)).rejects.toThrow("reset email");
  });
});

describe("duplicate registration", () => {
  it("recognizes Supabase's existing-account error and obfuscated identity response", () => {
    expect(isExistingAccount({ data: { user: null }, error: { code: "user_already_exists" } })).toBe(true);
    expect(isExistingAccount({ data: { user: { identities: [] } }, error: null })).toBe(true);
  });

  it("does not mislabel new users or unrelated provider failures as an existing account", () => {
    expect(isExistingAccount({ data: { user: { identities: [{}] } }, error: null })).toBe(false);
    expect(isExistingAccount({ data: { user: null }, error: { code: "over_email_send_rate_limit" } })).toBe(false);
    expect(isExistingAccount({ data: { user: null }, error: null })).toBe(false);
  });
});
