import { TRPCError } from "@trpc/server";

export type RemoteAssetKind = "mdr" | "mdx" | "pdx" | "soundfont" | "catalog";

const MAX_STANDARD_PROXY_BYTES = 64 * 1024 * 1024;
const MAX_SOUNDFONT_PROXY_BYTES = 320 * 1024 * 1024;
const MAX_REDIRECTS = 4;
const STANDARD_FETCH_TIMEOUT_MS = 25_000;
const SOUNDFONT_FETCH_TIMEOUT_MS = 120_000;

function isGoogleHost(hostname: string) {
  return hostname === "drive.google.com" || hostname === "drive.usercontent.google.com";
}

function isDropboxHost(hostname: string) {
  return hostname === "dropbox.com" || hostname.endsWith(".dropbox.com") || hostname.endsWith(".dropboxusercontent.com");
}

export function isApprovedStorageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (isGoogleHost(url.hostname.toLowerCase()) || isDropboxHost(url.hostname.toLowerCase()));
  } catch {
    return false;
  }
}

/** Converts a public Drive/Dropbox sharing URL to a server-fetchable download URL. No authentication, cookies, or private files are supported. */
export function normalizePublicStorageUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "共有URLの形式が正しくありません。" });
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || (!isGoogleHost(hostname) && !isDropboxHost(hostname))) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Google DriveまたはDropboxのHTTPS公開共有URLのみ取得できます。" });
  }
  if (isGoogleHost(hostname)) {
    const fileId = url.searchParams.get("id") ?? url.pathname.match(/\/file\/d\/([^/?#]+)/)?.[1];
    if (!fileId) throw new TRPCError({ code: "BAD_REQUEST", message: "Google Drive共有リンクからファイルIDを取得できませんでした。フォルダではなく単一ファイルの共有リンクを指定してください。" });
    const resourceKey = url.searchParams.get("resourcekey");
    const resourceKeyQuery = resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : "";
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${resourceKeyQuery}`;
  }
  if (hostname !== "dl.dropboxusercontent.com") url.searchParams.set("dl", "1");
  return url.toString();
}

function assertRedirectTarget(value: string): URL {
  const target = new URL(value);
  if (!isApprovedStorageUrl(target.toString())) throw new TRPCError({ code: "FORBIDDEN", message: "外部ストレージのリダイレクト先が許可されていません。" });
  return target;
}

function proxyByteLimit(kind: RemoteAssetKind): number {
  return kind === "soundfont" ? MAX_SOUNDFONT_PROXY_BYTES : MAX_STANDARD_PROXY_BYTES;
}

function proxyLimitMessage(kind: RemoteAssetKind): string {
  if (kind === "soundfont") return "共有SoundFontが320 MBを超えています。ローカル読み込み、または320 MB以下の公開共有ファイルを利用してください。";
  return "共有ファイルが64 MBを超えています。ローカル読み込みまたはCORS対応URLを利用してください。";
}

function isRiffSoundBank(data: Uint8Array): boolean {
  if (data.byteLength < 12) return false;
  const isRiff = data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46;
  const isSoundFont = data[8] === 0x73 && data[9] === 0x66 && data[10] === 0x62 && data[11] === 0x6b;
  const isDls = data[8] === 0x44 && data[9] === 0x4c && data[10] === 0x53 && data[11] === 0x20;
  return isRiff && (isSoundFont || isDls);
}

export type OpenPublicStorageAsset = {
  response: Response;
  finalUrl: string;
  dispose: () => void;
};

/** Opens a validated public share response without buffering it. Call dispose after its body has been consumed. */
export async function openPublicStorageAsset(url: string, kind: RemoteAssetKind, range?: string): Promise<OpenPublicStorageAsset> {
  let nextUrl = normalizePublicStorageUrl(url);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), kind === "soundfont" ? SOUNDFONT_FETCH_TIMEOUT_MS : STANDARD_FETCH_TIMEOUT_MS);
  const dispose = () => {
    clearTimeout(timeout);
    controller.abort();
  };
  try {
    for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(nextUrl, { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: "application/octet-stream,application/json;q=0.9,*/*;q=0.8", ...(range ? { Range: range } : {}) } });
      } catch {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "公開共有ファイルを取得できませんでした。共有権限、ダウンロード制限、リンクの有効性を確認してください。" });
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクのリダイレクト先を取得できませんでした。" });
        nextUrl = assertRedirectTarget(new URL(location, nextUrl).toString()).toString();
        continue;
      }
      if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `公開共有ファイルの取得に失敗しました（HTTP ${response.status}）。共有設定とダウンロード権限を確認してください。` });
      const declaredSize = Number(response.headers.get("content-length") ?? "0");
      if (Number.isFinite(declaredSize) && declaredSize > proxyByteLimit(kind)) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: proxyLimitMessage(kind) });
      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (kind === "soundfont" && contentType.includes("text/html")) {
        throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクがSoundFont本体ではなくHTMLページを返しました。Google Drive／Dropboxで「リンクを知っている全員・閲覧者」に設定し、ダウンロード制限を解除した単一ファイルの共有リンクを指定してください。" });
      }
      return { response, finalUrl: nextUrl, dispose };
    }
    throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクのリダイレクト回数が上限を超えました。" });
  } catch (error) {
    dispose();
    throw error;
  }
}

async function readLimitedBody(response: Response, kind: RemoteAssetKind): Promise<Uint8Array> {
  const maximumBytes = proxyByteLimit(kind);
  const declaredSize = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > maximumBytes) throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: proxyLimitMessage(kind) });
  if (!response.body) throw new TRPCError({ code: "BAD_GATEWAY", message: "共有ファイルの本文を受信できませんでした。" });
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: proxyLimitMessage(kind) });
    }
    chunks.push(value);
  }
  const data = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (kind === "soundfont" && !isRiffSoundBank(data)) {
    throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクからSoundFont本体を取得できませんでした。Google Drive／Dropboxで「リンクを知っている全員・閲覧者」に設定し、ダウンロード制限を解除した単一ファイルの共有リンクを指定してください。" });
  }
  return data;
}

export async function fetchPublicStorageAsset(url: string, kind: RemoteAssetKind) {
  const asset = await openPublicStorageAsset(url, kind);
  try {
    const data = await readLimitedBody(asset.response, kind);
    return { kind, sourceUrl: url, finalUrl: asset.finalUrl, contentType: asset.response.headers.get("content-type") ?? "application/octet-stream", byteLength: data.byteLength, dataBase64: Buffer.from(data).toString("base64") };
  } finally {
    asset.dispose();
  }
}
