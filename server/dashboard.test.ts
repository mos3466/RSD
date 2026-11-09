import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type User = NonNullable<TrpcContext["user"]>;
const baseUser: User = { id: 9, openId: "dashboard-test", email: "operator@example.com", name: "Operator", loginMethod: "test", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };

function context(user: TrpcContext["user"]): TrpcContext {
  return { user, req: { protocol: "https", headers: {} } as TrpcContext["req"], res: {} as TrpcContext["res"] };
}

describe("dashboard procedures", () => {
  it("requires authentication to record a detection", async () => {
    const caller = appRouter.createCaller(context(null));
    await expect(caller.dashboard.recordDetection({ detectionType: "Eating", cameraId: "C04", confidence: 94, occurredAt: Date.now(), source: "camera" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("prevents non-admin operators from changing incident review status", async () => {
    const caller = appRouter.createCaller(context(baseUser));
    await expect(caller.dashboard.reviewIncident({ incidentId: 1, status: "confirmed" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects confidence values outside the supported range", async () => {
    const caller = appRouter.createCaller(context(baseUser));
    await expect(caller.dashboard.recordDetection({ detectionType: "Eating", cameraId: "C04", confidence: 101, occurredAt: Date.now(), source: "camera" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
