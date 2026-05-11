import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["jspdf"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "jspdf": path.resolve(__dirname, "../../node_modules/jspdf/dist/jspdf.es.min.js"),
    },
    // Prefer TypeScript sources over any sibling `.js` file with the
    // same basename. The repo has stale compiled `.js` outputs (and
    // `.js.bak` backups) sitting next to every `.ts`/`.tsx` source —
    // residue from an older build setup. Without this override Vite's
    // default order is `[".mjs", ".js", ".mts", ".ts", ".jsx", ".tsx",
    // ".json"]`, which means an import like `@/lib/api` resolves to
    // the months-old `api.js` shadow instead of the live `api.ts`.
    // Putting TS first makes the .js shadows harmless until they can
    // be deleted from the working tree.
    extensions: [".tsx", ".ts", ".mts", ".jsx", ".mjs", ".js", ".json"],
  },
  server: {
    // Force Vite restart
    host: true,
    port: 5173,
    strictPort: true,
    // Vite 5+ rejects requests whose Host header isn't explicitly
    // allowlisted (DNS-rebinding protection). Custom dev domains
    // (`acme.tcgstudio.local`, `saga-acme.tcgstudio.local`, custom
    // tenant domains pointed at 127.0.0.1, etc.) all need to pass —
    // the platform is host-routed by design. The leading dot makes
    // this a suffix match: anything ending in `.tcgstudio.local` is
    // accepted at any subdomain depth. Add additional dev hostnames
    // here when testing custom-domain flows locally.
    allowedHosts: [".tcgstudio.local", "localhost", "127.0.0.1"],
    fs: {
      allow: ["..", "../../node_modules"],
    },
    watch: {
      // Polling is needed when running inside Docker on Windows hosts
      // because inotify events don't propagate across the bind mount.
      usePolling: true,
      interval: 200,
    },
  },
});
