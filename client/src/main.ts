import type {
  GameView,
  LobbyView,
  MatchMode,
  PlayerView,
  ServerMessage,
} from "@multispire/shared";
import { Net } from "./net.js";

const net = new Net();
const app = document.getElementById("app")!;

interface UIState {
  screen: "join" | "lobby" | "game";
  playerId: string | null;
  matchId: string | null;
  lobby: LobbyView | null;
  game: GameView | null;
  error: string | null;
  // When an enemy-target card is selected and there are multiple foes.
  targetingCardUid: string | null;
}

const ui: UIState = {
  screen: "join",
  playerId: null,
  matchId: null,
  lobby: null,
  game: null,
  error: null,
  targetingCardUid: null,
};

net.connect();
net.on(onMessage);

function onMessage(msg: ServerMessage): void {
  switch (msg.t) {
    case "joined":
      ui.playerId = msg.playerId;
      ui.matchId = msg.matchId;
      break;
    case "lobby":
      ui.lobby = msg.view;
      ui.game = null;
      ui.screen = msg.view.started ? "game" : "lobby";
      break;
    case "state":
      ui.game = msg.view;
      ui.screen = "game";
      break;
    case "error":
      ui.error = msg.message;
      setTimeout(() => {
        ui.error = null;
        render();
      }, 2500);
      break;
  }
  render();
}

// ----------------------------------------------------------------- actions

function join(name: string, matchId: string | undefined, mode: MatchMode): void {
  net.send({ t: "join", name, matchId, mode });
}

function startMatch(): void {
  net.send({ t: "startMatch" });
}

function clickCard(uid: string, card: { target: string; playable: boolean }): void {
  if (!card.playable) return;
  if (card.target === "enemy") {
    const enemies = aliveEnemies();
    if (enemies.length <= 1) {
      net.send({ t: "playCard", cardUid: uid, targetId: enemies[0]?.id });
    } else {
      ui.targetingCardUid = uid; // wait for the player to click a foe
      render();
    }
  } else {
    net.send({ t: "playCard", cardUid: uid });
  }
}

function clickEnemy(id: string): void {
  if (!ui.targetingCardUid) return;
  net.send({ t: "playCard", cardUid: ui.targetingCardUid, targetId: id });
  ui.targetingCardUid = null;
}

function pass(): void {
  net.send({ t: "pass" });
}

function aliveEnemies(): PlayerView[] {
  if (!ui.game) return [];
  return ui.game.players.filter((p) => p.id !== ui.game!.youId && p.alive);
}

// ----------------------------------------------------------------- rendering

function el(html: string): HTMLElement {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
}

function render(): void {
  app.innerHTML = "";
  if (ui.error) app.appendChild(el(`<div class="toast">${escape(ui.error)}</div>`));
  if (ui.screen === "join") return renderJoin();
  if (ui.screen === "lobby") return renderLobby();
  if (ui.screen === "game") return renderGame();
}

function renderJoin(): void {
  const wrap = el(`
    <div class="center">
      <h1>Multispire</h1>
      <p class="muted">Multiplayer deck battler</p>
      <div class="card-panel">
        <label>Name <input id="name" value="Player" /></label>
        <label>Match code <input id="match" placeholder="(blank = create new)" /></label>
        <label>Mode
          <select id="mode">
            <option value="1v1">1v1</option>
            <option value="ffa">Free for all</option>
          </select>
        </label>
        <button id="go" class="primary">Join / Create</button>
      </div>
    </div>`);
  wrap.querySelector("#go")!.addEventListener("click", () => {
    const name = (wrap.querySelector("#name") as HTMLInputElement).value.trim() || "Player";
    const match = (wrap.querySelector("#match") as HTMLInputElement).value.trim().toUpperCase();
    const mode = (wrap.querySelector("#mode") as HTMLSelectElement).value as MatchMode;
    join(name, match || undefined, mode);
  });
  app.appendChild(wrap);
}

function renderLobby(): void {
  const lobby = ui.lobby!;
  const isHost = lobby.hostId === ui.playerId;
  const wrap = el(`
    <div class="center">
      <h1>Lobby</h1>
      <p>Match code: <span class="code">${escape(lobby.matchId)}</span> &middot; ${lobby.mode}</p>
      <p class="muted">Share the code so friends can join.</p>
      <ul class="players">
        ${lobby.players
          .map(
            (p) =>
              `<li>${escape(p.name)}${p.id === lobby.hostId ? " 👑" : ""}${
                p.id === ui.playerId ? " (you)" : ""
              }</li>`,
          )
          .join("")}
      </ul>
      ${
        isHost
          ? `<button id="start" class="primary" ${lobby.players.length < 2 ? "disabled" : ""}>Start match</button>`
          : `<p class="muted">Waiting for the host to start…</p>`
      }
    </div>`);
  wrap.querySelector("#start")?.addEventListener("click", startMatch);
  app.appendChild(wrap);
}

function renderGame(): void {
  const g = ui.game!;
  const me = g.players.find((p) => p.id === g.youId)!;
  const enemies = g.players.filter((p) => p.id !== g.youId);
  const yourPriority = g.priorityId === g.youId && g.phase === "action";

  const board = el(`<div class="board"></div>`);

  // Banner
  let banner = "";
  if (g.phase === "gameover") {
    banner = g.winnerId === g.youId ? "🏆 You win!" : g.winnerId ? `${nameOf(g, g.winnerId)} wins` : "Game over";
  } else if (g.phase === "resolution") {
    banner = "Resolving…";
  } else if (yourPriority) {
    banner = ui.targetingCardUid ? "Pick a target" : "Your priority";
  } else {
    banner = `Waiting on ${nameOf(g, g.priorityId)}…`;
  }
  board.appendChild(
    el(`<div class="banner ${yourPriority ? "active" : ""}">Turn ${g.turn} &middot; ${escape(banner)}</div>`),
  );

  // Enemies row
  const enemyRow = el(`<div class="enemies"></div>`);
  for (const e of enemies) enemyRow.appendChild(enemyCard(g, e));
  board.appendChild(enemyRow);

  // Incoming attacks summary (what's aimed at me)
  const incoming = g.pendingAttacks.filter((a) => a.targetId === g.youId);
  if (incoming.length) {
    const total = incoming.reduce((s, a) => s + (a.amount ?? 0) * a.times, 0);
    board.appendChild(
      el(
        `<div class="incoming">⚔️ Incoming this turn: <b>${total}</b> damage across ${incoming.length} attack(s)</div>`,
      ),
    );
  }

  // Event log (scrollable history of what everyone has done this match)
  const logWrap = el(`<div class="logwrap"><div class="logtitle">Event log</div><div class="log" id="log"></div></div>`);
  const log = logWrap.querySelector("#log") as HTMLElement;
  for (const entry of g.log) log.appendChild(el(`<div class="logline ${logClass(entry.text)}">${escape(entry.text)}</div>`));
  board.appendChild(logWrap);

  // Self panel
  board.appendChild(selfPanel(g, me, yourPriority));

  app.appendChild(board);

  // Wire enemy clicks for targeting
  if (ui.targetingCardUid) {
    board.querySelectorAll<HTMLElement>("[data-enemy]").forEach((node) => {
      node.classList.add("targetable");
      node.addEventListener("click", () => clickEnemy(node.dataset.enemy!));
    });
  }

  // Keep the event log pinned to the newest entry.
  const logNode = board.querySelector("#log");
  if (logNode) logNode.scrollTop = logNode.scrollHeight;
}

// Tag log lines so the UI can color attacks / blocks / status changes.
function logClass(text: string): string {
  if (text.startsWith("☠")) return "log-debuff";
  if (text.startsWith("✦")) return "log-buff";
  if (text.includes("attack hits")) return "log-attack";
  if (text.startsWith("---")) return "log-phase";
  if (text.includes("defeated") || text.includes("wins")) return "log-big";
  return "";
}

function enemyCard(g: GameView, e: PlayerView): HTMLElement {
  const incoming = g.pendingAttacks.filter((a) => a.targetId === e.id && a.sourceId === g.youId);
  const myDmg = incoming.reduce((s, a) => s + (a.amount ?? 0) * a.times, 0);
  const node = el(`
    <div class="enemy ${e.alive ? "" : "dead"}" data-enemy="${e.id}">
      <div class="ename">${escape(e.name)}${e.passed ? " 💤" : ""}</div>
      <div class="hpbar"><div class="hpfill" style="width:${(100 * e.hp) / e.maxHp}%"></div>
        <span>${e.hp}/${e.maxHp}</span></div>
      <div class="badges">
        ${e.isBlocking ? `<span class="badge block">🛡 blocking</span>` : ""}
        ${myDmg ? `<span class="badge atk">your hit: ${myDmg}</span>` : ""}
      </div>
      <div class="powers">${powerBadges(e)}</div>
    </div>`);
  return node;
}

function selfPanel(g: GameView, me: PlayerView, yourPriority: boolean): HTMLElement {
  const panel = el(`<div class="self"></div>`);
  panel.appendChild(
    el(`
    <div class="selfstats">
      <div class="hpbar self"><div class="hpfill" style="width:${(100 * me.hp) / me.maxHp}%"></div>
        <span>${me.hp}/${me.maxHp}</span></div>
      <div class="stat">🛡 ${me.block ?? 0}</div>
      <div class="stat energy">⚡ ${me.energy ?? 0}/${me.maxEnergy}</div>
      <div class="powers">${powerBadges(me)}</div>
    </div>`),
  );

  const hand = el(`<div class="hand"></div>`);
  for (const c of me.hand ?? []) {
    const card = el(`
      <div class="gamecard ${c.playable && yourPriority ? "playable" : "locked"} type-${c.type} ${
        ui.targetingCardUid === c.uid ? "selected" : ""
      }">
        <div class="cost">${c.cost === "X" ? "X" : c.cost}</div>
        <div class="cname">${escape(c.name)}${c.upgraded ? "+" : ""}</div>
        <div class="ctext">${escape(c.description)}</div>
      </div>`);
    card.addEventListener("click", () => clickCard(c.uid, c));
    hand.appendChild(card);
  }
  panel.appendChild(hand);

  const controls = el(`<div class="controls"></div>`);
  const passBtn = el(
    `<button class="primary" ${yourPriority ? "" : "disabled"}>${
      hasAnyPlay(me) ? "Pass priority" : "Pass (nothing to play)"
    }</button>`,
  );
  passBtn.addEventListener("click", pass);
  controls.appendChild(passBtn);
  controls.appendChild(
    el(`<span class="piles">draw ${me.drawCount} · discard ${me.discardCount} · exhaust ${me.exhaustCount}</span>`),
  );
  panel.appendChild(controls);
  return panel;
}

function hasAnyPlay(me: PlayerView): boolean {
  return (me.hand ?? []).some((c) => c.playable);
}

function powerBadges(p: PlayerView): string {
  return p.powers
    .map(
      (pw) =>
        `<span class="pbadge ${pw.kind}" title="${escape(pw.name)} (${pw.kind})">${escape(pw.name)} ${pw.stacks}</span>`,
    )
    .join("");
}

function nameOf(g: GameView, id: string | null): string {
  if (!id) return "—";
  return g.players.find((p) => p.id === id)?.name ?? id;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

render();
