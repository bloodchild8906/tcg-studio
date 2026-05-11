/**
 * Centralized error handler.
 *
 * Rules:
 *   • Zod errors → 400 with the issue list (clients can highlight the bad field).
 *   • Prisma "record not found" (P2025) → 404.
 *   • Prisma unique-constraint violations (P2002) → 409.
 *   • Anything else → 500 with a generic message; the real error goes to logs.
 *
 * We intentionally don't expose Prisma error.meta to clients — it can leak
 * column names and DB structure.
 */

import fp from "fastify-plugin";
import { ZodError } from "zod";
import { loadEnv } from "@/env";
import { LimitExceededError, FeatureDisabledError } from "@/lib/plans";

export default fp(async (fastify) => {
  fastify.setErrorHandler((err, request, reply) => {
    const error = err as any;
    // Plan limit / feature flag — return a structured 403 so the
    // frontend can prompt the user to upgrade rather than just
    // showing a generic error toast.
    if (err instanceof LimitExceededError) {
      return reply.code(403).send({
        error: "plan_limit_exceeded",
        message: err.message,
        limit: err.limit,
        current: err.current,
        cap: err.cap,
      });
    }
    if (err instanceof FeatureDisabledError) {
      return reply.code(403).send({
        error: "plan_feature_disabled",
        message: err.message,
        feature: err.feature,
      });
    }

    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: "validation_error",
        issues: err.issues.map((i) => ({
          path: i.path.join("."),
          message: i.message,
          code: i.code,
        })),
      });
    }

    if (err.name === "PrismaClientKnownRequestError" || error.code?.startsWith("P2")) {
      if (error.code === "P2025") {
        return reply.code(404).send({
          error: "not_found",
          message: "Record not found.",
        });
      }
      if (error.code === "P2002") {
        return reply.code(409).send({
          error: "conflict",
          message: "A record with the same unique fields already exists.",
        });
      }
    }

    const env = loadEnv();
    request.log.error({ err, url: request.url }, "unhandled error");
    return reply.code(500).send({
      error: "internal_error",
      message: error.message || "Something went wrong.",
      code: error.code,
      name: err.name,
      stack: env.NODE_ENV === "development" ? (err as Error).stack : undefined,
    });
  });
});
