import { describe, expect, it } from "vitest";
import { isReloadableRecentSource, parseRecentSources, removeRecentSource, upsertRecentSource, type RecentSource } from "./recentSources";

const local: RecentSource = { id: "local:one.mdr", kind: "local", label: "ONE.MDR", format: "mdr", usedAt: 100 };
const remote: RecentSource = { id: "remote:https://example.test/two.mdx", kind: "remote", label: "TWO", format: "mdx", mdrUrl: "https://example.test/two.mdx", usedAt: 200 };

describe("recent source history", () => {
  it("keeps only remote URLs that can reopen without a file picker", () => {
    expect(isReloadableRecentSource(local)).toBe(false);
    expect(isReloadableRecentSource(remote)).toBe(true);
    expect(parseRecentSources([local, null, { id: "bad" }, remote])).toEqual([remote]);
  });

  it("ignores local upserts, moves remotes to the newest position, and removes entries", () => {
    expect(upsertRecentSource([remote], local)).toEqual([remote]);
    const refreshed = { ...remote, usedAt: 300 };
    expect(upsertRecentSource([remote], refreshed)).toEqual([refreshed]);
    expect(removeRecentSource([refreshed], refreshed.id)).toEqual([]);
  });
});
