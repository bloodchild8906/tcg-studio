/**
 * Production seed — platform admin + the special "platform" tenant.
 *
 * The platform tenant (slug from env `PLATFORM_TENANT_SLUG`, default
 * `platform`) is NOT a user-facing workspace. It's the internal namespace
 * that platform-scoped resources hang off of: the marketing CMS site
 * (landing page + login page), the marketplace catalog, the support
 * ticket inbox, platform-level analytics. Without it, the platform-scope
 * UI views all 404 because they look the tenant up by slug.
 *
 * This seed creates:
 *   1. The admin User with `platformRole = "owner"` — full platform powers.
 *   2. The platform Tenant.
 *   3. Membership linking the admin to the platform tenant as `tenant_owner`
 *      so they can edit its CMS pages.
 *   4. The default CMS scaffolding (studio site + `home` + `__login` pages)
 *      via the same helper the tenant-create route uses.
 *
 * No demo project, card type, or template. The admin builds real tenants
 * for end-users from the UI after first login; this seed only stands up
 * the platform-level infrastructure.
 *
 * Idempotent — running it twice is a no-op (upsert + scrub).
 *
 * Run from the API container:
 *     docker compose exec api npm run seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ensureDefaultCmsContent } from "../src/lib/cmsDefaults";

const prisma = new PrismaClient();

/**
 * Platform admin credentials. Override via env to keep secrets out of git:
 * set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD before running `npm run seed`.
 * The compiled-in defaults are the production operator for tcgstudio.online —
 * change them if you fork the project.
 */
const SEED_ADMIN_EMAIL =
  process.env.SEED_ADMIN_EMAIL ?? "Michael@tcgstudio.online";
const SEED_ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ?? "@w@tws$qN$zxu65G";
const SEED_ADMIN_NAME = process.env.SEED_ADMIN_NAME ?? "Michael";

/**
 * Platform tenant. Must match `env.PLATFORM_TENANT_SLUG` on the API side —
 * the marketplace / support / platform-CMS routes look this slug up to
 * resolve their data scope. The display name is what shows up in headers
 * and the public CMS title bar; defaults to the product brand.
 */
const PLATFORM_TENANT_SLUG = process.env.PLATFORM_TENANT_SLUG ?? "platform";
const PLATFORM_TENANT_NAME =
  process.env.PLATFORM_TENANT_NAME ?? "TCGStudio";

async function main() {
  // bcrypt-hash on every run so a stale hash from an earlier rev doesn't
  // outlive a password change in this seed file. Cost-10 is fast enough that
  // running the seed is still effectively instantaneous.
  const passwordHash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);

  // Normalize email to lowercase — User.email has a unique index and the
  // login flow lowercases input before lookup, so we must store it that way.
  const normalizedEmail = SEED_ADMIN_EMAIL.toLowerCase();

  const user = await prisma.user.upsert({
    where: { email: normalizedEmail },
    // platformRole "owner" gives this user platform-level admin powers —
    // they can mint tenants, see cross-tenant data in the platform console,
    // and approve marketplace submissions.
    update: {
      passwordHash,
      name: SEED_ADMIN_NAME,
      platformRole: "owner",
    },
    create: {
      email: normalizedEmail,
      name: SEED_ADMIN_NAME,
      passwordHash,
      platformRole: "owner",
    },
  });

  // ── Platform tenant ────────────────────────────────────────────────
  // Different from a user-facing tenant: this one owns the marketing
  // site, the marketplace catalog, the support inbox. The admin needs a
  // tenant_owner membership so the same view that any tenant_owner sees
  // for their tenant CMS works here too — no special-cased UI required.
  const platformTenant = await prisma.tenant.upsert({
    where: { slug: PLATFORM_TENANT_SLUG },
    update: { name: PLATFORM_TENANT_NAME },
    create: {
      slug: PLATFORM_TENANT_SLUG,
      name: PLATFORM_TENANT_NAME,
    },
  });

  await prisma.membership.upsert({
    where: {
      tenantId_userId: {
        tenantId: platformTenant.id,
        userId: user.id,
      },
    },
    update: { role: "tenant_owner" },
    create: {
      tenantId: platformTenant.id,
      userId: user.id,
      role: "tenant_owner",
    },
  });

  // ── Default CMS scaffolding for the platform tenant ────────────────
  // Creates the studio site + the canonical pages:
  //   • `home`     — public landing for anonymous visitors
  //   • `__login`  — hero panel rendered next to the sign-in form
  //   • `__members`— welcome banner shown after sign-in
  // Idempotent: only creates what's missing.
  const cmsResult = await ensureDefaultCmsContent(
    prisma,
    platformTenant.id,
    {
      siteName: PLATFORM_TENANT_NAME,
      productName: PLATFORM_TENANT_NAME,
      tagline:
        "Design, manage, validate, playtest, and publish custom trading card games — under your own brand.",
    },
  );

  // ── Cleanup of legacy demo data from earlier seed revs ─────────────
  await prisma.template.deleteMany({
    where: { id: "tpl_character_sample_seed" },
  });
  await prisma.project.deleteMany({
    where: { slug: "saga-tales-unchained" },
  });
  await prisma.membership.deleteMany({
    where: { user: { email: "michael@demo.tcgstudio.local" } },
  });
  await prisma.user.deleteMany({
    where: { email: "michael@demo.tcgstudio.local" },
  });
  await prisma.tenant.deleteMany({ where: { slug: "demo" } });
  // Also drop the placeholder "studio" tenant created by older seed revs —
  // real tenants are user-facing and should be created from the UI.
  await prisma.membership.deleteMany({
    where: { tenant: { slug: "studio" } },
  });
  await prisma.tenant.deleteMany({ where: { slug: "studio" } });

  // eslint-disable-next-line no-console
  console.log(
    [
      "seeded:",
      `  user           = ${user.email} (platform owner)`,
      `  platformTenant = ${platformTenant.slug}`,
      `  cms.site       = ${cmsResult.siteId}`,
      `  cms.pages      = home:${cmsResult.created.home ? "new" : "kept"}, __login:${cmsResult.created.login ? "new" : "kept"}, __members:${cmsResult.created.members ? "new" : "kept"}`,
    ].join("\n"),
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
