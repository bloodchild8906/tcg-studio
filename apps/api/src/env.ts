/**
 * Environment configuration.
 *
 * Centralizes env var reads + validation so the rest of the codebase doesn't
 * sprinkle `process.env.X ?? "default"` everywhere. Every value is validated
 * at boot — if something is missing, the server fails fast with a clear error
 * rather than 500-ing under load three hours later.
 */

import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(4000),
  /// Postgres connection string. Defaults match docker-compose service names.
  DATABASE_URL: z
    .string()
    .default("postgresql://tcg:tcg@postgres:5432/tcgstudio?schema=public"),
  /// Comma-separated list of allowed origins for CORS. "*" allows any (dev only).
  CORS_ORIGINS: z.string().default("http://localhost:5173,http://127.0.0.1:5173"),
  /// Default tenant slug used when no tenant header is provided. Lets the
  /// designer hit the API without auth in dev.
  DEFAULT_TENANT_SLUG: z.string().default("demo"),
  /// Root domain used for host-based tenant + project routing.
  ///   `tcgstudio.local`               → platform-level (super-admin)
  ///   `<tenant>.tcgstudio.local`       → tenant scope
  ///   `<project>.<tenant>.tcgstudio.local` → project scope
  /// Override via env when running under a different domain.
  ROOT_DOMAIN: z.string().default("tcgstudio.local"),
  /// Where tenants are told to point their custom domains via CNAME.
  /// In production this is the public hostname of the platform's HTTP
  /// proxy (Caddy/Traefik in front of the API). In dev we default it to
  /// `tenant-router.<ROOT_DOMAIN>` since most local setups already
  /// have that wired up via Acrylic.
  CUSTOM_DOMAIN_CNAME_TARGET: z
    .string()
    .default("tenant-router.tcgstudio.local"),
  /// Comma-separated list of acceptable CNAME / A-record targets for
  /// custom domains. We accept any of these as "pointing at us".
  /// Useful when a tenant uses an apex ALIAS that resolves to one of
  /// several edge IPs, or when multiple proxies share the load.
  CUSTOM_DOMAIN_ACCEPTED_TARGETS: z.string().default(""),
  /// Token shared with the HTTP proxy (Caddy / Traefik) so its
  /// on-demand-TLS hook can authenticate against the allowlist endpoint.
  /// Empty = endpoint is open (dev only).
  PROXY_HOOK_TOKEN: z.string().default(""),
  /// Slug of the tenant that owns the platform-level landing page.
  /// The public root host (`tcgstudio.local`) renders the published
  /// "home" page from this tenant's CMS site. Platform admins sign in
  /// at this tenant's subdomain to edit the marketing site through the
  /// regular CMS UI.
  PLATFORM_TENANT_SLUG: z.string().default("platform"),
  /// Pretty-print logs in dev — gets piped through pino-pretty.
  PRETTY_LOGS: z
    .string()
    .transform((v) => v === "1" || v.toLowerCase() === "true")
    .default("true"),
  /// JWT signing secret. Override in production via env. We default to a
  /// fixed string in dev so tokens survive container restarts during testing.
  JWT_SECRET: z.string().min(16).default("dev-only-secret-change-in-prod-please-32"),
  /// Token TTL — 7 days is plenty for a desktop-style app.
  JWT_EXPIRES_IN: z.string().default("7d"),
  /// Storage Provider — 'minio' or 'gcs'.
  STORAGE_PROVIDER: z.enum(["minio", "gcs"]).default("minio"),
  /// MinIO / S3 settings — match docker-compose service names by default.
  MINIO_ENDPOINT: z.string().default("minio"),
  MINIO_PORT: z.coerce.number().int().positive().default(9000),
  MINIO_USE_SSL: z
    .string()
    .transform((v) => v === "1" || v.toLowerCase() === "true")
    .default("false"),
  MINIO_ACCESS_KEY: z.string().default("tcg"),
  MINIO_SECRET_KEY: z.string().default("tcgtcgtcg"),
  MINIO_BUCKET: z.string().default("tcgstudio"),
  /// GCS settings.
  GCS_PROJECT_ID: z.string().optional(),
  GCS_KEY_FILE: z.string().optional(),
  GCS_BUCKET: z.string().default("tcgstudio-assets"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function loadEnv(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    // Pretty error so the operator sees exactly which env var blew up.
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment:\n${issues}`);
  }
  cached = result.data;
  return cached;
}
