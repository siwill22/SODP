import { defineConfig } from 'vite';

// public/archive is a symlink to ../archive at the repo root (same
// convention as Geode's own viewer/vite.config.ts) -- SODP's own prepped
// data (basement age, CCD curves, Scotese static polygons) is served from
// there under BASE_URL. Geode's own live archive (BRIDGE-Valdes climate
// data) is a SEPARATE fetch base, VITE_ARCHIVE_BASE, defaulting to Geode's
// deployed GitHub Pages archive (confirmed live and CORS-open, 2026-09-08)
// -- see ADR-0001/0003. The two are never the same base: one is bundled
// with this site, the other is fetched cross-origin at runtime.
//
// GitHub Pages serves a project site under /<repo>/, not the domain root --
// VITE_BASE follows Geode's own generated-viewer convention (set by a
// deploy workflow; dev and `vite preview` leave it at '/').
const GEODE_ARCHIVE_BASE = 'https://siwill22.github.io/Geode/archive';

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  server: { port: 5174 },
  define: {
    'import.meta.env.VITE_ARCHIVE_BASE': JSON.stringify(
      process.env.VITE_ARCHIVE_BASE ?? GEODE_ARCHIVE_BASE,
    ),
  },
  build: {
    target: 'es2022',
  },
});
