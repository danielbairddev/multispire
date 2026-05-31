// Central place for "we hit content we haven't defined yet" reporting.
// The goal: when a deck references a card/relic/power the engine doesn't know,
// emit a single, copy-pasteable message telling us exactly what to add and where.

type MissingKind = "card" | "relic" | "power" | "effect";

const FILE_FOR: Record<MissingKind, string> = {
  card: "server/src/game/cards/ironclad.ts",
  relic: "server/src/game/relics.ts",
  power: "server/src/game/powers.ts",
  effect: "server/src/game/engine.ts (effect interpreter)",
};

// De-dupe so logs aren't spammed for the same missing id every frame.
const seen = new Set<string>();

export function reportMissing(kind: MissingKind, id: string, context?: string): void {
  const key = `${kind}:${id}`;
  if (seen.has(key)) return;
  seen.add(key);
  const where = FILE_FOR[kind];
  console.error(
    `\n[MISSING ${kind.toUpperCase()}] id="${id}"` +
      (context ? ` (${context})` : "") +
      `\n  -> Define it in ${where}` +
      `\n  -> Until then this ${kind} is treated as a no-op so the match can continue.\n`,
  );
}

/** Reset the de-dupe set (used by tests). */
export function _resetMissing(): void {
  seen.clear();
}
