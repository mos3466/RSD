import { bigint, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const evidenceFiles = mysqlTable("evidenceFiles", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  fileName: varchar("fileName", { length: 255 }).notNull(),
  fileKey: varchar("fileKey", { length: 512 }).notNull().unique(),
  fileUrl: varchar("fileUrl", { length: 768 }).notNull(),
  mimeType: varchar("mimeType", { length: 128 }).notNull(),
  fileSize: int("fileSize").notNull(),
  trackingId: varchar("trackingId", { length: 32 }),
  tripId: varchar("tripId", { length: 32 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const detectionEvents = mysqlTable("detectionEvents", {
  id: int("id").autoincrement().primaryKey(),
  detectionType: varchar("detectionType", { length: 80 }).notNull(),
  cameraId: varchar("cameraId", { length: 32 }).notNull(),
  trackingId: varchar("trackingId", { length: 32 }),
  tripId: varchar("tripId", { length: 32 }),
  confidence: int("confidence").notNull(),
  source: mysqlEnum("source", ["camera", "simulation"]).default("camera").notNull(),
  occurredAt: bigint("occurredAt", { mode: "number" }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const incidents = mysqlTable("incidents", {
  id: int("id").autoincrement().primaryKey(),
  detectionEventId: int("detectionEventId").notNull(),
  status: mysqlEnum("status", ["pending", "confirmed", "rejected"]).default("pending").notNull(),
  reviewerId: int("reviewerId"),
  reviewedAt: timestamp("reviewedAt"),
  reviewNote: text("reviewNote"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const trips = mysqlTable("trips", {
  id: int("id").autoincrement().primaryKey(),
  tripId: varchar("tripId", { length: 32 }).notNull().unique(),
  cardUid: varchar("cardUid", { length: 128 }),
  cardUidHash: varchar("cardUidHash", { length: 64 }).notNull(),
  idempotencyKey: varchar("idempotencyKey", { length: 128 }).notNull().unique(),
  lastScanEventId: varchar("lastScanEventId", { length: 128 }).unique(),
  startedAt: bigint("startedAt", { mode: "number" }).notNull(),
  lastScanAt: bigint("lastScanAt", { mode: "number" }),
  lastScanDecision: varchar("lastScanDecision", { length: 24 }),
  status: mysqlEnum("status", ["active", "completed", "hold"]).default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type EvidenceFile = typeof evidenceFiles.$inferSelect;
export type InsertEvidenceFile = typeof evidenceFiles.$inferInsert;
export type DetectionEvent = typeof detectionEvents.$inferSelect;
export type Incident = typeof incidents.$inferSelect;
export type Trip = typeof trips.$inferSelect;
