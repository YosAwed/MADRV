import { describe, expect, it } from "vitest";
import { DEFAULT_PLAYLIST_LOOP_COUNT, isPersistablePlaylistEntry, movePlaylistEntry, normalizePlaylistLoopCount, parseSavedPlaylist, removePlaylistEntry, setPlaylistEntryLoopCount, updateRemotePlaylistTitle, upsertPlaylistEntry, type SavedPlaylistEntry } from "./playlistEntries";

const local: SavedPlaylistEntry = { id: "local:one.mdr", title: "ONE.MDR", format: "mdr", origin: "local", loopCount: 2, path: "ONE.MDR" };
const remote: SavedPlaylistEntry = { id: "remote:two", title: "TWO", format: "mdx", origin: "remote", loopCount: 3, remoteMdrUrl: "https://example.test/two.mdx", remotePdxUrl: "https://example.test/two.pdx" };

function remoteCatalogEntries(count: number): SavedPlaylistEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    ...remote,
    id: `remote:catalog-${index}`,
    title: `Catalog track ${index + 1}`,
    loopCount: index % 3 + 1,
    remoteMdrUrl: `https://example.test/catalog/${index}.mdx`,
  }));
}

describe("saved playlist entries", () => {
  it("persists only remote entries that can reopen without a file picker", () => {
    expect(isPersistablePlaylistEntry(local)).toBe(false);
    expect(isPersistablePlaylistEntry(remote)).toBe(true);
    expect(parseSavedPlaylist([remote, null, { id: "bad" }, local, { ...local, title: "duplicate" }])).toEqual([remote]);
  });

  it("restores all 300 remote catalog tracks across repeated reloads", () => {
    const entries = remoteCatalogEntries(300);
    const restored = parseSavedPlaylist(JSON.parse(JSON.stringify(entries)));

    expect(restored).toEqual(entries);
    expect(parseSavedPlaylist(JSON.parse(JSON.stringify(restored)))).toEqual(entries);
  });

  it("limits restored playlists to the first 300 distinct playable remote entries", () => {
    const entries = remoteCatalogEntries(301);
    const stored = [
      null,
      local,
      { ...remote, id: "remote:missing-url", remoteMdrUrl: " " },
      entries[0],
      { ...entries[0], title: "Duplicate catalog track" },
      ...entries.slice(1),
    ];

    expect(parseSavedPlaylist(JSON.parse(JSON.stringify(stored)))).toEqual(entries.slice(0, 300));
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

  it("adds the 300th track and can still refresh it when the playlist is full", () => {
    const entries = remoteCatalogEntries(301);
    const full = upsertPlaylistEntry(entries.slice(0, 299), entries[299]!);

    expect(full).toEqual(entries.slice(0, 300));
    expect(upsertPlaylistEntry(full, entries[300]!)).toEqual(full);

    const refreshed = { ...entries[299]!, title: "Updated final track", loopCount: 4 };
    expect(upsertPlaylistEntry(full, refreshed)).toEqual([...entries.slice(0, 299), refreshed]);
  });

  it("moves, removes, and updates a selected entry", () => {
    expect(movePlaylistEntry([local, remote], 1, 0)).toEqual([remote, local]);
    expect(setPlaylistEntryLoopCount([local, remote], remote.id, -10)[1]?.loopCount).toBe(1);
    expect(removePlaylistEntry([local, remote], local.id)).toEqual([remote]);
  });

  it("persists loaded song titles for matching URLs regardless of catalog IDs", () => {
    const catalog = { ...remote, id: "remote:catalog-id", title: "two.mdx", path: "two.mdx", loopCount: 5 };
    const other = { ...remote, id: "other", remoteMdrUrl: "https://example.test/other.mdx" };
    const entries = [catalog, other, remote, local];
    const updated = updateRemotePlaylistTitle(entries, ` ${remote.remoteMdrUrl} `, " 曲の正式タイトル ");
    expect(updated).toEqual([{ ...catalog, title: "曲の正式タイトル" }, other, { ...remote, title: "曲の正式タイトル" }, local]);
    expect(updated[1]).toBe(other);
    expect(updated[3]).toBe(local);
    expect(parseSavedPlaylist(JSON.parse(JSON.stringify(updated)))).toEqual(updated.slice(0, 3));
  });

  it("keeps titles intact when a load has no title or a different source URL", () => {
    const entries = [remote, local];
    expect(updateRemotePlaylistTitle(entries, remote.remoteMdrUrl!, " ")).toBe(entries);
    expect(updateRemotePlaylistTitle(entries, "https://other.test/two.mdx", "Different song")).toBe(entries);
    expect(updateRemotePlaylistTitle(entries, remote.remoteMdrUrl!, remote.title)).toBe(entries);
  });
});
