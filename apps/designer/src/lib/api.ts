/**
 * Typed API client.
 *
 * Single small fetch wrapper, no extra dependencies. Every request carries
 * `X-Tenant-Slug` so the API's tenant context plugin resolves the same demo
 * tenant the seed created.
 *
 * Why not pull in TanStack Query or trpc yet:
 *   - The designer's network surface is tiny (4 endpoints).
 *   - Loading state is simple enough to hold in the Zustand store.
 *   - We can add a query layer when caching / background refetch matters.
 */

import type {
  Ability,
  AbilityKind,
  Asset,
  AuthSession,
  AuthUser,
  Block,
  BoardLayout,
  BoardZone,
  Card,
  CardSet,
  CardType,
  Deck,
  DeckCard,
  Faction,
  Keyword,
  KeywordParameter,
  Lore,
  LoreKind,
  MembershipWithTenant,
  Project,
  ProjectMember,
  Ruleset,
  Template,
  Tenant,
  TenantMember,
  VariantBadge,
} from "@/lib/apiTypes";
import type { CardTypeTemplate } from "@/types";

/// Read at module load. Vite injects the env var at build time.
const API_BASE: string = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

/**
 * Root domain the platform serves under. Tenants live at
 * `<tenant>.<root>` and projects at `<project>.<tenant>.<root>`.
 *
 * Read from the Vite env so devs can override (`VITE_ROOT_DOMAIN`)
 * without touching code. Default matches the backend default.
 */
const ROOT_DOMAIN: string =
  (import.meta.env as { VITE_ROOT_DOMAIN?: string }).VITE_ROOT_DOMAIN ?? "tcgstudio.local";

/**
 * Best-effort host → context decoder. Used to seed the active tenant
 * slug from the browser's address bar before the API context call
 * round-trips. The server's `/api/v1/context` endpoint is the
 * canonical source — it also resolves custom domains (which the
 * frontend can't see by hostname alone). This local parser only
 * handles the conventional `<sub>.<root>` form.
 */
export function parseHostnameContext(hostname: string): {
  level: "platform" | "tenant" | "project";
  tenantSlug?: string;
  projectSlug?: string;
  /**
   * When the host is a single subdomain label that contains hyphens
   * (e.g. `core-acme.tcgstudio.local`), we surface every plausible
   * `<project>-<tenant>` split here. The boot bootstrap calls
   * `/api/v1/context` to disambiguate against the live database; we
   * can't pick the right split client-side because both project and
   * tenant slugs may legitimately contain hyphens.
   */
  compoundCandidates?: Array<{ projectSlug: string; tenantSlug: string }>;
} {
  const root = ROOT_DOMAIN.toLowerCase();
  const h = hostname.toLowerCase();
  if (h === "localhost" || /^[\d.]+$/.test(h)) {
    return { level: "platform" };
  }
  if (h === root) return { level: "platform" };
  if (!h.endsWith(`.${root}`)) {
    // Custom domain — we can't resolve it client-side; defer to /context.
    return { level: "platform" };
  }
  const sub = h.slice(0, -1 - root.length);
  const parts = sub.split(".").filter(Boolean);
  if (parts.length === 1) {
    const splits: Array<{ projectSlug: string; tenantSlug: string }> = [];
    const label = parts[0];
    for (let i = 1; i < label.length - 1; i++) {
      if (label[i] !== "-") continue;
      const projectSlug = label.slice(0, i);
      const tenantSlug = label.slice(i + 1);
      if (
        projectSlug &&
        tenantSlug &&
        !projectSlug.endsWith("-") &&
        !tenantSlug.startsWith("-")
      ) {
        splits.push({ projectSlug, tenantSlug });
      }
    }
    return {
      level: "tenant",
      tenantSlug: label,
      ...(splits.length > 0 ? { compoundCandidates: splits } : {}),
    };
  }
  if (parts.length >= 2)
    return { level: "project", tenantSlug: parts[1], projectSlug: parts[0] };
  return { level: "platform" };
}

export function getRootDomain(): string {
  return ROOT_DOMAIN;
}

/**
 * The platform tenant slug — must match `PLATFORM_TENANT_SLUG` on the
 * API (defaults to "platform" in `apps/api/src/env.ts`). Hard-coded
 * here so the frontend can correctly route platform-host requests
 * without a /context round trip. If you change the env on the API,
 * change this too.
 */
const PLATFORM_TENANT_SLUG = "platform";

/**
 * Active tenant slug. Mutable — `setActiveTenantSlug` is called from the
 * store whenever the user picks a different tenant. A module-level variable
 * keeps the network layer simple (no need to plumb the slug through every
 * call site) without coupling the API client to the React store.
 *
 * Default seeds from the current hostname when possible:
 *   `acme.tcgstudio.local`           → "acme"
 *   `core.acme.tcgstudio.local`     → "acme"
 *   `tcgstudio.local` / `localhost` → "platform" (the platform tenant —
 *     NOT "demo", which would silently land you in the wrong workspace)
 *
 * The auto-detection means a user landing on `acme.tcgstudio.local` is
 * already operating against tenant `acme` before the React shell
 * mounts; no flicker through another tenant first.
 */
let _tenantSlug = (() => {
  if (typeof window === "undefined") return PLATFORM_TENANT_SLUG;
  const ctx = parseHostnameContext(window.location.hostname);
  if (ctx.tenantSlug) return ctx.tenantSlug;
  // No tenant subdomain → this is the platform host. Land on the
  // platform tenant, not "demo" (a regular tenant that just happens
  // to exist in dev).
  return PLATFORM_TENANT_SLUG;
})();

export function setActiveTenantSlug(slug: string): void {
  _tenantSlug = slug;
}

export function getActiveTenantSlug(): string {
  return _tenantSlug;
}

/**
 * Bearer token used for authenticated requests. Restored from localStorage
 * at module load so a refresh keeps the user signed in.
 */
const AUTH_TOKEN_KEY = "tcgstudio.auth.token";
let _authToken: string | null = (() => {
  try {
    return typeof window !== "undefined"
      ? window.localStorage.getItem(AUTH_TOKEN_KEY)
      : null;
  } catch {
    return null;
  }
})();

export function setAuthToken(token: string | null): void {
  _authToken = token;
  try {
    if (typeof window === "undefined") return;
    if (token) window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    else window.localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    // Storage write failed (private mode / quota) — token still works in-memory.
  }
}

export function getAuthToken(): string | null {
  return _authToken;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
  signal?: AbortSignal;
}

// Exported so feature views (SupportView, future ad-hoc fetches) can
// hit endpoints without us minting a typed wrapper for every one.
// Prefer adding a dedicated wrapper here for endpoints called from
// >1 place, but a single-caller use of `request<T>(...)` is fine.
export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const url = new URL(path, API_BASE);
  if (options.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    }
  }

  const headers: Record<string, string> = {
    "X-Tenant-Slug": _tenantSlug,
  };
  if (options.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;

  const response = await fetch(url.toString(), {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  // 204 No Content — nothing to parse.
  if (response.status === 204) return undefined as T;

  const text = await response.text();
  const parsed = text ? safeParseJson(text) : undefined;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${response.status} ${response.statusText} — ${
        (parsed as { error?: string; message?: string } | undefined)?.message ??
        (parsed as { error?: string } | undefined)?.error ??
        "request failed"
      }`,
      parsed,
    );
  }

  return parsed as T;
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ---------------------------------------------------------------------------
// Auth (top-level — no tenant scope)
// ---------------------------------------------------------------------------

export async function signUp(input: {
  email: string;
  password: string;
  name: string;
  /** Joining an existing tenant by slug — the backend adds a viewer
   *  Membership instead of minting a personal tenant. */
  tenantSlug?: string;
  /** Redeeming an invitation. The backend skips personal-tenant
   *  creation and adds memberships per the invite's scope. */
  invitationToken?: string;
}): Promise<AuthSession> {
  const r = await request<AuthSession>("/api/v1/auth/signup", {
    method: "POST",
    body: input,
  });
  setAuthToken(r.token);
  return r;
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<{ user: AuthUser; token: string }> {
  const r = await request<{ user: AuthUser; token: string }>("/api/v1/auth/login", {
    method: "POST",
    body: input,
  });
  setAuthToken(r.token);
  return r;
}

export async function fetchMe(): Promise<{
  user: AuthUser;
  memberships: MembershipWithTenant[];
}> {
  return await request<{ user: AuthUser; memberships: MembershipWithTenant[] }>(
    "/api/v1/auth/me",
  );
}

export function signOut(): void {
  setAuthToken(null);
}

// ---------------------------------------------------------------------------
// Invitation preview + redeem-aware signup. The signup form uses these
// when the URL carries `?invite=<token>` — it previews the invite,
// locks the email field, and submits the token alongside the signup
// payload so the backend skips the personal-tenant flow.
// ---------------------------------------------------------------------------

export interface InvitationPreview {
  scope: "platform" | "tenant" | "project";
  email: string;
  role: string;
  message: string;
  expiresAt: string;
  tenant: { name: string; slug: string } | null;
  project: { name: string; slug: string } | null;
}

export async function fetchInvitationPreview(
  token: string,
): Promise<InvitationPreview> {
  const r = await request<{ invitation: InvitationPreview }>(
    `/api/v1/auth/invitations/${encodeURIComponent(token)}`,
  );
  return r.invitation;
}

// ---------------------------------------------------------------------------
// Memberships (tenant-scoped)
// ---------------------------------------------------------------------------

export async function listMemberships(): Promise<TenantMember[]> {
  const r = await request<{ memberships: TenantMember[] }>("/api/v1/memberships");
  return r.memberships;
}

export async function inviteMember(input: {
  email: string;
  role?: string;
}): Promise<TenantMember> {
  const r = await request<{ membership: TenantMember }>("/api/v1/memberships", {
    method: "POST",
    body: input,
  });
  return r.membership;
}

export async function updateMembershipRole(
  id: string,
  role: string,
): Promise<TenantMember> {
  const r = await request<{ membership: TenantMember }>(`/api/v1/memberships/${id}`, {
    method: "PATCH",
    body: { role },
  });
  return r.membership;
}

export async function removeMembership(id: string): Promise<void> {
  await request<void>(`/api/v1/memberships/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Project memberships (sec 13.4) — every project keeps its own member
// list. Tenant owners/admins/project_creators bypass the gate at the
// route layer, but the list endpoint still returns whatever rows exist
// for completeness in the UI.
// ---------------------------------------------------------------------------

export async function listProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const r = await request<{ memberships: ProjectMember[] }>(
    `/api/v1/projects/${projectId}/members`,
  );
  return r.memberships;
}

export async function inviteProjectMember(
  projectId: string,
  input: { email: string; role?: string },
): Promise<ProjectMember> {
  const r = await request<{ membership: ProjectMember }>(
    `/api/v1/projects/${projectId}/members`,
    { method: "POST", body: input },
  );
  return r.membership;
}

export async function updateProjectMemberRole(
  projectId: string,
  membershipId: string,
  role: string,
): Promise<ProjectMember> {
  const r = await request<{ membership: ProjectMember }>(
    `/api/v1/projects/${projectId}/members/${membershipId}`,
    { method: "PATCH", body: { role } },
  );
  return r.membership;
}

export async function removeProjectMember(
  projectId: string,
  membershipId: string,
): Promise<void> {
  await request<void>(
    `/api/v1/projects/${projectId}/members/${membershipId}`,
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// Tenants (top-level — registered outside the tenant scope on the server)
// ---------------------------------------------------------------------------

export async function listTenants(): Promise<Tenant[]> {
  const r = await request<{ tenants: Tenant[] }>("/api/v1/tenants");
  return r.tenants;
}

export async function createTenant(input: {
  name: string;
  slug: string;
  status?: string;
  /** Optional tenant archetype — drives dashboard preset. */
  tenantType?: "solo" | "studio" | "publisher" | "school" | "reseller";
  /** White-label tokens captured by the registration wizard.
   *  Used by the backend to seed the default CMS landing/login. */
  brandingJson?: Record<string, unknown>;
}): Promise<Tenant> {
  const r = await request<{ tenant: Tenant }>("/api/v1/tenants", {
    method: "POST",
    body: input,
  });
  return r.tenant;
}

export async function updateTenant(
  id: string,
  patch: {
    name?: string;
    slug?: string;
    status?: string;
    brandingJson?: Record<string, unknown>;
  },
): Promise<Tenant> {
  const r = await request<{ tenant: Tenant }>(`/api/v1/tenants/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.tenant;
}

export async function deleteTenant(id: string): Promise<void> {
  await request<void>(`/api/v1/tenants/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

export async function listProjects(): Promise<Project[]> {
  const r = await request<{ projects: Project[] }>("/api/v1/projects");
  return r.projects;
}

export async function createProject(input: {
  name: string;
  slug: string;
  description?: string;
  status?: string;
  /** Email of the user who becomes the project's first owner. Required
   *  by the new auth model — tenant admins do NOT auto-get access to
   *  projects they create; they have to specify a login that will be
   *  used to sign in to the project subdomain. */
  ownerEmail: string;
  /** Optional white-label tokens captured by the project wizard.
   *  Used to seed the project's CMS landing/login pages. */
  brandingJson?: Record<string, unknown>;
}): Promise<Project> {
  const r = await request<{ project: Project }>("/api/v1/projects", {
    method: "POST",
    body: input,
  });
  return r.project;
}

export async function updateProject(
  id: string,
  patch: { name?: string; slug?: string; description?: string; status?: string },
): Promise<Project> {
  const r = await request<{ project: Project }>(`/api/v1/projects/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.project;
}

export async function deleteProject(id: string): Promise<void> {
  await request<void>(`/api/v1/projects/${id}`, { method: "DELETE" });
}

export async function listCardTypes(projectId: string): Promise<CardType[]> {
  const r = await request<{ cardTypes: CardType[] }>("/api/v1/card-types", {
    query: { projectId },
  });
  return r.cardTypes;
}

export async function listTemplates(params: {
  projectId?: string;
  cardTypeId?: string;
}): Promise<Template[]> {
  const r = await request<{ templates: Template[] }>("/api/v1/templates", {
    query: params,
  });
  return r.templates;
}

export async function getTemplate(id: string): Promise<Template> {
  const r = await request<{ template: Template }>(`/api/v1/templates/${id}`);
  return r.template;
}

export async function updateTemplateContent(
  id: string,
  content: CardTypeTemplate,
): Promise<Template> {
  const r = await request<{ template: Template }>(`/api/v1/templates/${id}`, {
    method: "PATCH",
    body: { contentJson: content },
  });
  return r.template;
}

export async function createTemplate(input: {
  projectId: string;
  cardTypeId: string;
  name: string;
  contentJson: CardTypeTemplate;
}): Promise<Template> {
  const r = await request<{ template: Template }>("/api/v1/templates", {
    method: "POST",
    body: input,
  });
  return r.template;
}

// ---------------------------------------------------------------------------
// Keywords (sec 25)
// ---------------------------------------------------------------------------

export async function listKeywords(params: {
  projectId?: string;
}): Promise<Keyword[]> {
  const r = await request<{ keywords: Keyword[] }>("/api/v1/keywords", { query: params });
  return r.keywords;
}

export async function createKeyword(input: {
  projectId: string;
  name: string;
  slug: string;
  reminderText?: string;
  rulesDefinition?: string;
  category?: string;
  parametersJson?: KeywordParameter[];
  color?: string | null;
  iconAssetId?: string | null;
}): Promise<Keyword> {
  const r = await request<{ keyword: Keyword }>("/api/v1/keywords", {
    method: "POST",
    body: input,
  });
  return r.keyword;
}

export async function updateKeyword(
  id: string,
  patch: Partial<Omit<Keyword, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<Keyword> {
  const r = await request<{ keyword: Keyword }>(`/api/v1/keywords/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.keyword;
}

export async function deleteKeyword(id: string): Promise<void> {
  await request<void>(`/api/v1/keywords/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Factions (sec 28)
// ---------------------------------------------------------------------------

export async function listFactions(params: {
  projectId?: string;
}): Promise<Faction[]> {
  const r = await request<{ factions: Faction[] }>("/api/v1/factions", { query: params });
  return r.factions;
}

export async function createFaction(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  iconAssetId?: string | null;
  imageAssetId?: string | null;
  frameAssetId?: string | null;
  mechanicsJson?: string[];
  lore?: string;
  status?: string;
  sortOrder?: number;
}): Promise<Faction> {
  const r = await request<{ faction: Faction }>("/api/v1/factions", {
    method: "POST",
    body: input,
  });
  return r.faction;
}

export async function updateFaction(
  id: string,
  patch: Partial<Omit<Faction, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<Faction> {
  const r = await request<{ faction: Faction }>(`/api/v1/factions/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.faction;
}

export async function deleteFaction(id: string): Promise<void> {
  await request<void>(`/api/v1/factions/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Blocks (sec 27.3)
// ---------------------------------------------------------------------------

export async function listBlocks(params: {
  projectId?: string;
}): Promise<Block[]> {
  const r = await request<{ blocks: Block[] }>("/api/v1/blocks", { query: params });
  return r.blocks;
}

export async function createBlock(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  color?: string;
  sortOrder?: number;
  metadataJson?: Record<string, unknown>;
  status?: string;
}): Promise<Block> {
  const r = await request<{ block: Block }>("/api/v1/blocks", {
    method: "POST",
    body: input,
  });
  return r.block;
}

export async function updateBlock(
  id: string,
  patch: Partial<Omit<Block, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt" | "setCount">>,
): Promise<Block> {
  const r = await request<{ block: Block }>(`/api/v1/blocks/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.block;
}

export async function deleteBlock(id: string): Promise<void> {
  await request<void>(`/api/v1/blocks/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Lore (sec 29)
// ---------------------------------------------------------------------------

export async function listLore(params: {
  projectId?: string;
  kind?: LoreKind;
  factionId?: string;
  setId?: string;
}): Promise<Lore[]> {
  const r = await request<{ lore: Lore[] }>("/api/v1/lore", { query: params });
  return r.lore;
}

export async function createLore(input: {
  projectId: string;
  kind: LoreKind;
  name: string;
  slug: string;
  summary?: string;
  body?: string;
  coverAssetId?: string | null;
  factionId?: string | null;
  setId?: string | null;
  visibility?: string;
  status?: string;
}): Promise<Lore> {
  const r = await request<{ lore: Lore }>("/api/v1/lore", {
    method: "POST",
    body: input,
  });
  return r.lore;
}

export async function updateLore(
  id: string,
  patch: Partial<Omit<Lore, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<Lore> {
  const r = await request<{ lore: Lore }>(`/api/v1/lore/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.lore;
}

export async function deleteLore(id: string): Promise<void> {
  await request<void>(`/api/v1/lore/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Decks (sec 30)
// ---------------------------------------------------------------------------

export async function listDecks(params: {
  projectId?: string;
  factionId?: string;
  setId?: string;
}): Promise<Deck[]> {
  const r = await request<{ decks: Deck[] }>("/api/v1/decks", { query: params });
  return r.decks;
}

export async function getDeck(id: string): Promise<Deck> {
  const r = await request<{ deck: Deck }>(`/api/v1/decks/${id}`);
  return r.deck;
}

export async function createDeck(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  format?: string;
  factionId?: string | null;
  setId?: string | null;
  coverAssetId?: string | null;
  status?: string;
  visibility?: string;
  sortOrder?: number;
}): Promise<Deck> {
  const r = await request<{ deck: Deck }>("/api/v1/decks", {
    method: "POST",
    body: input,
  });
  return r.deck;
}

export async function updateDeck(
  id: string,
  patch: Partial<Omit<Deck, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt" | "cards" | "cardCount">>,
): Promise<Deck> {
  const r = await request<{ deck: Deck }>(`/api/v1/decks/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.deck;
}

export async function deleteDeck(id: string): Promise<void> {
  await request<void>(`/api/v1/decks/${id}`, { method: "DELETE" });
}

/**
 * Bulk replace the deck's card list. Idempotent on the server side —
 * existing slots are wiped and the new list is reinserted in one
 * transaction. Use this from the deck editor's "Save" button.
 */
export async function replaceDeckCards(
  id: string,
  cards: Array<Pick<DeckCard, "cardId" | "quantity" | "sideboard" | "category">>,
): Promise<{ ok: boolean; count: number }> {
  return request<{ ok: boolean; count: number }>(`/api/v1/decks/${id}/cards`, {
    method: "PUT",
    body: { cards },
  });
}

// ---------------------------------------------------------------------------
// Boards (sec 26)
// ---------------------------------------------------------------------------

export async function listBoards(params: { projectId?: string }): Promise<BoardLayout[]> {
  const r = await request<{ boards: BoardLayout[] }>("/api/v1/boards", { query: params });
  return r.boards;
}

export async function getBoard(id: string): Promise<BoardLayout> {
  const r = await request<{ board: BoardLayout }>(`/api/v1/boards/${id}`);
  return r.board;
}

export async function createBoard(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  width?: number;
  height?: number;
  background?: string;
  zonesJson?: BoardZone[];
}): Promise<BoardLayout> {
  const r = await request<{ board: BoardLayout }>("/api/v1/boards", {
    method: "POST",
    body: input,
  });
  return r.board;
}

export async function updateBoard(
  id: string,
  patch: Partial<Omit<BoardLayout, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<BoardLayout> {
  const r = await request<{ board: BoardLayout }>(`/api/v1/boards/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.board;
}

export async function deleteBoard(id: string): Promise<void> {
  await request<void>(`/api/v1/boards/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Rulesets (sec 23)
// ---------------------------------------------------------------------------

export async function listRulesets(params: { projectId?: string }): Promise<Ruleset[]> {
  const r = await request<{ rulesets: Ruleset[] }>("/api/v1/rulesets", { query: params });
  return r.rulesets;
}

export async function getRuleset(id: string): Promise<Ruleset> {
  const r = await request<{ ruleset: Ruleset }>(`/api/v1/rulesets/${id}`);
  return r.ruleset;
}

export async function createRuleset(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  configJson?: unknown;
  status?: string;
  isDefault?: boolean;
  sortOrder?: number;
}): Promise<Ruleset> {
  const r = await request<{ ruleset: Ruleset }>("/api/v1/rulesets", {
    method: "POST",
    body: input,
  });
  return r.ruleset;
}

export async function updateRuleset(
  id: string,
  patch: Partial<Omit<Ruleset, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<Ruleset> {
  const r = await request<{ ruleset: Ruleset }>(`/api/v1/rulesets/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.ruleset;
}

export async function deleteRuleset(id: string): Promise<void> {
  await request<void>(`/api/v1/rulesets/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Abilities (sec 24)
// ---------------------------------------------------------------------------

export async function listAbilities(params: {
  projectId?: string;
  kind?: AbilityKind;
  keywordId?: string;
}): Promise<Ability[]> {
  const r = await request<{ abilities: Ability[] }>("/api/v1/abilities", { query: params });
  return r.abilities;
}

export async function createAbility(input: {
  projectId: string;
  name: string;
  slug: string;
  kind?: AbilityKind;
  text?: string;
  reminderText?: string;
  trigger?: string;
  cost?: string;
  keywordId?: string | null;
  status?: string;
  sortOrder?: number;
}): Promise<Ability> {
  const r = await request<{ ability: Ability }>("/api/v1/abilities", {
    method: "POST",
    body: input,
  });
  return r.ability;
}

export async function updateAbility(
  id: string,
  patch: Partial<Omit<Ability, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<Ability> {
  const r = await request<{ ability: Ability }>(`/api/v1/abilities/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.ability;
}

export async function deleteAbility(id: string): Promise<void> {
  await request<void>(`/api/v1/abilities/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Variant badges (sec 21.x)
// ---------------------------------------------------------------------------

export async function listVariantBadges(params: { projectId?: string }): Promise<VariantBadge[]> {
  const r = await request<{ badges: VariantBadge[] }>("/api/v1/variant-badges", { query: params });
  return r.badges;
}

export async function createVariantBadge(input: {
  projectId: string;
  name: string;
  slug: string;
  label?: string;
  iconAssetId?: string | null;
  color?: string;
  textColor?: string;
  shape?: string;
  position?: string;
  conditionJson?: Record<string, unknown>;
  status?: string;
  sortOrder?: number;
}): Promise<VariantBadge> {
  const r = await request<{ badge: VariantBadge }>("/api/v1/variant-badges", {
    method: "POST",
    body: input,
  });
  return r.badge;
}

export async function updateVariantBadge(
  id: string,
  patch: Partial<Omit<VariantBadge, "id" | "tenantId" | "projectId" | "createdAt" | "updatedAt">>,
): Promise<VariantBadge> {
  const r = await request<{ badge: VariantBadge }>(`/api/v1/variant-badges/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.badge;
}

export async function deleteVariantBadge(id: string): Promise<void> {
  await request<void>(`/api/v1/variant-badges/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Host context (sec 10.4) + custom domains (sec 11.5)
// ---------------------------------------------------------------------------

export interface HostContext {
  level: "platform" | "tenant" | "project";
  rootDomain: string;
  tenantSlug: string | null;
  projectSlug: string | null;
  tenant: { id: string; slug: string; name: string; status: string } | null;
  project: { id: string; slug: string; name: string; status: string } | null;
  hosts: { platform: string; tenant: string | null; project: string | null };
}

/**
 * Fetch the server's view of the current host. This is the
 * authoritative source for level + tenant + project — the local
 * `parseHostnameContext` can only see standard subdomains and misses
 * custom domains entirely.
 *
 * The browser may live on a different hostname than the API (designer
 * at `demo.tcgstudio.local:5173`, API at `localhost:4000`), so we
 * forward the browser's `host` as a query hint. The API resolves the
 * hint instead of its own `Host` header — otherwise everything looks
 * like platform scope to it.
 */
export async function fetchHostContext(): Promise<HostContext> {
  const host =
    typeof window !== "undefined" && window.location?.host
      ? window.location.host
      : "";
  return request<HostContext>(
    `/api/v1/context${host ? `?host=${encodeURIComponent(host)}` : ""}`,
  );
}

export type TenantDomainStatus =
  | "pending"
  | "verified"
  | "active"
  | "failed"
  | "disabled";

export type TenantDomainStatusReason =
  | "ok"
  | "txt_missing"
  | "txt_mismatch"
  | "cname_missing"
  | "cname_wrong_target"
  | "dns_lookup_failed"
  | "manual_disabled"
  | null;

export interface TenantDomain {
  id: string;
  tenantId: string;
  hostname: string;
  verificationToken: string;
  status: TenantDomainStatus;
  statusReason: TenantDomainStatusReason;
  isPrimary: boolean;
  projectSlug: string | null;
  createdAt: string;
  updatedAt: string;
  verifiedAt: string | null;
  lastCheckedAt: string | null;
}

export interface DnsInstructions {
  txt: { name: string; value: string; ttl: number };
  cname: { name: string; value: string; note: string };
}

export interface DomainCheckResult {
  txt: {
    name: string;
    expected: string;
    found: string[] | null;
    matched: boolean;
    error?: string;
  };
  cname: {
    name: string;
    found: string[] | null;
    expected: string[];
    matched: boolean;
    error?: string;
  };
}

export async function listTenantDomains(): Promise<TenantDomain[]> {
  const r = await request<{ domains: TenantDomain[] }>("/api/v1/domains");
  return r.domains;
}

export async function createTenantDomain(input: {
  hostname: string;
  projectSlug?: string;
  isPrimary?: boolean;
}): Promise<{ domain: TenantDomain; instructions: DnsInstructions }> {
  return request<{ domain: TenantDomain; instructions: DnsInstructions }>("/api/v1/domains", {
    method: "POST",
    body: input,
  });
}

export async function getTenantDomain(
  id: string,
): Promise<{ domain: TenantDomain; instructions: DnsInstructions }> {
  return request<{ domain: TenantDomain; instructions: DnsInstructions }>(`/api/v1/domains/${id}`);
}

export async function verifyTenantDomain(
  id: string,
): Promise<{ domain: TenantDomain; check: DomainCheckResult }> {
  return request<{ domain: TenantDomain; check: DomainCheckResult }>(
    `/api/v1/domains/${id}/verify`,
    { method: "POST" },
  );
}

export async function updateTenantDomain(
  id: string,
  patch: Partial<Pick<TenantDomain, "isPrimary" | "projectSlug" | "status">>,
): Promise<TenantDomain> {
  const r = await request<{ domain: TenantDomain }>(`/api/v1/domains/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.domain;
}

export async function deleteTenantDomain(id: string): Promise<void> {
  await request<void>(`/api/v1/domains/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Card types
// ---------------------------------------------------------------------------

export async function createCardType(input: {
  projectId: string;
  name: string;
  slug: string;
  description?: string;
  schemaJson?: unknown;
}): Promise<CardType> {
  const r = await request<{ cardType: CardType }>("/api/v1/card-types", {
    method: "POST",
    body: input,
  });
  return r.cardType;
}

export async function updateCardType(
  id: string,
  patch: {
    name?: string;
    slug?: string;
    description?: string;
    activeTemplateId?: string | null;
    schemaJson?: unknown;
    status?: string;
  },
): Promise<CardType> {
  const r = await request<{ cardType: CardType }>(`/api/v1/card-types/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.cardType;
}

export async function deleteCardType(id: string): Promise<void> {
  await request<void>(`/api/v1/card-types/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Sets (sec 27)
// ---------------------------------------------------------------------------

export async function listSets(params: {
  projectId?: string;
}): Promise<CardSet[]> {
  const r = await request<{ sets: CardSet[] }>("/api/v1/sets", { query: params });
  return r.sets;
}

export async function createSet(input: {
  projectId: string;
  name: string;
  code: string;
  description?: string;
  releaseDate?: string;
  status?: string;
}): Promise<CardSet> {
  const r = await request<{ set: CardSet }>("/api/v1/sets", {
    method: "POST",
    body: input,
  });
  return r.set;
}

export async function updateSet(
  id: string,
  patch: {
    name?: string;
    code?: string;
    description?: string;
    releaseDate?: string | null;
    status?: string;
    packRulesJson?: unknown;
    blockId?: string | null;
  },
): Promise<CardSet> {
  const r = await request<{ set: CardSet }>(`/api/v1/sets/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.set;
}

export async function deleteSet(id: string): Promise<void> {
  await request<void>(`/api/v1/sets/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export async function listCards(params: {
  projectId?: string;
  cardTypeId?: string;
  setId?: string;
}): Promise<Card[]> {
  const r = await request<{ cards: Card[] }>("/api/v1/cards", { query: params });
  return r.cards;
}

export async function createCard(input: {
  projectId: string;
  cardTypeId: string;
  name: string;
  slug: string;
  dataJson?: Record<string, unknown>;
}): Promise<Card> {
  const r = await request<{ card: Card }>("/api/v1/cards", {
    method: "POST",
    body: input,
  });
  return r.card;
}

export async function updateCardData(
  id: string,
  patch: Partial<
    Pick<
      Card,
      "name" | "slug" | "dataJson" | "status" | "rarity" | "collectorNumber" | "setId"
    >
  >,
): Promise<Card> {
  const r = await request<{ card: Card }>(`/api/v1/cards/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.card;
}

export async function deleteCard(id: string): Promise<void> {
  await request<void>(`/api/v1/cards/${id}`, { method: "DELETE" });
}

export async function getCard(id: string): Promise<Card> {
  const r = await request<{ card: Card }>(`/api/v1/cards/${id}`);
  return r.card;
}

// ---------------------------------------------------------------------------
// Card revision history (sec 46)
// ---------------------------------------------------------------------------

export interface CardVersion {
  id: string;
  tenantId: string;
  cardId: string;
  versionNum: number;
  name: string;
  slug: string;
  status: string;
  rarity: string | null;
  collectorNumber: number | null;
  cardTypeId: string;
  setId: string | null;
  dataJson: Record<string, unknown>;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export async function listCardVersions(cardId: string): Promise<CardVersion[]> {
  const r = await request<{ versions: CardVersion[] }>(
    `/api/v1/cards/${cardId}/versions`,
  );
  return r.versions;
}

export async function compareCardVersions(
  cardId: string,
  a: string,
  b: string,
): Promise<{ a: CardVersion; b: CardVersion }> {
  return request(`/api/v1/cards/${cardId}/versions/compare?a=${a}&b=${b}`);
}

export async function restoreCardVersion(
  cardId: string,
  versionId: string,
): Promise<Card> {
  const r = await request<{ card: Card }>(
    `/api/v1/cards/${cardId}/versions/${versionId}/restore`,
    { method: "POST" },
  );
  return r.card;
}

// ---------------------------------------------------------------------------
// Card comments + approval (sec 18.4)
// ---------------------------------------------------------------------------

export type CardCommentKind = "comment" | "approval" | "change_request";

export interface CardComment {
  id: string;
  tenantId: string;
  cardId: string;
  userId: string;
  parentId: string | null;
  kind: CardCommentKind;
  body: string;
  versionId: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listCardComments(cardId: string): Promise<CardComment[]> {
  const r = await request<{ comments: CardComment[] }>(
    `/api/v1/cards/${cardId}/comments`,
  );
  return r.comments;
}

export async function createCardComment(
  cardId: string,
  input: { body: string; parentId?: string | null; versionId?: string | null },
): Promise<CardComment> {
  const r = await request<{ comment: CardComment }>(
    `/api/v1/cards/${cardId}/comments`,
    { method: "POST", body: input },
  );
  return r.comment;
}

export async function updateCardComment(
  cardId: string,
  commentId: string,
  body: string,
): Promise<CardComment> {
  const r = await request<{ comment: CardComment }>(
    `/api/v1/cards/${cardId}/comments/${commentId}`,
    { method: "PATCH", body: { body } },
  );
  return r.comment;
}

export async function resolveCardComment(
  cardId: string,
  commentId: string,
): Promise<CardComment> {
  const r = await request<{ comment: CardComment }>(
    `/api/v1/cards/${cardId}/comments/${commentId}/resolve`,
    { method: "POST" },
  );
  return r.comment;
}

export async function unresolveCardComment(
  cardId: string,
  commentId: string,
): Promise<CardComment> {
  const r = await request<{ comment: CardComment }>(
    `/api/v1/cards/${cardId}/comments/${commentId}/unresolve`,
    { method: "POST" },
  );
  return r.comment;
}

export async function deleteCardComment(
  cardId: string,
  commentId: string,
): Promise<void> {
  await request<void>(
    `/api/v1/cards/${cardId}/comments/${commentId}`,
    { method: "DELETE" },
  );
}

export async function approveCard(
  cardId: string,
  comment?: string,
): Promise<{ card: Card; comment: CardComment }> {
  return request<{ card: Card; comment: CardComment }>(
    `/api/v1/cards/${cardId}/approve`,
    { method: "POST", body: comment ? { comment } : {} },
  );
}

export async function requestCardChanges(
  cardId: string,
  comment?: string,
): Promise<{ card: Card; comment: CardComment }> {
  return request<{ card: Card; comment: CardComment }>(
    `/api/v1/cards/${cardId}/request-changes`,
    { method: "POST", body: comment ? { comment } : {} },
  );
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export async function listAssets(params: {
  projectId?: string;
  type?: string;
  /** Cursor — return rows older than this ISO date. */
  before?: string;
  /** Page size (max 5000). Defaults server-side to 1000. */
  limit?: number;
}): Promise<Asset[]> {
  // Auto-paginate so callers don't have to think about cursors. Big
  // libraries that exceed the server's max page size keep loading
  // until the server signals it's out of rows. Hard cap at 20k so
  // a runaway loop doesn't OOM the browser.
  const HARD_CAP = 20000;
  const all: Asset[] = [];
  let before = params.before;
  while (all.length < HARD_CAP) {
    const r = await request<{ assets: Asset[]; nextBefore: string | null }>(
      "/api/v1/assets",
      {
        query: {
          projectId: params.projectId,
          type: params.type,
          before,
          limit: params.limit ? String(params.limit) : undefined,
        },
      },
    );
    all.push(...r.assets);
    if (!r.nextBefore || r.assets.length === 0) break;
    before = r.nextBefore;
  }
  return all;
}

/** Single page version — returns up to one page worth of rows + the
 * continuation cursor. Useful for infinite-scroll grids where you want
 * to load more on demand rather than fetching everything up front. */
export async function listAssetsPage(params: {
  projectId?: string;
  type?: string;
  before?: string;
  limit?: number;
}): Promise<{ assets: Asset[]; nextBefore: string | null }> {
  return request<{ assets: Asset[]; nextBefore: string | null }>(
    "/api/v1/assets",
    {
      query: {
        projectId: params.projectId,
        type: params.type,
        before: params.before,
        limit: params.limit ? String(params.limit) : undefined,
      },
    },
  );
}

/**
 * Upload a file to the assets endpoint via multipart/form-data. We bypass the
 * shared `request()` helper here because that one always sends JSON; the
 * upload route needs a real FormData body so the boundary header is correct.
 */
export async function uploadAsset(input: {
  file: File;
  projectId?: string | null;
  name?: string;
  type?: string;
  /** Drop the upload directly into a folder. Null/omitted = root. */
  folderId?: string | null;
}): Promise<Asset> {
  const fd = new FormData();
  fd.append("file", input.file, input.file.name);
  if (input.projectId) fd.append("projectId", input.projectId);
  if (input.name) fd.append("name", input.name);
  if (input.type) fd.append("type", input.type);
  if (input.folderId) fd.append("folderId", input.folderId);

  const url = new URL("/api/v1/assets/upload", API_BASE);
  const uploadHeaders: Record<string, string> = { "X-Tenant-Slug": _tenantSlug };
  if (_authToken) uploadHeaders["Authorization"] = `Bearer ${_authToken}`;
  const response = await fetch(url.toString(), {
    method: "POST",
    headers: uploadHeaders,
    body: fd,
  });
  const text = await response.text();
  const parsed = text ? safeParseJson(text) : undefined;
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `${response.status} ${response.statusText} — ${
        (parsed as { error?: string; message?: string } | undefined)?.message ??
        (parsed as { error?: string } | undefined)?.error ??
        "upload failed"
      }`,
      parsed,
    );
  }
  return (parsed as { asset: Asset }).asset;
}

export async function deleteAsset(id: string): Promise<void> {
  await request<void>(`/api/v1/assets/${id}`, { method: "DELETE" });
}

export async function getAsset(id: string): Promise<Asset> {
  const r = await request<{ asset: Asset }>(`/api/v1/assets/${id}`);
  return r.asset;
}

export async function updateAsset(
  id: string,
  patch: {
    name?: string;
    slug?: string;
    type?: string;
    visibility?: string;
    metadataJson?: Record<string, unknown>;
    /** Move into another folder. `null` = root. */
    folderId?: string | null;
  },
): Promise<Asset> {
  const r = await request<{ asset: Asset }>(`/api/v1/assets/${id}`, {
    method: "PATCH",
    body: patch,
  });
  return r.asset;
}

// ---------------------------------------------------------------------------
// Asset folders + bulk ops + approval (sec 20). The frontend file-
// explorer uses these for the folder tree, drag-to-folder moves,
// multi-select bulk delete / submit / approve / reject.
// ---------------------------------------------------------------------------

export interface AssetFolder {
  id: string;
  tenantId: string;
  projectId: string | null;
  parentId: string | null;
  name: string;
  slug: string;
  createdAt: string;
  updatedAt: string;
  _count?: { assets: number; children: number };
}

export async function listAssetFolders(params: {
  projectId?: string;
  parentId?: string | null;
} = {}): Promise<AssetFolder[]> {
  const query: Record<string, string> = {};
  if (params.projectId) query.projectId = params.projectId;
  if (params.parentId === null) query.parentId = "null";
  else if (params.parentId !== undefined) query.parentId = params.parentId;
  const r = await request<{ folders: AssetFolder[] }>(
    "/api/v1/asset-folders",
    { query },
  );
  return r.folders;
}

export async function createAssetFolder(input: {
  name: string;
  slug?: string;
  parentId?: string | null;
  projectId?: string;
}): Promise<AssetFolder> {
  const r = await request<{ folder: AssetFolder }>("/api/v1/asset-folders", {
    method: "POST",
    body: input,
  });
  return r.folder;
}

export async function updateAssetFolder(
  id: string,
  patch: { name?: string; slug?: string; parentId?: string | null },
): Promise<AssetFolder> {
  const r = await request<{ folder: AssetFolder }>(
    `/api/v1/asset-folders/${id}`,
    { method: "PATCH", body: patch },
  );
  return r.folder;
}

export async function deleteAssetFolder(id: string): Promise<void> {
  await request<void>(`/api/v1/asset-folders/${id}`, { method: "DELETE" });
}

export type BulkAssetAction =
  | "move"
  | "delete"
  | "submit"
  | "approve"
  | "reject"
  | "set_visibility";

export async function bulkAssetOp(input: {
  ids: string[];
  action: BulkAssetAction;
  folderId?: string | null;
  note?: string;
  visibility?: string;
}): Promise<{
  succeeded: string[];
  failed: Array<{ id: string; reason: string }>;
}> {
  return request("/api/v1/assets/bulk", { method: "POST", body: input });
}

export async function submitAssetForApproval(
  id: string,
  note?: string,
): Promise<void> {
  await request<void>(`/api/v1/assets/${id}/submit`, {
    method: "POST",
    body: { note: note ?? "" },
  });
}

export async function approveAsset(id: string, note?: string): Promise<void> {
  await request<void>(`/api/v1/assets/${id}/approve`, {
    method: "POST",
    body: { note: note ?? "" },
  });
}

export async function rejectAsset(id: string, note?: string): Promise<void> {
  await request<void>(`/api/v1/assets/${id}/reject`, {
    method: "POST",
    body: { note: note ?? "" },
  });
}

/** Browser-resolvable URL for an asset's bytes. Used as <img src> / Konva.Image source. */
export function assetBlobUrl(id: string | null | undefined): string {
  if (!id || id === "null" || id === "undefined") return "";
  // If we definitely don't have a token yet (or it looks invalid), don't even
  // try to hit the API — it will just 401. This prevents console noise during
  // boot or after logout.
  if (!_authToken || !_authToken.includes(".")) return "";

  const url = new URL(`${API_BASE}/api/v1/assets/${id}/blob`);
  url.searchParams.set("tenant", _tenantSlug);
  url.searchParams.set("token", _authToken);
  return url.toString();
}

/**
 * Resolves a reliable source URL for an image layer.
 * Internal asset URLs are automatically refreshed with the latest
 * auth token and tenant slug to prevent 401/404 errors.
 */
export function resolveAssetUrl(
  layer: { assetId?: string | null; src?: string | null; fieldKey?: string | null },
  data: Record<string, unknown> = {},
  /**
   * Optional override for "asset id → URL". The public gallery passes a
   * tenant-slug-aware resolver here so frame art / card art route
   * through the unauthenticated public asset endpoint instead of the
   * auth-token-protected `/api/v1/assets/:id/blob`. Defaults to the
   * authenticated `assetBlobUrl` for the editor.
   */
  resolveId?: (assetId: string) => string,
): string | null {
  const idResolver = resolveId ?? assetBlobUrl;
  let idOrUrl: string | null = null;

  if (layer.fieldKey) {
    const v = data[layer.fieldKey];
    if (typeof v === "string" && v.trim() !== "" && v !== "null" && v !== "undefined") idOrUrl = v;
  }
  if (!idOrUrl && layer.assetId && layer.assetId !== "null" && layer.assetId !== "undefined") {
    idOrUrl = layer.assetId;
  }
  if (!idOrUrl && layer.src && layer.src !== "null" && layer.src !== "undefined") {
    idOrUrl = layer.src;
  }

  if (!idOrUrl) return null;

  // Known internal asset URL — extract the id and let the resolver
  // produce a fresh URL (so a stale auth token in the original URL
  // doesn't leak into the rendered output).
  const assetIdMatch = idOrUrl.match(/\/api\/v[01]\/assets\/([^/?#]+)\/blob/);
  if (assetIdMatch) {
    return idResolver(assetIdMatch[1]);
  }
  // Public asset URL — also extract the id so re-renders pick up the
  // active tenant slug correctly.
  const publicMatch = idOrUrl.match(/\/api\/public\/[^/]+\/assets\/([^/?#]+)\/blob/);
  if (publicMatch) {
    return idResolver(publicMatch[1]);
  }

  // Raw ID (no protocol / slashes) — treat as an asset id.
  if (!/^(https?:|data:|blob:|\/)/.test(idOrUrl)) {
    return idResolver(idOrUrl);
  }

  return idOrUrl;
}

// ---------------------------------------------------------------------------
// CMS (sec 14)
// ---------------------------------------------------------------------------
//
// The CMS surface is two-sided:
//   • Authoring API (/api/v1/cms/...) — tenant-scoped, requires auth.
//   • Public API (/api/public/.../cms/...) — exposes only published
//     content. Used by PublicGallery + future white-label sites.

export type CmsSiteKind = "studio" | "game" | "gallery" | "rules" | "lore" | "event";
export type CmsSiteStatus = "draft" | "published" | "archived";

export interface CmsSite {
  id: string;
  tenantId: string;
  projectId: string | null;
  kind: CmsSiteKind;
  name: string;
  slug: string;
  description: string;
  themeJson: Record<string, unknown>;
  settingsJson: Record<string, unknown>;
  status: CmsSiteStatus;
  createdAt: string;
  updatedAt: string;
}

export type CmsPageStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "scheduled"
  | "published"
  | "unpublished"
  | "archived";

export type CmsPageVisibility =
  | "private"
  | "internal_only"
  | "preview_only"
  | "public"
  | "public_after_release"
  | "hidden_but_linkable"
  | "archived_public";

export interface CmsBlock {
  id: string;
  type: string;
  props?: Record<string, unknown>;
  children?: CmsBlock[];
}

export interface CmsContent {
  blocks: CmsBlock[];
}

export interface CmsPageSummary {
  id: string;
  siteId: string;
  slug: string;
  title: string;
  seoDescription: string;
  status: CmsPageStatus;
  visibility: CmsPageVisibility;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CmsPageTranslation {
  title?: string;
  seoDescription?: string;
  publishedJson?: CmsContent;
}

export interface CmsPage extends CmsPageSummary {
  tenantId: string;
  seoJson: Record<string, unknown>;
  contentJson: CmsContent;
  publishedJson: CmsContent;
  /** Per-locale overrides keyed by IETF tag (sec 47). */
  translationsJson: Record<string, CmsPageTranslation>;
}

export interface CmsPageVersion {
  id: string;
  versionNum: number;
  title: string;
  slug: string;
  status: string;
  note: string;
  createdBy: string | null;
  createdAt: string;
}

export type CmsNavPlacement =
  | "header"
  | "footer"
  | "mobile"
  | "sidebar"
  | "rules"
  | "lore"
  | "members"
  | "custom";

export interface CmsNavItem {
  id: string;
  label: string;
  kind: "page" | "url" | "gallery" | "section";
  target?: string;
  slug?: string;
  children?: CmsNavItem[];
}

export interface CmsNavigation {
  id: string;
  tenantId: string;
  siteId: string;
  placement: CmsNavPlacement;
  name: string;
  itemsJson: { items: CmsNavItem[] };
  createdAt: string;
  updatedAt: string;
}

// ---------- sites ----------------------------------------------------------

export async function listCmsSites(params: {
  projectId?: string | null;
} = {}): Promise<CmsSite[]> {
  const r = await request<{ sites: CmsSite[] }>("/api/v1/cms/sites", {
    query: {
      projectId:
        params.projectId === null ? "null" : params.projectId ?? undefined,
    },
  });
  return r.sites;
}

export async function getCmsSite(id: string): Promise<{
  site: CmsSite & {
    pages: CmsPageSummary[];
    navigations: CmsNavigation[];
  };
}> {
  return request(`/api/v1/cms/sites/${id}`);
}

export async function createCmsSite(input: {
  kind?: CmsSiteKind;
  name: string;
  slug: string;
  description?: string;
  projectId?: string | null;
  themeJson?: Record<string, unknown>;
  settingsJson?: Record<string, unknown>;
  status?: CmsSiteStatus;
}): Promise<CmsSite> {
  const r = await request<{ site: CmsSite }>("/api/v1/cms/sites", {
    method: "POST",
    body: input,
  });
  return r.site;
}

export async function updateCmsSite(
  id: string,
  input: Partial<{
    kind: CmsSiteKind;
    name: string;
    slug: string;
    description: string;
    themeJson: Record<string, unknown>;
    settingsJson: Record<string, unknown>;
    status: CmsSiteStatus;
  }>,
): Promise<CmsSite> {
  const r = await request<{ site: CmsSite }>(`/api/v1/cms/sites/${id}`, {
    method: "PATCH",
    body: input,
  });
  return r.site;
}

export async function deleteCmsSite(id: string): Promise<void> {
  await request<void>(`/api/v1/cms/sites/${id}`, { method: "DELETE" });
}

// ---------- pages ----------------------------------------------------------

export async function listCmsPages(params: {
  siteId: string;
}): Promise<CmsPageSummary[]> {
  const r = await request<{ pages: CmsPageSummary[] }>("/api/v1/cms/pages", {
    query: { siteId: params.siteId },
  });
  return r.pages;
}

export async function getCmsPage(id: string): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>(`/api/v1/cms/pages/${id}`);
  return r.page;
}

export async function createCmsPage(input: {
  siteId: string;
  slug: string;
  title: string;
  seoDescription?: string;
  seoJson?: Record<string, unknown>;
  contentJson?: CmsContent;
  status?: CmsPageStatus;
  visibility?: CmsPageVisibility;
  scheduledAt?: string | null;
}): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>("/api/v1/cms/pages", {
    method: "POST",
    body: input,
  });
  return r.page;
}

export async function updateCmsPage(
  id: string,
  input: Partial<{
    slug: string;
    title: string;
    seoDescription: string;
    seoJson: Record<string, unknown>;
    contentJson: CmsContent;
    status: CmsPageStatus;
    visibility: CmsPageVisibility;
    scheduledAt: string | null;
    translationsJson: Record<string, CmsPageTranslation>;
  }>,
): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>(`/api/v1/cms/pages/${id}`, {
    method: "PATCH",
    body: input,
  });
  return r.page;
}

export async function deleteCmsPage(id: string): Promise<void> {
  await request<void>(`/api/v1/cms/pages/${id}`, { method: "DELETE" });
}

export async function publishCmsPage(
  id: string,
  input: { note?: string; scheduledAt?: string | null } = {},
): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>(
    `/api/v1/cms/pages/${id}/publish`,
    { method: "POST", body: input },
  );
  return r.page;
}

export async function unpublishCmsPage(id: string): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>(
    `/api/v1/cms/pages/${id}/unpublish`,
    { method: "POST", body: {} },
  );
  return r.page;
}

export async function listCmsPageVersions(id: string): Promise<CmsPageVersion[]> {
  const r = await request<{ versions: CmsPageVersion[] }>(
    `/api/v1/cms/pages/${id}/versions`,
  );
  return r.versions;
}

export async function restoreCmsPageVersion(
  pageId: string,
  versionId: string,
): Promise<CmsPage> {
  const r = await request<{ page: CmsPage }>(
    `/api/v1/cms/pages/${pageId}/versions/${versionId}/restore`,
    { method: "POST", body: {} },
  );
  return r.page;
}

// ---------- navigation -----------------------------------------------------

export async function listCmsNavigations(params: {
  siteId: string;
}): Promise<CmsNavigation[]> {
  const r = await request<{ navigations: CmsNavigation[] }>(
    "/api/v1/cms/navigations",
    { query: { siteId: params.siteId } },
  );
  return r.navigations;
}

export async function createCmsNavigation(input: {
  siteId: string;
  placement: CmsNavPlacement;
  name: string;
  itemsJson?: { items: CmsNavItem[] };
}): Promise<CmsNavigation> {
  const r = await request<{ navigation: CmsNavigation }>(
    "/api/v1/cms/navigations",
    { method: "POST", body: input },
  );
  return r.navigation;
}

export async function updateCmsNavigation(
  id: string,
  input: Partial<{
    placement: CmsNavPlacement;
    name: string;
    itemsJson: { items: CmsNavItem[] };
  }>,
): Promise<CmsNavigation> {
  const r = await request<{ navigation: CmsNavigation }>(
    `/api/v1/cms/navigations/${id}`,
    { method: "PATCH", body: input },
  );
  return r.navigation;
}

export async function deleteCmsNavigation(id: string): Promise<void> {
  await request<void>(`/api/v1/cms/navigations/${id}`, { method: "DELETE" });
}

// ---------- forms (sec 14.15) ---------------------------------------------

export type CmsFormFieldKind =
  | "text"
  | "longtext"
  | "email"
  | "number"
  | "checkbox"
  | "select"
  | "multiselect"
  | "url"
  | "phone"
  | "date";

export interface CmsFormField {
  id: string;
  name: string;
  label: string;
  kind: CmsFormFieldKind;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  options?: Array<{ value: string; label: string }>;
  pattern?: string;
  min?: number;
  max?: number;
}

export interface CmsFormSettings {
  emailRecipients?: string[];
  webhookUrl?: string;
  successMessage?: string;
  rateLimitPerHour?: number;
  requireConsent?: boolean;
  consentLabel?: string;
}

export type CmsFormStatus = "draft" | "active" | "archived";

export interface CmsForm {
  id: string;
  tenantId: string;
  siteId: string;
  slug: string;
  name: string;
  description: string;
  fieldsJson: { fields: CmsFormField[] };
  settingsJson: CmsFormSettings;
  status: CmsFormStatus;
  createdAt: string;
  updatedAt: string;
  /** Only populated by the list endpoint. */
  submissionCount?: number;
}

export interface CmsFormSubmission {
  id: string;
  tenantId: string;
  formId: string;
  payloadJson: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  createdAt: string;
}

export async function listCmsForms(params: {
  siteId: string;
}): Promise<CmsForm[]> {
  const r = await request<{ forms: CmsForm[] }>("/api/v1/cms/forms", {
    query: { siteId: params.siteId },
  });
  return r.forms;
}

export async function getCmsForm(id: string): Promise<CmsForm> {
  const r = await request<{ form: CmsForm }>(`/api/v1/cms/forms/${id}`);
  return r.form;
}

export async function createCmsForm(input: {
  siteId: string;
  slug: string;
  name: string;
  description?: string;
  fieldsJson?: { fields: CmsFormField[] };
  settingsJson?: CmsFormSettings;
  status?: CmsFormStatus;
}): Promise<CmsForm> {
  const r = await request<{ form: CmsForm }>("/api/v1/cms/forms", {
    method: "POST",
    body: input,
  });
  return r.form;
}

export async function updateCmsForm(
  id: string,
  input: Partial<{
    slug: string;
    name: string;
    description: string;
    fieldsJson: { fields: CmsFormField[] };
    settingsJson: CmsFormSettings;
    status: CmsFormStatus;
  }>,
): Promise<CmsForm> {
  const r = await request<{ form: CmsForm }>(`/api/v1/cms/forms/${id}`, {
    method: "PATCH",
    body: input,
  });
  return r.form;
}

export async function deleteCmsForm(id: string): Promise<void> {
  await request<void>(`/api/v1/cms/forms/${id}`, { method: "DELETE" });
}

export async function listCmsFormSubmissions(
  formId: string,
  params: { before?: string; limit?: number } = {},
): Promise<CmsFormSubmission[]> {
  const r = await request<{ submissions: CmsFormSubmission[] }>(
    `/api/v1/cms/forms/${formId}/submissions`,
    {
      query: {
        before: params.before,
        limit: params.limit ? String(params.limit) : undefined,
      },
    },
  );
  return r.submissions;
}

export async function deleteCmsFormSubmission(id: string): Promise<void> {
  await request<void>(`/api/v1/cms/submissions/${id}`, { method: "DELETE" });
}

/** Returns a tenant-scoped URL the user can open in a new tab to download
 * the CSV. The Authorization header rides via cookie/JWT… or, in our case,
 * via tenant header — so we hand back a URL plus the headers the caller
 * needs to apply if they're fetching server-side. For browser downloads we
 * fall back to fetching as a Blob and triggering a download client-side. */
export function cmsFormSubmissionsCsvUrl(formId: string): string {
  return new URL(
    `/api/v1/cms/forms/${encodeURIComponent(formId)}/submissions.csv`,
    API_BASE,
  ).toString();
}

export async function downloadCmsFormSubmissionsCsv(
  formId: string,
  filename: string,
): Promise<void> {
  const headers: Record<string, string> = { "X-Tenant-Slug": _tenantSlug };
  if (_authToken) headers["Authorization"] = `Bearer ${_authToken}`;
  const r = await fetch(cmsFormSubmissionsCsvUrl(formId), { headers });
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- public form helpers (no auth) ---------------------------------

export interface PublicCmsForm {
  id: string;
  slug: string;
  name: string;
  description: string;
  fieldsJson: { fields: CmsFormField[] };
  settingsJson: {
    successMessage?: string;
    requireConsent?: boolean;
    consentLabel?: string;
  };
}

export async function fetchPublicCmsForm(
  tenantSlug: string,
  formSlug: string,
): Promise<PublicCmsForm> {
  const url = new URL(
    `/api/public/${encodeURIComponent(tenantSlug)}/cms/forms/${encodeURIComponent(formSlug)}`,
    API_BASE,
  );
  const r = await fetch(url.toString());
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  const j = (await r.json()) as { form: PublicCmsForm };
  return j.form;
}

export async function submitPublicCmsForm(
  tenantSlug: string,
  formSlug: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true; submissionId: string; successMessage: string }> {
  const url = new URL(
    `/api/public/${encodeURIComponent(tenantSlug)}/cms/forms/${encodeURIComponent(formSlug)}/submit`,
    API_BASE,
  );
  const r = await fetch(url.toString(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) {
    let detail: unknown = undefined;
    try {
      detail = await r.json();
    } catch {
      /* ignore */
    }
    throw new ApiError(r.status, `${r.status} ${r.statusText}`, detail);
  }
  return (await r.json()) as {
    ok: true;
    submissionId: string;
    successMessage: string;
  };
}

// ---------- public CMS reads (no auth) -------------------------------------

export interface PublicCmsSiteResponse {
  tenant: {
    name: string;
    slug: string;
    brandingJson: Record<string, unknown>;
  };
  site: {
    id: string;
    slug: string;
    name: string;
    kind: CmsSiteKind;
    description: string;
    themeJson: Record<string, unknown>;
    settingsJson: Record<string, unknown>;
  };
  pages: Array<{
    id: string;
    slug: string;
    title: string;
    seoDescription: string;
    publishedAt: string | null;
  }>;
  navigations: CmsNavigation[];
}

export async function fetchPublicCmsSite(
  tenantSlug: string,
  siteSlug?: string,
): Promise<PublicCmsSiteResponse> {
  const url = new URL(
    `/api/public/${encodeURIComponent(tenantSlug)}/cms/site`,
    API_BASE,
  );
  if (siteSlug) url.searchParams.set("siteSlug", siteSlug);
  const r = await fetch(url.toString());
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  return (await r.json()) as PublicCmsSiteResponse;
}

export interface PublicCmsPageResponse {
  tenant: {
    slug: string;
    name: string;
    brandingJson: Record<string, unknown>;
    /** Default content locale (sec 47). Optional — older API
     *  responses may not include it. */
    defaultLocale?: string;
    /** Locales the tenant publishes in. */
    supportedLocales?: string[];
  };
  site: {
    id: string;
    slug: string;
    name: string;
    kind: CmsSiteKind;
    themeJson: Record<string, unknown>;
  };
  page: {
    id: string;
    slug: string;
    title: string;
    seoDescription: string;
    seoJson: Record<string, unknown>;
    publishedJson: CmsContent;
    publishedAt: string | null;
  };
  /** Locale the server resolved to. Echoes back so client can
   *  reflect it in the language switcher. */
  locale?: string;
}

/**
 * Platform-level landing page. Served at the root host
 * (`tcgstudio.local` or whatever ROOT_DOMAIN is configured to). This
 * is a CMS page owned by the configured platform tenant — backend
 * resolves which tenant via the `PLATFORM_TENANT_SLUG` env, frontend
 * doesn't need to know.
 *
 * Throws ApiError on 404 — caller falls back to a bundled static
 * landing page when the platform tenant hasn't published one yet.
 */
export async function fetchPlatformLanding(): Promise<PublicCmsPageResponse> {
  const url = new URL(`/api/public/platform/landing`, API_BASE);
  const r = await fetch(url.toString());
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  return (await r.json()) as PublicCmsPageResponse;
}

export async function fetchPublicCmsPage(
  tenantSlug: string,
  pageSlug: string,
  siteSlug?: string,
  /** IETF locale tag — server picks a translation override when supported. */
  lang?: string,
): Promise<PublicCmsPageResponse> {
  const safeSlug = pageSlug === "" ? "home" : pageSlug;
  const url = new URL(
    `/api/public/${encodeURIComponent(tenantSlug)}/cms/pages/${encodeURIComponent(safeSlug)}`,
    API_BASE,
  );
  if (siteSlug) url.searchParams.set("siteSlug", siteSlug);
  if (lang) url.searchParams.set("lang", lang);
  const r = await fetch(url.toString());
  if (!r.ok) throw new ApiError(r.status, `${r.status} ${r.statusText}`);
  return (await r.json()) as PublicCmsPageResponse;
}

// ---------------------------------------------------------------------------
// API keys (sec 36.7)
// ---------------------------------------------------------------------------

export interface ApiKey {
  id: string;
  name: string;
  tokenPrefix: string;
  scopesJson: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface CreatedApiKey {
  key: ApiKey;
  /** Plaintext token — shown ONCE on issuance. */
  plaintext: string;
  curlExample: string;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const r = await request<{ keys: ApiKey[] }>("/api/v1/keys");
  return r.keys;
}

export async function createApiKey(input: {
  name: string;
  scopes?: string[];
  expiresAt?: string | null;
}): Promise<CreatedApiKey> {
  return request<CreatedApiKey>("/api/v1/keys", { method: "POST", body: input });
}

export async function revokeApiKey(id: string): Promise<ApiKey> {
  const r = await request<{ key: ApiKey }>(`/api/v1/keys/${id}/revoke`, {
    method: "POST",
    body: {},
  });
  return r.key;
}

export async function deleteApiKey(id: string): Promise<void> {
  await request<void>(`/api/v1/keys/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Audit log (sec 41)
// ---------------------------------------------------------------------------

export interface AuditRow {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

export async function listAuditLog(params: {
  actionPrefix?: string;
  actorUserId?: string;
  before?: string;
  limit?: number;
} = {}): Promise<{ rows: AuditRow[]; nextBefore: string | null }> {
  return request<{ rows: AuditRow[]; nextBefore: string | null }>(
    "/api/v1/audit",
    {
      query: {
        actionPrefix: params.actionPrefix,
        actorUserId: params.actorUserId,
        before: params.before,
        limit: params.limit ? String(params.limit) : undefined,
      },
    },
  );
}

// ---------------------------------------------------------------------------
// Plugins (sec 34)
// ---------------------------------------------------------------------------

export interface Plugin {
  id: string;
  slug: string;
  name: string;
  version: string;
  author: string;
  description: string;
  manifestJson: Record<string, unknown>;
  scope: "platform" | "tenant";
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface PluginInstall {
  id: string;
  tenantId: string;
  pluginId: string;
  enabled: boolean;
  settingsJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  plugin: Plugin;
}

export async function listPlugins(): Promise<Plugin[]> {
  const r = await request<{ plugins: Plugin[] }>("/api/v1/plugins");
  return r.plugins;
}

export async function listPluginInstalls(): Promise<PluginInstall[]> {
  const r = await request<{ installs: PluginInstall[] }>(
    "/api/v1/plugins/installs",
  );
  return r.installs;
}

export async function installPlugin(id: string): Promise<PluginInstall> {
  const r = await request<{ install: PluginInstall }>(
    `/api/v1/plugins/${id}/install`,
    { method: "POST", body: {} },
  );
  return r.install;
}

export async function uninstallPlugin(id: string): Promise<void> {
  await request<void>(`/api/v1/plugins/${id}/uninstall`, {
    method: "POST",
    body: {},
  });
}

export async function updatePluginInstall(
  id: string,
  input: Partial<{ enabled: boolean; settingsJson: Record<string, unknown> }>,
): Promise<PluginInstall> {
  const r = await request<{ install: PluginInstall }>(
    `/api/v1/plugins/installs/${id}`,
    { method: "PATCH", body: input },
  );
  return r.install;
}

// ---------------------------------------------------------------------------
// Collaboration: profile, notifications, tasks, messages, milestones
// ---------------------------------------------------------------------------

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  displayName: string | null;
  bio: string;
  avatarAssetId: string | null;
  timezone: string;
  preferencesJson: Record<string, unknown>;
  createdAt: string;
}

export async function fetchMyProfile(): Promise<UserProfile> {
  const r = await request<{ profile: UserProfile }>("/api/v1/me/profile");
  return r.profile;
}

export async function updateMyProfile(
  input: Partial<{
    displayName: string | null;
    bio: string;
    avatarAssetId: string | null;
    timezone: string;
    preferencesJson: Record<string, unknown>;
  }>,
): Promise<UserProfile> {
  const r = await request<{ profile: UserProfile }>("/api/v1/me/profile", {
    method: "PATCH",
    body: input,
  });
  return r.profile;
}

export interface NotificationRow {
  id: string;
  userId: string;
  tenantId: string | null;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  metadataJson: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

export async function listNotifications(
  params: { unreadOnly?: boolean; limit?: number; before?: string } = {},
): Promise<{
  notifications: NotificationRow[];
  unreadCount: number;
  nextBefore: string | null;
}> {
  return request("/api/v1/notifications", {
    query: {
      unreadOnly: params.unreadOnly ? "true" : undefined,
      limit: params.limit ? String(params.limit) : undefined,
      before: params.before,
    },
  });
}

export async function markNotificationRead(id: string): Promise<void> {
  await request<void>(`/api/v1/notifications/${id}/read`, {
    method: "POST",
    body: {},
  });
}

export async function markAllNotificationsRead(): Promise<void> {
  await request<void>(`/api/v1/notifications/read-all`, {
    method: "POST",
    body: {},
  });
}

export async function deleteNotification(id: string): Promise<void> {
  await request<void>(`/api/v1/notifications/${id}`, { method: "DELETE" });
}

export type TaskStatus = "todo" | "in_progress" | "review" | "done" | "archived";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

export interface TenantTaskRow {
  id: string;
  tenantId: string;
  projectId: string | null;
  title: string;
  description: string;
  assigneeId: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  labels: string[];
  dueAt: string | null;
  sortOrder: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
}

export async function listTenantTasks(
  params: { projectId?: string; assigneeId?: string; status?: TaskStatus } = {},
): Promise<TenantTaskRow[]> {
  const r = await request<{ tasks: TenantTaskRow[] }>("/api/v1/tasks", {
    query: {
      projectId: params.projectId,
      assigneeId: params.assigneeId,
      status: params.status,
    },
  });
  return r.tasks;
}

export async function createTenantTask(input: {
  projectId?: string | null;
  title: string;
  description?: string;
  assigneeId?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  labels?: string[];
  dueAt?: string | null;
}): Promise<TenantTaskRow> {
  const r = await request<{ task: TenantTaskRow }>("/api/v1/tasks", {
    method: "POST",
    body: input,
  });
  return r.task;
}

export async function updateTenantTask(
  id: string,
  input: Partial<{
    title: string;
    description: string;
    assigneeId: string | null;
    status: TaskStatus;
    priority: TaskPriority;
    labels: string[];
    dueAt: string | null;
    sortOrder: number;
  }>,
): Promise<TenantTaskRow> {
  const r = await request<{ task: TenantTaskRow }>(`/api/v1/tasks/${id}`, {
    method: "PATCH",
    body: input,
  });
  return r.task;
}

export async function deleteTenantTask(id: string): Promise<void> {
  await request<void>(`/api/v1/tasks/${id}`, { method: "DELETE" });
}

export interface ChannelRow {
  id: string;
  tenantId: string;
  slug: string;
  name: string;
  description: string;
  projectId: string | null;
  visibility: "public" | "private";
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  tenantId: string;
  channelId: string;
  authorId: string;
  body: string;
  bodyHtml: string;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  author: {
    id: string;
    name: string;
    displayName: string | null;
    avatarAssetId: string | null;
  };
}

export async function listChannels(): Promise<ChannelRow[]> {
  const r = await request<{ channels: ChannelRow[] }>("/api/v1/channels");
  return r.channels;
}

export async function createChannel(input: {
  slug: string;
  name: string;
  description?: string;
  projectId?: string | null;
  visibility?: "public" | "private";
}): Promise<ChannelRow> {
  const r = await request<{ channel: ChannelRow }>("/api/v1/channels", {
    method: "POST",
    body: input,
  });
  return r.channel;
}

export async function listChannelMessages(
  channelId: string,
  params: { limit?: number; before?: string } = {},
): Promise<{ messages: MessageRow[]; nextBefore: string | null }> {
  return request(`/api/v1/channels/${channelId}/messages`, {
    query: {
      limit: params.limit ? String(params.limit) : undefined,
      before: params.before,
    },
  });
}

export async function postChannelMessage(
  channelId: string,
  body: string,
): Promise<MessageRow> {
  const r = await request<{ message: MessageRow }>(
    `/api/v1/channels/${channelId}/messages`,
    { method: "POST", body: { body } },
  );
  return r.message;
}

export async function deleteMessage(id: string): Promise<void> {
  await request<void>(`/api/v1/messages/${id}`, { method: "DELETE" });
}

export interface MilestoneRow {
  id: string;
  tenantId: string;
  projectId: string;
  name: string;
  description: string;
  status: "upcoming" | "active" | "done" | "cancelled";
  startAt: string | null;
  dueAt: string | null;
  closedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export async function listMilestones(
  params: { projectId?: string; status?: string } = {},
): Promise<MilestoneRow[]> {
  const r = await request<{ milestones: MilestoneRow[] }>(
    "/api/v1/milestones",
    {
      query: {
        projectId: params.projectId,
        status: params.status,
      },
    },
  );
  return r.milestones;
}

export async function createMilestone(input: {
  projectId: string;
  name: string;
  description?: string;
  status?: "upcoming" | "active" | "done" | "cancelled";
  startAt?: string | null;
  dueAt?: string | null;
  sortOrder?: number;
}): Promise<MilestoneRow> {
  const r = await request<{ milestone: MilestoneRow }>("/api/v1/milestones", {
    method: "POST",
    body: input,
  });
  return r.milestone;
}

export async function updateMilestone(
  id: string,
  input: Partial<{
    name: string;
    description: string;
    status: "upcoming" | "active" | "done" | "cancelled";
    startAt: string | null;
    dueAt: string | null;
    sortOrder: number;
  }>,
): Promise<MilestoneRow> {
  const r = await request<{ milestone: MilestoneRow }>(
    `/api/v1/milestones/${id}`,
    { method: "PATCH", body: input },
  );
  return r.milestone;
}

export async function deleteMilestone(id: string): Promise<void> {
  await request<void>(`/api/v1/milestones/${id}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Webhooks (sec 36)
// ---------------------------------------------------------------------------

export interface WebhookRow {
  id: string;
  name: string;
  targetUrl: string;
  events: string[];
  enabled: boolean;
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  failureBackoff: number;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreatedWebhook {
  webhook: WebhookRow;
  /** Plaintext signing secret — shown ONCE. */
  secret: string;
}

export interface WebhookDelivery {
  id: string;
  webhookId: string;
  event: string;
  payloadJson: Record<string, unknown>;
  responseStatus: number | null;
  responseBody: string | null;
  ok: boolean;
  errorCode: string | null;
  durationMs: number | null;
  createdAt: string;
}

export async function listWebhooks(): Promise<WebhookRow[]> {
  const r = await request<{ webhooks: WebhookRow[] }>("/api/v1/webhooks");
  return r.webhooks;
}

export async function createWebhook(input: {
  name: string;
  targetUrl: string;
  events: string[];
}): Promise<CreatedWebhook> {
  return request<CreatedWebhook>("/api/v1/webhooks", {
    method: "POST",
    body: input,
  });
}

export async function updateWebhook(
  id: string,
  input: Partial<{
    name: string;
    targetUrl: string;
    events: string[];
    enabled: boolean;
    failureBackoff: number;
  }>,
): Promise<WebhookRow> {
  const r = await request<{ webhook: WebhookRow }>(`/api/v1/webhooks/${id}`, {
    method: "PATCH",
    body: input,
  });
  return r.webhook;
}

export async function deleteWebhook(id: string): Promise<void> {
  await request<void>(`/api/v1/webhooks/${id}`, { method: "DELETE" });
}

export async function listWebhookDeliveries(
  id: string,
): Promise<WebhookDelivery[]> {
  const r = await request<{ deliveries: WebhookDelivery[] }>(
    `/api/v1/webhooks/${id}/deliveries`,
  );
  return r.deliveries;
}

export async function pingWebhook(id: string): Promise<void> {
  await request<{ ok: true }>(`/api/v1/webhooks/${id}/test`, {
    method: "POST",
    body: {},
  });
}

// ---------------------------------------------------------------------------
// Background jobs (sec 38)
// ---------------------------------------------------------------------------

export type JobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface JobRow {
  id: string;
  tenantId: string;
  type: string;
  status: JobStatus;
  payloadJson: Record<string, unknown>;
  resultJson: Record<string, unknown> | null;
  lastError: string | null;
  attempts: number;
  maxAttempts: number;
  nextRunAt: string;
  startedAt: string | null;
  completedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function listJobs(
  params: {
    status?: JobStatus;
    type?: string;
    before?: string;
    limit?: number;
  } = {},
): Promise<{ jobs: JobRow[]; nextBefore: string | null }> {
  return request<{ jobs: JobRow[]; nextBefore: string | null }>(
    "/api/v1/jobs",
    {
      query: {
        status: params.status,
        type: params.type,
        before: params.before,
        limit: params.limit ? String(params.limit) : undefined,
      },
    },
  );
}

export async function getJob(id: string): Promise<JobRow> {
  const r = await request<{ job: JobRow }>(`/api/v1/jobs/${id}`);
  return r.job;
}

export async function cancelJob(id: string): Promise<JobRow> {
  const r = await request<{ job: JobRow }>(`/api/v1/jobs/${id}/cancel`, {
    method: "POST",
    body: {},
  });
  return r.job;
}

export async function retryJob(id: string): Promise<JobRow> {
  const r = await request<{ job: JobRow }>(`/api/v1/jobs/${id}/retry`, {
    method: "POST",
    body: {},
  });
  return r.job;
}

export async function enqueueJob(input: {
  type: string;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  runAt?: string;
}): Promise<JobRow> {
  const r = await request<{ job: JobRow }>("/api/v1/jobs", {
    method: "POST",
    body: input,
  });
  return r.job;
}

// ---------------------------------------------------------------------------
// Plans / billing (sec 42)
// ---------------------------------------------------------------------------

export interface PlanRow {
  id: string;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  billingPeriod: "free" | "monthly" | "yearly";
  sortOrder: number;
  status: string;
  limitsJson: {
    limits?: Record<string, number | null>;
    features?: Record<string, boolean>;
  };
}

export interface BillingSnapshot {
  plan: PlanRow | null;
  planSince: string;
  usage: {
    projects: number;
    members: number;
    apiKeys: number;
    webhooks: number;
    plugins: number;
    customDomains: number;
    storageMiB: number;
  };
}

export async function listPlanCatalog(): Promise<PlanRow[]> {
  const r = await request<{ plans: PlanRow[] }>("/api/v1/plans");
  return r.plans;
}

export async function fetchBilling(): Promise<BillingSnapshot> {
  return request<BillingSnapshot>("/api/v1/billing");
}

export async function subscribeToPlan(planSlug: string): Promise<void> {
  await request("/api/v1/billing/subscribe", {
    method: "POST",
    body: { planSlug },
  });
}

// ---------------------------------------------------------------------------
// Marketplace (sec 35)
// ---------------------------------------------------------------------------

export type MarketplaceKind =
  | "plugin"
  | "frame_pack"
  | "icon_pack"
  | "font_pack"
  | "rules_pack"
  | "ability_pack"
  | "exporter"
  | "starter_kit"
  | "cms_theme"
  | "cms_block_pack"
  | "board_layout"
  | "print_profile"
  | "pack_generator"
  | "keyword_pack";

export interface MarketplacePublisher {
  id: string;
  tenantId: string;
  displayName: string;
  verified: boolean;
  bio: string;
  websiteUrl: string;
  iconAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MarketplacePackageVersion {
  id: string;
  packageId: string;
  version: string;
  changelog: string;
  contentJson: Record<string, unknown>;
  status: "draft" | "review" | "approved";
  publishedAt: string | null;
  createdAt: string;
}

export interface MarketplaceReview {
  id: string;
  tenantId: string;
  userId: string;
  packageId: string;
  rating: number;
  body: string;
  createdAt: string;
}

export interface MarketplacePackage {
  id: string;
  slug: string;
  name: string;
  kind: MarketplaceKind | string;
  category: string | null;
  summary: string;
  description: string;
  authorName: string;
  publisherId: string | null;
  priceCents: number;
  scope: "platform" | "tenant";
  tenantId: string | null;
  status: "draft" | "review" | "approved" | "deprecated";
  installCount: number;
  ratingAvg10: number;
  ratingCount: number;
  iconAssetId: string | null;
  galleryJson: string[];
  tagsJson: string[];
  createdAt: string;
  updatedAt: string;
  publisher?: {
    displayName: string;
    verified: boolean;
    iconAssetId?: string | null;
  } | null;
  versions?: MarketplacePackageVersion[];
  reviews?: MarketplaceReview[];
  _count?: { installs: number; reviews: number; versions: number };
}

export interface MarketplaceInstall {
  id: string;
  tenantId: string;
  packageId: string;
  versionId: string | null;
  enabled: boolean;
  settingsJson: Record<string, unknown>;
  installedAt: string;
  updatedAt: string;
  package?: MarketplacePackage;
}

export interface MarketplaceListQuery {
  q?: string;
  kind?: string;
  category?: string;
  scope?: "platform" | "tenant";
  installed?: "true" | "false";
  cursor?: string;
  limit?: number;
}

function qs(input: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined || v === null || v === "") continue;
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export async function listMarketplacePackages(
  query: MarketplaceListQuery = {},
): Promise<{ packages: MarketplacePackage[]; nextCursor: string | null }> {
  return request(`/api/v1/marketplace/packages${qs(query as Record<string, string | number | undefined>)}`);
}

/* ----------------------------------------------------------------------- */
/* Marketplace authoring templates (#182)                                    */
/* ----------------------------------------------------------------------- */

export interface MarketplaceTemplateKind {
  kind: string;
  label: string;
  summary: string;
}

export async function listMarketplaceTemplateKinds(): Promise<
  MarketplaceTemplateKind[]
> {
  const r = await request<{ kinds: MarketplaceTemplateKind[] }>(
    "/api/v1/marketplace/templates",
  );
  return r.kinds;
}

export async function getMarketplaceTemplate(kind: string): Promise<unknown> {
  const r = await request<{ kind: string; template: unknown }>(
    `/api/v1/marketplace/templates/${encodeURIComponent(kind)}`,
  );
  return r.template;
}

/**
 * Fetch a template and trigger a download as a JSON file. Browser-only —
 * runs the standard "create an anchor, set href, click, revoke" dance.
 * The author edits the downloaded file then submits via the existing
 * marketplace.packages create endpoint (or the platform direct-upload).
 */
export async function downloadMarketplaceTemplate(kind: string): Promise<void> {
  const template = await getMarketplaceTemplate(kind);
  const blob = new Blob([JSON.stringify(template, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${kind}-template.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function getMarketplacePackage(
  idOrSlug: string,
): Promise<{ package: MarketplacePackage; install: MarketplaceInstall | null }> {
  return request(`/api/v1/marketplace/packages/${encodeURIComponent(idOrSlug)}`);
}

export async function listMarketplaceInstalls(): Promise<MarketplaceInstall[]> {
  const r = await request<{ installs: MarketplaceInstall[] }>(
    "/api/v1/marketplace/installs",
  );
  return r.installs;
}

export async function installMarketplacePackage(
  idOrSlug: string,
): Promise<MarketplaceInstall> {
  const r = await request<{ install: MarketplaceInstall }>(
    `/api/v1/marketplace/packages/${encodeURIComponent(idOrSlug)}/install`,
    { method: "POST" },
  );
  return r.install;
}

export async function uninstallMarketplacePackage(
  idOrSlug: string,
): Promise<void> {
  await request<void>(
    `/api/v1/marketplace/packages/${encodeURIComponent(idOrSlug)}/uninstall`,
    { method: "POST" },
  );
}

export async function reviewMarketplacePackage(
  idOrSlug: string,
  input: { rating: number; body?: string },
): Promise<MarketplaceReview> {
  const r = await request<{ review: MarketplaceReview }>(
    `/api/v1/marketplace/packages/${encodeURIComponent(idOrSlug)}/reviews`,
    { method: "POST", body: input },
  );
  return r.review;
}

export async function getMarketplacePublisher(): Promise<MarketplacePublisher | null> {
  const r = await request<{ publisher: MarketplacePublisher | null }>(
    "/api/v1/marketplace/publisher",
  );
  return r.publisher;
}

export async function upsertMarketplacePublisher(input: {
  displayName: string;
  bio?: string;
  websiteUrl?: string;
  iconAssetId?: string | null;
}): Promise<MarketplacePublisher> {
  const r = await request<{ publisher: MarketplacePublisher }>(
    "/api/v1/marketplace/publisher",
    { method: "PUT", body: input },
  );
  return r.publisher;
}

export async function listMyMarketplacePackages(): Promise<MarketplacePackage[]> {
  const r = await request<{ packages: MarketplacePackage[] }>(
    "/api/v1/marketplace/my/packages",
  );
  return r.packages;
}

export async function createMarketplacePackage(input: {
  slug: string;
  name: string;
  kind: MarketplaceKind | string;
  category?: string;
  summary?: string;
  description?: string;
  iconAssetId?: string | null;
  galleryJson?: string[];
  tagsJson?: string[];
  scope?: "platform" | "tenant";
}): Promise<MarketplacePackage> {
  const r = await request<{ package: MarketplacePackage }>(
    "/api/v1/marketplace/packages",
    { method: "POST", body: input },
  );
  return r.package;
}

export async function updateMarketplacePackage(
  id: string,
  input: Partial<{
    name: string;
    category: string | null;
    summary: string;
    description: string;
    iconAssetId: string | null;
    galleryJson: string[];
    tagsJson: string[];
    status: "draft" | "review" | "approved" | "deprecated";
  }>,
): Promise<MarketplacePackage> {
  const r = await request<{ package: MarketplacePackage }>(
    `/api/v1/marketplace/packages/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return r.package;
}

export async function deleteMarketplacePackage(id: string): Promise<void> {
  await request<void>(`/api/v1/marketplace/packages/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Search (sec 39)
// ---------------------------------------------------------------------------

export type SearchKind =
  | "project"
  | "card"
  | "card_type"
  | "asset"
  | "set"
  | "deck"
  | "keyword"
  | "faction"
  | "lore"
  | "ability"
  | "cms_page"
  | "marketplace";

export interface SearchHit {
  id: string;
  kind: SearchKind;
  title: string;
  subtitle?: string;
  match?: string;
  projectId?: string;
  projectSlug?: string;
  score?: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  hits: SearchHit[];
  grouped: Record<SearchKind, SearchHit[]>;
}

export async function search(input: {
  q: string;
  projectId?: string;
  kinds?: SearchKind[];
  limit?: number;
}): Promise<SearchResponse> {
  const params: Record<string, string | number | undefined> = {
    q: input.q,
    projectId: input.projectId,
    kinds: input.kinds?.join(","),
    limit: input.limit,
  };
  return request(`/api/v1/search${qs(params)}`);
}

export async function publishMarketplaceVersion(
  packageId: string,
  input: { version: string; changelog?: string; contentJson?: Record<string, unknown> },
): Promise<MarketplacePackageVersion> {
  const r = await request<{ version: MarketplacePackageVersion }>(
    `/api/v1/marketplace/packages/${encodeURIComponent(packageId)}/versions`,
    { method: "POST", body: input },
  );
  return r.version;
}

// ---------------------------------------------------------------------------
// Playtest session relay (sec 30 + 37.2)
// ---------------------------------------------------------------------------

export interface PlaytestSessionRow {
  id: string;
  code: string;
  tenantId: string;
  ownerId: string;
  boardId: string | null;
  rulesetId: string | null;
  createdAt: number;
  touchedAt: number;
}

export interface PlaytestSessionEnvelope {
  session: PlaytestSessionRow;
  channel: string;
}

export async function createPlaytestSession(input: {
  boardId?: string | null;
  rulesetId?: string | null;
  code?: string;
}): Promise<PlaytestSessionEnvelope> {
  return request("/api/v1/playtest/sessions", {
    method: "POST",
    body: input,
  });
}

export async function findPlaytestSessionByCode(
  code: string,
): Promise<PlaytestSessionEnvelope> {
  return request(
    `/api/v1/playtest/sessions/by-code/${encodeURIComponent(code.toUpperCase())}`,
  );
}

export async function relayPlaytestAction(
  sessionId: string,
  input: { action: Record<string, unknown>; seq?: number },
): Promise<void> {
  await request<void>(
    `/api/v1/playtest/sessions/${encodeURIComponent(sessionId)}/relay`,
    { method: "POST", body: input },
  );
}

export async function announcePlaytestPresence(
  sessionId: string,
  input: { displayName: string; seat?: number },
): Promise<void> {
  await request<void>(
    `/api/v1/playtest/sessions/${encodeURIComponent(sessionId)}/presence`,
    { method: "POST", body: input },
  );
}

export async function closePlaytestSession(sessionId: string): Promise<void> {
  await request<void>(
    `/api/v1/playtest/sessions/${encodeURIComponent(sessionId)}/close`,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Platform admin (sec 9.2)
// ---------------------------------------------------------------------------

export type PlatformRole = "owner" | "admin" | "support" | null;

export interface PlatformTenantRow {
  id: string;
  slug: string;
  name: string;
  status: string;
  createdAt: string;
  plan: { slug: string; name: string; priceCents: number } | null;
  /** Platform admin only sees membership counts — projects are
   *  internal to each tenant and never exposed at the platform layer. */
  _count: { memberships: number };
}

export interface PlatformBillingSummary {
  totalTenants: number;
  activeTenants: number;
  planDistribution: Array<{ slug: string; count: number }>;
  monthlyRecurringCents: number;
}

export interface PlatformAnnouncement {
  id: string;
  kind: "info" | "warning" | "maintenance" | "marketing";
  headline: string;
  body: string;
  ctaLabel: string | null;
  ctaUrl: string | null;
  startsAt: string | null;
  endsAt: string | null;
  status: "draft" | "active" | "archived";
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchPlatformRole(): Promise<PlatformRole> {
  try {
    const r = await request<{ role: PlatformRole }>("/api/v1/platform/me");
    return r.role;
  } catch {
    return null;
  }
}

export async function listPlatformTenants(): Promise<PlatformTenantRow[]> {
  const r = await request<{ tenants: PlatformTenantRow[] }>(
    "/api/v1/platform/tenants",
  );
  return r.tenants;
}

export async function updatePlatformTenant(
  id: string,
  patch: { status?: string },
): Promise<PlatformTenantRow> {
  const r = await request<{ tenant: PlatformTenantRow }>(
    `/api/v1/platform/tenants/${encodeURIComponent(id)}`,
    { method: "PATCH", body: patch },
  );
  return r.tenant;
}

export async function fetchPlatformBillingSummary(): Promise<PlatformBillingSummary> {
  return request("/api/v1/platform/billing/summary");
}

export async function listPlatformAnnouncements(): Promise<PlatformAnnouncement[]> {
  const r = await request<{ announcements: PlatformAnnouncement[] }>(
    "/api/v1/platform/announcements",
  );
  return r.announcements;
}

export async function listActivePlatformAnnouncements(): Promise<
  PlatformAnnouncement[]
> {
  const r = await request<{ announcements: PlatformAnnouncement[] }>(
    "/api/v1/platform/announcements/active",
  );
  return r.announcements;
}

export async function createPlatformAnnouncement(input: {
  kind?: "info" | "warning" | "maintenance" | "marketing";
  headline: string;
  body?: string;
  ctaLabel?: string | null;
  ctaUrl?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  status?: "draft" | "active" | "archived";
}): Promise<PlatformAnnouncement> {
  const r = await request<{ announcement: PlatformAnnouncement }>(
    "/api/v1/platform/announcements",
    { method: "POST", body: input },
  );
  return r.announcement;
}

// ---------------------------------------------------------------------------
// Platform marketplace — submissions queue + direct upload (#180)
// ---------------------------------------------------------------------------

export interface PlatformMarketplaceSubmission {
  id: string;
  slug: string;
  name: string;
  kind: string;
  category: string | null;
  summary: string;
  status: string;
  priceCents: number;
  authorName: string;
  tenantId: string | null;
  publisherId: string | null;
  createdAt: string;
  updatedAt: string;
  installCount: number;
  ratingAvg10: number;
  ratingCount: number;
  iconAssetId: string | null;
  submittingTenant: { id: string; slug: string; name: string } | null;
}

export async function listPlatformMarketplaceSubmissions(
  status: "review" | "approved" | "draft" | "deprecated" | "all" = "review",
): Promise<PlatformMarketplaceSubmission[]> {
  const r = await request<{ submissions: PlatformMarketplaceSubmission[] }>(
    "/api/v1/platform/marketplace/submissions",
    { query: { status } },
  );
  return r.submissions;
}

export async function approvePlatformSubmission(id: string): Promise<void> {
  await request(
    `/api/v1/platform/marketplace/submissions/${encodeURIComponent(id)}/approve`,
    { method: "POST" },
  );
}

export async function rejectPlatformSubmission(
  id: string,
  reason?: string,
): Promise<void> {
  await request(
    `/api/v1/platform/marketplace/submissions/${encodeURIComponent(id)}/reject`,
    { method: "POST", body: { reason } },
  );
}

export async function createPlatformPackage(input: {
  slug: string;
  name: string;
  kind: string;
  category?: string;
  summary?: string;
  description?: string;
  priceCents?: number;
  authorName?: string;
  iconAssetId?: string | null;
  galleryJson?: string[];
  tagsJson?: string[];
  version?: {
    version: string;
    changelog?: string;
    contentJson?: unknown;
  };
}): Promise<{ id: string; slug: string; name: string }> {
  const r = await request<{ package: { id: string; slug: string; name: string } }>(
    "/api/v1/platform/marketplace/packages",
    { method: "POST", body: input },
  );
  return r.package;
}

export async function updatePlatformAnnouncement(
  id: string,
  input: Partial<Parameters<typeof createPlatformAnnouncement>[0]>,
): Promise<PlatformAnnouncement> {
  const r = await request<{ announcement: PlatformAnnouncement }>(
    `/api/v1/platform/announcements/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return r.announcement;
}

export async function deletePlatformAnnouncement(id: string): Promise<void> {
  await request<void>(
    `/api/v1/platform/announcements/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
}

// ---------------------------------------------------------------------------
// Platform admins (RBAC for the super-admin level). Same shape pattern
// as tenant memberships, but the role lives on `User.platformRole`
// instead of a join table — there's only ever one platform.
// ---------------------------------------------------------------------------

export interface PlatformAdminRow {
  id: string;
  email: string;
  name: string;
  platformRole: "owner" | "admin" | "support";
  createdAt: string;
}

export async function listPlatformAdmins(): Promise<PlatformAdminRow[]> {
  const r = await request<{ admins: PlatformAdminRow[] }>(
    "/api/v1/platform/admins",
  );
  return r.admins;
}

export async function grantPlatformAdmin(input: {
  email: string;
  role: "owner" | "admin" | "support";
}): Promise<PlatformAdminRow> {
  const r = await request<{ admin: PlatformAdminRow }>("/api/v1/platform/admins", {
    method: "PUT",
    body: input,
  });
  return r.admin;
}

export async function revokePlatformAdmin(userId: string): Promise<void> {
  await request<void>(`/api/v1/platform/admins/${encodeURIComponent(userId)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// RBAC — Roles + permissions catalog (sec 13). The Role table holds
// the canonical permission list per role slug. The catalog endpoint
// returns the permission registry the picker UI uses.
// ---------------------------------------------------------------------------

export interface PermissionDef {
  key: string;
  label: string;
  description: string;
  scope: "platform" | "tenant" | "project";
  group: string;
}

export interface RoleRow {
  id: string;
  scope: "platform" | "tenant" | "project";
  tenantId: string | null;
  name: string;
  slug: string;
  description: string;
  permissionsJson: string[];
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export async function listPlatformPermissions(): Promise<PermissionDef[]> {
  const r = await request<{ permissions: PermissionDef[] }>(
    "/api/v1/platform/permissions",
  );
  return r.permissions;
}

export async function listPlatformRoles(): Promise<RoleRow[]> {
  const r = await request<{ roles: RoleRow[] }>("/api/v1/platform/roles");
  return r.roles;
}

export async function createPlatformRole(input: {
  name: string;
  slug: string;
  description?: string;
  permissions: string[];
}): Promise<RoleRow> {
  const r = await request<{ role: RoleRow }>("/api/v1/platform/roles", {
    method: "POST",
    body: input,
  });
  return r.role;
}

export async function updatePlatformRole(
  id: string,
  input: { name?: string; description?: string; permissions?: string[] },
): Promise<RoleRow> {
  const r = await request<{ role: RoleRow }>(
    `/api/v1/platform/roles/${encodeURIComponent(id)}`,
    { method: "PATCH", body: input },
  );
  return r.role;
}

export async function deletePlatformRole(id: string): Promise<void> {
  await request<void>(`/api/v1/platform/roles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Per-level theme/branding (sec 11.4) — platform / tenant / project
// each carry their own brandingJson blob. The frontend reads these to
// build the rendered theme; the renderer falls through the inheritance
// chain in `tenant_panel → project_override` order.
// ---------------------------------------------------------------------------

export type BrandingTokens = Record<string, unknown>;

export async function fetchPlatformBranding(): Promise<BrandingTokens> {
  const r = await request<{ branding: BrandingTokens }>(
    "/api/v1/platform/branding",
  );
  return r.branding ?? {};
}

export async function savePlatformBranding(
  branding: BrandingTokens,
): Promise<BrandingTokens> {
  const r = await request<{ branding: BrandingTokens }>(
    "/api/v1/platform/branding",
    { method: "PUT", body: { branding } },
  );
  return r.branding ?? {};
}

export async function fetchProjectBranding(
  projectId: string,
): Promise<BrandingTokens> {
  const r = await request<{ branding: BrandingTokens }>(
    `/api/v1/projects/${projectId}/branding`,
  );
  return r.branding ?? {};
}

export async function saveProjectBranding(
  projectId: string,
  branding: BrandingTokens,
): Promise<BrandingTokens> {
  const r = await request<{ branding: BrandingTokens }>(
    `/api/v1/projects/${projectId}/branding`,
    { method: "PUT", body: { branding } },
  );
  return r.branding ?? {};
}

export const apiHealth = {
  base: API_BASE,
  /** Reads through to the live mutable so callers always see the current tenant. */
  get tenantSlug() {
    return _tenantSlug;
  },
};
