import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, DELETE } from "@/app/api/meetings/[meetingId]/route";
import { AppError } from "@/lib/errors";

const mocks = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), touch: vi.fn(), owner: vi.fn() }));
vi.mock("@/lib/server/database", () => ({ getMeetingTranscript: mocks.get, deleteMeeting: mocks.delete, touchSession: mocks.touch }));
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
function request(method: string, origin = "http://localhost:3000") {
  return new Request(`http://localhost:3000/api/meetings/${id}`, { method, headers: { origin } });
}
beforeEach(() => {
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("DEMO_ACCESS_MODE", "local");
  vi.spyOn(console, "info").mockImplementation(() => {});
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.owner.mockResolvedValue({ owner, setCookie: "itl_session=test; HttpOnly; SameSite=Lax" });
  mocks.get.mockResolvedValue({ id, title: "Synthetic", raw_transcript: "[00:01] Sarah: Agreed." });
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
