import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, extname, join, normalize } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { ClientMessage, ServerMessage, MatchMode } from "@multispire/shared";
import { MatchManager, type MemberSeed } from "./match.js";
import { importLoadout } from "./game/import.js";
import { buildCatalog, buildRelicCatalog } from "./game/catalog.js";

const CARD_CATALOG = JSON.stringify(buildCatalog());
const RELIC_CATALOG = JSON.stringify(buildRelicCatalog());

const PORT = Number(process.env.PORT ?? 8080);
const __dirname = dirname(fileURLToPath(import.meta.url));
// In production we serve the built client. In dev, Vite serves it on :5173.
const CLIENT_DIR = join(__dirname, "../../client/dist");

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const manager = new MatchManager();

// Map each socket to its identity.
interface Conn {
  ws: WebSocket;
  playerId: string;
  matchId: string | null;
}

const conns = new WeakMap<WebSocket, Conn>();

const http = createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }
  if (req.url === "/api/cards") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    res.end(CARD_CATALOG);
    return;
  }
  if (req.url === "/api/relics") {
    res.writeHead(200, { "content-type": "application/json", "cache-control": "no-cache" });
    res.end(RELIC_CATALOG);
    return;
  }
  // Static file serving for the built client (prod). Safe path join.
  try {
    const urlPath = (req.url ?? "/").split("?")[0];
    const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = join(CLIENT_DIR, rel);
    if (!filePath.startsWith(CLIENT_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    const data = await readFile(filePath).catch(() => readFile(join(CLIENT_DIR, "index.html")));
    res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404).end("Client not built. Run `npm run dev` and open the Vite URL.");
  }
});

const wss = new WebSocketServer({ server: http, path: "/ws" });

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function newPlayerId(): string {
  return "p_" + Math.random().toString(36).slice(2, 10);
}

wss.on("connection", (ws) => {
  conns.set(ws, { ws, playerId: newPlayerId(), matchId: null });

  ws.on("message", (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { t: "error", message: "Bad message format." });
    }
    handle(ws, msg);
  });

  ws.on("close", () => {
    const c = conns.get(ws);
    if (!c?.matchId) return;
    const match = manager.get(c.matchId);
    if (!match) return;
    // Don't let a disconnect during the resolution summary stall everyone else.
    const engine = match.getEngine();
    if (engine && engine.phase === "resolution") engine.acknowledgeResolution(c.playerId);
    match.detach(c.playerId);
    match.broadcast();
    if (match.isEmpty()) manager.remove(c.matchId);
  });
});

function handle(ws: WebSocket, msg: ClientMessage): void {
  const c = conns.get(ws);
  if (!c) return;

  switch (msg.t) {
    case "join": {
      const mode: MatchMode = msg.mode ?? "1v1";
      const match = manager.joinOrCreate(msg.matchId, mode, c.playerId);

      // Validate an imported loadout (if any) into an engine seed + warnings.
      let seed: MemberSeed | undefined;
      let warnings: string[] = [];
      let importedName: string | undefined;
      if (msg.loadout) {
        const imported = importLoadout(msg.loadout);
        warnings = imported.report.warnings;
        importedName = imported.name;
        seed = {
          deck: imported.deck,
          relics: imported.relics,
          maxHp: imported.maxHp,
          custom: imported.deck.length > 0,
        };
      }
      const name = importedName || msg.name || "Player";

      // Reconnect path: same player rejoining a match they're already in.
      if (match.hasMember(c.playerId)) {
        match.attach(c.playerId, ws);
        if (seed) match.setLoadout(c.playerId, name, seed);
      } else {
        const err = match.addMember(c.playerId, name, ws, seed);
        if (err) return send(ws, { t: "error", message: err });
      }
      c.matchId = match.id;
      send(ws, { t: "joined", playerId: c.playerId, matchId: match.id });
      if (seed) {
        const summary = `Imported deck: ${seed.deck.length} cards, ${seed.relics.length} relics.`;
        send(ws, { t: "notice", message: warnings.length ? `${summary} ${warnings.length} warning(s).` : summary });
        for (const w of warnings.slice(0, 12)) send(ws, { t: "notice", message: "⚠ " + w });
      }
      match.broadcast();
      break;
    }
    case "startMatch": {
      const match = c.matchId ? manager.get(c.matchId) : undefined;
      if (!match) return send(ws, { t: "error", message: "Not in a match." });
      const err = match.start(c.playerId);
      if (err) return send(ws, { t: "error", message: err });
      match.broadcast();
      break;
    }
    case "playCard": {
      const match = c.matchId ? manager.get(c.matchId) : undefined;
      const engine = match?.getEngine();
      if (!engine) return send(ws, { t: "error", message: "Match not running." });
      const err = engine.playCard(c.playerId, msg.cardUid, msg.targetId);
      if (err) send(ws, { t: "error", message: err });
      match!.broadcast();
      break;
    }
    case "pass": {
      const match = c.matchId ? manager.get(c.matchId) : undefined;
      const engine = match?.getEngine();
      if (!engine) return send(ws, { t: "error", message: "Match not running." });
      const err = engine.pass(c.playerId);
      if (err) send(ws, { t: "error", message: err });
      match!.broadcast();
      break;
    }
    case "ackResolution": {
      const match = c.matchId ? manager.get(c.matchId) : undefined;
      const engine = match?.getEngine();
      if (!engine) return;
      engine.acknowledgeResolution(c.playerId);
      match!.broadcast();
      break;
    }
    case "chat": {
      // Minimal: ignore for now (room for a chat log later).
      break;
    }
  }
}

http.listen(PORT, () => {
  console.log(`\nMultispire server listening on http://localhost:${PORT}`);
  console.log(`WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`In dev, open the Vite client URL (usually http://localhost:5173)\n`);
});
