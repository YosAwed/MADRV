import type { Express, Request, Response } from "express";
import { Readable, Transform } from "node:stream";
import { openPublicStorageAsset } from "./remoteAssets";

const MAX_SOUNDFONT_PROXY_BYTES = 320 * 1024 * 1024;
const MAX_SOUNDFONT_RANGE_BYTES = 8 * 1024 * 1024;

function errorStatus(error: unknown): number {
  return typeof error === "object" && error !== null && "code" in error && error.code === "PAYLOAD_TOO_LARGE" ? 413 : 502;
}

function writeError(response: Response, error: unknown) {
  const message = error instanceof Error ? error.message : "公開共有SoundFontを取得できませんでした。";
  if (!response.headersSent) response.status(errorStatus(error)).json({ error: message });
  else response.end();
}

function parseSoundFontRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^bytes=(\d+)-(\d+)$/.exec(value.trim());
  if (!match) throw new Error("SoundFontの範囲指定が正しくありません。");
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > MAX_SOUNDFONT_RANGE_BYTES) {
    throw new Error("SoundFontの範囲指定が大きすぎます。");
  }
  return `bytes=${start}-${end}`;
}

/** Streams a validated Google Drive/Dropbox SoundFont so a large bank never becomes a Base64 tRPC payload. */
export function registerPublicSoundfontRoute(app: Express) {
  app.get("/api/public-storage/soundfont", async (request: Request, response: Response) => {
    const sourceUrl = typeof request.query.url === "string" ? request.query.url : "";
    if (!sourceUrl.trim()) {
      response.status(400).json({ error: "SoundFont共有URLを指定してください。" });
      return;
    }
    try {
      const requestedRange = parseSoundFontRange(request.header("range"));
      const asset = await openPublicStorageAsset(sourceUrl, "soundfont", requestedRange);
      if (!asset.response.body) {
        asset.dispose();
        response.status(502).json({ error: "共有SoundFontの本文を受信できませんでした。" });
        return;
      }
      const contentLength = asset.response.headers.get("content-length");
      response.status(asset.response.status === 206 ? 206 : 200);
      response.setHeader("Content-Type", asset.response.headers.get("content-type") ?? "application/octet-stream");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("Accept-Ranges", "bytes");
      response.setHeader("X-Remote-Asset-Final-Url", asset.finalUrl);
      if (contentLength) response.setHeader("Content-Length", contentLength);
      const contentRange = asset.response.headers.get("content-range");
      if (contentRange) response.setHeader("Content-Range", contentRange);
      let transferredBytes = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          transferredBytes += chunk.length;
          if (transferredBytes > MAX_SOUNDFONT_PROXY_BYTES) {
            callback(new Error("共有SoundFontが320 MBを超えています。ローカル読み込み、または320 MB以下の公開共有ファイルを利用してください。"));
            return;
          }
          callback(null, chunk);
        },
      });
      const source = Readable.fromWeb(asset.response.body as any);
      const dispose = () => asset.dispose();
      request.once("aborted", dispose);
      response.once("close", dispose);
      source.once("error", error => writeError(response, error));
      limiter.once("error", error => {
        source.destroy(error);
        writeError(response, error);
      });
      source.pipe(limiter).pipe(response);
    } catch (error) {
      writeError(response, error);
    }
  });
}
