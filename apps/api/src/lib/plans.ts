/**
 * Plan / limit enforcement helper (sec 42).
 *
 * Routes that create entities call `enforceLimit(prisma, tenantId,
 * "projects", currentCount)` before the actual insert. Throws a 403
 * if the tenant's plan caps that resource and the count would exceed
 * the cap. The error carries a structured payload the frontend can
 * map to a "upgrade your plan" prompt.
 *
 * Limit semantics:
 *   • `null` / missing key → unlimited
 *   • `0` → explicitly disabled (Free can't have custom domains, etc.)
 *   • positive integer → cap; create is allowed when count < cap.
 *
 * Feature flags are a separate concept — `featureEnabled(prisma,
 * tenantId, "whiteLabel")` returns boolean. Routes that gate features
 * (e.g. white-labeling a brand) call this and return 403 on miss.
 */

import type { PrismaClient } from "@prisma/client";

export interface PlanLimits {
  projects?: number | null;
  members?: number | null;
  storageMiB?: number | null;
  exportsPerMonth?: number | null;
  customDomains?: number | null;
  apiKeys?: number | null;
  webhooks?: number | null;
  plugins?: number | null;
}

export interface PlanFeatures {
  whiteLabel?: boolean;
  sso?: boolean;
  advancedExports?: boolean;
  publicMarketplacePublishing?: boolean;
  /** Tenant-set overrides — flags the tenant flips locally. */
  [key: string]: boolean | undefined;
}

export interface PlanShape {
  limits: PlanLimits;
  features: PlanFeatures;
}

/** Class-tagged 403 so the error handler can return a structured body. */
export class LimitExceededError extends Error {
  statusCode = 403;
  constructor(
    public limit: keyof PlanLimits,
    public current: number,
    public cap: number | null,
  ) {
    super(
      cap === 0
        ? `Your plan doesn't include "${limit}".`
        : `You've hit your plan's "${limit}" limit (${current}/${cap}).`,
    );
    this.name = "LimitExceededError";
  }
}

export class FeatureDisabledError extends Error {
  statusCode = 403;
  constructor(public feature: keyof PlanFeatures) {
    super(`Your plan doesn't include the "${String(feature)}" feature.`);
    this.name = "FeatureDisabledError";
  }
}

async function loadPlanShape(
  prisma: PrismaClient,
  tenantId: string,
): Promise<PlanShape> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { plan: true },
  });
  const json = (tenant?.plan?.limitsJson ?? null) as PlanShape | null;
  return {
    limits: json?.limits ?? {},
    features: json?.features ?? {},
  };
}

/**
 * Throw if creating one more `<resource>` would exceed the plan's cap.
 * `currentCount` is the caller's responsibility — pass the live row
 * count so we don't double-count.
 */
export async function enforceLimit(
  prisma: PrismaClient,
  tenantId: string,
  resource: keyof PlanLimits,
  currentCount: number,
): Promise<void> {
  const { limits } = await loadPlanShape(prisma, tenantId);
  const cap = limits[resource];
  if (cap === undefined || cap === null) return; // unlimited
  if (currentCount >= cap) {
    throw new LimitExceededError(resource, currentCount, cap);
  }
}

/** Boolean check on a feature flag. False when missing — fail closed. */
export async function featureEnabled(
  prisma: PrismaClient,
  tenantId: string,
  feature: keyof PlanFeatures,
): Promise<boolean> {
  const { features } = await loadPlanShape(prisma, tenantId);
  return features[feature] === true;
}

export async function requireFeature(
  prisma: PrismaClient,
  tenantId: string,
  feature: keyof PlanFeatures,
): Promise<void> {
  if (!(await featureEnabled(prisma, tenantId, feature))) {
    throw new FeatureDisabledError(feature);
  }
}
