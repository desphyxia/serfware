import { describe, expect, it } from "vitest";
import { CLIMATE_STEP, YEAR_DAYS } from "../src/sim/climate/climate";
import { ticksPerDay } from "../src/sim/clock";
import { World } from "../src/sim/world";

describe("hydrology", () => {
  it("rain gathers into rivers that run downhill, and some basins become lakes", () => {
    const w = new World("rivers-1", { size: "small" });
    const { hydro } = w.land;
    const rivers = Array.from({ length: w.planet.grid.count }, (_, t) => t).filter((t) => w.land.isRiver(t));
    expect(rivers.length).toBeGreaterThan(10);
    const e = w.planet.terrain.elevation;
    for (const t of rivers) {
      const to = hydro.flowTo[t]!;
      if (to >= 0) expect(e[to]!).toBeLessThanOrEqual(e[t]!);
    }
    // Lakes are water, not land.
    for (let t = 0; t < hydro.lake.length; t++) if (hydro.lake[t]) expect(w.land.isLand(t)).toBe(false);
  });
});

describe("climate", () => {
  it("seasons swing the temperature in opposite directions in each hemisphere", () => {
    const w = new World("seasons-1", { size: "tiny" });
    const c = w.climate;
    const year = ticksPerDay(w.planet.params.dayLengthHours) * YEAR_DAYS;
    const north: number[] = [];
    const south: number[] = [];
    for (let i = 0; i < 4; i++) {
      north.push(c.seasonalOffset((year * i) / 4, 0.7));
      south.push(c.seasonalOffset((year * i) / 4, -0.7));
    }
    expect(Math.max(...north) - Math.min(...north)).toBeGreaterThan(5);
    for (let i = 0; i < 4; i++) expect(Math.sign(north[i]!)).toBe(-Math.sign(south[i]!) || 0);
    expect(c.season(0, 0.5)).not.toBe(c.season(0, -0.5));
  });

  it("weather moves, rain makes mud and cold makes snow", () => {
    const w = new World("weather-1", { size: "small" });
    const before = w.climate.fronts.map((f) => f.x);
    let mud = 0;
    let rain = 0;
    for (let i = 0; i < 40; i++) {
      for (let k = 0; k < CLIMATE_STEP; k++) w.step();
      rain = Math.max(rain, ...w.climate.rain);
      mud = Math.max(mud, ...w.land.mud);
    }
    expect(w.climate.fronts.map((f) => f.x)).not.toEqual(before);
    expect(rain).toBeGreaterThan(0.2);
    expect(mud).toBeGreaterThan(0.1);
    // Somewhere cold enough there is snow on the ground.
    const land = w.land;
    for (let i = 0; i < 400; i++) for (let k = 0; k < CLIMATE_STEP; k++) w.step();
    let coldSnow = 0;
    for (let t = 0; t < land.snowCover.length; t++) if (w.climate.temp[t]! < -5 && land.isLand(t)) coldSnow = Math.max(coldSnow, land.snowCover[t]!);
    const anyCold = Array.from(w.climate.temp).some((x, t) => x < -5 && land.isLand(t));
    if (anyCold) expect(coldSnow).toBeGreaterThan(0);
  });

  it("the forecast is what then happens", () => {
    const w = new World("forecast-1", { size: "tiny" });
    const t = w.economy.buildings[w.economy.keep]!.tile;
    const f = w.climate.forecast(w.tick, t, 12);
    let wet = 0;
    const steps = Math.round((12 / 24) * (ticksPerDay(w.planet.params.dayLengthHours) / CLIMATE_STEP));
    for (let i = 0; i < steps; i++) {
      for (let k = 0; k < CLIMATE_STEP; k++) w.step();
      wet = Math.max(wet, w.climate.rain[t]!);
    }
    expect(Math.abs(wet - f.rain)).toBeLessThan(0.05);
  });

  it("farming tires the soil; fallow land recovers", () => {
    const w = new World("soil-1", { size: "tiny" });
    const land = w.land;
    const t = Array.from({ length: land.soil.length }, (_, i) => i).find((i) => land.isLand(i))!;
    const start = land.soil[t]!;
    land.soil[t] = 0.1;
    for (let i = 0; i < ticksPerDay(w.planet.params.dayLengthHours) * 3; i++) w.step();
    expect(land.soil[t]!).toBeGreaterThan(0.1);
    expect(land.soil[t]!).toBeLessThanOrEqual(Math.max(start, 1));
    expect(w.economy.fieldGrowthTicks(t)).toBeGreaterThan(0);
  });
});
