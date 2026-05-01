import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: [
        "favicon.ico",
        "apple-touch-icon-180x180.png",
        "pwa-maskable-512x512.png",
      ],
      manifest: {
        name: "Budget App",
        short_name: "Budget",
        description: "Personal budget tracker with offline support",
        theme_color: "#1c1917",
        background_color: "#1c1917",
        display: "standalone",
        orientation: "portrait",
        scope: "/",
        start_url: "/",
        icons: [
          {
            src: "pwa-192x192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "pwa-512x512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "pwa-maskable-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,ico,woff,woff2}"],
        // env-config.js holds runtime credentials (Supabase URL + anon key) and
        // is templated by docker-entrypoint.sh on container start. It must
        // never be precached or runtime-cached, otherwise an anon-key rotation
        // would not propagate to clients with an active service worker.
        globIgnores: ["**/env-config.js"],
        navigateFallback: "index.html",
        navigateFallbackDenylist: [/^\/api/, /^\/env-config\.js$/],
        runtimeCaching: [
          {
            // Always go to network for env-config.js; never cache it.
            urlPattern: /\/env-config\.js$/i,
            handler: "NetworkOnly",
          },
          {
            // Phase 5: rarely-mutated reference tables (accounts, categories,
            // user_preferences) are served stale-while-revalidate so the UI
            // gets an instant response and the cache is refreshed in the
            // background. Listed BEFORE the catch-all so it wins.
            urlPattern:
              /^https:\/\/.*\.supabase\.co\/rest\/v1\/(accounts|categories|user_preferences)\b/i,
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "supabase-reference-tables",
              expiration: {
                maxEntries: 30,
                maxAgeSeconds: 60 * 60 * 24, // 1 day
              },
            },
          },
          {
            // Cache Supabase REST API calls (network-first so offline
            // falls through to our Dexie layer naturally)
            urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/.*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "supabase-api",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60, // 1 hour
              },
              // Phase 5: dropped from 3s -> 1s so flaky networks fall back to
              // the cache (and our Dexie layer) without a long perceived
              // hang on mobile.
              networkTimeoutSeconds: 1,
            },
          },
          {
            // Never cache Supabase auth endpoints — tokens must always come
            // from the live server to avoid stale-session foot-guns.
            urlPattern: /^https:\/\/.*\.supabase\.co\/auth\/v1\/.*/i,
            handler: "NetworkOnly",
          },
          {
            // Cache Google Fonts (if ever used)
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "google-fonts" },
          },
        ],
      },
    }),
  ],
  build: {
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor libraries
          vendor: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
          excel: ["exceljs"],
          supabase: ["@supabase/supabase-js"],
          dnd: [
            "@dnd-kit/core",
            "@dnd-kit/sortable",
            "@dnd-kit/utilities",
            "@dnd-kit/modifiers",
          ],
          utils: ["date-fns", "dexie"],
        },
      },
    },
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 1000,
    // Disable source maps in production for speed
    sourcemap: false,
    // Optimize build target
    target: "es2018",
    // Use faster minifier
    minify: "esbuild",
  },
  // Optimize dependency resolution
  resolve: {
    // Cache node_modules resolution
    preserveSymlinks: false,
  },
  // Optimize dev server
  server: {
    host: true, // bind to 0.0.0.0 so the dev container can forward the port
    hmr: {
      clientPort: 5173, // ensure HMR WebSocket uses the forwarded port
    },
    watch: {
      usePolling: true, // required for bind-mounted dev containers to detect file changes
      interval: 300, // poll every 300ms
    },
    fs: {
      // Allow serving files from the project root
      cachedChecks: false,
    },
  },
  // Build performance optimizations
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router-dom",
      "recharts",
      "@supabase/supabase-js",
    ],
    esbuildOptions: {
      // Use faster target
      target: "es2018",
    },
  },
});
