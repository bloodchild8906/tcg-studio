/**
 * Public CMS block renderer — used by both PublicGallery (per-tenant
 * pages) and LandingPage (platform root). Lifted out of PublicGallery
 * so we don't duplicate the block-type switch in two places.
 *
 * Unknown block types render as a small placeholder so editors can spot
 * them without breaking the page. New block types should also surface
 * here when they're added to the CMS designer's block registry.
 */

import { useEffect, useState } from "react";
import {
  fetchPublicCmsForm,
  submitPublicCmsForm,
  type CmsBlock,
  type CmsFormField,
  type PublicCmsForm,
} from "@/lib/api";
import { fetchPublicCards, publicAssetUrl } from "@/public/publicApi";

export interface CmsBlocksRendererProps {
  blocks: CmsBlock[];
  /**
   * The tenant slug used for resolving asset URLs and live data
   * blocks (card galleries, forms). Pass `null` when there's no
   * tenant context (e.g. the platform landing page) — in that case
   * blocks that need a tenant render an inline notice instead of
   * silently swallowing.
   */
  tenantSlug: string | null;
}

export function CmsBlocksRenderer({ blocks, tenantSlug }: CmsBlocksRendererProps) {
  return (
    <div className="space-y-5">
      {blocks.map((b) => (
        <CmsBlockRenderer key={b.id} block={b} tenantSlug={tenantSlug} />
      ))}
    </div>
  );
}

function CmsBlockRenderer({
  block,
  tenantSlug,
}: {
  block: CmsBlock;
  tenantSlug: string | null;
}) {
  // New shape detection — BlockCMS native blocks have a `content`
  // string (and optionally `metadata`, `children`). Hand off to a
  // separate switch so the legacy `props`-based branch below doesn't
  // need to deal with string content.
  const asAny = block as unknown as {
    content?: string;
    metadata?: Record<string, unknown>;
    children?: unknown[];
  };
  if (typeof asAny.content === "string") {
    return (
      <BlockCmsRenderer
        block={asAny as { type: string; content: string; metadata?: Record<string, unknown>; children?: unknown[] }}
        tenantSlug={tenantSlug}
      />
    );
  }

  const props = block.props ?? {};
  switch (block.type) {
    case "heading": {
      const level = Math.min(Math.max(Number(props.level ?? 1), 1), 4);
      const text = String(props.text ?? "");
      const cls =
        level === 1
          ? "text-3xl font-semibold text-ink-50"
          : level === 2
          ? "text-2xl font-semibold text-ink-100"
          : level === 3
          ? "text-xl font-medium text-ink-100"
          : "text-lg font-medium text-ink-200";
      return (
        <div role="heading" aria-level={level} className={cls}>
          {text}
        </div>
      );
    }
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap text-base leading-relaxed text-ink-200">
          {String(props.text ?? "")}
        </p>
      );
    case "image": {
      const src = String(props.src ?? "");
      if (!src) return null;
      return (
        <figure className="space-y-1">
          <img
            src={src}
            alt={String(props.alt ?? "")}
            className="max-h-[60vh] w-full rounded object-contain"
          />
          {props.caption ? (
            <figcaption className="text-center text-sm text-ink-500">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "asset_image": {
      const assetId = String(props.assetId ?? "");
      if (!assetId || !tenantSlug) return null;
      const src = publicAssetUrl(tenantSlug, assetId);
      // Sprite ref: when set, render the cell via background-image
      // positioning instead of <img>. Fixed pixel dimensions match the
      // cell so the browser handles the crop natively.
      const sprite = props.sprite as
        | { x: number; y: number; w: number; h: number }
        | null
        | undefined;
      if (sprite && sprite.w > 0 && sprite.h > 0) {
        return (
          <figure className="space-y-1">
            <div
              role="img"
              aria-label={String(props.alt ?? "")}
              style={{
                width: sprite.w,
                height: sprite.h,
                backgroundImage: `url(${src})`,
                backgroundPosition: `-${sprite.x}px -${sprite.y}px`,
                backgroundRepeat: "no-repeat",
                imageRendering: "pixelated",
              }}
              className="rounded"
            />
            {props.caption ? (
              <figcaption className="text-sm text-ink-500">
                {String(props.caption)}
              </figcaption>
            ) : null}
          </figure>
        );
      }
      return (
        <figure className="space-y-1">
          <img
            src={src}
            alt={String(props.alt ?? "")}
            className="max-h-[60vh] w-full rounded object-contain"
          />
          {props.caption ? (
            <figcaption className="text-center text-sm text-ink-500">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    case "divider":
      return <hr className="border-ink-700" />;
    case "button":
      return (
        <a
          href={String(props.href ?? "#")}
          className="inline-block rounded border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 hover:bg-accent-500/25"
        >
          {String(props.label ?? "Read more")}
        </a>
      );
    case "card_gallery":
      if (!tenantSlug) {
        return (
          <p className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
            Card galleries can't render on the platform landing page — embed
            them inside a tenant site.
          </p>
        );
      }
      return (
        <CmsCardGalleryBlock
          tenantSlug={tenantSlug}
          factionSlug={String(props.factionSlug ?? "")}
          setCode={String(props.setCode ?? "")}
          limit={Number(props.limit ?? 12)}
        />
      );
    case "form": {
      const slug = String(props.formSlug ?? "");
      if (!slug || !tenantSlug) {
        return (
          <p className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
            Forms require a tenant context.
          </p>
        );
      }
      return <CmsFormBlock tenantSlug={tenantSlug} formSlug={slug} />;
    }
    case "hero": {
      const align = props.align === "left" ? "text-left items-start" : "text-center items-center";
      return (
        <section
          className={`flex flex-col gap-3 rounded-lg border border-ink-700 bg-ink-900 px-6 py-12 ${align}`}
        >
          {props.eyebrow && (
            <p className="text-[11px] uppercase tracking-widest text-accent-300">
              {String(props.eyebrow)}
            </p>
          )}
          <h2 className="max-w-3xl text-3xl font-semibold text-ink-50 md:text-4xl">
            {String(props.heading ?? "")}
          </h2>
          {props.subheading && (
            <p className="max-w-2xl text-base text-ink-300">
              {String(props.subheading)}
            </p>
          )}
          {props.ctaLabel && props.ctaHref && (
            <a
              href={String(props.ctaHref)}
              className="mt-2 inline-block rounded-md bg-accent-500 px-5 py-2.5 text-sm font-semibold text-ink-950 hover:bg-accent-400"
            >
              {String(props.ctaLabel)}
            </a>
          )}
        </section>
      );
    }
    case "columns": {
      const cols = (props.columns as Array<{ heading: string; body: string }> | undefined) ?? [];
      return (
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${Math.min(Math.max(cols.length, 1), 4)}, minmax(0, 1fr))`,
          }}
        >
          {cols.map((c, i) => (
            <article
              key={i}
              className="rounded-lg border border-ink-800 bg-ink-900/60 p-4"
            >
              <h3 className="text-base font-medium text-ink-100">{c.heading}</h3>
              {c.body && (
                <p className="mt-2 text-sm text-ink-300">{c.body}</p>
              )}
            </article>
          ))}
        </div>
      );
    }
    case "tabs": {
      const tabs = (props.tabs as Array<{ label: string; body: string }> | undefined) ?? [];
      return <PublicTabs tabs={tabs} />;
    }
    case "accordion": {
      const items = (props.items as Array<{ q: string; a: string }> | undefined) ?? [];
      return (
        <div className="space-y-2">
          {items.map((it, i) => (
            <details
              key={i}
              className="rounded-lg border border-ink-800 bg-ink-900 p-3"
            >
              <summary className="cursor-pointer text-base font-medium text-ink-100">
                {it.q}
              </summary>
              <p className="mt-2 text-sm text-ink-300">{it.a}</p>
            </details>
          ))}
        </div>
      );
    }
    case "video": {
      const url = String(props.url ?? "");
      if (!url) return null;
      const embed = videoEmbedUrl(url);
      if (embed) {
        return (
          <figure className="space-y-1">
            <div className="relative w-full overflow-hidden rounded" style={{ paddingBottom: "56.25%" }}>
              <iframe
                src={embed}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full border-0"
                title={String(props.caption ?? "Video")}
              />
            </div>
            {props.caption ? (
              <figcaption className="text-center text-sm text-ink-500">
                {String(props.caption)}
              </figcaption>
            ) : null}
          </figure>
        );
      }
      return (
        <figure className="space-y-1">
          <video controls className="w-full rounded" src={url} />
          {props.caption ? (
            <figcaption className="text-center text-sm text-ink-500">
              {String(props.caption)}
            </figcaption>
          ) : null}
        </figure>
      );
    }
    default:
      return (
        <div className="rounded border border-dashed border-ink-700 p-3 text-xs text-ink-500">
          Unknown block "{block.type}"
        </div>
      );
  }
}

/* ====================================================================== */
/* Card gallery block                                                      */
/* ====================================================================== */

function CmsCardGalleryBlock({
  tenantSlug,
  factionSlug,
  setCode,
  limit,
}: {
  tenantSlug: string;
  factionSlug: string;
  setCode: string;
  limit: number;
}) {
  const [cards, setCards] = useState<
    Array<{ id: string; name: string; rarity: string | null; dataJson: unknown; setId: string | null }>
    | null
  >(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetchPublicCards(tenantSlug, {});
        if (!alive) return;
        let filtered = r.cards;
        if (factionSlug) {
          filtered = filtered.filter((c) => {
            const f = (c.dataJson as { faction?: string } | null)?.faction;
            return typeof f === "string" && f === factionSlug;
          });
        }
        if (setCode) {
          filtered = filtered.filter((c) => c.setId === setCode);
        }
        setCards(filtered.slice(0, Math.max(1, limit)));
      } catch {
        if (alive) setCards([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [tenantSlug, factionSlug, setCode, limit]);

  if (cards === null) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-4 text-sm text-ink-400">
        Loading cards…
      </div>
    );
  }
  if (cards.length === 0) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-4 text-sm text-ink-400">
        No cards match this gallery's filters.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
      {cards.map((c) => (
        <div
          key={c.id}
          className="aspect-[5/7] w-full rounded border border-ink-700 bg-ink-950 p-2 text-center"
        >
          <div className="flex h-full w-full flex-col items-center justify-center rounded bg-gradient-to-br from-accent-500/10 to-ink-900 p-2">
            <p className="text-xs font-semibold text-accent-300">{c.name}</p>
            <p className="mt-1 font-mono text-[10px] text-ink-500">{c.rarity ?? ""}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ====================================================================== */
/* Form block                                                              */
/* ====================================================================== */

function CmsFormBlock({
  tenantSlug,
  formSlug,
}: {
  tenantSlug: string;
  formSlug: string;
}) {
  const [form, setForm] = useState<PublicCmsForm | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPublicCmsForm(tenantSlug, formSlug)
      .then((f) => {
        if (alive) setForm(f);
      })
      .catch((err) => {
        if (alive) setLoadError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [tenantSlug, formSlug]);

  if (loadError) {
    return (
      <div className="rounded border border-danger-500/30 bg-danger-500/10 p-3 text-xs text-danger-400">
        Couldn't load form "{formSlug}": {loadError}
      </div>
    );
  }
  if (!form) {
    return (
      <div className="rounded border border-ink-700 bg-ink-900 p-3 text-sm text-ink-400">
        Loading form…
      </div>
    );
  }
  if (success) {
    return (
      <div className="rounded border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-300">
        {success}
      </div>
    );
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    if (form.settingsJson?.requireConsent && !consent) {
      setError("Please agree to the consent terms before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await submitPublicCmsForm(tenantSlug, formSlug, values);
      setSuccess(r.successMessage);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 rounded border border-ink-700 bg-ink-900 p-4"
    >
      <div>
        <h3 className="text-base font-medium text-ink-100">{form.name}</h3>
        {form.description && (
          <p className="mt-1 text-xs text-ink-400">{form.description}</p>
        )}
      </div>
      {(form.fieldsJson?.fields ?? []).map((f) => (
        <CmsFormFieldRenderer
          key={f.id}
          field={f}
          value={values[f.name]}
          onChange={(v) => setValues({ ...values, [f.name]: v })}
        />
      ))}
      <input
        type="text"
        name="_hp"
        autoComplete="off"
        tabIndex={-1}
        onChange={(e) => setValues({ ...values, _hp: e.target.value })}
        className="hidden"
        aria-hidden="true"
      />
      {form.settingsJson?.requireConsent && (
        <label className="flex items-start gap-2 text-xs text-ink-300">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            {form.settingsJson?.consentLabel ??
              "I agree to the terms and privacy policy."}
          </span>
        </label>
      )}
      {error && (
        <p className="rounded border border-danger-500/30 bg-danger-500/10 px-2 py-1.5 text-xs text-danger-400">
          {error}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="rounded border border-accent-500/40 bg-accent-500/15 px-4 py-2 text-sm font-medium text-accent-300 hover:bg-accent-500/25 disabled:opacity-50"
      >
        {busy ? "Sending…" : "Submit"}
      </button>
    </form>
  );
}

function CmsFormFieldRenderer({
  field,
  value,
  onChange,
}: {
  field: CmsFormField;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const baseInputClass =
    "block w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 text-sm text-ink-100 focus:border-accent-500/60 focus:ring-1 focus:ring-accent-500/40";
  const stringValue = typeof value === "string" ? value : "";

  let control: React.ReactNode;
  switch (field.kind) {
    case "longtext":
      control = (
        <textarea
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          rows={4}
          className={baseInputClass}
        />
      );
      break;
    case "number":
      control = (
        <input
          type="number"
          value={
            typeof value === "number"
              ? value
              : value === undefined
              ? ""
              : Number(value)
          }
          onChange={(e) =>
            onChange(e.target.value === "" ? undefined : Number(e.target.value))
          }
          required={field.required}
          placeholder={field.placeholder}
          min={field.min}
          max={field.max}
          className={baseInputClass}
        />
      );
      break;
    case "email":
      control = (
        <input
          type="email"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          className={baseInputClass}
        />
      );
      break;
    case "checkbox":
      control = (
        <label className="flex items-center gap-2 text-sm text-ink-200">
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          <span>{field.label}</span>
        </label>
      );
      break;
    case "select":
      control = (
        <select
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          className={baseInputClass}
        >
          <option value="">—</option>
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
      break;
    default:
      control = (
        <input
          type="text"
          value={stringValue}
          onChange={(e) => onChange(e.target.value)}
          required={field.required}
          placeholder={field.placeholder}
          pattern={field.pattern}
          className={baseInputClass}
        />
      );
  }

  if (field.kind === "checkbox") {
    return <div>{control}</div>;
  }

  return (
    <label className="block space-y-1">
      <span className="block text-xs font-medium text-ink-300">
        {field.label}
        {field.required && <span className="text-danger-400"> *</span>}
      </span>
      {control}
      {field.helpText && (
        <span className="block text-[11px] text-ink-500">{field.helpText}</span>
      )}
    </label>
  );
}

/* ====================================================================== */
/* Tabs block — public renderer                                            */
/* ====================================================================== */

function PublicTabs({
  tabs,
}: {
  tabs: Array<{ label: string; body: string }>;
}) {
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-900">
      <div className="flex border-b border-ink-800 px-2">
        {tabs.map((t, i) => (
          <button
            key={i}
            type="button"
            onClick={() => setActive(i)}
            className={[
              "border-b-2 px-3 py-2 text-sm transition-colors",
              i === active
                ? "border-accent-500 text-accent-300"
                : "border-transparent text-ink-400 hover:text-ink-100",
            ].join(" ")}
          >
            {t.label || `Tab ${i + 1}`}
          </button>
        ))}
      </div>
      <div className="whitespace-pre-wrap p-4 text-sm text-ink-200">
        {tabs[active]?.body}
      </div>
    </div>
  );
}

/* ====================================================================== */
/* Video URL → embed URL                                                   */
/* ====================================================================== */

/**
 * Coerce a video URL into a sandboxed iframe embed URL when we can.
 * Returns null for unrecognised hosts — the caller falls back to a
 * native <video> tag for direct file URLs.
 */
function videoEmbedUrl(url: string): string | null {
  // YouTube — match watch?v=, youtu.be/, /embed/, /shorts/.
  const youtubeMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/i,
  );
  if (youtubeMatch) {
    return `https://www.youtube.com/embed/${youtubeMatch[1]}`;
  }
  // Vimeo — vimeo.com/<id>.
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vimeoMatch) {
    return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* BlockCMS-native renderer                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Render a block authored on the BlockCMS native schema:
 *   { id, type, content: string, children?, metadata? }
 *
 * `content` is the universal payload — sometimes plain text, sometimes
 * pipe-delimited tuples (button: "label|style|url", quote: "text|author"),
 * sometimes newline-delimited lists (list/gallery), sometimes a 2-D
 * grid (table). The shape is documented inline next to each case so
 * the matching authoring side (`BlockCMS.tsx`) and this renderer
 * don't drift.
 *
 * Theme variables (--cms-accent, --cms-surface, --cms-text, etc.) are
 * applied at the page-frame level by the public renderer wrapper; we
 * just reach for them via CSS `var()` so the same blocks pick up
 * whatever theme the site has set.
 */
function BlockCmsRenderer({
  block,
  tenantSlug: _tenantSlug,
}: {
  block: { type: string; content: string; metadata?: Record<string, unknown>; children?: unknown[] };
  tenantSlug: string | null;
}) {
  const meta = block.metadata ?? {};
  const style: React.CSSProperties = {
    padding: typeof meta.padding === "string" && meta.padding
      ? `${parseInt(meta.padding) * 0.25}rem`
      : undefined,
    marginTop: typeof meta.margin === "string" && meta.margin
      ? `${parseInt(meta.margin) * 0.125}rem`
      : undefined,
    marginBottom: typeof meta.margin === "string" && meta.margin
      ? `${parseInt(meta.margin) * 0.125}rem`
      : undefined,
    backgroundColor: typeof meta.backgroundColor === "string" ? meta.backgroundColor : undefined,
    borderRadius: typeof meta.borderRadius === "string" ? meta.borderRadius : undefined,
  };
  const customClass = typeof meta.customClass === "string" ? meta.customClass : undefined;

  const inner = renderBlockCmsContent(block);
  return (
    <div style={style} className={customClass}>
      {inner}
    </div>
  );
}

function renderBlockCmsContent(block: {
  type: string;
  content: string;
  metadata?: Record<string, unknown>;
  children?: unknown[];
}): JSX.Element | null {
  const content = block.content ?? "";
  const meta = block.metadata ?? {};
  switch (block.type) {
    case "heading":
      return (
        <h1
          className="text-4xl font-bold leading-tight"
          style={{
            color: "var(--cms-text, #e6e9ee)",
            fontFamily: "var(--cms-heading-font, inherit)",
          }}
        >
          {content}
        </h1>
      );
    case "paragraph":
      return (
        <p
          className="text-lg font-light leading-relaxed"
          style={{
            color: "var(--cms-text, rgba(230,233,238,0.85))",
            fontFamily: "var(--cms-body-font, inherit)",
          }}
        >
          {content}
        </p>
      );
    case "image": {
      const alt = typeof meta.altText === "string" ? meta.altText : "";
      if (!content) return null;
      return (
        <img
          src={content}
          alt={alt}
          className="h-auto w-full shadow-sm"
          style={{ borderRadius: "var(--cms-radius, 0.5rem)" }}
        />
      );
    }
    case "code":
      return (
        <pre className="overflow-x-auto rounded-xl border border-ink-800 bg-ink-950 p-6 font-mono text-[13px] text-emerald-400">
          {content}
        </pre>
      );
    case "list":
      return (
        <ul className="space-y-3">
          {content.split("\n").filter(Boolean).map((item, i) => (
            <li key={i} className="flex items-start gap-4">
              <span
                className="mt-2.5 h-2 w-2 flex-shrink-0 rounded-full"
                style={{ background: "var(--cms-accent, #d4a24c)" }}
              />
              <span
                className="text-lg"
                style={{
                  color: "var(--cms-text, rgba(230,233,238,0.85))",
                  fontFamily: "var(--cms-body-font, inherit)",
                }}
              >
                {item}
              </span>
            </li>
          ))}
        </ul>
      );
    case "quote": {
      const [text, author] = content.split("|").map((s) => s.trim());
      return (
        <blockquote
          className="border-l-4 pl-8 py-4"
          style={{ borderColor: "var(--cms-accent, #d4a24c)" }}
        >
          <p
            className="mb-4 text-2xl font-light italic"
            style={{ color: "var(--cms-text, rgba(230,233,238,0.85))" }}
          >
            "{text}"
          </p>
          {author && (
            <footer className="text-sm font-bold uppercase tracking-widest text-ink-400">
              — {author}
            </footer>
          )}
        </blockquote>
      );
    }
    case "video": {
      if (!content) return null;
      const embed = embedUrl(content) ?? content;
      return (
        <div className="aspect-video overflow-hidden rounded-2xl border border-ink-800 bg-black shadow-2xl">
          <iframe src={embed} className="h-full w-full" allowFullScreen title="Embedded video" />
        </div>
      );
    }
    case "button": {
      const [label, btnStyle, url] = content.split("|").map((s) => s.trim());
      const isSecondary = btnStyle === "secondary";
      return (
        <a
          href={url || "#"}
          className="inline-flex items-center justify-center px-8 py-4 font-bold shadow-lg transition-transform hover:scale-105"
          style={{
            background: isSecondary
              ? "var(--cms-surface, #161a22)"
              : "var(--cms-accent, #d4a24c)",
            color: isSecondary ? "var(--cms-text, #e6e9ee)" : "#0b0d10",
            borderRadius: "var(--cms-radius, 0.75rem)",
          }}
        >
          {label}
        </a>
      );
    }
    case "divider":
      return (
        <hr
          className="my-12 border-0"
          style={{
            height: 1,
            background:
              "color-mix(in srgb, var(--cms-accent, #d4a24c) 35%, transparent)",
          }}
        />
      );
    case "gallery": {
      const images = content.split("\n").filter((u) => u.trim());
      if (images.length === 0) return null;
      return (
        <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
          {images.map((url, i) => (
            <img
              key={i}
              src={url}
              alt=""
              className="h-56 w-full rounded-2xl border border-ink-800 object-cover shadow-md"
            />
          ))}
        </div>
      );
    }
    case "table": {
      const rows = content
        .split("\n")
        .map((row) => row.split("|").map((cell) => cell.trim()));
      if (rows.length === 0) return null;
      return (
        <div className="overflow-hidden rounded-2xl border border-ink-700 shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                {rows[0]?.map((cell, i) => (
                  <th
                    key={i}
                    className="border-b border-ink-700 bg-ink-800/50 px-6 py-4 text-left text-xs font-bold uppercase tracking-widest text-ink-100"
                  >
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(1).map((row, i) => (
                <tr key={i}>
                  {row.map((cell, j) => (
                    <td key={j} className="border-b border-ink-800/50 px-6 py-4 text-ink-200">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "accordion": {
      const items = content
        .split("\n\n")
        .map((item) => item.split("|").map((s) => s.trim()))
        .filter((parts) => parts[0] || parts[1]);
      return (
        <div className="space-y-3">
          {items.map(([q, a], i) => (
            <details
              key={i}
              className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900"
            >
              <summary className="cursor-pointer px-6 py-4 font-bold text-ink-100 hover:bg-ink-800/30">
                {q}
              </summary>
              <div className="border-t border-ink-800/50 bg-ink-800/10 px-6 py-4 text-ink-200">
                {a}
              </div>
            </details>
          ))}
        </div>
      );
    }
    case "features": {
      const feats = content.split("\n").map((feat) => {
        const [title, desc] = feat.split("|").map((s) => s.trim());
        return { title, desc };
      });
      return (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {feats.map((feat, i) => (
            <div
              key={i}
              className="border p-8 shadow-sm"
              style={{
                borderRadius: "var(--cms-radius, 1.5rem)",
                borderColor:
                  "color-mix(in srgb, var(--cms-accent, #d4a24c) 18%, transparent)",
                background: "var(--cms-surface, #11141a)",
              }}
            >
              <h3
                className="mb-3 text-xl font-bold"
                style={{ color: "var(--cms-text, #e6e9ee)" }}
              >
                {feat.title}
              </h3>
              <p style={{ color: "var(--cms-text, rgba(230,233,238,0.7))" }}>
                {feat.desc}
              </p>
            </div>
          ))}
        </div>
      );
    }
    case "columns": {
      const children = (block.children as unknown[]) ?? [];
      return (
        <div className="flex flex-wrap gap-8 md:flex-nowrap">
          {children.map((col, i) => {
            const c = col as {
              id?: string;
              children?: unknown[];
              metadata?: { widthFr?: number };
            };
            // Per-column width hint stored on column.metadata.widthFr —
            // mirrors the BlockCMS authoring renderer so the public page
            // honors whatever ratio the operator dragged or typed.
            const fr =
              typeof c.metadata?.widthFr === "number" && c.metadata.widthFr > 0
                ? c.metadata.widthFr
                : 1;
            return (
              <div
                key={c.id ?? i}
                className="space-y-4"
                style={{ flex: `${fr} 1 0%`, minWidth: 0 }}
              >
                {(c.children as unknown[] | undefined)?.map((child, j) => {
                  const cb = child as {
                    id?: string;
                    type: string;
                    content: string;
                    metadata?: Record<string, unknown>;
                    children?: unknown[];
                  };
                  return (
                    <BlockCmsRenderer
                      key={cb.id ?? j}
                      block={cb}
                      tenantSlug={null}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      );
    }
    case "column":
      // Columns should only appear inside a "columns" parent — render
      // children directly if a stray column ends up at the top level.
      return (
        <div className="space-y-4">
          {((block.children as unknown[]) ?? []).map((child, i) => {
            const cb = child as {
              id?: string;
              type: string;
              content: string;
              metadata?: Record<string, unknown>;
              children?: unknown[];
            };
            return <BlockCmsRenderer key={cb.id ?? i} block={cb} tenantSlug={null} />;
          })}
        </div>
      );
    default:
      return (
        <p className="text-xs text-ink-500">
          [Unrecognized block type: {block.type}]
        </p>
      );
  }
}
