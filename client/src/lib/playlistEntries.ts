export type SavedPlaylistEntry = {
  id: string;
  title: string;
  format: "mdr" | "mdx";
  origin: "local" | "remote";
  loopCount: number;
  remoteMdrUrl?: string;
  remotePdxUrl?: string;
  pdxName?: string;
  requiredPdxName?: string;
  path?: string;
};

export const SAVED_PLAYLIST_STORAGE_KEY = "madrv-player.playlist-v1";
export const DEFAULT_PLAYLIST_LOOP_COUNT = 2;
const MAX_PLAYLIST_ENTRIES = 200;

export function normalizePlaylistLoopCount(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PLAYLIST_LOOP_COUNT;
  return Math.max(1, Math.min(99, Math.floor(value)));
}

function isSavedPlaylistEntry(value: unknown): value is SavedPlaylistEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SavedPlaylistEntry>;
  if (typeof entry.id !== "string" || !entry.id || typeof entry.title !== "string" || !entry.title) return false;
  if (entry.format !== "mdr" && entry.format !== "mdx") return false;
  if (entry.origin !== "local" && entry.origin !== "remote") return false;
  if (entry.origin === "remote" && (!entry.remoteMdrUrl || typeof entry.remoteMdrUrl !== "string")) return false;
  return true;
}

/** Persisted playlist rows must reopen without a file picker (remote URLs only). */
export function isPersistablePlaylistEntry(entry: Pick<SavedPlaylistEntry, "origin" | "remoteMdrUrl">): boolean {
  return entry.origin === "remote" && typeof entry.remoteMdrUrl === "string" && entry.remoteMdrUrl.trim().length > 0;
}

export function parseSavedPlaylist(value: unknown): SavedPlaylistEntry[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return value.reduce<SavedPlaylistEntry[]>((entries, value) => {
    if (!isSavedPlaylistEntry(value) || !isPersistablePlaylistEntry(value) || ids.has(value.id) || entries.length >= MAX_PLAYLIST_ENTRIES) return entries;
    ids.add(value.id);
    entries.push({ ...value, loopCount: normalizePlaylistLoopCount(value.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT) });
    return entries;
  }, []);
}

export function upsertPlaylistEntry(current: SavedPlaylistEntry[], entry: SavedPlaylistEntry): SavedPlaylistEntry[] {
  const normalized = { ...entry, loopCount: normalizePlaylistLoopCount(entry.loopCount) };
  const existingIndex = current.findIndex((candidate) => candidate.id === normalized.id);
  if (existingIndex < 0) return [...current, normalized].slice(0, MAX_PLAYLIST_ENTRIES);
  return current.map((candidate, index) => index === existingIndex ? normalized : candidate);
}

export function removePlaylistEntry(current: SavedPlaylistEntry[], id: string): SavedPlaylistEntry[] {
  return current.filter((entry) => entry.id !== id);
}

export function movePlaylistEntry(current: SavedPlaylistEntry[], fromIndex: number, toIndex: number): SavedPlaylistEntry[] {
  if (fromIndex < 0 || fromIndex >= current.length || toIndex < 0 || toIndex >= current.length || fromIndex === toIndex) return current;
  const next = [...current];
  const [entry] = next.splice(fromIndex, 1);
  if (!entry) return current;
  next.splice(toIndex, 0, entry);
  return next;
}

export function setPlaylistEntryLoopCount(current: SavedPlaylistEntry[], id: string, loopCount: number): SavedPlaylistEntry[] {
  return current.map((entry) => entry.id === id ? { ...entry, loopCount: normalizePlaylistLoopCount(loopCount) } : entry);
}
