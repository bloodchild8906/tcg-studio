-- Example plugin row (sec 34).
-- Seeds a single platform-curated plugin so a fresh tenant can install
-- it from the Plugins panel and immediately see the runtime work end
-- to end. The manifest declares a panel UI contribution that loads the
-- static page shipped under /plugins/example/index.html (served by the
-- designer's public/ directory).
--
-- Permissions are intentionally tiny so the tenant can audit what the
-- example can see: read-only on cards + assets, plus the always-allowed
-- ui.toast.

INSERT INTO "Plugin"
  ("id", "slug", "name", "version", "author", "description", "manifestJson", "scope", "status", "updatedAt")
VALUES
  ('plugin_example_panel', 'example-panel', 'Example Panel', '0.1.0',
   'TCGStudio',
   'Demonstrates the plugin runtime — sandboxed iframe with read-only RPC access to cards and assets.',
   '{
      "id": "example-panel",
      "name": "Example Panel",
      "version": "0.1.0",
      "permissions": ["read:cards", "read:assets"],
      "uiContributions": [
        {
          "kind": "panel",
          "id": "main",
          "label": "Demo panel",
          "entry": "/plugins/example/index.html"
        }
      ]
   }',
   'platform',
   'approved',
   CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO UPDATE SET
  "name" = EXCLUDED."name",
  "version" = EXCLUDED."version",
  "manifestJson" = EXCLUDED."manifestJson",
  "updatedAt" = CURRENT_TIMESTAMP;
