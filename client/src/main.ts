import type {
  CardCatalogEntry,
  GameView,
  Loadout,
  LoadoutCardEntry,
  LobbyView,
  MatchMode,
  OpenMatchView,
  PendingChoiceView,
  PlayerView,
  RelicCatalogEntry,
  ServerMessage,
} from "@multispire/shared";
import { Net } from "./net.js";
import { EXAMPLE_LOADOUT, EXAMPLE_LOADOUT_REGENT } from "./example-loadout.js";

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
  // Chosen hero/character to filter the catalog by ("" = unset, show all).
  hero: string;
  relics: string[];
  query: string;
  relicQuery: string;
  entries: BuilderEntry[];
}

interface UIState {
  screen: "join" | "lobby" | "game" | "deckbuilder" | "reference";
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
  // Cards currently selected in an open card-selection prompt (multi-pick).
  choiceSel: string[];
  // Card catalog (fetched once) and the in-progress deckbuilder state.
  catalog: CardCatalogEntry[] | null;
  relicCatalog: RelicCatalogEntry[] | null;
  builder: BuilderState;
  // A deck built in the deckbuilder, used as the loadout on join.
  deckDraft: Loadout | null;
  // Open games advertised on the homepage (polled while on the join screen).
  openMatches: OpenMatchView[];
  // Decklists the player has used before, remembered across sessions.
  savedDecks: Loadout[];
}

function emptyBuilder(): BuilderState {
  return { name: "", maxHp: "", hero: "", relics: [], query: "", relicQuery: "", entries: [] };
}

// --- persistence: remember the player's name and previously-used decklists ---
const NAME_KEY = "ms_name";
const DECKS_KEY = "ms_decks";
const MAX_SAVED_DECKS = 12;

function loadSavedName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || "";
  } catch {
    return "";
  }
}

function saveName(name: string): void {
  try {
    if (name.trim()) localStorage.setItem(NAME_KEY, name.trim());
  } catch {
    /* storage unavailable — non-fatal */
  }
}

function loadSavedDecks(): Loadout[] {
  try {
    const raw = localStorage.getItem(DECKS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as Loadout[]) : [];
  } catch {
    return [];
  }
}

function persistSavedDecks(): void {
  try {
    localStorage.setItem(DECKS_KEY, JSON.stringify(ui.savedDecks.slice(0, MAX_SAVED_DECKS)));
  } catch {
    /* storage unavailable — non-fatal */
  }
}

// Remember a decklist the player just used. Newest first; de-duplicated by name
// (or exact contents when unnamed) so repeated joins don't pile up copies.
function rememberDeck(l: Loadout): void {
  if (!l.deck || !l.deck.length) return;
  const key = (d: Loadout) => (d.name?.trim() ? `n:${d.name.trim().toLowerCase()}` : `j:${JSON.stringify(d.deck)}`);
  const k = key(l);
  ui.savedDecks = [l, ...ui.savedDecks.filter((d) => key(d) !== k)].slice(0, MAX_SAVED_DECKS);
  persistSavedDecks();
}

function deleteSavedDeck(idx: number): void {
  ui.savedDecks.splice(idx, 1);
  persistSavedDecks();
  render();
}

function useSavedDeck(l: Loadout): void {
  ui.deckDraft = l;
  ui.loadoutText = "";
  render();
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
  choiceSel: [],
  catalog: null,
  relicCatalog: null,
  builder: emptyBuilder(),
  deckDraft: null,
  openMatches: [],
  savedDecks: loadSavedDecks(),
};

net.connect();
net.on(onMessage);

// --- open-games list: poll the homepage feed while sitting on the join screen ---
async function refreshOpenMatches(): Promise<void> {
  try {
    const res = await fetch("/api/matches");
    const list = (await res.json()) as OpenMatchView[];
    const changed = JSON.stringify(list) !== JSON.stringify(ui.openMatches);
    ui.openMatches = list;
    if (changed && ui.screen === "join") render();
  } catch {
    /* network hiccup — keep the last list */
  }
}
void refreshOpenMatches();
setInterval(() => {
  if (ui.screen === "join") void refreshOpenMatches();
}, 4000);

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
      // Chime only on the transition into being able to act (not on every update).
      const me = msg.view.players.find((p) => p.id === msg.view.youId);
      const minePriority =
        msg.view.phase === "action" &&
        (msg.view.yoloPriority ? !!me && !me.passed : msg.view.priorityId === msg.view.youId);
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

// -------------------------------------------------------------- reference

// Fetch the card + relic catalogs once (shared by the deckbuilder and reference).
async function ensureCatalogs(): Promise<void> {
  if (!ui.catalog) {
    try {
      ui.catalog = (await (await fetch("/api/cards")).json()) as CardCatalogEntry[];
    } catch {
      ui.error = "Couldn't load the card list.";
      ui.catalog = [];
    }
  }
  if (!ui.relicCatalog) {
    try {
      ui.relicCatalog = (await (await fetch("/api/relics")).json()) as RelicCatalogEntry[];
    } catch {
      ui.relicCatalog = [];
    }
  }
}

const REFERENCE_HERO_ORDER = ["ironclad", "silent", "regent", "defect", "necrobinder", "neutral"];

// Plain-text dump of the loadout format + every card and relic id, made to paste
// into another LLM for generating decks.
function referenceText(): string {
  const cards = (ui.catalog ?? []).filter((c) => c.supported !== false);
  const relics = [...(ui.relicCatalog ?? [])].sort((a, b) => a.name.localeCompare(b.name));
  const out: string[] = [];
  out.push("# Multispire deck / loadout reference");
  out.push("");
  out.push("## Loadout JSON format");
  out.push(
    JSON.stringify(
      {
        name: "My Deck",
        character: "ironclad",
        maxHp: 75,
        relics: ["burning_blood"],
        deck: [{ id: "strike_r", count: 5 }, { id: "bash", count: 1, upgraded: true }, "defend_r"],
      },
      null,
      2,
    ),
  );
  out.push("");
  out.push("Rules:");
  out.push("- `deck` is required. Each entry is either a bare card id string (= 1");
  out.push("  copy, not upgraded) or an object { id, count?, upgraded? }.");
  out.push("- `relics`, `maxHp` (default 75), `character` (hero filter only), and");
  out.push("  `name` are optional.");
  out.push("- Use ONLY the ids listed below. Unknown ids are ignored on import.");
  out.push("- `count` is the number of copies; `upgraded: true` for the + version.");
  out.push("");
  out.push(`## Cards (${cards.length})   format: id | name | type | cost`);
  for (const ch of REFERENCE_HERO_ORDER) {
    const list = cards.filter((c) => c.character === ch).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    out.push("");
    out.push(`### ${ch}`);
    for (const c of list) {
      const cost = c.cost === "X" ? "X" : String(c.cost);
      out.push(`${c.id} | ${c.name} | ${c.type} | ${cost}${c.upgradable ? " | upgradable" : ""}`);
    }
  }
  out.push("");
  out.push(`## Relics (${relics.length})   format: id | name`);
  for (const r of relics) out.push(`${r.id} | ${r.name}`);
  return out.join("\n");
}

async function openReference(): Promise<void> {
  await ensureCatalogs();
  ui.screen = "reference";
  render();
}

function renderReference(): void {
  const text = referenceText();
  const wrap = el(`
    <div class="builder reference">
      <div class="builder-head">
        <div class="builder-titlerow">
          <button id="refBack" class="ghost">← Back</button>
          <h1>Card &amp; relic reference</h1>
          <button id="refCopy" class="primary">📋 Copy all</button>
        </div>
        <p class="muted small">Everything another LLM needs to generate a loadout: the JSON format plus every card and relic id. Copy it and paste it into your model.</p>
      </div>
      <textarea id="refText" class="refbox" rows="28" readonly>${escape(text)}</textarea>
    </div>`);
  wrap.querySelector("#refBack")!.addEventListener("click", () => {
    ui.screen = "join";
    render();
  });
  wrap.querySelector("#refCopy")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      flashNotice("Copied the reference to your clipboard.");
    } catch {
      const ta = wrap.querySelector("#refText") as HTMLTextAreaElement;
      ta.select();
      document.execCommand("copy");
      flashNotice("Copied the reference.");
    }
  });
  app.appendChild(wrap);
}

// -------------------------------------------------------------- deckbuilder

async function openDeckbuilder(): Promise<void> {
  await ensureCatalogs();
  // Seed the builder from an existing draft so "Edit" round-trips cleanly.
  if (ui.deckDraft) {
    ui.builder = {
      name: ui.deckDraft.name ?? "",
      maxHp: ui.deckDraft.maxHp != null ? String(ui.deckDraft.maxHp) : "",
      hero: ui.deckDraft.character ?? "",
      relics: [...(ui.deckDraft.relics ?? [])],
      query: "",
      relicQuery: "",
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
  refreshBuilder();
}

function changeCount(id: string, upgraded: boolean, delta: number): void {
  const e = ui.builder.entries.find((x) => x.id === id && x.upgraded === upgraded);
  if (!e) return;
  e.count += delta;
  if (e.count <= 0) ui.builder.entries = ui.builder.entries.filter((x) => x !== e);
  refreshBuilder();
}

function setEntryUpgraded(id: string, fromUpgraded: boolean, upgraded: boolean): void {
  const e = ui.builder.entries.find((x) => x.id === id && x.upgraded === fromUpgraded);
  if (!e) return;
  const moved = e.count;
  ui.builder.entries = ui.builder.entries.filter((x) => x !== e);
  const target = ui.builder.entries.find((x) => x.id === id && x.upgraded === upgraded);
  if (target) target.count += moved;
  else ui.builder.entries.push({ id, upgraded, count: moved });
  refreshBuilder();
}

function deckCount(): number {
  return ui.builder.entries.reduce((s, e) => s + e.count, 0);
}

// A short breakdown of the in-progress deck: total plus per-type counts, and a
// note when cards from another hero are mixed in (they still play fine, but it's
// usually unintended).
function deckSummaryText(): string {
  const total = deckCount();
  if (total === 0) return "Empty deck — click a card on the left to add it.";
  const byId = catalogById();
  const counts: Record<string, number> = { attack: 0, skill: 0, power: 0, status: 0, curse: 0 };
  let offHero = 0;
  const hero = ui.builder.hero;
  for (const e of ui.builder.entries) {
    const c = byId.get(e.id);
    if (c) {
      counts[c.type] = (counts[c.type] ?? 0) + e.count;
      if (hero && c.character !== hero && c.character !== "neutral") offHero += e.count;
    }
  }
  const parts = [`${total} card${total === 1 ? "" : "s"}`];
  for (const [type, label] of [
    ["attack", "Attack"],
    ["skill", "Skill"],
    ["power", "Power"],
    ["status", "Status"],
    ["curse", "Curse"],
  ] as const) {
    if (counts[type]) parts.push(`${counts[type]} ${label}${counts[type] === 1 ? "" : "s"}`);
  }
  let text = parts.join(" · ");
  if (offHero) text += ` · ⚠ ${offHero} off-hero card${offHero === 1 ? "" : "s"}`;
  return text;
}

function clearDeckEntries(): void {
  if (!ui.builder.entries.length) return;
  ui.builder.entries = [];
  refreshBuilder();
}

// Re-render only the live parts of the deckbuilder (card lists, relic widgets,
// counters) instead of rebuilding the whole screen. This preserves the scroll
// position of the catalog while you click "+ Add" repeatedly, and keeps search
// inputs focused. Falls back to a full render if we're not on the builder.
function refreshBuilder(): void {
  const catalogList = document.querySelector("#catalogList") as HTMLElement | null;
  const deckList = document.querySelector("#deckList") as HTMLElement | null;
  if (ui.screen !== "deckbuilder" || !catalogList || !deckList) {
    render();
    return;
  }
  const relicPicker = document.querySelector("#relicPicker") as HTMLElement | null;
  const relicChips = document.querySelector("#relicChips") as HTMLElement | null;
  const cs = catalogList.scrollTop;
  const ds = deckList.scrollTop;
  const rs = relicPicker?.scrollTop ?? 0;
  renderCatalogList(catalogList);
  renderDeckList(deckList);
  if (relicPicker) renderRelicPicker(relicPicker);
  if (relicChips) renderRelicChips(relicChips);
  catalogList.scrollTop = cs;
  deckList.scrollTop = ds;
  if (relicPicker) relicPicker.scrollTop = rs;
  // Update the various live counters and the disabled state of the Use buttons.
  const n = deckCount();
  for (const id of ["#deckCount", "#deckCountTop"]) {
    const node = document.querySelector(id);
    if (node) node.textContent = String(n);
  }
  const summary = document.querySelector("#deckSummary");
  if (summary) summary.textContent = deckSummaryText();
  const relicCount = document.querySelector("#relicCount");
  if (relicCount) relicCount.textContent = String(ui.builder.relics.length);
  for (const id of ["#useDeck", "#useDeckTop", "#clearDeck"]) {
    const btn = document.querySelector(id) as HTMLButtonElement | null;
    if (btn) btn.disabled = ui.builder.entries.length === 0;
  }
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
    ...(b.hero ? { character: b.hero } : {}),
    relics: [...b.relics],
    deck,
  };
}

function addRelic(id: string): void {
  const r = id.trim();
  if (!r || ui.builder.relics.includes(r)) return;
  ui.builder.relics.push(r);
  refreshBuilder();
}

function removeRelic(id: string): void {
  ui.builder.relics = ui.builder.relics.filter((r) => r !== id);
  refreshBuilder();
}

function toggleRelic(id: string): void {
  if (ui.builder.relics.includes(id)) removeRelic(id);
  else addRelic(id);
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
  const loadout = builderToLoadout();
  ui.deckDraft = loadout;
  ui.loadoutText = ""; // the draft takes precedence over any pasted JSON
  rememberDeck(loadout); // keep it in the saved-decks list for next time
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

// --- card-selection prompts (Headbutt / Warcry / Burning Pact) ---
// pick === 1: a click sends immediately. pick > 1: toggle a selection, then the
// player confirms once exactly `pick` cards are chosen.
function clickChoiceCard(uid: string, pick: number): void {
  if (pick <= 1) {
    ui.choiceSel = [];
    net.send({ t: "chooseCards", uids: [uid] });
    return;
  }
  const sel = ui.choiceSel;
  const i = sel.indexOf(uid);
  if (i !== -1) sel.splice(i, 1);
  else if (sel.length < pick) sel.push(uid);
  render();
}

function confirmChoice(): void {
  const g = ui.game;
  if (!g?.pendingChoice) return;
  if (ui.choiceSel.length !== g.pendingChoice.pick) return;
  const uids = ui.choiceSel.slice();
  ui.choiceSel = [];
  net.send({ t: "chooseCards", uids });
}

// Leave the finished match and return to the main menu. Reconnects with a fresh
// identity (the server detaches us from the old match) but keeps any deck the
// player built so they can jump straight into another game.
function backToMenu(): void {
  net.reset();
  ui.screen = "join";
  ui.playerId = null;
  ui.matchId = null;
  ui.lobby = null;
  ui.game = null;
  ui.targetingCardUid = null;
  ui.showDeck = false;
  ui.buildOf = null;
  hadPriority = false;
  lastSeenPlaySeq = 0;
  void refreshOpenMatches();
  render();
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
  if (ui.screen === "reference") return renderReference();
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
        <label>Name <input id="name" value="${escape(loadSavedName() || "Player")}" /></label>
        <label>Match code <input id="match" placeholder="(blank = create new)" /></label>
        <label>Mode
          <select id="mode">
            <option value="1v1">1v1</option>
            <option value="ffa">Free for all</option>
            <option value="yolo">YOLO priority</option>
          </select>
        </label>

        <div class="opengames">
          <div class="opengames-head">
            <span>Open games</span>
            <button id="refreshGames" type="button" class="ghost" title="Refresh">↻</button>
          </div>
          <div id="openList" class="openlist"></div>
        </div>

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
          <button id="openRef" type="button" class="buildlink">📋 Card &amp; relic id reference (for LLM deck generation)</button>
        </div>

        ${
          ui.savedDecks.length
            ? `<div class="saveddecks">
                 <div class="saveddecks-head"><span>Saved decks</span></div>
                 <div id="savedList" class="savedlist"></div>
               </div>`
            : ""
        }

        <details class="import" ${ui.loadoutText ? "open" : ""}>
          <summary>Import deck / loadout (paste JSON)</summary>
          <p class="muted small">Paste loadout JSON, or load a file. Leave blank to use the default Ironclad deck (or build one above).</p>
          <div class="import-actions">
            <button id="example" type="button">Load Ironclad example</button>
            <button id="exampleRegent" type="button">Load Regent example</button>
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
  wrap.querySelector("#openRef")?.addEventListener("click", () => void openReference());
  wrap.querySelector("#clearDraft")?.addEventListener("click", clearDeckDraft);

  const ta = wrap.querySelector("#loadout") as HTMLTextAreaElement;
  ta.addEventListener("input", () => (ui.loadoutText = ta.value));

  wrap.querySelector("#example")!.addEventListener("click", () => {
    ui.loadoutText = JSON.stringify(EXAMPLE_LOADOUT, null, 2);
    render();
  });
  wrap.querySelector("#exampleRegent")!.addEventListener("click", () => {
    ui.loadoutText = JSON.stringify(EXAMPLE_LOADOUT_REGENT, null, 2);
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
    saveName(name);
    if (loadout) rememberDeck(loadout);
    join(name, match || undefined, mode, loadout);
  });

  // Open-games list with click-to-join.
  const nameInput = wrap.querySelector("#name") as HTMLInputElement;
  const joinOpen = (matchId: string, mode: MatchMode) => {
    const name = nameInput.value.trim() || "Player";
    let loadout: Loadout | undefined = ui.deckDraft ?? undefined;
    if (!loadout && ui.loadoutText.trim()) {
      try {
        loadout = JSON.parse(ui.loadoutText);
      } catch {
        /* fall through with no loadout */
      }
    }
    saveName(name);
    if (loadout) rememberDeck(loadout);
    join(name, matchId, mode, loadout);
  };
  renderOpenList(wrap.querySelector("#openList") as HTMLElement, joinOpen);
  wrap.querySelector("#refreshGames")!.addEventListener("click", () => void refreshOpenMatches());

  const savedList = wrap.querySelector("#savedList") as HTMLElement | null;
  if (savedList) renderSavedDecks(savedList);

  app.appendChild(wrap);
}

// Previously-used decklists, with quick "Use" + delete. Remembered in localStorage.
function renderSavedDecks(container: HTMLElement): void {
  container.innerHTML = "";
  ui.savedDecks.forEach((d, idx) => {
    const label = d.name?.trim() || `Deck ${idx + 1}`;
    const cards = draftCardCount(d);
    const relics = (d.relics ?? []).length;
    const isActive = ui.deckDraft && JSON.stringify(ui.deckDraft) === JSON.stringify(d);
    const row = el(`
      <div class="savedrow ${isActive ? "active" : ""}">
        <span class="savedname">${escape(label)}</span>
        <span class="savedmeta">${cards} cards · ${relics} relics${d.maxHp ? ` · ${d.maxHp} HP` : ""}</span>
        <span class="savedbtns">
          <button class="usesaved primary" type="button">${isActive ? "✓ Selected" : "Use"}</button>
          <button class="delsaved ghost" type="button" title="Forget this deck">✕</button>
        </span>
      </div>`);
    row.querySelector(".usesaved")!.addEventListener("click", () => useSavedDeck(d));
    row.querySelector(".delsaved")!.addEventListener("click", () => deleteSavedDeck(idx));
    container.appendChild(row);
  });
}

function renderOpenList(container: HTMLElement, joinOpen: (matchId: string, mode: MatchMode) => void): void {
  container.innerHTML = "";
  if (!ui.openMatches.length) {
    container.appendChild(el(`<p class="muted small">No open games right now. Join / Create one above to host.</p>`));
    return;
  }
  for (const m of ui.openMatches) {
    const row = el(`
      <div class="gamerow">
        <span class="gamecode">${escape(m.matchId)}</span>
        <span class="gamemeta">${escape(m.hostName)} · ${m.mode} · ${m.playerCount}/${m.maxPlayers}</span>
        <button class="joingame primary" type="button">Join</button>
      </div>`);
    row.querySelector(".joingame")!.addEventListener("click", () => joinOpen(m.matchId, m.mode));
    container.appendChild(row);
  }
}

function draftCardCount(l: Loadout): number {
  return (l.deck ?? []).reduce((s, d) => s + (typeof d === "string" ? 1 : d.count ?? 1), 0);
}

function catalogById(): Map<string, CardCatalogEntry> {
  return new Map((ui.catalog ?? []).map((c) => [c.id, c]));
}

// The displayed cost of a card, using the upgraded cost when relevant (some
// cards, e.g. Barricade, get cheaper when upgraded).
function entryCost(c: CardCatalogEntry, upgraded: boolean): string {
  const cost = upgraded && c.upgradedCost != null ? c.upgradedCost : c.cost;
  return cost === "X" ? "X" : String(cost);
}

function renderDeckbuilder(): void {
  const b = ui.builder;
  const wrap = el(`
    <div class="builder">
      <div class="builder-head">
        <div class="builder-titlerow">
          <button id="back" class="ghost">← Back</button>
          <h1>Deckbuilder</h1>
          <button id="useDeckTop" class="primary" ${b.entries.length ? "" : "disabled"}>Use this deck (<span id="deckCountTop">${deckCount()}</span>)</button>
        </div>
        <div class="builder-meta">
          <label>Name <input id="bname" value="${escape(b.name)}" placeholder="Ironclad" /></label>
          <label>Hero
            <select id="bhero">
              ${heroOptions(b.hero)}
            </select>
          </label>
          <label>Max HP
            <span class="hpadjust">
              <button id="hpdown" class="ghost" title="−5">−</button>
              <input id="bhp" value="${escape(b.maxHp)}" placeholder="75" inputmode="numeric" />
              <button id="hpup" class="ghost" title="+5">+</button>
            </span>
          </label>
        </div>
        <div class="relicrow">
          <div class="relichead">
            <span class="reliclbl">Relics (<span id="relicCount">${b.relics.length}</span>) — click to toggle</span>
            <span class="relicadd">
              <input id="brelicSearch" class="search" value="${escape(b.relicQuery)}" placeholder="🔎 Search relics…" />
              <input id="brelic" class="search" placeholder="custom relic id…" />
              <button id="brelicAdd" class="ghost">+ Add</button>
            </span>
          </div>
          <div id="relicPicker" class="relicpicker"></div>
          <div id="relicChips" class="relicchips"></div>
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
        <span class="muted" id="deckSummary">${escape(deckSummaryText())}</span>
        <span class="foot-actions">
          <button id="clearDeck" class="ghost" title="Remove every card from the deck" ${b.entries.length ? "" : "disabled"}>🗑 Clear deck</button>
          <button id="copyJson" class="ghost" title="Copy this deck as JSON">📋 Copy JSON</button>
          <button id="dlJson" class="ghost" title="Download this deck as a .json file">⬇ Download</button>
          <button id="useDeck" class="primary" ${b.entries.length ? "" : "disabled"}>Use this deck</button>
        </span>
      </div>
    </div>`);

  // Text fields update state without a full re-render so focus is preserved.
  const bname = wrap.querySelector("#bname") as HTMLInputElement;
  bname.addEventListener("input", () => (b.name = bname.value));
  const bhero = wrap.querySelector("#bhero") as HTMLSelectElement;
  bhero.addEventListener("change", () => {
    b.hero = bhero.value;
    refreshBuilder();
  });
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

  const relicSearch = wrap.querySelector("#brelicSearch") as HTMLInputElement;
  const relicPicker = wrap.querySelector("#relicPicker") as HTMLElement;
  // Live-filter the relic picker in place (no full render) so search keeps focus.
  relicSearch.addEventListener("input", () => {
    b.relicQuery = relicSearch.value;
    renderRelicPicker(relicPicker);
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
  wrap.querySelector("#useDeckTop")!.addEventListener("click", useBuiltDeck);
  wrap.querySelector("#clearDeck")!.addEventListener("click", () => {
    if (deckCount() === 0) return;
    if (confirm(`Remove all ${deckCount()} cards from the deck?`)) clearDeckEntries();
  });
  wrap.querySelector("#copyJson")!.addEventListener("click", copyDeckJson);
  wrap.querySelector("#dlJson")!.addEventListener("click", downloadDeckJson);

  renderRelicPicker(wrap.querySelector("#relicPicker") as HTMLElement);
  renderRelicChips(wrap.querySelector("#relicChips") as HTMLElement);
  renderCatalogList(catalogList);
  renderDeckList(wrap.querySelector("#deckList") as HTMLElement);
  app.appendChild(wrap);
}

// The relic catalog as clickable toggles (selected ones are highlighted).
// A search box narrows the (now larger) pool; selected relics always stay
// visible so you never lose a pick behind the filter.
function renderRelicPicker(container: HTMLElement): void {
  container.innerHTML = "";
  const relics = ui.relicCatalog ?? [];
  if (!relics.length) {
    container.appendChild(el(`<span class="muted small">No relics available.</span>`));
    return;
  }
  const selected = new Set(ui.builder.relics);
  const q = ui.builder.relicQuery.trim().toLowerCase();
  const matches = relics.filter(
    (r) => selected.has(r.id) || !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q),
  );
  if (!matches.length) {
    container.appendChild(el(`<span class="muted small">No relics match “${escape(q)}”.</span>`));
    return;
  }
  for (const r of matches) {
    const on = selected.has(r.id);
    const node = el(`
      <button class="relicopt ${on ? "on" : ""}" title="${escape(r.description)}">
        <span class="relicoptname">${on ? "✓ " : ""}${escape(r.name)}</span>
        <span class="relicoptdesc">${escape(r.description)}</span>
      </button>`);
    node.addEventListener("click", () => toggleRelic(r.id));
    container.appendChild(node);
  }
}

// Chips for selected relics that aren't in the catalog (custom/free-text ids).
function renderRelicChips(container: HTMLElement): void {
  container.innerHTML = "";
  const known = new Set((ui.relicCatalog ?? []).map((r) => r.id));
  const custom = ui.builder.relics.filter((id) => !known.has(id));
  if (!custom.length) return;
  container.appendChild(el(`<span class="muted small">Custom:</span>`));
  for (const id of custom) {
    const chip = el(`<span class="relicchip">${escape(id)}<button class="rmrelic" title="Remove">✕</button></span>`);
    chip.querySelector(".rmrelic")!.addEventListener("click", () => removeRelic(id));
    container.appendChild(chip);
  }
}

// Pretty labels for the hero dropdown. Unset shows every card.
const HERO_LABELS: Record<string, string> = {
  ironclad: "Ironclad",
  silent: "Silent",
  regent: "Regent",
  defect: "Defect",
  necrobinder: "Necrobinder",
  watcher: "Watcher",
};

// Build the <option> list for the hero selector from the characters actually
// present in the catalog (plus an "Any hero" unset option).
function heroOptions(selected: string): string {
  const present = new Set<string>((ui.catalog ?? []).map((c) => c.character).filter((ch) => ch !== "neutral"));
  const order = ["ironclad", "silent", "regent", "defect", "necrobinder", "watcher"];
  const heroes = order.filter((h) => present.has(h));
  // Keep a previously-saved hero selectable even if its cards aren't in the
  // catalog yet, so the dropdown reflects the real state instead of silently
  // snapping to "Any hero".
  if (selected && selected !== "neutral" && !heroes.includes(selected)) heroes.push(selected);
  const opt = (val: string, label: string) =>
    `<option value="${val}" ${selected === val ? "selected" : ""}>${label}</option>`;
  return [opt("", "Any hero"), ...heroes.map((h) => opt(h, HERO_LABELS[h] ?? h))].join("");
}

function renderCatalogList(container: HTMLElement): void {
  container.innerHTML = "";
  const q = ui.builder.query.trim().toLowerCase();
  const hero = ui.builder.hero;
  const cards = (ui.catalog ?? []).filter(
    (c) =>
      // When a hero is set, show that hero's cards plus Colorless/Neutral; unset shows all.
      (!hero || c.character === hero || c.character === "neutral") &&
      (!q || c.name.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)),
  );
  if (!cards.length) {
    container.appendChild(el(`<p class="muted small">No cards match “${escape(ui.builder.query)}”.</p>`));
    return;
  }
  const inDeck = (id: string) =>
    ui.builder.entries.filter((e) => e.id === id).reduce((s, e) => s + e.count, 0);
  for (const c of cards) {
    const n = inDeck(c.id);
    if (c.supported === false) {
      // Partially-modeled cards are shown but can't be added, so it's clear they
      // aren't fully supported yet.
      const node = el(`
        <div class="catcard type-${c.type} unsupported" title="Not fully supported yet — disabled.">
          <span class="dcost">${c.cost === "X" ? "X" : c.cost}</span>
          <div class="catbody">
            <div class="catname">${escape(c.name)} <span class="unsupbadge">not supported</span></div>
            <div class="dtext">${escape(c.description)}</div>
          </div>
        </div>`);
      container.appendChild(node);
      continue;
    }
    const node = el(`
      <div class="catcard type-${c.type}">
        <span class="dcost">${c.cost === "X" ? "X" : c.cost}</span>
        <div class="catbody">
          <div class="catname">${escape(c.name)}${n ? ` <span class="indeck">×${n} in deck</span>` : ""}</div>
          <div class="dtext">${escape(c.description)}</div>
        </div>
        <div class="catadd">
          <button class="add" title="Add one copy">+ Add</button>
          ${
            c.upgradable
              ? `<button class="addup" title="${escape(c.upgradedDescription ?? "")}">+ Add⁺${
                  c.upgradedCost != null ? ` <span class="upcost">(${c.upgradedCost === "X" ? "X" : c.upgradedCost}⚡)</span>` : ""
                }</button>`
              : ""
          }
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
    const cost = c ? entryCost(c, e.upgraded) : "?";
    const node = el(`
      <div class="deckrow type-${c?.type ?? "skill"} ${e.upgraded ? "upgraded" : ""}">
        <span class="dcost">${cost}</span>
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
      <button id="leaveLobby" class="ghost">${isHost ? "← Cancel game" : "← Leave lobby"}</button>
    </div>`);
  wrap.querySelector("#start")?.addEventListener("click", startMatch);
  wrap.querySelector("#leaveLobby")!.addEventListener("click", backToMenu);
  app.appendChild(wrap);
}

function renderGame(): void {
  const g = ui.game!;
  const me = g.players.find((p) => p.id === g.youId)!;
  const enemies = g.players.filter((p) => p.id !== g.youId);
  // In YOLO mode there's no priority hand-off: you may act until you End Turn.
  const yourPriority =
    g.phase === "action" && (g.yoloPriority ? !me.passed : g.priorityId === g.youId);

  const board = el(`<div class="board"></div>`);

  // Banner
  let banner = "";
  if (g.phase === "gameover") {
    banner = g.winnerId === g.youId ? "🏆 You win!" : g.winnerId ? `${nameOf(g, g.winnerId)} wins` : "Game over";
  } else if (g.phase === "resolution") {
    banner = "Resolving…";
  } else if (g.yoloPriority) {
    const waiting = g.players.filter((p) => p.alive && !p.passed).map((p) => p.name);
    banner = me.passed
      ? `Turn locked — waiting on ${waiting.join(", ") || "resolution"}…`
      : ui.targetingCardUid
        ? "Pick a target"
        : "YOLO — play your cards, then End Turn";
  } else if (yourPriority) {
    banner = ui.targetingCardUid ? "Pick a target" : "Your priority";
  } else {
    banner = `Waiting on ${nameOf(g, g.priorityId)}…`;
  }
  board.appendChild(
    el(`<div class="banner ${yourPriority ? "active" : ""}">Turn ${g.turn} &middot; ${escape(banner)}</div>`),
  );

  // When the match is over, offer a clear way back to the main menu.
  if (g.phase === "gameover") {
    const gameover = el(`<div class="gameover"><button id="toMenu" class="primary">← Back to main menu</button></div>`);
    gameover.querySelector("#toMenu")!.addEventListener("click", backToMenu);
    board.appendChild(gameover);
  }

  // Battlefield: you on the left, foes on the right (Slay-the-Spire style).
  const field = el(`<div class="battlefield"></div>`);
  const youSide = el(`<div class="side you"></div>`);
  youSide.appendChild(avatar(g, me, true));
  const incoming = g.pendingAttacks.filter((a) => a.targetId === g.youId);
  if (incoming.length) {
    const total = incoming.reduce((s, a) => s + (a.amount ?? 0) * a.times, 0);
    youSide.appendChild(
      el(`<div class="incoming">⚔️ Incoming: <b>${total}</b> across ${incoming.length} attack(s)</div>`),
    );
  }
  field.appendChild(youSide);
  field.appendChild(el(`<div class="versus">vs</div>`));
  const foeSide = el(`<div class="side foes"></div>`);
  for (const e of enemies) foeSide.appendChild(avatar(g, e, false));
  field.appendChild(foeSide);
  board.appendChild(field);

  // Event log (scrollable history of what everyone has done this match)
  const logWrap = el(`<div class="logwrap"><div class="logtitle">Event log</div><div class="log" id="log"></div></div>`);
  const log = logWrap.querySelector("#log") as HTMLElement;
  for (const entry of g.log) log.appendChild(el(`<div class="logline ${logClass(entry.text)}">${escape(entry.text)}</div>`));
  board.appendChild(logWrap);

  // Your hand + controls, docked at the bottom.
  board.appendChild(dock(me, yourPriority));

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

  // Animate the most recent card play (a card flying up from the player).
  maybeAnimatePlay(g);

  // End-of-turn resolution summary (modal). Players dismiss it to advance.
  if (g.phase === "resolution" && g.resolution) {
    app.appendChild(resolutionModal(g, g.resolution));
  }

  // Card-selection prompt (Headbutt / Warcry / Burning Pact). Shown only to the
  // chooser; the engine is paused until they resolve it.
  if (g.pendingChoice) app.appendChild(choiceModal(g.pendingChoice));

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

function choiceModal(pc: PendingChoiceView): HTMLElement {
  const multi = pc.pick > 1;
  // Drop any stale selections (cards that are no longer eligible).
  ui.choiceSel = ui.choiceSel.filter((u) => pc.cards.some((c) => c.uid === u));
  const cards = pc.cards.length
    ? pc.cards
        .map((c) => {
          const sel = ui.choiceSel.includes(c.uid);
          return `<li class="deckcard choicecard type-${c.type} ${sel ? "chosen" : ""}" data-choice="${c.uid}">
              <span class="dcost">${c.cost === "X" ? "X" : c.cost}</span>
              <span class="dname">${escape(c.name)}${c.upgraded ? "+" : ""}</span>
              <span class="dtext">${escape(c.description)}</span>
            </li>`;
        })
        .join("")
    : `<li class="muted">no eligible cards</li>`;

  const confirmBar = multi
    ? `<div class="choicebar">
         <span class="muted small">Selected ${ui.choiceSel.length} / ${pc.pick}</span>
         <button id="confirmChoice" class="primary" ${ui.choiceSel.length === pc.pick ? "" : "disabled"}>Confirm</button>
       </div>`
    : `<p class="muted small">Click a card to choose.</p>`;

  const overlay = el(`
    <div class="overlay">
      <div class="modal wide">
        <h2>${escape(pc.prompt)}</h2>
        <ul class="decklist choicelist">${cards}</ul>
        ${confirmBar}
      </div>
    </div>`);
  overlay.querySelectorAll<HTMLElement>("[data-choice]").forEach((node) => {
    node.addEventListener("click", () => clickChoiceCard(node.dataset.choice!, pc.pick));
  });
  const confirm = overlay.querySelector("#confirmChoice");
  if (confirm) confirm.addEventListener("click", confirmChoice);
  return overlay;
}

function resolutionModal(g: GameView, r: NonNullable<GameView["resolution"]>): HTMLElement {
  const colorOf = (id: string) => g.players.find((p) => p.id === id)?.color ?? "var(--ink)";
  const nameTag = (id: string, name: string) =>
    `<span style="color:${colorOf(id)};font-weight:600">${escape(name)}</span>`;

  // Blocks first — they're applied before any attack lands. Show each defender's
  // running block total so the sources are clear.
  let blockSection = "";
  if (r.blocks.length) {
    const byPlayer = new Map<string, { name: string; running: number; rows: string[] }>();
    for (const b of r.blocks) {
      let g2 = byPlayer.get(b.playerId);
      if (!g2) {
        g2 = { name: b.playerName, running: 0, rows: [] };
        byPlayer.set(b.playerId, g2);
      }
      g2.running += b.amount;
      g2.rows.push(
        `<li class="resblock">
          <span class="resname block">${escape(b.cardName)}</span>
          <span class="resdmg">+${b.amount} → ${g2.running} block</span>
        </li>`,
      );
    }
    const groups = [...byPlayer.entries()]
      .map(
        ([id, gp]) =>
          `<div class="resblockgroup">
            <div class="resblockwho">${nameTag(id, gp.name)} <span class="muted">— ${gp.running} total block</span></div>
            <ul class="reslist">${gp.rows.join("")}</ul>
          </div>`,
      )
      .join("");
    blockSection = `<div class="ressection"><div class="resheading">🛡 Block raised</div>${groups}</div>`;
  }

  const attackRows = r.attacks.length
    ? r.attacks
        .map((a) => {
          const blocked =
            a.blockBefore > 0
              ? ` <span class="muted">(${a.blocked} blocked · block ${a.blockBefore}→${a.blockAfter})</span>`
              : a.blocked > 0
                ? ` <span class="muted">(${a.blocked} blocked)</span>`
                : "";
          const lethal = a.lethal ? ` <span class="lethal">☠ lethal</span>` : "";
          return `<li class="resatk">
            <span class="resname">${escape(a.cardName)}</span>
            <span>${nameTag(a.sourceId, a.sourceName)} → ${nameTag(a.targetId, a.targetName)}</span>
            <span class="resdmg">${a.damage}${a.times > 1 ? `×${a.times}` : ""} dmg · −${a.hpLost} HP${blocked}${lethal}</span>
          </li>`;
        })
        .join("")
    : `<li class="muted">No attacks landed this turn.</li>`;

  const deaths = r.deaths.length
    ? `<div class="resdeaths">☠ Defeated: ${r.deaths.map((d) => escape(d)).join(", ")}</div>`
    : "";

  // Grand totals — the at-a-glance summary of the whole turn.
  const totalHpLost = r.attacks.reduce((s, a) => s + a.hpLost, 0);
  const totalBlocked = r.attacks.reduce((s, a) => s + a.blocked, 0);
  const totalBlockRaised = r.blocks.reduce((s, b) => s + b.amount, 0);
  const youTook = r.attacks.filter((a) => a.targetId === g.youId).reduce((s, a) => s + a.hpLost, 0);
  const youDealt = r.attacks.filter((a) => a.sourceId === g.youId).reduce((s, a) => s + a.hpLost, 0);
  const totals = `
    <div class="restotals">
      <div class="restotal big dmg"><span class="rtnum">${totalHpLost}</span><span class="rtlbl">total HP lost</span></div>
      <div class="restotal you-took"><span class="rtnum">${youTook}</span><span class="rtlbl">you took</span></div>
      <div class="restotal you-dealt"><span class="rtnum">${youDealt}</span><span class="rtlbl">you dealt</span></div>
      <div class="restotal block"><span class="rtnum">${totalBlockRaised}</span><span class="rtlbl">block raised</span></div>
      <div class="restotal blocked"><span class="rtnum">${totalBlocked}</span><span class="rtlbl">dmg blocked</span></div>
      ${r.deaths.length ? `<div class="restotal kills"><span class="rtnum">${r.deaths.length}</span><span class="rtlbl">defeated</span></div>` : ""}
    </div>`;

  const overlay = el(`
    <div class="overlay">
      <div class="modal">
        <h2>Turn ${r.turn} resolved</h2>
        ${totals}
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

// A player's battlefield avatar: a colored square with a Block badge floating
// above its head, a name plate, an HP bar, and power badges below. For enemies
// this is the click target when picking an attack target.
// Visual styling for each Defect orb type (icon + colour).
const ORB_META: Record<string, { icon: string; bg: string; fg: string; name: string }> = {
  lightning: { icon: "⚡", bg: "#f4d03f", fg: "#222", name: "Lightning" },
  frost: { icon: "❄", bg: "#5dade2", fg: "#06263b", name: "Frost" },
  dark: { icon: "🌑", bg: "#7d3c98", fg: "#fff", name: "Dark" },
  plasma: { icon: "🔆", bg: "#e67e22", fg: "#3a1d00", name: "Plasma" },
  glass: { icon: "🔷", bg: "#aed6f1", fg: "#06263b", name: "Glass" },
};

function orbChips(p: PlayerView): string {
  if (!p.orbs.length) return "";
  const chips = p.orbs
    .map((o) => {
      const m = ORB_META[o.type] ?? { icon: "●", bg: "#888", fg: "#fff", name: o.type };
      const amt = (o.type === "dark" || o.type === "glass") && o.amount ? ` ${o.amount}` : "";
      return `<span class="orbchip" title="${m.name}${amt}" style="background:${m.bg};color:${m.fg}">${m.icon}${amt}</span>`;
    })
    .join("");
  return ` ${chips}`;
}

function avatar(g: GameView, p: PlayerView, isYou: boolean): HTMLElement {
  // Block "above the head". You see the exact number; opponents only reveal
  // whether they're blocking (fog of war), so show a shield with no count.
  let blockBadge = "";
  if (p.block != null) {
    if (p.block > 0) blockBadge = `<div class="blockbadge">🛡 ${p.block}</div>`;
  } else if (p.isBlocking) {
    blockBadge = `<div class="blockbadge unknown">🛡</div>`;
  }

  // For enemies, preview the damage your queued attacks will do to them.
  let hitBadge = "";
  if (!isYou) {
    const myHits = g.pendingAttacks.filter((a) => a.targetId === p.id && a.sourceId === g.youId);
    const myDmg = myHits.reduce((s, a) => s + (a.amount ?? 0) * a.times, 0);
    if (myDmg) hitBadge = `<div class="hitbadge">⚔️ ${myDmg}</div>`;
  }

  const initials = escape(p.name.slice(0, 2).toUpperCase());
  const energy = isYou ? `<div class="avenergy">⚡ ${p.energy ?? 0}/${p.maxEnergy}</div>` : "";
  // Regent second resources: Star Energy (hidden for opponents) and Forge (public).
  const stars = p.usesStars
    ? `<div class="avstars">✦ ${isYou ? (p.stars ?? 0) : "?"} Stars${p.forge ? ` · ⚒️ ${p.forge}` : ""}</div>`
    : "";

  // Defect orbs (public). Coloured chips, oldest on the left; Dark shows its charge.
  const orbs = p.usesOrbs ? `<div class="avorbs">🔮 ${p.orbs.length}/${p.orbSlots}${orbChips(p)}</div>` : "";

  // Necrobinder's Osty summon (public): show its current/max HP when alive.
  const osty = p.osty ? `<div class="avosty">💀 Osty ${p.osty.hp}/${p.osty.maxHp}</div>` : "";

  const node = el(`
    <div class="avatarbox ${isYou ? "you" : "foe"} ${p.alive ? "" : "dead"}" ${isYou ? "" : `data-enemy="${p.id}"`}>
      ${blockBadge}
      <div class="avatar" style="background:${p.color}">
        <span class="avinitials">${initials}</span>
        ${hitBadge}
      </div>
      <div class="nameplate">
        <span class="avname" style="color:${p.color}">${escape(p.name)}${isYou ? " (you)" : ""}${p.passed ? " 💤" : ""}</span>
        <button class="buildbtn ghost" title="View this player's deck & relics">🔍</button>
      </div>
      <div class="hpbar"><div class="hpfill" style="width:${(100 * p.hp) / p.maxHp}%"></div>
        <span>${p.hp}/${p.maxHp}</span></div>
      ${energy}
      ${stars}
      ${orbs}
      ${osty}
      <div class="powers">${powerBadges(p)}</div>
    </div>`);
  node.querySelector(".buildbtn")!.addEventListener("click", (ev) => {
    ev.stopPropagation();
    showBuild(p.id);
  });
  return node;
}

// The bottom dock: your hand of cards plus the action controls.
function dock(me: PlayerView, yourPriority: boolean): HTMLElement {
  const panel = el(`<div class="dock"></div>`);
  const hand = el(`<div class="hand"></div>`);
  for (const c of me.hand ?? []) {
    const card = el(`
      <div class="gamecard ${c.playable && yourPriority ? "playable" : "locked"} type-${c.type} ${
        ui.targetingCardUid === c.uid ? "selected" : ""
      }">
        <div class="cost">${c.cost === "X" ? "X" : c.cost}</div>
        ${c.starCost ? `<div class="starcost">✦${c.starCost}</div>` : ""}
        <div class="cname">${escape(c.name)}${c.upgraded ? "+" : ""}</div>
        <div class="ctext">${escape(c.description)}</div>
      </div>`);
    card.addEventListener("click", () => clickCard(c.uid, c));
    hand.appendChild(card);
  }
  panel.appendChild(hand);

  const controls = el(`<div class="controls"></div>`);
  const yolo = ui.game?.yoloPriority;
  const passLabel = yolo
    ? "🔒 End turn"
    : hasAnyPlay(me)
      ? "Pass priority"
      : "Pass (nothing to play)";
  const passBtn = el(`<button class="primary" ${yourPriority ? "" : "disabled"}>${passLabel}</button>`);
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

// ---- card-play animation: a card floats up from whoever played it ----
let lastSeenPlaySeq = 0;

function maybeAnimatePlay(g: GameView): void {
  const lp = g.lastPlay;
  if (!lp) return;
  if (lp.seq <= lastSeenPlaySeq) return;
  const firstSighting = lastSeenPlaySeq === 0;
  lastSeenPlaySeq = lp.seq;
  // Don't replay history on first load / reconnect — only animate fresh plays.
  if (firstSighting) return;
  spawnPlayFlyer(g, lp);
}

function spawnPlayFlyer(g: GameView, lp: NonNullable<GameView["lastPlay"]>): void {
  const player = g.players.find((p) => p.id === lp.playerId);
  const color = player?.color ?? "var(--gold)";
  // Anchor the flyer to the player's avatar if it's on screen, else a corner.
  const anchor = document.querySelector<HTMLElement>(
    lp.playerId === g.youId ? ".avatarbox.you" : `[data-enemy="${lp.playerId}"]`,
  );
  const flyer = el(
    `<div class="playflyer type-${lp.cardType}" style="border-color:${color}">${escape(lp.cardName)}</div>`,
  );
  document.body.appendChild(flyer);
  const rect = anchor?.getBoundingClientRect();
  const x = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const y = rect ? rect.top : window.innerHeight * 0.6;
  flyer.style.left = `${x}px`;
  flyer.style.top = `${y}px`;
  // Trigger the float-up animation on the next frame, then clean up.
  requestAnimationFrame(() => flyer.classList.add("fly"));
  setTimeout(() => flyer.remove(), 1200);
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
