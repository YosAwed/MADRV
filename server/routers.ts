import { COOKIE_NAME } from "@shared/const";
import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { fetchPublicStorageAsset } from "./remoteAssets";
import { createSharedSession, getSharedSession, sharedSessionIdPattern } from "./sharedSessions";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

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

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  publicStorage: router({
    fetchAsset: publicProcedure.input(z.object({ url: z.string().url(), kind: z.enum(["mdr", "mdx", "pdx", "soundfont", "catalog"]) })).mutation(({ input }) => fetchPublicStorageAsset(input.url, input.kind)),
  }),
  sharedSession: router({
    create: publicProcedure.input(sharedSessionPayloadSchema).mutation(({ input }) => createSharedSession(input)),
    get: publicProcedure.input(z.object({ id: z.string().regex(sharedSessionIdPattern) })).query(async ({ input }) => {
      const payload = await getSharedSession(input.id);
      if (!payload) throw new Error("共有セッションが見つかりません。リンクが正しいか確認してください。");
      return payload;
    }),
  }),

  // TODO: add feature routers here, e.g.
  // todo: router({
  //   list: protectedProcedure.query(({ ctx }) =>
  //     db.getUserTodos(ctx.user.id)
  //   ),
  // }),
});

export type AppRouter = typeof appRouter;
