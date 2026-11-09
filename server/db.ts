import { createHash } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { detectionEvents, evidenceFiles, incidents, InsertEvidenceFile, InsertUser, trips, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;
let _databaseConfigWarned = false;

export function hasUsableDatabaseUrl(value = process.env.DATABASE_URL ?? "") {
  const url = value.trim();
  if (!url) return false;
  return !/^mysql:\/\/USER:PASSWORD@HOST:3306\/DATABASE$/i.test(url);
}

export async function getDb() {
  const databaseUrl = process.env.DATABASE_URL?.trim() ?? "";
  if (!_db && hasUsableDatabaseUrl(databaseUrl)) {
    try { _db = drizzle(databaseUrl); } catch (error) { console.warn("[Database] Failed to connect:", error); _db = null; }
  } else if (!_db && !_databaseConfigWarned) {
    _databaseConfigWarned = true;
    console.warn("[Database] DATABASE_URL is missing or still contains the env.example placeholder; persistence is disabled until a real MySQL URL is configured.");
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  const textFields = ["name", "email", "loginMethod"] as const;
  for (const field of textFields) { if (user[field] !== undefined) { values[field] = user[field] ?? null; updateSet[field] = user[field] ?? null; } }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; } else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (!Object.keys(updateSet).length) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb(); if (!db) return undefined;
  const rows = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return rows[0];
}

export async function listEvidenceFiles(userId: number) {
  const db = await getDb(); if (!db) return [];
  return db.select().from(evidenceFiles).where(eq(evidenceFiles.userId, userId)).orderBy(desc(evidenceFiles.createdAt));
}

export async function createEvidenceFile(file: InsertEvidenceFile) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  const result = await db.insert(evidenceFiles).values(file);
  const rows = await db.select().from(evidenceFiles).where(eq(evidenceFiles.id, Number(result[0].insertId))).limit(1);
  return rows[0];
}

export async function createDetectionWithIncident(input: typeof detectionEvents.$inferInsert) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  // A trip should have one review item per violation type. Camera models can
  // rediscover the same behavior across many frames, so a linked Trip ID is
  // the durable deduplication boundary rather than the frame timestamp.
  if (input.tripId) {
    const linkedDuplicate = await db.select({ detection: detectionEvents, incident: incidents })
      .from(detectionEvents)
      .innerJoin(incidents, eq(incidents.detectionEventId, detectionEvents.id))
      .where(and(
        eq(detectionEvents.tripId, input.tripId),
        eq(detectionEvents.detectionType, input.detectionType),
      )).orderBy(desc(detectionEvents.createdAt)).limit(1);
    if (linkedDuplicate[0]) return linkedDuplicate[0];
  }
  // Treat an identical camera event as a retry rather than creating duplicate logs.
  const duplicate = await db.select({ detection: detectionEvents, incident: incidents })
    .from(detectionEvents)
    .leftJoin(incidents, eq(incidents.detectionEventId, detectionEvents.id))
    .where(and(
      eq(detectionEvents.cameraId, input.cameraId),
      eq(detectionEvents.detectionType, input.detectionType),
      eq(detectionEvents.occurredAt, input.occurredAt),
      input.tripId ? eq(detectionEvents.tripId, input.tripId) : isNull(detectionEvents.tripId),
      input.trackingId ? eq(detectionEvents.trackingId, input.trackingId) : isNull(detectionEvents.trackingId),
    )).limit(1);
  if (duplicate[0]) {
    if (!duplicate[0].incident) {
      await db.insert(incidents).values({ detectionEventId: duplicate[0].detection.id, status: "pending" });
    }
    const existingRows = await db.select({ detection: detectionEvents, incident: incidents })
      .from(detectionEvents).innerJoin(incidents, eq(incidents.detectionEventId, detectionEvents.id))
      .where(eq(detectionEvents.id, duplicate[0].detection.id)).limit(1);
    return existingRows[0];
  }
  const result = await db.insert(detectionEvents).values(input);
  const detectionId = Number(result[0].insertId);
  await db.insert(incidents).values({ detectionEventId: detectionId, status: "pending" });
  const rows = await db.select({ detection: detectionEvents, incident: incidents }).from(detectionEvents).innerJoin(incidents, eq(incidents.detectionEventId, detectionEvents.id)).where(eq(detectionEvents.id, detectionId)).limit(1);
  return rows[0];
}

/** Start of the current dashboard day in ms. Riyadh is UTC+3 with no DST; override with RSD_DAY_UTC_OFFSET_HOURS. */
export function startOfDashboardDay(now = Date.now(), offsetHours = Number(process.env.RSD_DAY_UTC_OFFSET_HOURS ?? 3)) {
  const offsetMs = (Number.isFinite(offsetHours) ? offsetHours : 3) * 3_600_000;
  return Math.floor((now + offsetMs) / 86_400_000) * 86_400_000 - offsetMs;
}

export function retentionDays() {
  const configured = Number(process.env.RSD_RETENTION_DAYS);
  return Number.isFinite(configured) && configured >= 1 ? Math.floor(configured) : 30;
}

/**
 * Retention cleanup is deliberately conservative:
 * - never deletes incidents/review decisions or their source detections;
 * - never deletes active or held trips;
 * - removes only old orphan detections and completed trip history.
 */
export async function purgeOldData(days = retentionDays()) {
  const db = await getDb(); if (!db) return { incidents: 0, detections: 0, trips: 0 };
  const safeDays = Number.isFinite(days) && days >= 1 ? Math.floor(days) : retentionDays();
  const cutoff = new Date(Date.now() - safeDays * 86_400_000);
  const linkedDetectionIds = db.select({ id: incidents.detectionEventId }).from(incidents);
  const removedDetections = await db.delete(detectionEvents).where(and(
    lt(detectionEvents.createdAt, cutoff),
    sql`${detectionEvents.id} NOT IN (${linkedDetectionIds})`,
  ));
  const removedTrips = await db.delete(trips).where(and(
    lt(trips.createdAt, cutoff),
    eq(trips.status, "completed"),
    sql`${trips.tripId} NOT IN (
      SELECT ${detectionEvents.tripId}
      FROM ${detectionEvents}
      INNER JOIN ${incidents} ON ${incidents.detectionEventId} = ${detectionEvents.id}
      WHERE ${detectionEvents.tripId} IS NOT NULL
    )`,
  ));
  return { incidents: 0, detections: Number(removedDetections[0].affectedRows ?? 0), trips: Number(removedTrips[0].affectedRows ?? 0) };
}

export async function listIncidents(status?: "pending" | "confirmed" | "rejected") {
  const db = await getDb(); if (!db) return [];
  // The default review queue contains only unresolved items.
  const condition = eq(incidents.status, status ?? "pending");
  return db.select({ incident: incidents, detection: detectionEvents }).from(incidents).innerJoin(detectionEvents, eq(incidents.detectionEventId, detectionEvents.id)).where(condition).orderBy(desc(incidents.createdAt)).limit(100);
}

export async function updateIncidentStatus(id: number, status: "confirmed" | "rejected", reviewerId: number, reviewNote?: string) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  if (status === "confirmed") {
    const source = await db.select({ tripId: detectionEvents.tripId }).from(incidents)
      .innerJoin(detectionEvents, eq(incidents.detectionEventId, detectionEvents.id))
      .where(eq(incidents.id, id)).limit(1);
    if (!source[0]?.tripId) throw new Error("Cannot confirm a violation without a linked Trip ID");
  }
  // A reviewed item is immutable through this action; repeated clicks cannot recount or overwrite it.
  await db.update(incidents).set({ status, reviewerId, reviewedAt: new Date(), reviewNote: reviewNote ?? null })
    .where(and(eq(incidents.id, id), eq(incidents.status, "pending")));
  const rows = await db.select({ incident: incidents, detection: detectionEvents }).from(incidents).innerJoin(detectionEvents, eq(incidents.detectionEventId, detectionEvents.id)).where(eq(incidents.id, id)).limit(1);
  return rows[0];
}

export async function getDashboardSummary() {
  const db = await getDb(); if (!db) return { detections: 0, pending: 0, confirmed: 0, rejected: 0, latest: [] };
  const [detections, pending, confirmed, rejected, latest] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(detectionEvents),
    db.select({ count: sql<number>`count(*)` }).from(incidents).where(eq(incidents.status, "pending")),
    db.select({ count: sql<number>`count(*)` }).from(incidents).where(eq(incidents.status, "confirmed")),
    db.select({ count: sql<number>`count(*)` }).from(incidents).where(eq(incidents.status, "rejected")),
    listIncidents("pending"),
  ]);
  return { detections: Number(detections[0]?.count ?? 0), pending: Number(pending[0]?.count ?? 0), confirmed: Number(confirmed[0]?.count ?? 0), rejected: Number(rejected[0]?.count ?? 0), latest: latest.slice(0, 5) };
}

export function hashCardUid(uid: string) {
  return createHash("sha256").update(uid.trim().toUpperCase()).digest("hex");
}

/** A second tap of the same card moments after entry is almost always an accidental double-tap, not an exit. */
export function rescanGuardMs() {
  const configured = Number(process.env.RSD_RESCAN_GUARD_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : 10000;
}

export function isAccidentalRescan(tripStartedAt: number, scannedAt: number, guardMs = rescanGuardMs()) {
  const elapsed = scannedAt - tripStartedAt;
  return elapsed >= 0 && elapsed < guardMs;
}

/** The default single-reader setup treats a later tap as the passenger's exit. */
export function shouldTreatAsExit(direction: "entry" | "exit", accidentalRescan: boolean) {
  return direction === "exit" || (direction === "entry" && !accidentalRescan);
}

export function resolveRfidExitDecision(status: "active" | "completed" | "hold", hasConfirmedViolation: boolean) {
  if (status === "hold" || hasConfirmedViolation) {
    // The passenger is referred to staff and this gate transaction is closed.
    // The reviewed incident remains stored; a later tap starts a new trip.
    return { decision: "HOLD" as const, nextStatus: "completed" as const, message: "Please proceed to the ticket counter." };
  }
  return { decision: "EXIT_ALLOWED" as const, nextStatus: "completed" as const, message: "Goodbye" };
}

export async function createRfidTrip(input: { uid: string; idempotencyKey: string; startedAt: number }) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  const normalizedUid = input.uid.trim().toUpperCase();
  const existing = await db.select().from(trips).where(eq(trips.idempotencyKey, input.idempotencyKey)).limit(1);
  if (existing[0]) return { trip: existing[0], duplicate: true };
  const provisionalTripId = `PENDING-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const result = await db.insert(trips).values({ tripId: provisionalTripId, cardUid: normalizedUid, cardUidHash: hashCardUid(normalizedUid), idempotencyKey: input.idempotencyKey, startedAt: input.startedAt, lastScanAt: input.startedAt, status: "active" });
  const id = Number(result[0].insertId);
  const tripId = `T${String(id).padStart(6, "0")}`;
  await db.update(trips).set({ tripId }).where(eq(trips.id, id));
  const rows = await db.select().from(trips).where(eq(trips.id, id)).limit(1);
  return { trip: rows[0], duplicate: false };
}

export async function processRfidScan(input: { uid: string; eventId: string; startedAt: number; direction?: "entry" | "exit" }) {
  const db = await getDb(); if (!db) throw new Error("Database is not configured");
  const normalizedUid = input.uid.trim().toUpperCase();
  const uidHash = hashCardUid(normalizedUid);
  const direction = input.direction ?? "entry";

  const entryRetry = await db.select().from(trips).where(eq(trips.idempotencyKey, input.eventId)).limit(1);
  if (entryRetry[0]) return { trip: entryRetry[0], scan: "entry" as const, decision: "TRIP_ACTIVE" as const, duplicate: true, message: "Trip already active" };

  const exitRetry = await db.select().from(trips).where(eq(trips.lastScanEventId, input.eventId)).limit(1);
  if (exitRetry[0]) {
    const decision = exitRetry[0].lastScanDecision === "HOLD" || exitRetry[0].status === "hold" ? "HOLD" as const : "EXIT_ALLOWED" as const;
    return { trip: exitRetry[0], scan: "exit" as const, decision, duplicate: true, message: decision === "HOLD" ? "Please proceed to the ticket counter." : "Goodbye" };
  }

  const activeTrip = await db.select().from(trips)
    .where(and(eq(trips.cardUidHash, uidHash), inArray(trips.status, ["active", "hold"])))
    .orderBy(desc(trips.createdAt)).limit(1);

  if (!activeTrip[0] && direction === "exit") {
    return { trip: null, scan: "exit" as const, decision: "SCAN_ERROR" as const, duplicate: false, message: "No active trip found for exit scan" };
  }

  if (!activeTrip[0]) {
    const created = await createRfidTrip({ uid: normalizedUid, idempotencyKey: input.eventId, startedAt: input.startedAt });
    return { trip: created.trip, scan: "entry" as const, decision: "TRIP_ACTIVE" as const, duplicate: created.duplicate, message: "Trip created" };
  }

  const trip = activeTrip[0];
  // In the default single-reader setup, a tap after the accidental-rescan
  // window is the passenger's exit. A separately configured exit reader also
  // follows this same path immediately.
  const accidentalRescan = isAccidentalRescan(trip.lastScanAt ?? trip.startedAt, input.startedAt);
  if (!shouldTreatAsExit(direction, accidentalRescan)) {
    await db.update(trips).set({ lastScanAt: input.startedAt }).where(eq(trips.id, trip.id));
    return { trip: { ...trip, lastScanAt: input.startedAt }, scan: "entry" as const, decision: "TRIP_ACTIVE" as const, duplicate: true, message: "Trip remains active; entry scan received" };
  }

  const confirmed = await db.select({ id: incidents.id }).from(incidents)
    .innerJoin(detectionEvents, eq(incidents.detectionEventId, detectionEvents.id))
    .where(and(eq(detectionEvents.tripId, trip.tripId), eq(incidents.status, "confirmed"))).limit(1);

  const decision = resolveRfidExitDecision(trip.status, confirmed.length > 0);
  await db.update(trips).set({ status: decision.nextStatus, lastScanEventId: input.eventId, lastScanAt: input.startedAt, lastScanDecision: decision.decision }).where(eq(trips.id, trip.id));
  const updated = { ...trip, status: decision.nextStatus, lastScanEventId: input.eventId, lastScanAt: input.startedAt, lastScanDecision: decision.decision };
  return {
    trip: updated,
    scan: "exit" as const,
    decision: decision.decision,
    duplicate: false,
    message: decision.message,
  };
}

export async function listTrips(limit = 25) {
  const db = await getDb(); if (!db) return [];
  return db.select({ id: trips.id, tripId: trips.tripId, cardUid: trips.cardUid, startedAt: trips.startedAt, status: trips.status, createdAt: trips.createdAt }).from(trips).where(or(gte(trips.createdAt, new Date(startOfDashboardDay())), inArray(trips.status, ["active", "hold"]))).orderBy(desc(trips.createdAt)).limit(limit);
}
