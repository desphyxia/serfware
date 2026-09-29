import { COMBAT } from "./defs";
import { ARM_BLADE, ARM_BOW, ARM_MOUNT } from "./people";

/**
 * Combat arithmetic, kept free of state so the odds preview and the duels use the same numbers.
 * Fights are duels at the door of a lantern building: one attacker against one defender.
 */

export function rankTitle(rank: number): string {
  return COMBAT.ranks[Math.max(0, Math.min(COMBAT.ranks.length - 1, rank))] ?? "Watcher";
}

export interface Fighter {
  rank: number;
  arms: number;
  /** 0 fresh .. 1 exhausted from marching. */
  fatigue: number;
}

/** Strength of a fighter. `resolve` comes from the settlement, `ground` favours defenders. */
export function strength(f: Fighter, resolve: number, ground: number): number {
  return (1 + 0.35 * f.rank) * (f.arms & ARM_BLADE ? 1.35 : 1) * (f.arms & ARM_MOUNT ? 1.08 : 1) * resolve * (1 - 0.35 * f.fatigue) * ground;
}

/** Chance that the attacker wins a single duel. */
export function duelChance(attacker: number, defender: number): number {
  const a = attacker * attacker;
  const d = defender * defender;
  return a / (a + d);
}

/** Chance that one bow wounds one opponent in a volley. */
export const VOLLEY_HIT = 0.35;

export function hasBow(f: Fighter): boolean {
  return (f.arms & ARM_BOW) !== 0;
}

/** Fatigue after marching `steps` tiles. Mounts halve it. */
export function fatigueFor(steps: number, arms: number): number {
  return Math.min(1, (steps / 40) * (arms & ARM_MOUNT ? 0.5 : 1));
}

/**
 * Estimated chance of taking a building: attackers fight in order, each winner stays at the
 * door for the next duel. Computed exactly by dynamic programming over (attacker, defender).
 * Volleys are folded in as expected losses.
 */
export function captureOdds(attackers: number[], defenders: number[], attackerBows = 0, defenderBows = 0): number {
  if (!defenders.length) return attackers.length ? 1 : 0;
  if (!attackers.length) return 0;
  // Expected volley losses, rounded down so the preview doesn't oversell.
  const d = defenders.slice(Math.min(defenders.length - 1, Math.floor(attackerBows * VOLLEY_HIT)));
  const a = attackers.slice(Math.min(attackers.length, Math.floor(defenderBows * VOLLEY_HIT)));
  if (!a.length) return 0;
  // p[i][j]: chance attackers win when attacker i faces defender j.
  const memo = new Map<number, number>();
  const win = (i: number, j: number): number => {
    if (j >= d.length) return 1;
    if (i >= a.length) return 0;
    const key = i * 1000 + j;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const p = duelChance(a[i] as number, d[j] as number);
    const v = p * win(i, j + 1) + (1 - p) * win(i + 1, j);
    memo.set(key, v);
    return v;
  };
  return win(0, 0);
}
