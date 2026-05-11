/**
 * Prisma plugin.
 *
 * Decorates the Fastify instance with a singleton PrismaClient and disconnects
 * it on shutdown. We use a singleton instead of creating a client per request
 * because Prisma manages its own connection pool internally.
 *
 * Tenant scoping happens in the *tenant* plugin, not here — Prisma stays
 * tenant-agnostic so plugins / migrations / scripts that legitimately need
 * cross-tenant access aren't fighting the framework.
 */

import { PrismaClient } from "@prisma/client";
import fp from "fastify-plugin";

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }
}

export default fp(async (fastify) => {
  const prisma = new PrismaClient({
    log:
      fastify.log.level === "debug"
        ? ["query", "info", "warn", "error"]
        : ["warn", "error"],
  });

  await prisma.$connect();
  fastify.decorate("prisma", prisma);

  fastify.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
