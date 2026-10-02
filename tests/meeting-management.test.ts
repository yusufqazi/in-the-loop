import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, DELETE, PATCH } from "@/app/api/meetings/[meetingId]/route";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), rename: vi.fn(), touch: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ getMeetingTranscript: mocks.get, deleteMeeting: mocks.delete, renameMeeting: mocks.rename, touchSession: mocks.touch }));
vi.mock("@/lib/server/owner", () => ({
  requestOwner: mocks.owner,
  attachSessionCookie: (response: Response, cookie?: string) => {
    if (cookie) response.headers.set("Set-Cookie", cookie);
    return response;
  },
}));
const id = "550e8400-e29b-41d4-a716-446655440000";
const owner = { userId: null, sessionId: id };
const context = { params: Promise.resolve({ meetingId: id }) };
const meeting = { id, title: "Renamed synthetic", meeting_date: null, created_at: "2026-10-01T00:00:00Z", turn_count: 2, chunk_count: 1, embedding_model: "text-embedding-3-small" };
function request(method: string, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/meetings/${id}`, { method, headers: { origin } });
}
function patchRequest(body: unknown, headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/meetings/${id}`, {
    method: "PATCH",
    headers: { origin: "http://localhost:3000", "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}
beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEMO_ACCESS_MODE", "local");
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.owner.mockResolvedValue({ owner, setCookie: "itl_session=test; HttpOnly; SameSite=Lax" });
  mocks.get.mockResolvedValue({ id, title: "Synthetic", raw_transcript: "[00:01] Sarah: Agreed." });
  mocks.rename.mockResolvedValue(meeting);
});

describe("meeting rename route", () => {
  it("trims and persists a guest meeting title with private headers and the current session", async () => {
    const response = await PATCH(patchRequest({ title: "  Renamed synthetic  " }), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ meeting });
    expect(mocks.rename).toHaveBeenCalledWith(id, "Renamed synthetic", owner);
    expect(mocks.touch).toHaveBeenCalledWith(owner);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.delete).not.toHaveBeenCalled();
  });

  it("uses verified account ownership when renaming a saved meeting", async () => {
    const account = { userId: "verified-user", sessionId: null };
    mocks.owner.mockResolvedValue({ owner: account });
    const response = await PATCH(patchRequest({ title: "Renamed synthetic" }), context);
    expect(response.status).toBe(200);
    expect(mocks.rename).toHaveBeenCalledWith(id, "Renamed synthetic", account);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it.each(["", "   ", "x".repeat(121), "Quarter\nReview", "Quarter\u0000Review", "Quarter\u007fReview", 12, null])("rejects an invalid title %# before mutation", async (title) => {
    const response = await PATCH(patchRequest({ title }), context);
    expect(response.status).toBe(400);
    expect(mocks.rename).not.toHaveBeenCalled();
    expect(mocks.touch).not.toHaveBeenCalled();
  });

  it.each([null, [], "title", {}])("rejects missing or malformed title objects %#", async (body) => {
    expect((await PATCH(patchRequest(body), context)).status).toBe(400);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("handles invalid JSON and content types as client errors", async () => {
    const malformed = new Request(`http://localhost:3000/api/meetings/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: "{\"title\":",
    });
    expect((await PATCH(malformed, context)).status).toBe(400);
    expect((await PATCH(patchRequest({ title: "Valid title" }, { "content-type": "text/plain" }), context)).status).toBe(400);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it.each([false, true])("bounds actual JSON bytes and declared content length (declared=%s)", async (declared) => {
    const body = JSON.stringify({ title: "x".repeat(4096) });
    const response = await PATCH(new Request(`http://localhost:3000/api/meetings/${id}`, {
      method: "PATCH", body,
      headers: { "content-type": "application/json", ...(declared ? { "content-length": String(new TextEncoder().encode(body).length) } : {}) },
    }), context);
    expect(response.status).toBe(413);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("rejects invalid meeting IDs before resolving ownership", async () => {
    const response = await PATCH(patchRequest({ title: "Valid title" }), { params: Promise.resolve({ meetingId: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("hides missing or unrelated meetings behind the same not-found error", async () => {
    mocks.rename.mockRejectedValue(new AppError("NOT_FOUND", "Meeting not found.", 404));
    const response = await PATCH(patchRequest({ title: "New title" }), context);
    expect(response.status).toBe(404);
    expect((await response.json()).error.message).toBe("Meeting not found.");
    expect(mocks.touch).not.toHaveBeenCalled();
  });

  it("rejects expired account authentication before renaming", async () => {
    mocks.owner.mockRejectedValue(new AppError("UNAUTHORIZED", "Sign in again.", 401));
    expect((await PATCH(patchRequest({ title: "New title" }), context)).status).toBe(401);
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("blocks cross-origin renaming before touching private data", async () => {
    expect((await PATCH(patchRequest({ title: "New title" }, { origin: "https://unrelated.example" }), context)).status).toBe(403);
    expect(mocks.owner).not.toHaveBeenCalled();
    expect(mocks.rename).not.toHaveBeenCalled();
  });

  it("returns safe database failures without leaking provider details", async () => {
    mocks.rename.mockRejectedValue(new AppError("DATABASE_ERROR", "Database request failed. Please retry.", 503));
    expect((await PATCH(patchRequest({ title: "New title" }), context)).status).toBe(503);
    mocks.rename.mockRejectedValue(new Error("Private SQL credentials and transcript"));
    const response = await PATCH(patchRequest({ title: "New title" }), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("Private SQL");
    expect(mocks.touch).not.toHaveBeenCalled();
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("meeting transcript and deletion routes", () => {
  it("returns private original text with no-store headers and the current session cookie", async () => {
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(200);
    expect((await response.json()).transcript.raw_transcript).toBe("[00:01] Sarah: Agreed.");
    expect(mocks.get).toHaveBeenCalledWith(id, owner);
    expect(mocks.touch).toHaveBeenCalledWith(owner);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
  });
  it("passes verified account ownership to deletion", async () => {
    const account = { userId: "verified-user", sessionId: null };
    mocks.owner.mockResolvedValue({ owner: account });
    const response = await DELETE(request("DELETE"), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.delete).toHaveBeenCalledWith(id, account);
  });
  it.each([GET, DELETE])("rejects invalid meeting IDs before database access", async (action) => {
    const response = await action(request(action === GET ? "GET" : "DELETE"), { params: Promise.resolve({ meetingId: "invalid" }) });
    expect(response.status).toBe(400);
    expect(mocks.owner).not.toHaveBeenCalled();
  });
  it.each([GET, DELETE])("returns not-found for missing or inaccessible meetings", async (action) => {
    mocks.get.mockRejectedValue(new AppError("NOT_FOUND", "Meeting not found.", 404));
    mocks.delete.mockRejectedValue(new AppError("NOT_FOUND", "Meeting not found.", 404));
    expect((await action(request(action === GET ? "GET" : "DELETE"), context)).status).toBe(404);
    expect(mocks.touch).not.toHaveBeenCalled();
  });
  it("blocks cross-origin deletion before touching data", async () => {
    expect((await DELETE(request("DELETE", "https://unrelated.example"), context)).status).toBe(403);
    expect(mocks.delete).not.toHaveBeenCalled();
  });
  it("surfaces database errors without exposing transcript contents", async () => {
    mocks.get.mockRejectedValue(new Error("private transcript SQL details"));
    const response = await GET(request("GET"), context);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private transcript");
  });
});
