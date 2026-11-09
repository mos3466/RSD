import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createContext(user: TrpcContext["user"]): TrpcContext {
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const operator: AuthenticatedUser = {
  id: 7,
  openId: "evidence-test-user",
  email: "operator@example.com",
  name: "RSD Operator",
  loginMethod: "test",
  role: "user",
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

describe("evidence access", () => {
  it("requires authentication to list evidence", async () => {
    const caller = appRouter.createCaller(createContext(null));
    await expect(caller.evidence.list()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
  });

  it("rejects unsupported evidence types before storage upload", async () => {
    const caller = appRouter.createCaller(createContext(operator));
    await expect(
      caller.evidence.upload({
        fileName: "payload.exe",
        mimeType: "application/x-msdownload",
        fileSize: 3,
        dataBase64: "YWJj",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Unsupported file type" });
  });
});
