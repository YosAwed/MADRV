import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { persistRemoteSoundFontSelection, readPersistedSoundFontSelection, SOUND_FONT_SELECTION_STORAGE_KEY } from "./soundFontStorage";

describe("soundFontStorage", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, value); },
        removeItem: (key: string) => { storage.delete(key); },
        clear: () => { storage.clear(); },
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips a remote SoundFont selection", () => {
    persistRemoteSoundFontSelection("https://example.org/bank.sf2");
    expect(readPersistedSoundFontSelection()).toEqual({ kind: "remote", sourceUrl: "https://example.org/bank.sf2" });
  });

  it("ignores invalid persisted payloads", () => {
    storage.set(SOUND_FONT_SELECTION_STORAGE_KEY, JSON.stringify({ kind: "remote" }));
    expect(readPersistedSoundFontSelection()).toBeNull();
  });
});
