import { describe, expect, it } from "vitest";
import { SurfaceFrames } from "../src/render/frames";
import { Overlays } from "../src/render/overlays";
import { World } from "../src/sim/world";

describe("the tile-edge debug overlay", () => {
  it("draws every tile edge once, and can be switched on and off", () => {
    const w = new World("amber-fern-212", { size: "tiny" });
    const ov = new Overlays(w.land, new SurfaceFrames(w.planet, undefined as never));
    expect(ov.tileEdgesOn).toBe(false);
    ov.setTileEdges(true);
    expect(ov.tileEdgesOn).toBe(true);
    const lines = ov.group.children.find((c) => c.name === "tile-edges") as unknown as { geometry: { getAttribute(n: string): { count: number } } };
    // Tiles are the vertices of a triangulation, so the edges between tiles number half the sum of their degrees,
    // and each is a strip of two triangles (six vertices).
    const grid = w.planet.grid;
    let sides = 0;
    for (let t = 0; t < grid.count; t++) sides += grid.neighborsOf(t).length;
    expect(lines.geometry.getAttribute("position").count).toBe((sides / 2) * 6);
    ov.setTileEdges(false);
    expect(ov.tileEdgesOn).toBe(false);
  });
});
