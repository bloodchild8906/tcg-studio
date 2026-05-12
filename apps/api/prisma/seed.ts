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
 *   5. A default user-facing tenant (for demo / local dev purposes), with
 *      optional customizable tenant owner (via env or interactive prompt).
 *
 * No demo project, card type, or template. The admin builds real tenants
 * for end-users from the UI after first login; this seed only stands up
 * the platform-level infrastructure.
 *
 * Idempotent — running it twice is a no-op (upsert + scrub).
 *
 * Run from the API container:
 *     docker compose exec api npm run seed
 *
 * Or with explicit default tenant owner:
 *     docker compose exec api \
 *       DEFAULT_TENANT_OWNER_EMAIL=alice@example.com \
 *       DEFAULT_TENANT_OWNER_NAME="Alice Smith" \
 *       npm run seed
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { ensureDefaultCmsContent } from "../src/lib/cmsDefaults";

const prisma = new PrismaClient();

// Node.js readline for interactive prompts (if running in terminal mode)
const readline = require("readline").createInterface({
  input: process.stdin,
  output: process.stdout,
});

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

/**
 * Default user-facing tenant. When SEED_DEFAULT_TENANT is true (default in dev),
 * a demo tenant is created for quick prototyping. Disable by setting the env
 * var to "false" in production.
 */
const SEED_DEFAULT_TENANT = process.env.SEED_DEFAULT_TENANT !== "false";
const DEFAULT_TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? "default";
const DEFAULT_TENANT_NAME =
  process.env.DEFAULT_TENANT_NAME ?? "Demo Game Studio";

/**
 * Default tenant owner configuration. When seeding the default tenant,
 * these values determine who gets tenant_owner access.
 *
 * Priority:
 *   1. Explicit env vars (DEFAULT_TENANT_OWNER_EMAIL, etc.)
 *   2. Interactive prompt (if in a terminal)
 *   3. Use the platform admin as the owner (fallback)
 */
const DEFAULT_TENANT_OWNER_EMAIL =
  process.env.DEFAULT_TENANT_OWNER_EMAIL?.toLowerCase().trim() || null;
const DEFAULT_TENANT_OWNER_NAME =
  process.env.DEFAULT_TENANT_OWNER_NAME?.trim() || null;
const DEFAULT_TENANT_OWNER_PASSWORD = process.env.DEFAULT_TENANT_OWNER_PASSWORD || null;

const SALT_ROUNDS = 10;

/**
 * Prompt the user for input in the terminal. Returns immediately if not a TTY.
 */
function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    // If not a TTY (e.g., running in CI), return empty string immediately.
    if (!process.stdin.isTTY) {
      resolve("");
      return;
    }
    readline.question(question, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

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

  // ── Default user-facing tenant (dev/demo) ──────────────────────────
  // When SEED_DEFAULT_TENANT is true (dev/local default), creates a
  // demo tenant with a configurable owner. In production, set
  // SEED_DEFAULT_TENANT=false to skip this.
  let defaultTenant = null;
  let defaultTenantOwnerUser = null;
  if (SEED_DEFAULT_TENANT) {
    defaultTenant = await prisma.tenant.upsert({
      where: { slug: DEFAULT_TENANT_SLUG },
      update: { name: DEFAULT_TENANT_NAME },
      create: {
        slug: DEFAULT_TENANT_SLUG,
        name: DEFAULT_TENANT_NAME,
        tenantType: "studio", // Indie Studio archetype (sec 8)
      },
    });

    // Resolve the default tenant owner — ask the user if not provided
    // via environment variables.
    let ownerEmail = DEFAULT_TENANT_OWNER_EMAIL;
    let ownerName = DEFAULT_TENANT_OWNER_NAME;
    let ownerPassword = DEFAULT_TENANT_OWNER_PASSWORD;

    if (!ownerEmail) {
      // Interactive mode — prompt for tenant owner details.
      // (Only if running in a TTY; otherwise use the platform admin as fallback.)
      if (process.stdin.isTTY) {
        // eslint-disable-next-line no-console
        console.log("\n─── Default Tenant Owner ───");
        // eslint-disable-next-line no-console
        console.log(
          "Assign the default tenant's first owner. Press Enter to use the platform admin.",
        );

        ownerEmail = await prompt("Owner email: ");
        if (ownerEmail) {
          ownerName = await prompt("Owner name: ");
          ownerPassword = await prompt("Owner password (min 8 chars): ");

          // Validate password length
          while (ownerPassword && ownerPassword.length < 8) {
            // eslint-disable-next-line no-console
            console.log("❌ Password must be at least 8 characters.");
            ownerPassword = await prompt("Owner password (min 8 chars): ");
          }
        }
      }
    }

    // Create or update the tenant owner user.
    if (ownerEmail) {
      const normalizedOwnerEmail = ownerEmail.toLowerCase().trim();
      try {
        const ownerPasswordHash = ownerPassword
          ? await bcrypt.hash(ownerPassword, SALT_ROUNDS)
          : undefined;

        defaultTenantOwnerUser = await prisma.user.upsert({
          where: { email: normalizedOwnerEmail },
          update: {
            name: ownerName || normalizedOwnerEmail.split("@")[0],
            ...(ownerPasswordHash ? { passwordHash: ownerPasswordHash } : {}),
          },
          create: {
            email: normalizedOwnerEmail,
            name: ownerName || normalizedOwnerEmail.split("@")[0],
            passwordHash: ownerPasswordHash || null,
          },
          select: { id: true, email: true, name: true },
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `⚠️  Could not create/update tenant owner user: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Grant owner access to the default tenant.
    if (defaultTenantOwnerUser) {
      await prisma.membership.upsert({
        where: {
          tenantId_userId: {
            tenantId: defaultTenant.id,
            userId: defaultTenantOwnerUser.id,
          },
        },
        update: { role: "tenant_owner" },
        create: {
          tenantId: defaultTenant.id,
          userId: defaultTenantOwnerUser.id,
          role: "tenant_owner",
        },
      });
    } else {
      // Fallback: use the platform admin as the tenant owner.
      await prisma.membership.upsert({
        where: {
          tenantId_userId: {
            tenantId: defaultTenant.id,
            userId: user.id,
          },
        },
        update: { role: "tenant_owner" },
        create: {
          tenantId: defaultTenant.id,
          userId: user.id,
          role: "tenant_owner",
        },
      });
    }
  }

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
  // (But only if we're not seeding a default tenant with that name.)
  if (!SEED_DEFAULT_TENANT) {
    await prisma.membership.deleteMany({
      where: { tenant: { slug: "studio" } },
    });
    await prisma.tenant.deleteMany({ where: { slug: "studio" } });
  }

  // ── Cleanup completed default tenant if SEED_DEFAULT_TENANT is false ──
  // If the user explicitly disables default tenant seeding, remove any
  // legacy "default" or "studio" tenants that might exist from earlier runs.
  if (!SEED_DEFAULT_TENANT) {
    await prisma.membership.deleteMany({
      where: { tenant: { slug: DEFAULT_TENANT_SLUG } },
    });
    await prisma.tenant.deleteMany({ where: { slug: DEFAULT_TENANT_SLUG } });
  }

  // ── Output summary ──────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.log(
    [
      "\n✅ Seeded:",
      `  platform admin     = ${user.email} (platformRole: owner)`,
      `  platform tenant    = ${platformTenant.slug}`,
      `  cms.site           = ${cmsResult.siteId}`,
      `  cms.pages          = home:${cmsResult.created.home ? "new" : "kept"}, __login:${cmsResult.created.login ? "new" : "kept"}, __members:${cmsResult.created.members ? "new" : "kept"}`,
      ...(defaultTenant
        ? [
            `  default tenant     = ${defaultTenant.slug} (${DEFAULT_TENANT_NAME})`,
            `  tenant owner       = ${defaultTenantOwnerUser ? `${defaultTenantOwnerUser.email} (${defaultTenantOwnerUser.name})` : user.email + " (platform admin)"}`,
          ]
        : []),
      "",
    ].join("\n"),
  );

  readline.close();
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    readline.close();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
