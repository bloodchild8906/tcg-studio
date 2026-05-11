/**
 * Auth plugin.
 *
 * Registers @fastify/jwt and decorates `request.currentUser` when a Bearer
 * token is present and valid. We deliberately DON'T enforce auth here — that
 * stays opt-in per route, so existing tenant-scoped endpoints still work
 * with header-based tenant resolution while we build out the auth UI.
 *
 * Token shape (signed):
 *   {
 *     sub: userId,
 *     email: user.email,
 *     iat / exp: standard JWT
 *   }
 *
 * `requireUser(request)` is a tiny helper for routes that DO want auth:
 * throws a 401 with `request.unauthorized()` (from @fastify/sensible) if no
 * user is attached.
 */

import fp from "fastify-plugin";
import jwt from "@fastify/jwt";
import crypto from "node:crypto";
import type { FastifyRequest } from "fastify";
import { loadEnv } from "@/env";

export interface CurrentUser {
  id: string;
  email: string;
  name: string;
}

/**
 * When the request authenticated via API key (not JWT), we attach the
 * key's tenantId + scopes here. Routes that need scope enforcement
 * read `request.apiKey?.scopes` and 403 on mismatch.
 */
export interface ApiKeyContext {
  id: string;
  tenantId: string;
  /** Project scope for the key, if any. When set, downstream gates
   *  refuse cross-project access. Null = tenant-wide key. */
  projectId: string | null;
  scopes: string[];
  /** True when the JWT path didn't run — there's no human user behind this. */
  systemActor: true;
}

declare module "fastify" {
  interface FastifyRequest {
    currentUser?: CurrentUser;
    apiKey?: ApiKeyContext;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; email: string };
    user: { sub: string; email: string };
  }
}

export default fp(async (fastify) => {
  const env = loadEnv();

  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // Pre-handler that opportunistically decodes a Bearer token. Failures are
  // SILENT here — endpoints that need auth call `requireUser` themselves.
  fastify.addHook("preHandler", async (request) => {
    let token: string | undefined;

    // 1. Check Authorization header
    const authHeader = request.headers.authorization;
    if (authHeader?.toLowerCase().startsWith("bearer ")) {
      token = authHeader.slice(7).trim();
    }

    // 2. Fallback to query param (for <img> tags)
    if (!token) {
      const query = request.query as Record<string, unknown> | undefined;
      if (typeof query?.token === "string") {
        token = query.token.trim();
      }
    }

    if (!token) return;

    // API key path — `tcgs_<hex>` tokens skip JWT verification and
    // hit the ApiKey table directly. We sha256 the plaintext and look
    // up the hash. Hits update lastUsedAt async (don't block the
    // request on the audit write).
    if (token.startsWith("tcgs_")) {
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      const key = await fastify.prisma.apiKey.findUnique({
        where: { tokenHash: hash },
        select: {
          id: true,
          tenantId: true,
          projectId: true,
          scopesJson: true,
          revokedAt: true,
          expiresAt: true,
        },
      });
      if (!key) return;
      if (key.revokedAt) return;
      if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return;
      const scopes = Array.isArray(key.scopesJson)
        ? (key.scopesJson as string[]).filter((s) => typeof s === "string")
        : [];
      request.apiKey = {
        id: key.id,
        tenantId: key.tenantId,
        projectId: key.projectId ?? null,
        scopes,
        systemActor: true,
      };
      // Update lastUsedAt without awaiting — this is housekeeping,
      // shouldn't block the response. We still log failures.
      void fastify.prisma.apiKey
        .update({
          where: { id: key.id },
          data: { lastUsedAt: new Date() },
        })
        .catch((err) =>
          request.log.error({ err }, "apikey.lastUsedAt write failed"),
        );
      return;
    }

    try {
      // @fastify/jwt verify() is asynchronous.
      const decoded = await fastify.jwt.verify<{ sub: string; email: string }>(token);
      if (!decoded?.sub) return;

      const user = await fastify.prisma.user.findUnique({
        where: { id: decoded.sub },
        select: { id: true, email: true, name: true },
      });
      if (user) {
        request.currentUser = user;
      }
    } catch (err) {
      // Bad / expired token — leave currentUser unset.
      request.log.debug({ err, token: token.slice(0, 10) + "..." }, "JWT verification failed");
    }
  });
});

export function requireUser(request: FastifyRequest): CurrentUser {
  if (!request.currentUser) {
    const err = new Error("auth_required") as Error & { statusCode?: number };
    err.statusCode = 401;
    throw err;
  }
  return request.currentUser;
}
