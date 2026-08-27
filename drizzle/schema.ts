import { int, json, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Public, non-authenticated playback settings that can be restored through a compact share ID. */
export type SharedSessionPayload = {
  source: { kind: "mml"; mml: string } | { kind: "remote"; mdrUrl: string; pdxUrl?: string };
  loopCount: number;
  exportLimit: number;
  catalogUrl?: string;
  soundFontUrl?: string;
};

export const sharedSessions = mysqlTable("sharedSessions", {
  /** Eight URL-safe random characters; no account identity or private file bytes are stored. */
  id: varchar("id", { length: 8 }).primaryKey(),
  payload: json("payload").$type<SharedSessionPayload>().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type SharedSession = typeof sharedSessions.$inferSelect;
export type InsertSharedSession = typeof sharedSessions.$inferInsert;
