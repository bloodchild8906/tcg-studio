/**
 * Tenant custom-domain routes (sec 11.5).
 *
 * Lifecycle of a custom domain:
 *
 *   1. POST /api/v1/domains  — tenant submits a hostname.
 *      We persist a row with status=pending and a verification token.
 *
 *   2. The tenant adds two DNS records at their registrar:
 *        TXT  _tcgstudio-verify.<host>  "<verificationToken>"
 *        CNAME <host>                    <CUSTOM_DOMAIN_CNAME_TARGET>
 *
 *   3. POST /api/v1/domains/:id/verify  — we resolve TXT + CNAME live.
 *        • TXT good but CNAME missing/wrong  → status=verified  (DNS
 *          ownership proven, but traffic isn't pointed at us yet).
 *        • Both good                          → status=active
 *          (the domain serves traffic for this tenant; the proxy can
 *          issue a cert via on-demand TLS now).
 *        • TXT bad                            → status=failed
 *
 *   4. The tenant plugin (`plugins/tenant.ts`) reads the active
 *      TenantDomain table on every request to resolve `Host:` →
 *      tenant. So as soon as the row flips to `active`, traffic for
 *      that hostname lands in the right tenant.
 *
 *   5. The HTTP proxy in front of us (Caddy / Traefik / NGINX) calls
 *      the on-demand-TLS hook (`/api/internal/domain-allowed`) before
 *      issuing certs, so we never burn a Let's Encrypt order on a
 *      hostname that isn't actually configured.
 *
 * Re-checks: tenants can re-run verification any time via the same
 * endpoint. We always update `lastCheckedAt` and `statusReason` so the
 * UI can show why something is stuck.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import { requireTenant } from "@/plugins/tenant";
import { loadEnv } from "@/env";

const idParam = z.object({ id: z.string().min(1) });

// RFC 1035-ish hostname check. Liberal on length (DNS allows up to
// 253), strict on charset to avoid CR/LF injection or wildcards.
const hostnameSchema = z
  .string()
  .min(1)
  .max(253)
  .regex(/^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/);

const createBody = z.object({
  hostname: hostnameSchema,
  /** Optional — when set, this domain pins to a specific project. */
  projectSlug: z.string().min(1).max(80).optional(),
  /** Mark this as the primary canonical domain. Auto-clears any other primary. */
  isPrimary: z.boolean().optional(),
});

const patchBody = z.object({
  isPrimary: z.boolean().optional(),
  projectSlug: z.string().min(1).max(80).nullable().optional(),
  status: z.enum(["pending", "verified", "active", "failed", "disabled"]).optional(),
});

export default async function tenantDomainRoutes(fastify: FastifyInstance) {
  const env = loadEnv();

  fastify.get("/api/v1/domains", async (request) => {
    const { tenantId } = requireTenant(request);
    const domains = await fastify.prisma.tenantDomain.findMany({
      where: { tenantId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    return { domains };
  });

  fastify.post("/api/v1/domains", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const body = createBody.parse(request.body);
    const hostname = body.hostname.toLowerCase();

    // Reject duplicates up front — the unique index would do the same
    // but a friendlier 409 reads better in the UI.
    const existing = await fastify.prisma.tenantDomain.findUnique({
      where: { hostname },
      select: { tenantId: true },
    });
    if (existing) {
      return reply.code(409).send({
        error: "hostname_taken",
        message:
          existing.tenantId === tenantId
            ? "You've already registered this hostname."
            : "This hostname is already claimed by another tenant.",
      });
    }

    const verificationToken = `tcgs-${crypto.randomBytes(16).toString("hex")}`;

    const domain = await fastify.prisma.tenantDomain.create({
      data: {
        tenantId,
        hostname,
        verificationToken,
        projectSlug: body.projectSlug ?? null,
        isPrimary: body.isPrimary ?? false,
        status: "pending",
        statusReason: "txt_missing",
      },
    });

    if (body.isPrimary) {
      await clearOtherPrimary(fastify, tenantId, domain.id);
    }

    return reply.code(201).send({
      domain,
      instructions: dnsInstructions(hostname, verificationToken, env),
    });
  });

  fastify.get("/api/v1/domains/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const domain = await fastify.prisma.tenantDomain.findFirstOrThrow({
      where: { id, tenantId },
    });
    return {
      domain,
      instructions: dnsInstructions(domain.hostname, domain.verificationToken, env),
    };
  });

  /**
   * Run a real DNS check. Updates the row in place with the result.
   * Returns the (possibly updated) row plus a `check` block so the UI
   * can show what we actually saw on the wire — useful when the tenant
   * thinks they added the records but DNS hasn't propagated yet.
   */
  fastify.post("/api/v1/domains/:id/verify", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);

    const existing = await fastify.prisma.tenantDomain.findFirst({
      where: { id, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: "not_found" });
    if (existing.status === "disabled") {
      return reply.code(400).send({ error: "domain_disabled" });
    }

    const acceptedTargets = parseAcceptedTargets(env);
    const check = await runDnsCheck({
      hostname: existing.hostname,
      verificationToken: existing.verificationToken,
      cnameTarget: env.CUSTOM_DOMAIN_CNAME_TARGET,
      acceptedTargets,
    });

    const next = decideStatus(check);

    const updated = await fastify.prisma.tenantDomain.update({
      where: { id: existing.id },
      data: {
        status: next.status,
        statusReason: next.reason,
        lastCheckedAt: new Date(),
        verifiedAt: next.status === "active" ? new Date() : existing.verifiedAt,
      },
    });

    return reply.send({ domain: updated, check });
  });

  /** Alias — same as /verify, just clearer in the UI. */
  fastify.post("/api/v1/domains/:id/recheck", async (request, reply) => {
    return fastify.inject({
      method: "POST",
      url: `/api/v1/domains/${idParam.parse(request.params).id}/verify`,
      headers: request.headers as Record<string, string>,
      payload: {},
    }).then((r) => reply.code(r.statusCode).send(r.json()));
  });

  fastify.patch("/api/v1/domains/:id", async (request) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const body = patchBody.parse(request.body);

    const data: Record<string, unknown> = {};
    if (body.isPrimary !== undefined) data.isPrimary = body.isPrimary;
    if (body.projectSlug !== undefined) data.projectSlug = body.projectSlug;
    if (body.status !== undefined) {
      data.status = body.status;
      // When an admin manually flips status, capture the reason so the
      // UI doesn't show a stale automatic message.
      data.statusReason =
        body.status === "disabled"
          ? "manual_disabled"
          : body.status === "active"
          ? "ok"
          : null;
    }

    const result = await fastify.prisma.tenantDomain.updateMany({
      where: { id, tenantId },
      data,
    });
    if (result.count === 0) return { error: "not_found" };
    const domain = await fastify.prisma.tenantDomain.findFirstOrThrow({
      where: { id, tenantId },
    });
    if (body.isPrimary === true) {
      await clearOtherPrimary(fastify, tenantId, id);
    }
    return { domain };
  });

  fastify.delete("/api/v1/domains/:id", async (request, reply) => {
    const { tenantId } = requireTenant(request);
    const { id } = idParam.parse(request.params);
    const result = await fastify.prisma.tenantDomain.deleteMany({
      where: { id, tenantId },
    });
    if (result.count === 0) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}

/**
 * Build the human-readable DNS setup instructions returned alongside
 * a freshly-created or just-fetched domain row. The frontend renders
 * these verbatim.
 */
function dnsInstructions(
  hostname: string,
  token: string,
  env: ReturnType<typeof loadEnv>,
) {
  return {
    txt: {
      name: `_tcgstudio-verify.${hostname}`,
      value: token,
      ttl: 300,
    },
    cname: {
      name: hostname,
      value: env.CUSTOM_DOMAIN_CNAME_TARGET,
      note:
        "Apex domains can't have a CNAME — use ALIAS / ANAME at your DNS host, " +
        "or an A record at " +
        env.CUSTOM_DOMAIN_CNAME_TARGET +
        "'s public IP if your provider doesn't support flattening.",
    },
  };
}

async function clearOtherPrimary(fastify: FastifyInstance, tenantId: string, keepId: string) {
  await fastify.prisma.tenantDomain.updateMany({
    where: { tenantId, id: { not: keepId }, isPrimary: true },
    data: { isPrimary: false },
  });
}

// ---------------------------------------------------------------------------
// DNS verification
// ---------------------------------------------------------------------------

interface DnsCheckResult {
  txt: {
    name: string;
    expected: string;
    /** All TXT records we found (or null if lookup failed). */
    found: string[] | null;
    /** Did at least one record match the expected token? */
    matched: boolean;
    error?: string;
  };
  cname: {
    name: string;
    /** Hostnames the lookup resolved to (CNAME chain) or A-record IPs. */
    found: string[] | null;
    /** Acceptable target list passed to the check. */
    expected: string[];
    matched: boolean;
    error?: string;
  };
}

interface CheckInput {
  hostname: string;
  verificationToken: string;
  cnameTarget: string;
  acceptedTargets: string[];
}

async function runDnsCheck(input: CheckInput): Promise<DnsCheckResult> {
  const txt = await checkTxt(input);
  const cname = await checkCname(input);
  return { txt, cname };
}

async function checkTxt(input: CheckInput): Promise<DnsCheckResult["txt"]> {
  const name = `_tcgstudio-verify.${input.hostname}`;
  try {
    // resolveTxt returns string[][] — each record can be split into
    // multiple chunks, joined per RFC 1464. We flatten + trim quotes.
    const raw = await dns.resolveTxt(name);
    const flat = raw.map((parts) => parts.join("").trim());
    const matched = flat.includes(input.verificationToken);
    return {
      name,
      expected: input.verificationToken,
      found: flat,
      matched,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "ELOOKUP";
    return {
      name,
      expected: input.verificationToken,
      found: null,
      matched: false,
      error: code,
    };
  }
}

async function checkCname(input: CheckInput): Promise<DnsCheckResult["cname"]> {
  const expected = [
    input.cnameTarget.toLowerCase(),
    ...input.acceptedTargets.map((t) => t.toLowerCase()),
  ];

  // Try CNAME first (subdomain case). If that 404s — apex domains
  // can't carry CNAMEs — fall back to A-record lookup and compare
  // against the IPs of our targets.
  try {
    const records = await dns.resolveCname(input.hostname);
    const lower = records.map((r) => r.toLowerCase().replace(/\.$/, ""));
    const matched = lower.some((r) => expected.includes(r));
    return {
      name: input.hostname,
      found: lower,
      expected,
      matched,
    };
  } catch (err) {
    // ENODATA / ENOTFOUND happens for apex records; try A-record path.
    const code = (err as NodeJS.ErrnoException)?.code ?? "";
    if (code !== "ENODATA" && code !== "ENOTFOUND") {
      return {
        name: input.hostname,
        found: null,
        expected,
        matched: false,
        error: code || "cname_lookup_failed",
      };
    }
  }

  // Apex / ALIAS path: resolve the target to A records and compare
  // against what the hostname resolves to.
  try {
    const [hostA, targetA] = await Promise.all([
      dns.resolve4(input.hostname).catch(() => [] as string[]),
      dns.resolve4(input.cnameTarget).catch(() => [] as string[]),
    ]);
    if (hostA.length === 0) {
      return {
        name: input.hostname,
        found: [],
        expected,
        matched: false,
        error: "no_a_records",
      };
    }
    const targetSet = new Set(targetA);
    const matched = hostA.some((ip) => targetSet.has(ip));
    return {
      name: input.hostname,
      found: hostA,
      expected: targetA.length > 0 ? targetA : expected,
      matched,
    };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code ?? "ELOOKUP";
    return {
      name: input.hostname,
      found: null,
      expected,
      matched: false,
      error: code,
    };
  }
}

function decideStatus(check: DnsCheckResult): {
  status: "pending" | "verified" | "active" | "failed";
  reason: string;
} {
  // TXT bad → can't prove ownership at all.
  if (!check.txt.matched) {
    if (check.txt.error) {
      return { status: "failed", reason: "dns_lookup_failed" };
    }
    if (check.txt.found && check.txt.found.length > 0) {
      return { status: "failed", reason: "txt_mismatch" };
    }
    return { status: "pending", reason: "txt_missing" };
  }
  // TXT good — at minimum the user owns the domain.
  if (!check.cname.matched) {
    if (check.cname.error === "no_a_records") {
      return { status: "verified", reason: "cname_missing" };
    }
    if (check.cname.found && check.cname.found.length > 0) {
      return { status: "verified", reason: "cname_wrong_target" };
    }
    return { status: "verified", reason: "cname_missing" };
  }
  // Both good — fully active.
  return { status: "active", reason: "ok" };
}

function parseAcceptedTargets(env: ReturnType<typeof loadEnv>): string[] {
  return env.CUSTOM_DOMAIN_ACCEPTED_TARGETS.split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
