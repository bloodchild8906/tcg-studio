-- Project commerce settings (sec 8 — projects can sell creations).
-- Three free-form JSON blobs keep the schema flexible while we
-- iterate on what fields each section actually needs:
--
--   * economyJson   — pricing, currency, royalty splits, payout.
--   * marketingJson — SEO defaults, social handles, newsletter.
--   * storefrontJson — public store toggles + commerce policies.
--
-- All three default to '{}' meaning "the project hasn't configured
-- this yet". The renderers gate UI on emptiness rather than hiding
-- the columns from the model.
ALTER TABLE "Project"
    ADD COLUMN "economyJson"    JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "marketingJson"  JSONB NOT NULL DEFAULT '{}',
    ADD COLUMN "storefrontJson" JSONB NOT NULL DEFAULT '{}';
