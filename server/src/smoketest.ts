// End-to-end smoke test: two ws clients join, host starts, both play/pass a turn.
import { WebSocket } from "ws";

const URL = "ws://localhost:8080/ws";

function client(name: string) {
  const ws = new WebSocket(URL);
  const state: any = { name, playerId: null, matchId: null, last: null };
  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.t === "joined") {
      state.playerId = msg.playerId;
      state.matchId = msg.matchId;
    } else if (msg.t === "state") {
      state.last = msg.view;
    } else if (msg.t === "lobby") {
      state.lobby = msg.view;
    } else if (msg.t === "error") {
      console.log(`[${name}] ERROR: ${msg.message}`);
    }
  });
  return { ws, state, send: (m: any) => ws.send(JSON.stringify(m)) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const a = client("Alice");
  await new Promise((r) => a.ws.on("open", r));
  a.send({ t: "join", name: "Alice", mode: "1v1" });
  await wait(150);
  const code = a.state.matchId;
  console.log("match code:", code);

  const b = client("Bob");
  await new Promise((r) => b.ws.on("open", r));
  b.send({ t: "join", name: "Bob", matchId: code });
  await wait(150);

  a.send({ t: "startMatch" });
  await wait(200);

  const g = a.state.last;
  if (!g || g.phase !== "action") throw new Error("game did not start");
  console.log("game started. starter:", g.startingPlayerId, "priority:", g.priorityId);

  // Whoever has priority plays an attack at the other.
  const starter = g.priorityId === a.state.playerId ? a : b;
  const otherId = starter.state.playerId === a.state.playerId ? b.state.playerId : a.state.playerId;
  const sv = starter.state.last;
  const me = sv.players.find((p: any) => p.id === starter.state.playerId);
  const atk = me.hand.find((c: any) => c.type === "attack" && c.playable);
  if (atk) {
    starter.send({ t: "playCard", cardUid: atk.uid, targetId: otherId });
    await wait(150);
    console.log("played attack:", atk.name);
    const tgtView = (otherId === a.state.playerId ? a : b).state.last;
    const incoming = tgtView.pendingAttacks.filter((x: any) => x.targetId === otherId);
    console.log("target sees incoming amount:", incoming.map((x: any) => x.amount));
  }

  // Both pass to resolve the turn.
  const turnBefore = a.state.last.turn;
  a.send({ t: "pass" });
  b.send({ t: "pass" });
  await wait(150);
  a.send({ t: "pass" });
  b.send({ t: "pass" });
  await wait(200);
  console.log("turn before:", turnBefore, "turn after:", a.state.last.turn);
  console.log("HP after resolution:", a.state.last.players.map((p: any) => `${p.name}:${p.hp}`));

  a.ws.close();
  b.ws.close();
  console.log("\n✅ smoke test complete");
  process.exit(0);
}

run().catch((e) => {
  console.error("smoke test failed:", e);
  process.exit(1);
});
