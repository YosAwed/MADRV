export const SOUND_FONT_SELECTION_STORAGE_KEY = "madrv-player.soundfont-selection-v1";
const SOUND_FONT_DB_NAME = "madrv-player";
const SOUND_FONT_DB_VERSION = 1;
const SOUND_FONT_OBJECT_STORE = "soundfonts";
const LOCAL_SOUND_FONT_CACHE_KEY = "last-local";

export type PersistedSoundFontSelection =
  | { kind: "remote"; sourceUrl: string }
  | { kind: "local"; name: string; size: number; lastModified: number };

type CachedLocalSoundFontRecord = PersistedSoundFontSelection & { kind: "local"; data: ArrayBuffer };

function isPersistedSoundFontSelection(value: unknown): value is PersistedSoundFontSelection {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "remote") return typeof record.sourceUrl === "string" && record.sourceUrl.trim().length > 0;
  if (record.kind === "local") {
    return typeof record.name === "string"
      && record.name.length > 0
      && Number.isFinite(record.size)
      && Number(record.size) > 0
      && Number.isFinite(record.lastModified);
  }
  return false;
}

/** Reads the last successfully loaded SoundFont selection from browser storage. */
export function readPersistedSoundFontSelection(): PersistedSoundFontSelection | null {
  try {
    const raw = window.localStorage.getItem(SOUND_FONT_SELECTION_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPersistedSoundFontSelection(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Persists a remote SoundFont URL for the next visit. */
export function persistRemoteSoundFontSelection(sourceUrl: string) {
  const trimmed = sourceUrl.trim();
  if (!trimmed) return;
  try {
    window.localStorage.setItem(SOUND_FONT_SELECTION_STORAGE_KEY, JSON.stringify({ kind: "remote", sourceUrl: trimmed } satisfies PersistedSoundFontSelection));
  } catch { /* Browser storage may be unavailable. */ }
}

/** Persists a local SoundFont file and caches its bytes in IndexedDB. */
export async function persistLocalSoundFontSelection(file: File, data: ArrayBuffer) {
  const selection: PersistedSoundFontSelection = {
    kind: "local",
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
  };
  try {
    window.localStorage.setItem(SOUND_FONT_SELECTION_STORAGE_KEY, JSON.stringify(selection));
  } catch { /* Browser storage may be unavailable. */ }
  try {
    await writeCachedLocalSoundFont({ ...selection, data });
  } catch { /* Cache is optional; metadata still restores the file identity. */ }
}

/** Reads a cached local SoundFont if it still matches the saved selection. */
export async function readCachedLocalSoundFont(selection: Extract<PersistedSoundFontSelection, { kind: "local" }>): Promise<ArrayBuffer | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const cached = await readCachedLocalSoundFontRecord();
    if (!cached) return null;
    if (cached.name !== selection.name || cached.size !== selection.size || cached.lastModified !== selection.lastModified) return null;
    return cached.data;
  } catch {
    return null;
  }
}

function openSoundFontDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SOUND_FONT_DB_NAME, SOUND_FONT_DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SOUND_FONT_OBJECT_STORE)) {
        database.createObjectStore(SOUND_FONT_OBJECT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function writeCachedLocalSoundFont(record: CachedLocalSoundFontRecord): Promise<void> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openSoundFontDatabase();
      const transaction = database.transaction(SOUND_FONT_OBJECT_STORE, "readwrite");
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error ?? new Error("IndexedDB write failed"));
      };
      transaction.objectStore(SOUND_FONT_OBJECT_STORE).put(record, LOCAL_SOUND_FONT_CACHE_KEY);
    } catch (error) {
      reject(error);
    }
  });
}

function readCachedLocalSoundFontRecord(): Promise<CachedLocalSoundFontRecord | null> {
  return new Promise(async (resolve, reject) => {
    try {
      const database = await openSoundFontDatabase();
      const transaction = database.transaction(SOUND_FONT_OBJECT_STORE, "readonly");
      const request = transaction.objectStore(SOUND_FONT_OBJECT_STORE).get(LOCAL_SOUND_FONT_CACHE_KEY);
      request.onsuccess = () => {
        database.close();
        const value = request.result;
        if (!value || typeof value !== "object") {
          resolve(null);
          return;
        }
        const record = value as CachedLocalSoundFontRecord;
        if (record.kind !== "local" || !(record.data instanceof ArrayBuffer)) {
          resolve(null);
          return;
        }
        resolve(record);
      };
      request.onerror = () => {
        database.close();
        reject(request.error ?? new Error("IndexedDB read failed"));
      };
    } catch (error) {
      reject(error);
    }
  });
}
