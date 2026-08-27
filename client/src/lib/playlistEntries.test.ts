import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYLIST_LOOP_COUNT, isPersistablePlaylistEntry, movePlaylistEntry, normalizePlaylistLoopCount, parseSavedPlaylist, removePlaylistEntry, setPlaylistEntryLoopCount, upsertPlaylistEntry, type SavedPlaylistEntry } from "./playlistEntries";

const local: SavedPlaylistEntry = { id: "local:one.mdr", title: "ONE.MDR", format: "mdr", origin: "local", loopCount: 2, path: "ONE.MDR" };
const remote: SavedPlaylistEntry = { id: "remote:two", title: "TWO", format: "mdx", origin: "remote", loopCount: 3, remoteMdrUrl: "https://example.test/two.mdx", remotePdxUrl: "https://example.test/two.pdx" };

describe("saved playlist entries", () => {
  it("persists only remote entries that can reopen without a file picker", () => {
    expect(isPersistablePlaylistEntry(local)).toBe(false);
    expect(isPersistablePlaylistEntry(remote)).toBe(true);
    expect(parseSavedPlaylist([remote, null, { id: "bad" }, local, { ...local, title: "duplicate" }])).toEqual([remote]);
  });

  it("normalizes per-track loop counts to finite playback values", () => {
    expect(normalizePlaylistLoopCount(Number.NaN)).toBe(DEFAULT_PLAYLIST_LOOP_COUNT);
    expect(normalizePlaylistLoopCount(0)).toBe(1);
    expect(normalizePlaylistLoopCount(2.9)).toBe(2);
    expect(normalizePlaylistLoopCount(200)).toBe(99);
  });

  it("adds or refreshes an entry without changing its position", () => {
    const refreshed = { ...remote, title: "TWO (updated)", loopCount: 4 };
    expect(upsertPlaylistEntry([remote, local], refreshed)).toEqual([refreshed, local]);
    expect(upsertPlaylistEntry([remote], local)).toEqual([remote, local]);
  });

  it("moves, removes, and updates a selected entry", () => {
    expect(movePlaylistEntry([local, remote], 1, 0)).toEqual([remote, local]);
    expect(setPlaylistEntryLoopCount([local, remote], remote.id, -10)[1]?.loopCount).toBe(1);
    expect(removePlaylistEntry([local, remote], local.id)).toEqual([remote]);
  });
});
