import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchPublicStorageAsset, isApprovedStorageUrl, normalizePublicStorageUrl } from "./remoteAssets";

describe("public storage URL normalization", () => {
  it("converts a Google Drive file share link into a direct download endpoint", () => {
    expect(normalizePublicStorageUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing")).toBe("https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t");
  });

  it("keeps a Google Drive resource key required by some link-shared files", () => {
    expect(normalizePublicStorageUrl("https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=drive_link&resourcekey=0-exampleKey")).toBe("https://drive.usercontent.google.com/download?id=1AbCdEfGhIjKlMnOp&export=download&confirm=t&resourcekey=0-exampleKey");
  });

  it("forces Dropbox shared links into download mode", () => {
    expect(normalizePublicStorageUrl("https://www.dropbox.com/scl/fi/token/song.sf2?rlkey=key&dl=0")).toBe("https://www.dropbox.com/scl/fi/token/song.sf2?rlkey=key&dl=1");
  });

  it("accepts only HTTPS Google Drive and Dropbox hosts", () => {
    expect(isApprovedStorageUrl("https://drive.google.com/file/d/public/view")).toBe(true);
    expect(isApprovedStorageUrl("https://dl.dropboxusercontent.com/s/example/file.mdr")).toBe(true);
    expect(isApprovedStorageUrl("https://uc123.dropboxusercontent.com/s/example/file.mdr")).toBe(true);
    expect(isApprovedStorageUrl("https://example.com/redirect?url=http://127.0.0.1")).toBe(false);
    expect(isApprovedStorageUrl("http://drive.google.com/file/d/public/view")).toBe(false);
  });

  it("fetches an MDX through the Google Drive download endpoint while preserving its asset kind", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Uint8Array([0x4d, 0x44, 0x58]), { status: 200, headers: { "content-type": "application/octet-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchPublicStorageAsset("https://drive.google.com/file/d/shared-mdx-id/view?usp=drive_link", "mdx");
    expect(fetchMock).toHaveBeenCalledWith("https://drive.usercontent.google.com/download?id=shared-mdx-id&export=download&confirm=t", expect.objectContaining({ method: "GET" }));
    expect(result).toMatchObject({ kind: "mdx", sourceUrl: "https://drive.google.com/file/d/shared-mdx-id/view?usp=drive_link", byteLength: 3 });
  });

  it("permits a 64 MB-plus SoundFont while retaining the lower limit for song assets", async () => {
    const riffSoundFont = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x73, 0x66, 0x62, 0x6b]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(riffSoundFont, { status: 200, headers: { "content-length": String(65 * 1024 * 1024) } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicStorageAsset("https://drive.google.com/file/d/shared-sf-id/view", "soundfont")).resolves.toMatchObject({ kind: "soundfont", byteLength: 12 });
    await expect(fetchPublicStorageAsset("https://drive.google.com/file/d/shared-mdr-id/view", "mdr")).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
  });

  it("rejects an HTML share page instead of passing it to the SoundFont synthesizer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<!doctype html><title>Drive</title>", { status: 200, headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchPublicStorageAsset("https://www.dropbox.com/scl/fi/token/bank.sf2?dl=0", "soundfont")).rejects.toMatchObject({ code: "BAD_GATEWAY" });
  });
});

afterEach(() => vi.unstubAllGlobals());
