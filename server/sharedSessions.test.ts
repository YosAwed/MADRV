import { describe, expect, it } from "vitest";
import { createSharedSessionId, sharedSessionIdPattern } from "./sharedSessions";

describe("shared session IDs", () => {
  it("creates compact URL-safe opaque IDs", () => {
    const ids = Array.from({ length: 64 }, () => createSharedSessionId());
    expect(ids.every((id) => sharedSessionIdPattern.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
