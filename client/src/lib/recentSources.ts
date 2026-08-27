export type RecentSource = {
  id: string;
  kind: "local" | "remote";
  label: string;
  format?: "mdr" | "mdx";
  mdrUrl?: string;
  pdxUrl?: string;
  pdxName?: string;
  usedAt: number;
};

export const RECENT_SOURCES_STORAGE_KEY = "madrv-player.recent-sources-v1";
const MAX_RECENT_SOURCES = 6;

function isRecentSource(value: unknown): value is RecentSource {
  if (!value || typeof value !== "object") return false;
  const source = value as Partial<RecentSource>;
  return typeof source.id === "string" && (source.kind === "local" || source.kind === "remote") && typeof source.label === "string" && typeof source.usedAt === "number";
}

/** Only remote URLs can reopen without a file picker; local paths are not retained by the browser. */
export function isReloadableRecentSource(source: RecentSource): boolean {
  return source.kind === "remote" && typeof source.mdrUrl === "string" && source.mdrUrl.trim().length > 0;
}

export function parseRecentSources(value: unknown): RecentSource[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecentSource).filter(isReloadableRecentSource).sort((left, right) => right.usedAt - left.usedAt).slice(0, MAX_RECENT_SOURCES);
}

export function upsertRecentSource(current: RecentSource[], next: RecentSource): RecentSource[] {
  if (!isReloadableRecentSource(next)) return current;
  return [next, ...current.filter((source) => source.id !== next.id)].sort((left, right) => right.usedAt - left.usedAt).slice(0, MAX_RECENT_SOURCES);
}

export function removeRecentSource(current: RecentSource[], id: string): RecentSource[] {
  return current.filter((source) => source.id !== id);
}
