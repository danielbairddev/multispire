import type {
  CardCatalogEntry,
  GameView,
  Loadout,
  LoadoutCardEntry,
  LobbyView,
  MatchMode,
  PlayerView,
  RelicCatalogEntry,
  ServerMessage,
} from "@multispire/shared";
import { Net } from "./net.js";
import { EXAMPLE_LOADOUT } from "./example-loadout.js";

// A working entry in the deckbuilder: a card id + modifier, with a copy count.
interface BuilderEntry {
  id: string;
  upgraded: boolean;
  count: number;
}

const net = new Net();
const app = document.getElementById("app")!;

interface BuilderState {
  name: string;
  maxHp: string;
  relics: string[];
  query: string;
  entries: BuilderEntry[];
}

interface UIState {
  screen: "join" | "lobby" | "game" | "deckbuilder";
  playerId: string | null;
  matchId: string | null;
  lobby: LobbyView | null;
  game: GameView | null;
  error: string | null;
  notices: string[];
  // When an enemy-target card is selected and there are multiple foes.
  targetingCardUid: string | null;
  // Loadout JSON the user pasted/loaded on the join screen (kept across renders).
  loadoutText: string;
  // Deck viewer overlay (draw / discard / exhaust piles).
  showDeck: boolean;
  // Id of the player whose static build (deck/relics/HP) is being inspected.
  buildOf: string | null;
  // Card catalog (fetched once) and the in-progress deckbuilder state.
  catalog: CardCatalogEntry[] | null;
  relicCatalog: RelicCatalogEntry[] | null;
  builder: BuilderState;
  // A deck built in the deckbuilder, used as the loadout on join.
  deckDraft: Loadout | null;
}

function emptyBuilder(): BuilderState {
  return { name: "", maxHp: "", relics: [], query: "", entries: [] };
}

const ui: UIState = {
  screen: "join",
  playerId: null,
  matchId: null,
  lobby: null,
  game: null,
  error: null,
  notices: [],
  targetingCardUid: null,
  loadoutText: "",
  showDeck: false,
  buildOf: null,
  catalog: null,
  relicCatalog: null,
  builder: emptyBuilder(),
  deckDraft: null,
};

net.connect();
net.on(onMessage);

// --- priority chime: a short synthesized tone when it becomes your turn ---
let audioCtx: AudioContext | null = null;
let hadPriority = false;
let muted = localStorage.getItem("ms_muted") === "1";

function ensureAudio(): AudioContext | null {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}
// Browsers block audio until a user gesture; unlock on the first interaction.
window.addEventListener("pointerdown", () => ensureAudio(), { once: true });

function playPriorityChime(): void {
  if (muted) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const now = ctx.currentTime;
  for (const n of [{ f: 660, t: 0 }, { f: 880, t: 0.1 }]) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = n.f;
    gain.gain.setValueAtTime(0.0001, now + n.t);
    gain.gain.exponentialRampToValueAtTime(0.16, now + n.t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.28);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now + n.t);
    osc.stop(now + n.t + 0.3);
  }
}

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
      hadPriority = false;
      break;
    case "state": {
      ui.game = msg.view;
      ui.screen = "game";
      // Chime only on the transition into having priority (not on every update).
      const minePriority = msg.view.priorityId === msg.view.youId && msg.view.phase === "action";
      if (minePriority && !hadPriority) playPriorityChime();
      hadPriority = minePriority;
      break;
    }
    case "error":
      ui.error = msg.message;
      setTimeout(() => {
        ui.error = null;
        render();
      }, 2500);
      break;
    case "notice":
      ui.notices.push(msg.message);
      if (ui.notices.length > 8) ui.notices = ui.notices.slice(-8);
      setTimeout(() => {
        ui.notices.shift();
        render();
      }, 6000);
      break;
  }
  render();
}

// ----------------------------------------------------------------- actions

function flashNotice(message: string): void {
  ui.notices.push(message);
  if (ui.notices.length > 8) ui.notices = ui.notices.slice(-8);
  setTimeout(() => {
    ui.notices.shift();
    render();
  }, 4000);
  render();
}

function join(name: string, matchId: string | undefined, mode: MatchMode, loadout?: Loadout): void {
  net.send({ t: "join", name, matchId, mode, loadout });
}

// -------------------------------------------------------------- deckbuilder

async function openDeckbuilder(): Promise<void> {
  if (!ui.catalog) {
    try {
      const res = await fetch("/api/cards");
      ui.catalog = (await res.json()) as CardCatalogEntry[];
    } catch {
      ui.error = "Couldn't load the card list.";
      ui.catalog = [];
    }
  }
  if (!ui.relicCatalog) {
    try {
      const res = await fetch("/api/relics");
      ui.relicCatalog = (await res.json()) as RelicCatalogEntry[];
    } catch {
      ui.relicCatalog = [];
    }
  }
  // Seed the builder from an existing draft so "Edit" round-trips cleanly.
  if (ui.deckDraft) {
    ui.builder = {
      name: ui.deckDraft.name ?? "",
      maxHp: ui.deckDraft.maxHp != null ? String(ui.deckDraft.maxHp) : "",
      relics: [...(ui.deckDraft.relics ?? [])],
      query: "",
      entries: (ui.deckDraft.deck ?? []).map((d) =>
        typeof d === "string"
          ? { id: d, upgraded: false, count: 1 }
          : { id: d.id, upgraded: !!d.upgraded, count: d.count ?? 1 },
      ),
    };
  } else if (ui.builder.entries.length === 0) {
    ui.builder = emptyBuilder();
  }
  ui.screen = "deckbuilder";
  render();
}

function addCard(id: string, upgraded: boolean): void {
  const e = ui.builder.entries.find((x) => x.id === id && x.upgraded === upgraded);
  if (e) e.count += 1;
  else ui.builder.entries.push({ id, upgraded, count: 1 });
  render();
}

function changeCount(id: string, upgraded: boolean, delta: number): void {
  const e = ui.builder.entries.find((x) => x.id === id && x.upgraded === upgraded);
  if (!e) return;
  e.count += delta;
  if (e.count <= 0) ui.builder.entries = ui.builder.entries.filter((x) => x !== e);
  render();
}

function setEntryUpgraded(id: string, fromUpgraded: boolean, upgraded: boolean): void {
  const e = ui.builder.entries.find((x) => x.id === id && x.upgraded === fromUpgraded);
  if (!e) return;
  const moved = e.count;
  ui.builder.entries = ui.builder.entries.filter((x) => x !== e);
  const target = ui.builder.entries.find((x) => x.id === id && x.upgraded === upgraded);
  if (target) target.count += moved;
  else ui.builder.entries.push({ id, upgraded, count: moved });
  render();
}

function deckCount(): number {
  return ui.builder.entries.reduce((s, e) => s + e.count, 0);
}

function builderToLoadout(): Loadout {
  const b = ui.builder;
  const deck: LoadoutCardEntry[] = b.entries.map((e) => ({
    id: e.id,
    count: e.count,
    ...(e.upgraded ? { upgraded: true } : {}),
  }));
  const maxHpNum = b.maxHp.trim() ? Number(b.maxHp) : undefined;
  return {
    name: b.name.trim() || undefined,
    maxHp: Number.isFinite(maxHpNum) ? maxHpNum : undefined,
    relics: [...b.relics],
    deck,
  };
}

function addRelic(id: string): void {
  const r = id.trim();
  if (!r || ui.builder.relics.includes(r)) return;
  ui.builder.relics.push(r);
  render();
}

function removeRelic(id: string): void {
  ui.builder.relics = ui.builder.relics.filter((r) => r !== id);
  render();
}

function builderJson(): string {
  return JSON.stringify(builderToLoadout(), null, 2);
}

async function copyDeckJson(): Promise<void> {
  const json = builderJson();
  try {
    await navigator.clipboard.writeText(json);
    flashNotice("Copied deck JSON to clipboard.");
  } catch {
    // Clipboard API can be blocked (insecure context); fall back to a download.
    downloadDeckJson();
  }
}

function downloadDeckJson(): void {
  const name = (ui.builder.name.trim() || "deck").replace(/[^\w.-]+/g, "_");
  const blob = new Blob([builderJson()], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function useBuiltDeck(): void {
  ui.deckDraft = builderToLoadout();
  ui.loadoutText = ""; // the draft takes precedence over any pasted JSON
  ui.screen = "join";
  render();
}

function clearDeckDraft(): void {
  ui.deckDraft = null;
  ui.builder = emptyBuilder();
  render();
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

function ackResolution(): void {
  net.send({ t: "ackResolution" });
}

function toggleMute(): void {
  muted = !muted;
  localStorage.setItem("ms_muted", muted ? "1" : "0");
  render();
}

function toggleDeck(): void {
  ui.showDeck = !ui.showDeck;
  render();
}

function showBuild(id: string | null): void {
  ui.buildOf = id;
  render();
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
  const toasts = el(`<div class="toasts"></div>`);
  if (ui.error) toasts.appendChild(el(`<div class="toast error">${escape(ui.error)}</div>`));
  for (const n of ui.notices) toasts.appendChild(el(`<div class="toast notice">${escape(n)}</div>`));
  app.appendChild(toasts);
  if (ui.screen === "join") return renderJoin();
  if (ui.screen === "deckbuilder") return renderDeckbuilder();
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

        <div class="builder-entry">
          ${
            ui.deckDraft
              ? `<div class="draft-chip">
                   <span>🛠 Custom deck · ${draftCardCount(ui.deckDraft)} cards · ${(ui.deckDraft.relics ?? []).length} relics</span>
                   <span class="draft-actions">
                     <button id="editDeck" type="button">Edit</button>
                     <button id="clearDraft" type="button">Clear</button>
                   </span>
                 </div>`
              : `<button id="buildDeck" type="button" class="buildlink">🛠 Build a deck</button>`
          }
        </div>

        <details class="import" ${ui.loadoutText ? "open" : ""}>
          <summary>Import deck / loadout (paste JSON)</summary>
          <p class="muted small">Paste loadout JSON, or load a file. Leave blank to use the default Ironclad deck (or build one above).</p>
          <div class="import-actions">
            <button id="example" type="button">Load example</button>
            <label class="filebtn">Load file…<input id="file" type="file" accept="application/json,.json" hidden /></label>
            <button id="clearLoad" type="button">Clear</button>
          </div>
          <textarea id="loadout" rows="8" placeholder='{ "name": "Ironclad", "maxHp": 80, "relics": ["burning_blood"], "deck": [ { "id": "strike_r", "count": 5 }, "bash" ] }'>${escape(ui.loadoutText)}</textarea>
          <div id="loaderr" class="loaderr"></div>
        </details>

        <button id="go" class="primary">Join / Create</button>
      </div>
    </div>`);

  wrap.querySelector("#buildDeck")?.addEventListener("click", () => void openDeckbuilder());
  wrap.querySelector("#editDeck")?.addEventListener("click", () => void openDeckbuilder());
  wrap.querySelector("#clearDraft")?.addEventListener("click", clearDeckDraft);

  const ta = wrap.querySelector("#loadout") as HTMLTextAreaElement;
  ta.addEventListener("input", () => (ui.loadoutText = ta.value));

  wrap.querySelector("#example")!.addEventListener("click", () => {
    ui.loadoutText = JSON.stringify(EXAMPLE_LOADOUT, null, 2);
    render();
  });
  wrap.querySelector("#clearLoad")!.addEventListener("click", () => {
    ui.loadoutText = "";
    render();
  });
  wrap.querySelector("#file")!.addEventListener("change", (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    file.text().then((text) => {
      ui.loadoutText = text;
      render();
    });
  });

  wrap.querySelector("#go")!.addEventListener("click", () => {
    const name = (wrap.querySelector("#name") as HTMLInputElement).value.trim() || "Player";
    const match = (wrap.querySelector("#match") as HTMLInputElement).value.trim().toUpperCase();
    const mode = (wrap.querySelector("#mode") as HTMLSelectElement).value as MatchMode;
    const errBox = wrap.querySelector("#loaderr") as HTMLElement;
    errBox.textContent = "";
    // A deck built in the deckbuilder takes precedence over pasted JSON.
    let loadout: Loadout | undefined = ui.deckDraft ?? undefined;
    if (!loadout && ui.loadoutText.trim()) {
      try {
        loadout = JSON.parse(ui.loadoutText);
      } catch (e) {
        errBox.textContent = "Invalid JSON: " + (e as Error).message;
        return;
      }
    }
    join(name, match || undefined, mode, loadout);
  });
  app.appendChild(wrap);
}

function draftCardCount(l: Loadout): number {
  return (l.deck ?? []).reduce((s, d) => s + (typeof d === "string" ? 1 : d.count ?? 1), 0);
}

function catalogById(): Map<string, CardCatalogEntry> {
  return new Map((ui.catalog ?? []).map((c) => [c.id, c]));
}

function renderDeckbuilder(): void {
  const b = ui.builder;
  const wrap = el(`
    <div class="builder">
      <div class="builder-head">
        <button id="back" class="ghost">← Back</button>
        <h1>Deckbuilder</h1>
        <div class="builder-meta">
          <label>Name <input id="bname" value="${escape(b.name)}" placeholder="Ironclad" /></label>
          <label>Max HP
            <span class="hpadjust">
              <button id="hpdown" class="ghost" title="−5">−</button>
              <input id="bhp" value="${escape(b.maxHp)}" placeholder="75" inputmode="numeric" />
              <button id="hpup" class="ghost" title="+5">+</button>
            </span>
          </label>
        </div>
        <div class="relicrow">
          <span class="reliclbl">Relics</span>
          <div id="relicChips" class="relicchips"></div>
          <span class="relicadd">
            <input id="brelic" class="search" list="relicopts" placeholder="relic id…" />
            <datalist id="relicopts">
              ${(ui.relicCatalog ?? []).map((r) => `<option value="${escape(r.id)}">${escape(r.name)}</option>`).join("")}
            </datalist>
            <button id="brelicAdd" class="ghost">+ Add relic</button>
          </span>
        </div>
      </div>
      <div class="builder-cols">
        <div class="builder-pane">
          <div class="builder-panehead">
            <span class="resheading">Cards</span>
            <input id="bsearch" class="search" value="${escape(b.query)}" placeholder="🔎 Search cards…" />
          </div>
          <div id="catalogList" class="catalog"></div>
        </div>
        <div class="builder-pane">
          <div class="builder-panehead">
            <span class="resheading">Your deck (<span id="deckCount">${deckCount()}</span>)</span>
          </div>
          <div id="deckList" class="deckbuild"></div>
        </div>
      </div>
      <div class="builder-foot">
        <span class="muted">${deckCount()} cards${b.entries.length ? "" : " — click a card to add it"}</span>
        <span class="foot-actions">
          <button id="copyJson" class="ghost" title="Copy this deck as JSON">📋 Copy JSON</button>
          <button id="dlJson" class="ghost" title="Download this deck as a .json file">⬇ Download</button>
          <button id="useDeck" class="primary" ${b.entries.length ? "" : "disabled"}>Use this deck</button>
        </span>
      </div>
    </div>`);

  // Text fields update state without a full re-render so focus is preserved.
  const bname = wrap.querySelector("#bname") as HTMLInputElement;
  bname.addEventListener("input", () => (b.name = bname.value));
  const bhp = wrap.querySelector("#bhp") as HTMLInputElement;
  bhp.addEventListener("input", () => (b.maxHp = bhp.value));
  const bumpHp = (delta: number) => {
    const cur = Number(b.maxHp) || 0;
    b.maxHp = String(Math.max(1, cur + delta));
    bhp.value = b.maxHp;
  };
  wrap.querySelector("#hpdown")!.addEventListener("click", () => bumpHp(-5));
  wrap.querySelector("#hpup")!.addEventListener("click", () => bumpHp(+5));

  const brelic = wrap.querySelector("#brelic") as HTMLInputElement;
  const commitRelic = () => {
    addRelic(brelic.value);
    brelic.value = "";
  };
  wrap.querySelector("#brelicAdd")!.addEventListener("click", commitRelic);
  brelic.addEventListener("keydown", (e) => {
    if ((e as KeyboardEvent).key === "Enter") {
      e.preventDefault();
      commitRelic();
    }
  });

  const search = wrap.querySelector("#bsearch") as HTMLInputElement;
  const catalogList = wrap.querySelector("#catalogList") as HTMLElement;
  // Live-filter the catalog in place (no full render) so search keeps focus.
  search.addEventListener("input", () => {
    b.query = search.value;
    renderCatalogList(catalogList);
  });

  wrap.querySelector("#back")!.addEventListener("click", () => {
    ui.screen = "join";
    render();
  });
  wrap.querySelector("#useDeck")!.addEventListener("click", useBuiltDeck);
  wrap.querySelector("#copyJson")!.addEventListener("click", copyDeckJson);
  wrap.querySelector("#dlJson")!.addEventListener("click", downloadDeckJson);

  renderRelicChips(wrap.querySelector("#relicChips") as HTMLElement);
  renderCatalogList(catalogList);
  renderDeckList(wrap.querySelector("#deckList") as HTMLElement);
  app.appendChild(wrap);
}

function renderRelicChips(container: HTMLElement): void {
  container.innerHTML = "";
  const b = ui.builder;
  if (!b.relics.length) {
    container.appendChild(el(`<span class="muted small">none</span>`));
    return;
  }
  const names = new Map((ui.relicCatalog ?? []).map((r) => [r.id, r.name]));
  for (const id of b.relics) {
    const chip = el(
      `<span class="relicchip">${escape(names.get(id) ?? id)}<button class="rmrelic" title="Remove">✕</button></span>`,
    );
    chip.querySelector(".rmrelic")!.addEventListener("click", () => removeRelic(id));
    container.appendChild(chip);
  }
}

function renderCatalogList(container: HTMLElement): void {
  container.innerHTML = "";
  const q = ui.builder.query.trim().toLowerCase();
  const cards = (ui.catalog ?? []).filter(
    (c) => !q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q),
  );
  if (!cards.length) {
    container.appendChild(el(`<p class="muted small">No cards match “${escape(ui.builder.query)}”.</p>`));
    return;
  }
  const inDeck = (id: string) =>
    ui.builder.entries.filter((e) => e.id === id).reduce((s, e) => s + e.count, 0);
  for (const c of cards) {
    const n = inDeck(c.id);
    const node = el(`
      <div class="catcard type-${c.type}">
        <span class="dcost">${c.cost === "X" ? "X" : c.cost}</span>
        <div class="catbody">
          <div class="catname">${escape(c.name)}${n ? ` <span class="indeck">×${n} in deck</span>` : ""}</div>
          <div class="dtext">${escape(c.description)}</div>
        </div>
        <div class="catadd">
          <button class="add" title="Add one copy">+ Add</button>
          ${c.upgradable ? `<button class="addup" title="${escape(c.upgradedDescription ?? "")}">+ Add⁺</button>` : ""}
        </div>
      </div>`);
    node.querySelector(".add")!.addEventListener("click", () => addCard(c.id, false));
    node.querySelector(".addup")?.addEventListener("click", () => addCard(c.id, true));
    container.appendChild(node);
  }
}

function renderDeckList(container: HTMLElement): void {
  container.innerHTML = "";
  const byId = catalogById();
  if (!ui.builder.entries.length) {
    container.appendChild(el(`<p class="muted small">Empty. Add cards from the left.</p>`));
    return;
  }
  const rows = [...ui.builder.entries].sort((a, e) => {
    const an = byId.get(a.id)?.name ?? a.id;
    const en = byId.get(e.id)?.name ?? e.id;
    return an.localeCompare(en) || Number(a.upgraded) - Number(e.upgraded);
  });
  for (const e of rows) {
    const c = byId.get(e.id);
    const name = c?.name ?? e.id;
    const node = el(`
      <div class="deckrow type-${c?.type ?? "skill"} ${e.upgraded ? "upgraded" : ""}">
        <span class="dcost">${c ? (c.cost === "X" ? "X" : c.cost) : "?"}</span>
        <span class="dname">${escape(name)}${e.upgraded ? "+" : ""}</span>
        <span class="rowcount">×${e.count}</span>
        <span class="rowbtns">
          <button class="dec" title="Remove one">−</button>
          <button class="inc" title="Add one">+</button>
          <button class="up" title="Toggle upgraded">${e.upgraded ? "▽" : "△"}</button>
          <button class="rm" title="Remove all">✕</button>
        </span>
      </div>`);
    node.querySelector(".dec")!.addEventListener("click", () => changeCount(e.id, e.upgraded, -1));
    node.querySelector(".inc")!.addEventListener("click", () => changeCount(e.id, e.upgraded, +1));
    node.querySelector(".up")!.addEventListener("click", () => setEntryUpgraded(e.id, e.upgraded, !e.upgraded));
    node.querySelector(".rm")!.addEventListener("click", () => changeCount(e.id, e.upgraded, -e.count));
    container.appendChild(node);
  }
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
              `<li>
                <span>${escape(p.name)}${p.id === lobby.hostId ? " 👑" : ""}${p.id === ui.playerId ? " (you)" : ""}</span>
                <span class="deckinfo">${p.custom ? "🃏 custom" : "default"} · ${p.deckSize} cards · ${p.relicCount} relics · ${p.maxHp} HP</span>
              </li>`,
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

  // End-of-turn resolution summary (modal). Players dismiss it to advance.
  if (g.phase === "resolution" && g.resolution) {
    app.appendChild(resolutionModal(g, g.resolution));
  }

  // Deck viewer overlay (draw / discard / exhaust).
  if (ui.showDeck) app.appendChild(deckModal(me));

  // Build viewer overlay (any player's static deck/relics/HP).
  if (ui.buildOf) {
    const who = g.players.find((p) => p.id === ui.buildOf);
    if (who) app.appendChild(buildModal(who));
    else ui.buildOf = null;
  }
}

function buildModal(p: PlayerView): HTMLElement {
  const b = p.build;
  const relics = b.relics.length
    ? b.relics.map((r) => `<span class="pbadge buff">${escape(r.name)}</span>`).join("")
    : `<span class="muted">none</span>`;
  const cards = b.cards.length
    ? b.cards
        .map(
          (c) =>
            `<li class="deckcard type-${c.type}">
              <span class="dcount">${c.count}×</span>
              <span class="dname">${escape(c.name)}${c.upgraded ? "+" : ""}</span>
            </li>`,
        )
        .join("")
    : `<li class="muted">empty</li>`;

  const overlay = el(`
    <div class="overlay">
      <div class="modal">
        <h2>${escape(p.name)}'s build</h2>
        <div class="buildmeta">
          <span class="stat">❤️ ${b.maxHp} max HP</span>
          <span class="stat">🃏 ${b.deckSize} cards</span>
        </div>
        <div class="resheading">Relics</div>
        <div class="powers buildrelics">${relics}</div>
        <div class="resheading">Deck</div>
        <ul class="decklist buildlist">${cards}</ul>
        <button id="closeBuild" class="primary">Close</button>
      </div>
    </div>`);
  overlay.querySelector("#closeBuild")!.addEventListener("click", () => showBuild(null));
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) showBuild(null);
  });
  return overlay;
}

function deckModal(me: PlayerView): HTMLElement {
  const pile = (title: string, cards: PlayerView["hand"]): string => {
    const list = cards ?? [];
    const items = list.length
      ? list
          .map(
            (c) =>
              `<li class="deckcard type-${c.type}">
                <span class="dcost">${c.cost === "X" ? "X" : c.cost}</span>
                <span class="dname">${escape(c.name)}${c.upgraded ? "+" : ""}</span>
                <span class="dtext">${escape(c.description)}</span>
              </li>`,
          )
          .join("")
      : `<li class="muted">empty</li>`;
    return `<div class="deckpile">
      <div class="resheading">${title} (${list.length})</div>
      <ul class="decklist">${items}</ul>
    </div>`;
  };

  const overlay = el(`
    <div class="overlay">
      <div class="modal wide">
        <h2>Your deck</h2>
        <p class="muted small">Draw pile order is hidden (sorted by name).</p>
        <div class="deckcols">
          ${pile("Draw", me.drawPile)}
          ${pile("Discard", me.discardPile)}
          ${pile("Exhaust", me.exhaustPile)}
        </div>
        <button id="closeDeck" class="primary">Close</button>
      </div>
    </div>`);
  overlay.querySelector("#closeDeck")!.addEventListener("click", toggleDeck);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) toggleDeck();
  });
  return overlay;
}

function resolutionModal(g: GameView, r: NonNullable<GameView["resolution"]>): HTMLElement {
  // Blocks first — they're applied before any attack lands.
  const blockSection = r.blocks.length
    ? `<div class="ressection">
        <div class="resheading">🛡 Block raised</div>
        <ul class="reslist">
          ${r.blocks
            .map(
              (b) =>
                `<li class="resblock">
                  <span class="resname block">${escape(b.cardName)}</span>
                  <span>${escape(b.playerName)}</span>
                  <span class="resdmg">+${b.amount} block</span>
                </li>`,
            )
            .join("")}
        </ul>
      </div>`
    : "";

  const attackRows = r.attacks.length
    ? r.attacks
        .map((a) => {
          const blocked = a.blocked > 0 ? ` <span class="muted">(${a.blocked} blocked)</span>` : "";
          const lethal = a.lethal ? ` <span class="lethal">☠ lethal</span>` : "";
          return `<li class="resatk">
            <span class="resname">${escape(a.cardName)}</span>
            <span>${escape(a.sourceName)} → ${escape(a.targetName)}</span>
            <span class="resdmg">${a.damage}${a.times > 1 ? `×${a.times}` : ""} dmg · −${a.hpLost} HP${blocked}${lethal}</span>
          </li>`;
        })
        .join("")
    : `<li class="muted">No attacks landed this turn.</li>`;

  const deaths = r.deaths.length
    ? `<div class="resdeaths">☠ Defeated: ${r.deaths.map((d) => escape(d)).join(", ")}</div>`
    : "";

  const overlay = el(`
    <div class="overlay">
      <div class="modal">
        <h2>Turn ${r.turn} resolved</h2>
        ${blockSection}
        <div class="ressection">
          <div class="resheading">⚔️ Attacks</div>
          <ul class="reslist">${attackRows}</ul>
        </div>
        ${deaths}
        ${
          r.youAcked
            ? `<p class="muted">Waiting on: ${r.waitingOn.length ? r.waitingOn.map((n) => escape(n)).join(", ") : "—"}</p>`
            : `<button id="ack" class="primary">Continue</button>`
        }
      </div>
    </div>`);
  overlay.querySelector("#ack")?.addEventListener("click", ackResolution);
  return overlay;
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
      <div class="ename">${escape(e.name)}${e.passed ? " 💤" : ""}
        <button class="buildbtn ghost" title="View this player's deck & relics">🔍</button>
      </div>
      <div class="hpbar"><div class="hpfill" style="width:${(100 * e.hp) / e.maxHp}%"></div>
        <span>${e.hp}/${e.maxHp}</span></div>
      <div class="badges">
        ${e.isBlocking ? `<span class="badge block">🛡 blocking</span>` : ""}
        ${myDmg ? `<span class="badge atk">your hit: ${myDmg}</span>` : ""}
      </div>
      <div class="powers">${powerBadges(e)}</div>
    </div>`);
  node.querySelector(".buildbtn")!.addEventListener("click", (ev) => {
    ev.stopPropagation();
    showBuild(e.id);
  });
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
  const deckBtn = el(`<button class="ghost" title="View your draw, discard and exhaust piles">📚 Deck</button>`);
  deckBtn.addEventListener("click", toggleDeck);
  controls.appendChild(deckBtn);
  const buildBtn = el(`<button class="ghost" title="View your build (deck list, relics, HP)">🔍 Build</button>`);
  buildBtn.addEventListener("click", () => showBuild(me.id));
  controls.appendChild(buildBtn);
  const muteBtn = el(`<button class="ghost" title="Toggle sound">${muted ? "🔇" : "🔊"}</button>`);
  muteBtn.addEventListener("click", toggleMute);
  controls.appendChild(muteBtn);
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
