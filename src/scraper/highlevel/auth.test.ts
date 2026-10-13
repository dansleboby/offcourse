import type { Page } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../shared/firebase.js", () => ({
  hasValidFirebaseToken: vi.fn(),
}));
import { hasValidFirebaseToken } from "../../shared/firebase.js";
import { hasValidHighLevelSession } from "./auth.js";

const firebase = vi.mocked(hasValidFirebaseToken);
function mockPage(url: string, cookies: Array<{ name: string; value: string; expires: number }> = []) {
  const getCookies = vi.fn().mockResolvedValue(cookies);
  return {
    page: { url: () => url, context: () => ({ cookies: getCookies }) } as unknown as Page,
    getCookies,
  };
}
describe("hasValidHighLevelSession", () => {
  beforeEach(() => firebase.mockReset().mockResolvedValue(false));

  it("accepts an existing Firebase session", async () => {
    firebase.mockResolvedValue(true);
    expect(await hasValidHighLevelSession(mockPage("https://courses.example.com/courses/products/123").page)).toBe(true);
  });

  it("accepts a catv2 cookie scoped to the current portal", async () => {
    const { page, getCookies } = mockPage("https://courses.example.com/courses/products/123", [
      { name: "catv2", value: "session-value", expires: -1 },
    ]);
    expect(await hasValidHighLevelSession(page)).toBe(true);
    expect(getCookies).toHaveBeenCalledWith(["https://courses.example.com/courses/products/123"]);
  });

  it("does not accept an empty or expired catv2 cookie", async () => {
    const url = "https://courses.example.com/courses/products/123";
    expect(await hasValidHighLevelSession(mockPage(url, [{ name: "catv2", value: "", expires: -1 }]).page)).toBe(false);
    expect(await hasValidHighLevelSession(mockPage(url, [{ name: "catv2", value: "old", expires: 1 }]).page)).toBe(false);
  });

  it("rejects login pages even when the cookie is present", async () => {
    const { page, getCookies } = mockPage("https://courses.example.com/login", [
      { name: "catv2", value: "session-value", expires: -1 },
    ]);
    expect(await hasValidHighLevelSession(page)).toBe(false);
    expect(getCookies).not.toHaveBeenCalled();
  });

  it("rejects a portal without either authentication mechanism", async () => {
    expect(await hasValidHighLevelSession(mockPage("https://courses.example.com/courses/products/123").page)).toBe(false);
  });
});
