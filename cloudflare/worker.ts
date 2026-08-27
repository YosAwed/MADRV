import { initTRPC, TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { DurableObject } from "cloudflare:workers";
import superjson from "superjson";
import { z } from "zod";

type RemoteAssetKind = "mdr" | "mdx" | "pdx" | "soundfont" | "catalog";

type SharedSessionPayload = {
  source: { kind: "mml"; mml: string } | { kind: "remote"; mdrUrl: string; pdxUrl?: string };
  loopCount: number;
  exportLimit: number;
  catalogUrl?: string;
  soundFontUrl?: string;
};

const MAX_STANDARD_PROXY_BYTES = 32 * 1024 * 1024;
const MAX_SOUNDFONT_RANGE_BYTES = 8 * 1024 * 1024;
const MAX_REDIRECTS = 4;

function isGoogleHost(hostname: string) {
  return hostname === "drive.google.com" || hostname === "drive.usercontent.google.com";
}

function isDropboxHost(hostname: string) {
  return hostname === "dropbox.com" || hostname.endsWith(".dropbox.com") || hostname.endsWith(".dropboxusercontent.com");
}

function isApprovedStorageUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:" && (isGoogleHost(hostname) || isDropboxHost(hostname));
  } catch {
    return false;
  }
}

function normalizePublicStorageUrl(value: string) {
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
    if (!fileId) throw new TRPCError({ code: "BAD_REQUEST", message: "Google Drive共有リンクからファイルIDを取得できませんでした。" });
    const resourceKey = url.searchParams.get("resourcekey");
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t${resourceKey ? `&resourcekey=${encodeURIComponent(resourceKey)}` : ""}`;
  }
  if (hostname !== "dl.dropboxusercontent.com") url.searchParams.set("dl", "1");
  return url.toString();
}

async function openPublicStorageAsset(sourceUrl: string, range?: string) {
  let nextUrl = normalizePublicStorageUrl(sourceUrl);
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(nextUrl, {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "application/octet-stream,application/json;q=0.9,*/*;q=0.8",
          ...(range ? { Range: range } : {}),
        },
      });
    } catch {
      throw new TRPCError({ code: "BAD_GATEWAY", message: "公開共有ファイルを取得できませんでした。共有権限を確認してください。" });
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクのリダイレクト先を取得できませんでした。" });
      const target = new URL(location, nextUrl).toString();
      if (!isApprovedStorageUrl(target)) throw new TRPCError({ code: "FORBIDDEN", message: "外部ストレージのリダイレクト先が許可されていません。" });
      nextUrl = target;
      continue;
    }
    if (!response.ok) throw new TRPCError({ code: "BAD_GATEWAY", message: `公開共有ファイルの取得に失敗しました（HTTP ${response.status}）。` });
    return { response, finalUrl: nextUrl };
  }
  throw new TRPCError({ code: "BAD_GATEWAY", message: "共有リンクのリダイレクト回数が上限を超えました。" });
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...Array.from(bytes.subarray(offset, offset + chunkSize)));
  }
  return btoa(binary);
}

async function fetchPublicStorageAsset(url: string, kind: RemoteAssetKind) {
  if (kind === "soundfont") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "SoundFontはストリーミング取得を使用してください。" });
  }
  const asset = await openPublicStorageAsset(url);
  const declaredSize = Number(asset.response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredSize) && declaredSize > MAX_STANDARD_PROXY_BYTES) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "共有ファイルが32 MBを超えています。" });
  }
  const data = new Uint8Array(await asset.response.arrayBuffer());
  if (data.byteLength > MAX_STANDARD_PROXY_BYTES) {
    throw new TRPCError({ code: "PAYLOAD_TOO_LARGE", message: "共有ファイルが32 MBを超えています。" });
  }
  return {
    kind,
    sourceUrl: url,
    finalUrl: asset.finalUrl,
    contentType: asset.response.headers.get("content-type") ?? "application/octet-stream",
    byteLength: data.byteLength,
    dataBase64: bytesToBase64(data),
  };
}

function sessionStub(env: Env, id: string) {
  return env.SESSIONS.getByName(id);
}

function createSessionId() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

const sharedSessionPayloadSchema = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("mml"), mml: z.string().min(1).max(20_000) }),
    z.object({ kind: z.literal("remote"), mdrUrl: z.string().url().max(4096), pdxUrl: z.string().url().max(4096).optional() }),
  ]),
  loopCount: z.union([z.literal(0), z.number().int().min(1).max(99)]),
  exportLimit: z.number().int().min(10).max(600),
  catalogUrl: z.string().max(4096).optional(),
  soundFontUrl: z.string().url().max(4096).optional(),
});

const t = initTRPC.context<{ env: Env }>().create({ transformer: superjson });
const appRouter = t.router({
  auth: t.router({
    me: t.procedure.query(() => null),
    logout: t.procedure.mutation(() => ({ success: true as const })),
  }),
  publicStorage: t.router({
    fetchAsset: t.procedure
      .input(z.object({ url: z.string().url(), kind: z.enum(["mdr", "mdx", "pdx", "soundfont", "catalog"]) }))
      .mutation(({ input }) => fetchPublicStorageAsset(input.url, input.kind)),
  }),
  sharedSession: t.router({
    create: t.procedure.input(sharedSessionPayloadSchema).mutation(async ({ input, ctx }) => {
      const id = createSessionId();
      await sessionStub(ctx.env, id).put(input);
      return id;
    }),
    get: t.procedure.input(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{8}$/) })).query(async ({ input, ctx }) => {
      const payload = await sessionStub(ctx.env, input.id).get();
      if (!payload) throw new TRPCError({ code: "NOT_FOUND", message: "共有セッションが見つかりません。" });
      return payload;
    }),
  }),
});

async function handleSoundFont(request: Request) {
  const url = new URL(request.url);
  const sourceUrl = url.searchParams.get("url") ?? "";
  if (!sourceUrl) return Response.json({ error: "SoundFont共有URLを指定してください。" }, { status: 400 });
  const range = request.headers.get("range") ?? undefined;
  if (range) {
    const match = /^bytes=(\d+)-(\d+)$/.exec(range.trim());
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start || end - start + 1 > MAX_SOUNDFONT_RANGE_BYTES) {
      return Response.json({ error: "SoundFontの範囲指定が正しくありません。" }, { status: 416 });
    }
  }
  try {
    const asset = await openPublicStorageAsset(sourceUrl, range);
    if (range && asset.response.status !== 206) {
      return Response.json({ error: "共有SoundFontが範囲取得に対応していません。" }, { status: 502 });
    }
    const contentLength = Number(asset.response.headers.get("content-length") ?? "0");
    if (range && Number.isFinite(contentLength) && contentLength > MAX_SOUNDFONT_RANGE_BYTES) {
      return Response.json({ error: "共有SoundFontの応答範囲が大きすぎます。" }, { status: 502 });
    }
    const headers = new Headers();
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = asset.response.headers.get(name);
      if (value) headers.set(name, value);
    }
    headers.set("cache-control", "no-store");
    headers.set("x-remote-asset-final-url", asset.finalUrl);
    return new Response(asset.response.body, { status: asset.response.status === 206 ? 206 : 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "公開共有SoundFontを取得できませんでした。";
    return Response.json({ error: message }, { status: 502 });
  }
}

export class SessionStore extends DurableObject<Env> {
  async put(payload: SharedSessionPayload) {
    await this.ctx.storage.put("payload", payload);
  }

  async get() {
    return this.ctx.storage.get<SharedSessionPayload>("payload");
  }
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/public-storage/soundfont") return handleSoundFont(request);
    if (url.pathname.startsWith("/api/trpc")) {
      return fetchRequestHandler({
        endpoint: "/api/trpc",
        req: request,
        router: appRouter,
        createContext: () => ({ env }),
      });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
