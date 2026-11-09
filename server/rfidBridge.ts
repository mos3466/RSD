import { timingSafeEqual } from "node:crypto";
import type { Express, Request, Response } from "express";
import { processRfidScan } from "./db";

function authorized(request: Request) {
  const expected = process.env.RSD_BRIDGE_API_KEY?.trim();
  const received = request.header("x-rsd-bridge-key")?.trim();
  if (!expected || !received) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function validateRfidPayload(body: { uid?: unknown; eventId?: unknown; startedAt?: unknown; direction?: unknown }) {
  const uid = typeof body.uid === "string" ? body.uid.trim() : "";
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  const startedAt = typeof body.startedAt === "number" ? body.startedAt : Date.now();
  const direction = body.direction === undefined ? "entry" : body.direction;
  if (direction !== "entry" && direction !== "exit") return { error: "Invalid scan direction" } as const;
  if (uid.length < 4 || uid.length > 128 || !/^[0-9A-Fa-f: -]+$/.test(uid)) return { error: "Invalid RFID UID" } as const;
  if (eventId.length < 8 || eventId.length > 128 || !/^[a-zA-Z0-9._:-]+$/.test(eventId)) return { error: "Invalid event ID" } as const;
  if (!Number.isInteger(startedAt) || startedAt < 1) return { error: "Invalid start time" } as const;
  return { uid, eventId, startedAt, direction } as const;
}

export function registerRfidBridgeRoute(app: Express) {
  app.post("/api/rfid/trips", async (request: Request, response: Response) => {
    if (!process.env.RSD_BRIDGE_API_KEY) return response.status(503).json({ error: "RFID bridge is not configured" });
    if (!authorized(request)) return response.status(401).json({ error: "Unauthorized RFID bridge" });
    const parsed = validateRfidPayload(request.body as { uid?: unknown; eventId?: unknown; startedAt?: unknown; direction?: unknown });
    if ("error" in parsed) return response.status(400).json(parsed);
    try {
      const result = await processRfidScan({ uid: parsed.uid, eventId: parsed.eventId, startedAt: parsed.startedAt, direction: parsed.direction });
      return response.status(result.scan === "entry" && !result.duplicate ? 201 : 200).json({
        trip: result.trip,
        scan: result.scan,
        decision: result.decision,
        message: result.message,
        duplicate: result.duplicate,
      });
    } catch (error) {
      console.error("[RFID bridge] Failed to create trip", error);
      return response.status(500).json({ error: "Unable to create RFID trip" });
    }
  });
}
