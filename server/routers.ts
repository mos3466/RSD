import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { COOKIE_NAME } from "@shared/const";
import { createDetectionWithIncident, createEvidenceFile, createRfidTrip, getDashboardSummary, listEvidenceFiles, listIncidents, listTrips, updateIncidentStatus } from "./db";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { adminProcedure, protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { storagePut } from "./storage";

const MAX_EVIDENCE_BYTES = 15 * 1024 * 1024;
const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf", "video/mp4", "video/webm"]);
const safeFileName = (name: string) => name.trim().replace(/[^a-zA-Z0-9._-]/g, "-").slice(-180) || "evidence-file";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => { const cookieOptions = getSessionCookieOptions(ctx.req); ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 }); return { success: true } as const; }),
  }),
  evidence: router({
    list: protectedProcedure.query(({ ctx }) => listEvidenceFiles(ctx.user.id)),
    upload: protectedProcedure.input(z.object({ fileName: z.string().min(1).max(255), mimeType: z.string().min(1).max(128), fileSize: z.number().int().positive().max(MAX_EVIDENCE_BYTES), dataBase64: z.string().min(1), trackingId: z.string().max(32).optional(), tripId: z.string().max(32).optional() })).mutation(async ({ ctx, input }) => {
      if (!allowedMimeTypes.has(input.mimeType)) throw new TRPCError({ code: "BAD_REQUEST", message: "Unsupported file type" });
      const bytes = Buffer.from(input.dataBase64, "base64");
      if (bytes.length !== input.fileSize || bytes.length > MAX_EVIDENCE_BYTES) throw new TRPCError({ code: "BAD_REQUEST", message: "File size validation failed" });
      const stored = await storagePut(`evidence/${ctx.user.id}/${Date.now()}-${safeFileName(input.fileName)}`, bytes, input.mimeType);
      return createEvidenceFile({ userId: ctx.user.id, fileName: input.fileName, fileKey: stored.key, fileUrl: stored.url, mimeType: input.mimeType, fileSize: bytes.length, trackingId: input.trackingId ?? null, tripId: input.tripId ?? null });
    }),
  }),
  dashboard: router({
    summary: protectedProcedure.query(() => getDashboardSummary()),
    incidents: protectedProcedure.input(z.object({ status: z.enum(["pending", "confirmed", "rejected"]).optional() }).optional()).query(({ input }) => listIncidents(input?.status)),
    recordDetection: protectedProcedure.input(z.object({ detectionType: z.string().min(1).max(80), cameraId: z.string().min(1).max(32), trackingId: z.string().max(32).optional(), tripId: z.string().max(32).optional(), confidence: z.number().int().min(0).max(100), source: z.enum(["camera", "simulation"]).default("camera"), occurredAt: z.number().int().positive() })).mutation(({ input }) => createDetectionWithIncident({ ...input, trackingId: input.trackingId ?? null, tripId: input.tripId ?? null })),
    reviewIncident: adminProcedure.input(z.object({ incidentId: z.number().int().positive(), status: z.enum(["confirmed", "rejected"]), reviewNote: z.string().max(500).optional() })).mutation(({ ctx, input }) => updateIncidentStatus(input.incidentId, input.status, ctx.user.id, input.reviewNote)),
    trips: protectedProcedure.query(() => listTrips()),
  }),
  rfid: router({
    createTrip: protectedProcedure.input(z.object({ uid: z.string().min(4).max(128), idempotencyKey: z.string().min(8).max(128), startedAt: z.number().int().positive().optional() })).mutation(({ input }) => createRfidTrip({ uid: input.uid, idempotencyKey: input.idempotencyKey, startedAt: input.startedAt ?? Date.now() })),
  }),
});

export type AppRouter = typeof appRouter;
