import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachSessionCookie, requestOwner } from "@/lib/server/owner";

const mocks = vi.hoisted(() => ({ create: vi.fn(), getUser: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.create }));

beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://test.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-public-key");
  mocks.create.mockReturnValue({ auth: { getUser: mocks.getUser } });
  mocks.getUser.mockReset();
});

describe("workspace ownership", () => {
  it("creates an unguessable browser-session cookie without a persistent lifetime", async () => {
    const context = await requestOwner(new Request("https://app.example/api/meetings"));
    expect(context.owner.userId).toBeNull();
    expect(context.owner.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    const response = attachSessionCookie(new Response("{}"), context.setCookie);
    expect(response.headers.get("set-cookie")).toContain("HttpOnly; SameSite=Lax; Secure");
    expect(response.headers.get("set-cookie")).not.toContain("Max-Age");
  });

  it("reuses only a valid session identifier from the same browser cookie", async () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const context = await requestOwner(new Request("http://localhost/api/meetings", {
      headers: { cookie: `theme=paper; itl_session=${id}` },
    }));
    expect(context.owner).toEqual({ userId: null, sessionId: id });
    expect(context.setCookie).toBeUndefined();
    const invalid = await requestOwner(new Request("http://localhost/api/meetings", {
      headers: { cookie: "itl_session=not-a-uuid" },
    }));
    expect(invalid.owner.sessionId).not.toBe("not-a-uuid");
  });

  it("validates signed-in access tokens with Supabase and keeps the browser session available for claiming", async () => {
    const userId = "550e8400-e29b-41d4-a716-446655440001";
    const sessionId = "550e8400-e29b-41d4-a716-446655440000";
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
    const context = await requestOwner(new Request("https://app.example/api/meetings", {
      headers: { authorization: "Bearer valid-access-token", cookie: `itl_session=${sessionId}` },
    }));
    expect(mocks.getUser).toHaveBeenCalledWith("valid-access-token");
    expect(context.owner).toEqual({ userId, sessionId: null, claimSessionId: sessionId });
  });
});
