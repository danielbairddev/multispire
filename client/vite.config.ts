import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Proxy the WebSocket to the game server during dev so the client can
      // always connect to same-origin `/ws`.
      "/ws": { target: "ws://localhost:8080", ws: true },
      // The card catalog for the deckbuilder is served by the game server.
      "/api": { target: "http://localhost:8080" },
    },
  },
  build: { outDir: "dist" },
});
