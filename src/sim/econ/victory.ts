import type { Economy } from "./economy";
import { COMBAT } from "./defs";

/** How a match can be won. "both" (the default) is conquest or the Star Wells; "all" adds Prosperity and Influence. */
export type VictoryRule = "both" | "conquest" | "wells" | "prosperity" | "influence" | "all";

export type WinReason = "conquest" | "wells" | "bloom" | "prosperity" | "influence";

/** What the winner is told. */
export const WIN_TEXT: Record<WinReason, string> = {
  wells: "The Star Wells sing for you. Victory!",
  conquest: "The last rival Hearthship has fallen. Victory!",
  bloom: "Your colony has bloomed first. Victory!",
  prosperity: "Your people have made more than any could count. Victory!",
  influence: "Most of the hamlets have joined your light. Victory!",
};

/** The banner line for the winner. */
export const WIN_BANNER: Record<WinReason, string> = {
  wells: "Victory: the Star Wells sing for you.",
  conquest: "Victory: the last rival Hearthship has fallen.",
  bloom: "Victory: your colony bloomed first.",
  prosperity: "Victory: your settlement prospered beyond all others.",
  influence: "Victory: the hamlets have chosen your light.",
};


export interface SummaryRow {
  player: number;
  name: string;
  /** "won", "won with the winner" (allied), "fell", or "" while still standing. */
  outcome: "won" | "ally" | "fallen" | "";
  made: number;
  hamlets: number;
  wells: number;
  captured: number;
  buildings: number;
  people: number;
}

export interface Summary {
  over: boolean;
  winner: number;
  reason: WinReason | "";
  days: number;
  rows: SummaryRow[];
  /** Targets the victory races measure against. */
  goods: number;
  hamletsTotal: number;
  wellsTotal: number;
}

/** The end-of-game numbers for every settlement. */
export function summarize(eco: Economy): Summary {
  const grid = eco.land.planet.grid;
  const held: number[] = [];
  let wellsTotal = 0;
  for (let t = 0; t < grid.count; t++) {
    if (grid.degree(t) !== 5) continue;
    wellsTotal++;
    const o = eco.land.territory[t] as number;
    if (o) held[o - 1] = (held[o - 1] ?? 0) + 1;
  }
  const rows: SummaryRow[] = [];
  eco.keeps.forEach((keep, player) => {
    if (keep === undefined) return;
    const won = eco.winner === player;
    rows.push({
      player,
      name: eco.playerName(player),
      outcome: won ? "won" : eco.winner >= 0 && eco.allied(player, eco.winner) ? "ally" : eco.defeated[player] ? "fallen" : "",
      made: eco.made[player] ?? 0,
      hamlets: eco.wanderers.hamlets.filter((h) => h.joined === player).length,
      wells: held[player] ?? 0,
      captured: eco.captured[player] ?? 0,
      buildings: eco.buildings.filter((b) => b.alive && b.built && b.owner === player).length,
      people: eco.people.filter((x) => x.alive && x.owner === player).length,
    });
  });
  const end = eco.winTick >= 0 ? eco.winTick : eco.tick;
  return {
    over: eco.winner >= 0,
    winner: eco.winner,
    reason: eco.winReason,
    days: Math.floor(end / eco.dayTicks),
    rows,
    goods: COMBAT.prosperityGoods,
    hamletsTotal: eco.wanderers.hamlets.length,
    wellsTotal,
  };
}
