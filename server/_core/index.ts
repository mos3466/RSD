import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { registerRfidBridgeRoute } from "../rfidBridge";
import { hasUsableDatabaseUrl, purgeOldData, retentionDays } from "../db";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  registerRfidBridgeRoute(app);
  app.get("/api/health", (_request, response) => {
    const databaseConfigured = hasUsableDatabaseUrl();
    const bridgeConfigured = Boolean(process.env.RSD_BRIDGE_API_KEY?.trim());
    response.status(databaseConfigured && bridgeConfigured ? 200 : 503).json({
      ok: databaseConfigured && bridgeConfigured,
      databaseConfigured,
      bridgeConfigured,
      oauthConfigured: Boolean(process.env.VITE_APP_ID?.trim()),
      message: databaseConfigured && bridgeConfigured
        ? "RSD backend is ready for RFID persistence"
        : "Configure a real DATABASE_URL and RSD_BRIDGE_API_KEY before testing RFID persistence",
    });
  });
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // `pnpm dev` must work on Windows without the POSIX `NODE_ENV=value` syntax.
  // Production is explicit; every other mode uses the Vite development server.
  if (process.env.NODE_ENV !== "production") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });

  // Remove old detections/incidents/trips: once at startup, then every 24 hours.
  const runPurge = async () => {
    try {
      const removed = await purgeOldData(retentionDays());
      console.log(`[Retention] Removed data older than ${retentionDays()} days`, removed);
    } catch (error) {
      console.error("[Retention] Cleanup failed", error);
    }
  };
  void runPurge();
  setInterval(runPurge, 24 * 60 * 60 * 1000).unref();
}

startServer().catch(console.error);
