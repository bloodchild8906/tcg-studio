/**
 * Outbound email — tenant-scoped SMTP via nodemailer.
 *
 * Each tenant carries its own `emailSettingsJson` (see prisma/schema.prisma).
 * This module reads it, builds a nodemailer transport per tenant (cached for
 * the lifetime of the process), and exposes a single `sendEmail` helper.
 *
 * Why per-tenant transport: white-label deploys give every tenant their own
 * sender identity. Mixing them through a single platform-wide SMTP would
 * either leak the platform's brand on every notification or require all
 * tenants to share one mailbox, neither of which is acceptable.
 *
 * Failure mode: if a tenant has no `emailSettingsJson`, `sendEmail` is a
 * no-op that logs once. We never throw from a sender path — undelivered
 * email shouldn't break a signup or password-reset flow.
 */

import nodemailer, { Transporter } from "nodemailer";

/**
 * Shape of `Tenant.emailSettingsJson`. Matches what the seed writes and
 * what the tenant settings UI will edit. Loose typing because the column
 * is `Json` in Postgres and operators may add custom fields.
 */
export interface TenantEmailSettings {
  provider?: string;
  host?: string;
  port?: number;
  /** True = use TLS from the start (port 465). False = STARTTLS upgrade (587). */
  secure?: boolean;
  auth?: { user?: string; pass?: string };
  fromEmail?: string;
  fromName?: string;
  replyTo?: string;
  /**
   * Headers to attach to every outbound message — useful for adding
   * `List-Unsubscribe` or `X-Tenant-Slug` for downstream observability.
   */
  defaultHeaders?: Record<string, string>;
}

export interface SendEmailInput {
  /** Tenant whose SMTP creds to use. Looked up from settings. */
  tenantId: string;
  /** Lazily-evaluated lookup so we don't pull Prisma in at module level. */
  loadSettings: (tenantId: string) => Promise<TenantEmailSettings | null>;
  to: string | string[];
  subject: string;
  /** Plain text body. Either this, `html`, or both. */
  text?: string;
  /** HTML body. */
  html?: string;
  /** Override the tenant default. Rarely needed. */
  fromOverride?: { email: string; name?: string };
  /** Reply-To override. */
  replyToOverride?: string;
  /** Logger — Fastify's request.log or app.log. */
  log?: {
    info: (msg: unknown, ...args: unknown[]) => void;
    warn: (msg: unknown, ...args: unknown[]) => void;
    error: (msg: unknown, ...args: unknown[]) => void;
  };
}

// Transport cache keyed by a hash of the SMTP coords — when a tenant
// rotates credentials the key changes and a fresh transport is built.
const transportCache = new Map<string, Transporter>();

function cacheKey(s: TenantEmailSettings): string {
  return [s.host, s.port, s.secure ? "tls" : "starttls", s.auth?.user].join("|");
}

function buildTransport(s: TenantEmailSettings): Transporter {
  const key = cacheKey(s);
  const hit = transportCache.get(key);
  if (hit) return hit;
  const t = nodemailer.createTransport({
    host: s.host,
    port: s.port ?? 587,
    secure: s.secure === true,
    auth:
      s.auth?.user && s.auth?.pass
        ? { user: s.auth.user, pass: s.auth.pass }
        : undefined,
    // Brevo, SendGrid, and most relays reject unauthenticated TLS for
    // submission. STARTTLS on 587 is the path of least surprise.
  });
  transportCache.set(key, t);
  return t;
}

/**
 * Send an email through the tenant's configured SMTP. Returns true on
 * success, false on any error (config missing, transport refused, etc.).
 * Never throws — callers can fire-and-forget without try/catch.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const settings = await input.loadSettings(input.tenantId);
  if (!settings || !settings.host || !settings.auth?.user || !settings.auth?.pass) {
    input.log?.warn(
      { tenantId: input.tenantId },
      "email: no SMTP configured for tenant — message dropped",
    );
    return false;
  }
  try {
    const transport = buildTransport(settings);
    const from = input.fromOverride
      ? `${input.fromOverride.name ? `${input.fromOverride.name} <${input.fromOverride.email}>` : input.fromOverride.email}`
      : `${settings.fromName ? `${settings.fromName} <${settings.fromEmail}>` : settings.fromEmail}`;
    const replyTo = input.replyToOverride ?? settings.replyTo ?? settings.fromEmail;
    const info = await transport.sendMail({
      from,
      to: input.to,
      replyTo,
      subject: input.subject,
      text: input.text,
      html: input.html,
      headers: settings.defaultHeaders,
    });
    input.log?.info(
      { tenantId: input.tenantId, messageId: info.messageId, to: input.to },
      "email: sent",
    );
    return true;
  } catch (err) {
    input.log?.error(
      { tenantId: input.tenantId, err: err instanceof Error ? err.message : String(err) },
      "email: send failed",
    );
    return false;
  }
}

/**
 * Build a `loadSettings` function bound to a PrismaClient. Keeps this
 * module Prisma-free so the typings stay simple and the file is easy
 * to unit-test with a mocked loader.
 */
export function makePrismaSettingsLoader(prisma: {
  tenant: {
    findUnique: (args: {
      where: { id: string };
      select: { emailSettingsJson: true };
    }) => Promise<{ emailSettingsJson: unknown } | null>;
  };
}) {
  return async (tenantId: string): Promise<TenantEmailSettings | null> => {
    const row = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { emailSettingsJson: true },
    });
    if (!row?.emailSettingsJson) return null;
    return row.emailSettingsJson as TenantEmailSettings;
  };
}
