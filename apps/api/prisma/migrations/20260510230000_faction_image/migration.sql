-- Faction.imageAssetId — large banner/portrait asset for lore pages,
-- public faction profile, faction-pick header, decklist hero strips.
-- Distinct from iconAssetId (small badge/cost-slot icon) so each can
-- be sized for its surface.

ALTER TABLE "Faction"
  ADD COLUMN "imageAssetId" TEXT;
