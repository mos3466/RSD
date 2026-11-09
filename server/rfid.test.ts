import { describe, expect, it } from "vitest";
import { hasUsableDatabaseUrl, hashCardUid, isAccidentalRescan, resolveRfidExitDecision, shouldTreatAsExit, startOfDashboardDay } from "./db";
import { validateRfidPayload } from "./rfidBridge";

describe("RFID bridge", () => {
  it("accepts a valid UID and event id while normalizing whitespace", () => {
    expect(validateRfidPayload({ uid: " aa:bb:cc:dd ", eventId: "arduino-event-001", startedAt: 1700000000000 })).toEqual({ uid: "aa:bb:cc:dd", eventId: "arduino-event-001", startedAt: 1700000000000, direction: "entry" });
  });

  it("accepts an explicitly configured exit reader", () => {
    expect(validateRfidPayload({ uid: "AA:BB:CC:DD", eventId: "arduino-event-002", direction: "exit" })).toMatchObject({ direction: "exit" });
  });

  it("rejects an invalid scan direction", () => {
    expect(validateRfidPayload({ uid: "AA:BB:CC:DD", eventId: "arduino-event-003", direction: "sideways" })).toEqual({ error: "Invalid scan direction" });
  });

  it("rejects malformed UID and event values", () => {
    expect(validateRfidPayload({ uid: "not-a-card", eventId: "short" })).toEqual({ error: "Invalid RFID UID" });
    expect(validateRfidPayload({ uid: "AA:BB:CC:DD", eventId: "bad event id" })).toEqual({ error: "Invalid event ID" });
  });

  it("hashes equivalent UID formatting to the same non-raw value", () => {
    const first = hashCardUid("aa:bb:cc:dd");
    const second = hashCardUid(" AA:BB:CC:DD ");
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(first).not.toContain("AA:BB:CC:DD");
  });

  it("allows exit when the active trip has no confirmed violation", () => {
    expect(resolveRfidExitDecision("active", false)).toEqual({ decision: "EXIT_ALLOWED", nextStatus: "completed", message: "Goodbye" });
  });

  it("places an active trip on hold when a violation is confirmed", () => {
    expect(resolveRfidExitDecision("active", true)).toEqual({ decision: "HOLD", nextStatus: "completed", message: "Please proceed to the ticket counter." });
  });

  it("closes an already-held trip after referring the passenger to staff", () => {
    expect(resolveRfidExitDecision("hold", false)).toEqual({ decision: "HOLD", nextStatus: "completed", message: "Please proceed to the ticket counter." });
  });

  it("treats a second tap within the 10-second guard window as an accidental double-tap", () => {
    expect(isAccidentalRescan(1_000_000, 1_009_999, 10000)).toBe(true);
    expect(isAccidentalRescan(1_000_000, 1_010_000, 10000)).toBe(false);
    expect(shouldTreatAsExit("entry", true)).toBe(false);
    expect(shouldTreatAsExit("entry", false)).toBe(true);
    expect(shouldTreatAsExit("exit", true)).toBe(true);
  });

  it("uses the previous scan timestamp as the cooldown anchor", () => {
    expect(isAccidentalRescan(1_010_000, 1_019_000, 10000)).toBe(true);
  });

  it("does not treat a scan older than the trip start (clock skew) as a double-tap", () => {
    expect(isAccidentalRescan(1_000_000, 999_000, 10000)).toBe(false);
  });

  it("does not treat the env.example database placeholder as a real database", () => {
    expect(hasUsableDatabaseUrl("mysql://USER:PASSWORD@HOST:3306/DATABASE")).toBe(false);
    expect(hasUsableDatabaseUrl("mysql://root:secret@127.0.0.1:3306/rasd")).toBe(true);
  });

  it("starts the dashboard day at midnight Riyadh time (UTC+3)", () => {
    const noonRiyadh = Date.UTC(2026, 9, 29, 9, 0, 0); // 12:00 in Riyadh
    expect(startOfDashboardDay(noonRiyadh, 3)).toBe(Date.UTC(2026, 9, 28, 21, 0, 0)); // 00:00 Riyadh = 21:00 UTC the day before
    const justAfterMidnight = Date.UTC(2026, 9, 28, 21, 0, 1);
    expect(startOfDashboardDay(justAfterMidnight, 3)).toBe(Date.UTC(2026, 9, 28, 21, 0, 0));
    const justBeforeMidnight = Date.UTC(2026, 9, 28, 20, 59, 59);
    expect(startOfDashboardDay(justBeforeMidnight, 3)).toBe(Date.UTC(2026, 9, 27, 21, 0, 0));
  });
});
