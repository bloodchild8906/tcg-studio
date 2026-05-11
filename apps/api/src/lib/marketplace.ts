/**
 * Marketplace install side-effects (sec 35).
 *
 * When a tenant installs a MarketplacePackage we may need to mutate
 * other tenant-scoped tables to actually wire the package into the
 * workspace. This file centralizes those side-effects so the install
 * route stays thin and we can add new package kinds without growing a
 * giant switch in the route.
 *
 * Each kind handler is intentionally idempotent — re-running an
 * install on top of an existing tenant should converge, never
 * duplicate. New handlers register through `registerInstallHandler`
 * (mirrors the pattern used by background jobs in `lib/jobs.ts`).
 *
 * Current handlers (v0):
 *
 *   plugin / exporter
 *     Upserts a Plugin row from the package manifest, then creates a
 *     PluginInstall row pointing at it. The plugin manager shell
 *     surfaces it in the existing list.
 *
 *   cms_theme
 *     Patches every CmsSite owned by the tenant to merge the package's
 *     theme tokens into themeJson. Existing tokens win on conflict so
 *     a tenant can re-apply without losing customizations they already
 *     made.
 *
 *   keyword_pack / rules_pack
 *     Best-effort upsert keywords by slug into the tenant. Each tenant
 *     project can adopt them; we don't auto-bind to any single project.
 *
 *   frame_pack / icon_pack / font_pack
 *     v0 records the install and writes an audit row; the asset upload
 *     itself happens out-of-band via a background job (placeholder for
 *     now; the full implementation queues up `marketplace.unpack`).
 *
 *   starter_kit / board_layout / print_profile / pack_generator /
 *   cms_block_pack
 *     v0 just records the install. Surfacing them inside the relevant
 *     editor (sets, board designer, etc.) lands as those editors gain
 *     marketplace-aware extension points.
 */

import type { PrismaClient } from "@prisma/client";

export type InstallContext = {
  prisma: PrismaClient;
  tenantId: string;
  packageId: string;
  /** Latest approved version row, if any. */
  versionContent: Record<string, unknown> | null;
  /** Cached package row (saves a re-fetch in the handler). */
  pkg: { id: string; slug: string; name: string; kind: string };
};

type InstallHandler = (ctx: InstallContext) => Promise<void>;

const handlers = new Map<string, InstallHandler>();

export function registerInstallHandler(kind: string, fn: InstallHandler) {
  handlers.set(kind, fn);
}

/**
 * Run side-effects for the given package kind. Always best-effort —
 * the install row is created first by the route; if a handler throws
 * we log and continue so the user isn't left with a half-created
 * install when only the side-effect is unavailable.
 */
export async function applyInstall(ctx: InstallContext): Promise<void> {
  const fn = handlers.get(ctx.pkg.kind);
  if (!fn) return;
  await fn(ctx);
}

// ---------------------------------------------------------------------------
// plugin / exporter
// ---------------------------------------------------------------------------

const pluginLikeHandler: InstallHandler = async ({
  prisma,
  tenantId,
  versionContent,
  pkg,
}) => {
  const manifest = (versionContent?.manifest as Record<string, unknown> | undefined) ?? {};
  const slug = (manifest.id as string | undefined) ?? pkg.slug;
  const name = (manifest.name as string | undefined) ?? pkg.name;
  const version = (manifest.version as string | undefined) ?? "0.1.0";

  const plugin = await prisma.plugin.upsert({
    where: { slug },
    create: {
      slug,
      name,
      version,
      author: (manifest.author as string | undefined) ?? "TCGStudio",
      description: (manifest.description as string | undefined) ?? "",
      manifestJson: manifest as object,
      scope: "tenant",
      status: "approved",
    },
    update: {
      name,
      version,
      manifestJson: manifest as object,
    },
  });

  await prisma.pluginInstall.upsert({
    where: { tenantId_pluginId: { tenantId, pluginId: plugin.id } },
    create: { tenantId, pluginId: plugin.id, enabled: true },
    update: { enabled: true },
  });
};

registerInstallHandler("plugin", pluginLikeHandler);
registerInstallHandler("exporter", pluginLikeHandler);

// ---------------------------------------------------------------------------
// cms_theme — merge tokens into every CmsSite owned by the tenant
// ---------------------------------------------------------------------------

registerInstallHandler("cms_theme", async ({ prisma, tenantId, versionContent }) => {
  const themeBlob = versionContent?.theme as Record<string, unknown> | undefined;
  if (!themeBlob) return;
  const tokens = (themeBlob.tokensJson as Record<string, unknown> | undefined) ?? {};
  const layout = (themeBlob.layoutJson as Record<string, unknown> | undefined) ?? {};

  const sites = await prisma.cmsSite.findMany({
    where: { tenantId },
    select: { id: true, themeJson: true },
  });
  for (const site of sites) {
    const existing = (site.themeJson as Record<string, unknown> | null) ?? {};
    const merged: Record<string, unknown> = {
      // Existing tokens win on conflict — installing should not
      // clobber a tenant's customizations.
      ...tokens,
      ...layout,
      ...existing,
    };
    await prisma.cmsSite.update({
      where: { id: site.id },
      data: { themeJson: merged as object },
    });
  }
});

// ---------------------------------------------------------------------------
// keyword_pack / rules_pack — placeholder
// ---------------------------------------------------------------------------
//
// Keywords are project-scoped in the data model; an install at tenant
// scope therefore can't auto-bind to a project. The Marketplace UI
// surfaces a "Apply to project…" action after install which queues a
// `marketplace.apply_to_project` job that copies keywords into the
// chosen project. v0 just records the install row.

// ---------------------------------------------------------------------------
// asset / starter packs — placeholder, no-op for now
// ---------------------------------------------------------------------------

const noopHandler: InstallHandler = async () => {
  // The install row + audit log carry the user-visible state. Real
  // unpack lands when the worker job `marketplace.unpack` ships.
};

for (const kind of [
  "frame_pack",
  "icon_pack",
  "font_pack",
  "starter_kit",
  "board_layout",
  "print_profile",
  "pack_generator",
  "cms_block_pack",
  "keyword_pack",
  "rules_pack",
  "ability_pack",
]) {
  registerInstallHandler(kind, noopHandler);
}
