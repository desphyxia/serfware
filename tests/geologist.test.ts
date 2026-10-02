import { describe, expect, it } from "vitest";
import { Deposit, SMALL_DEPOSIT } from "../src/sim/econ/landuse";
import { World } from "../src/sim/world";

const SEEDS = ["chain-geo", "russet-heron-417", "amber-fern-212", "glade-iris-904", "lantern-moss-55", "tidal-oak-808"];

function keepFlagTile(w: World): number {
  const keep = w.economy.buildings[w.economy.keep]!;
  return w.economy.flags[keep.flag]!.tile;
}

describe("geologists (Serf City's rules)", () => {
  it("won't go where there is no mountain in reach, and signs show how rich a deposit is", () => {
    let refused = 0;
    let surveyed = 0;
    let smallSeen = 0;
    let largeSeen = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "tiny" });
      const tile = keepFlagTile(w);
      const near = w.land.ring(tile, 4).some((t) => w.land.surveyable(t));
      const r = w.command({ t: "geologist", flagTile: tile });
      if (!near) {
        expect(r.ok).toBe(false);
        expect((r as { reason?: string }).reason).toMatch(/Nothing to survey/);
        refused++;
        continue;
      }
      expect(r.ok).toBe(true);
      surveyed++;
      for (let i = 0; i < 6000; i++) w.step();
      const land = w.land;
      let found = 0;
      for (let t = 0; t < land.sign.length; t++) {
        if (!land.sign[t]) continue;
        // Every signpost stands on ground worth surveying, and says small only for a small deposit.
        expect(land.surveyable(t)).toBe(true);
        const dep = land.deposit[t] as number;
        expect(land.signSmall[t]).toBe(dep !== Deposit.None && (land.depositAmount[t] as number) < SMALL_DEPOSIT ? 1 : 0);
        if (dep !== Deposit.None) found++;
        if (land.signSmall[t]) smallSeen++;
        else if (dep !== Deposit.None) largeSeen++;
      }
      // Notices come once per find of an ore, not once per signpost.
      const ore = (w.economy.notices as { text: string }[]).filter((n) => /^Geologist found/.test(n.text)).length;
      expect(ore).toBeLessThanOrEqual(found);
    }
    expect(surveyed).toBeGreaterThan(0);
    // Both sizes turn up (deposits hold 14 to 50 loads).
    expect(smallSeen).toBeGreaterThan(0);
    expect(largeSeen).toBeGreaterThan(0);
    expect(refused + surveyed).toBe(SEEDS.length);
  }, 120000);

  it("a flag on flat ground far from any mountain is refused", () => {
    let tried = 0;
    for (const seed of SEEDS) {
      const w = new World(seed, { size: "small" });
      const land = w.land;
      const keep = w.economy.buildings[w.economy.keep]!;
      const tile = land.ring(keep.tile, 12).find((t) => land.territory[t] === 1 && land.canPlaceFlag(t, 0) && !land.ring(t, 4).some((n) => land.surveyable(n)));
      if (tile === undefined) continue;
      expect(w.command({ t: "flag", tile }).ok).toBe(true);
      const r = w.command({ t: "geologist", flagTile: tile });
      expect(r.ok).toBe(false);
      expect((r as { reason?: string }).reason).toMatch(/Nothing to survey/);
      expect(w.economy.check({ t: "geologist", flagTile: tile })).toMatch(/Nothing to survey/);
      tried++;
    }
    expect(tried).toBeGreaterThan(0);
  }, 120000);

  it("a find is announced once while the same ore is already marked nearby", () => {
    const w = new World("chain-geo", { size: "tiny" });
    const land = w.land;
    const eco = w.economy;
    // Mark one coal deposit by hand, as if found, then survey: no second notice for coal beside it.
    const coal = Array.from({ length: land.deposit.length }, (_, t) => t).filter((t) => land.deposit[t] === Deposit.Coal);
    expect(coal.length).toBeGreaterThan(1);
    const a = coal[0] as number;
    const close = coal.find((t) => t !== a && land.ring(a, 5).includes(t));
    if (close === undefined) throw new Error("no close coal pair on this seed");
    land.sign[a] = Deposit.Coal + 1;
    const before = eco.notices.length;
    // The next sample lands beside an existing sign of the same ore.
    const s = { owner: 0, state: "inspect", timer: 1, path: [close], pi: 0, visits: 0, id: 0, home: close } as unknown as Parameters<typeof stepGeologist>[1];
    stepGeologist(eco, s);
    expect(land.sign[close]).toBe(Deposit.Coal + 1);
    expect(eco.notices.length).toBe(before);
  });
});

function stepGeologist(eco: unknown, s: unknown): void {
  (eco as { stepGeologist(s: unknown): void }).stepGeologist(s);
}
