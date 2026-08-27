import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { SharedSessionPayload, sharedSessions } from "../drizzle/schema";
import { getDb } from "./db";

export const sharedSessionIdPattern = /^[A-Za-z0-9_-]{8}$/;

export function createSharedSessionId(): string {
  return randomBytes(6).toString("base64url");
}

export async function createSharedSession(payload: SharedSessionPayload): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("短縮共有リンクを保存できませんでした。しばらくしてからもう一度お試しください。");
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const id = createSharedSessionId();
    try {
      await db.insert(sharedSessions).values({ id, payload });
      return id;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
  throw new Error("短縮共有リンクを保存できませんでした。しばらくしてからもう一度お試しください。");
}

export async function getSharedSession(id: string): Promise<SharedSessionPayload | undefined> {
  if (!sharedSessionIdPattern.test(id)) return undefined;
  const db = await getDb();
  if (!db) throw new Error("短縮共有リンクを取得できませんでした。しばらくしてからもう一度お試しください。");
  const result = await db.select({ payload: sharedSessions.payload }).from(sharedSessions).where(eq(sharedSessions.id, id)).limit(1);
  return result[0]?.payload;
}
