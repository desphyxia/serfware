import { BUILDINGS, BUILDING_INDEX } from "./sim/econ/defs";
import type { Command } from "./sim/econ/economy";
import { Feature, Use } from "./sim/econ/landuse";
import type { World } from "./sim/world";
import type { Overlays } from "./render/overlays";
import type { ToolId } from "./ui/buildBar";
import type { Selection } from "./ui/infoPanel";

/** Open ground where a hedgerow can be planted. */
function hedgeable(land: World["land"], t: number): boolean {
  return land.isLand(t) && land.use[t] === Use.Free && (land.feature[t] === Feature.None || land.feature[t] === Feature.Shrub) && land.planet.grid.degree(t) === 6;
}

export interface ToolHost {
  world(): World;
  /** The player this machine builds for. */
  player(): number;
  overlays(): Overlays;
  command(cmd: Command): boolean;
  notify(text: string, kind?: "info" | "warn" | "good"): void;
  select(sel: Selection): void;
  toolChanged(id: ToolId): void;
}

/**
 * Turns hover and clicks into commands. Road building works like Serf City: start at a flag,
 * click where the road should end; the game finds the path, and keeps going from the new flag.
 */
export class Tools {
  tool: ToolId = "select";
  private roadStart = -1;
  private hover = -1;
  private markerKey = "";
  private demolishArm = -1;
  private demolishTime = 0;

  constructor(private readonly host: ToolHost) {}

  set(id: ToolId): void {
    this.tool = id;
    this.roadStart = -1;
    this.demolishArm = -1;
    this.markerKey = "";
    this.host.toolChanged(id);
    this.refresh();
  }

  cancel(): boolean {
    if (this.tool === "road" && this.roadStart >= 0) {
      this.roadStart = -1;
      this.refresh();
      return true;
    }
    if (this.tool !== "select") {
      this.set("select");
      return true;
    }
    return false;
  }

  hoverTile(t: number): void {
    if (t === this.hover) return;
    this.hover = t;
    this.refresh();
  }

  /** Why the building in hand can't go on the hovered tile, or null (also null for other tools). */
  hoverBlocker(): string | null {
    if (this.hover < 0 || !this.isBuilding(this.tool)) return null;
    const def = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
    if (!def) return null;
    const land = this.host.world().land;
    return land.buildBlocker(this.hover, def, this.host.player(), def.ferry !== undefined && land.territory[this.hover] === 0);
  }

  private isBuilding(id: ToolId): boolean {
    return BUILDING_INDEX.has(id);
  }

  /** Update previews, ghosts and placement markers for the current tool and hover tile. */
  refresh(): void {
    const w = this.host.world();
    const land = w.land;
    const ov = this.host.overlays();
    const t = this.hover;
    ov.setPreview(null, false);
    ov.setGhost(null, -1, -1, false);

    const pl = this.host.player();
    const key = `${this.tool}:${pl}:${land.useVersion}:${land.featureVersion}:${land.territoryVersion}:${land.causewayVersion}`;
    if (key !== this.markerKey) {
      this.markerKey = key;
      const tiles: number[] = [];
      if (this.tool === "flag" || this.isBuilding(this.tool)) {
        const def = this.isBuilding(this.tool) ? BUILDINGS[BUILDING_INDEX.get(this.tool) as number] : undefined;
        for (let i = 0; i < land.territory.length; i++) {
          const free = def?.ferry !== undefined && land.territory[i] === 0;
          if (land.territory[i] !== pl + 1 && !free) continue;
          if (def ? land.canBuildDef(i, land.bestFlagTile(i, pl, free), def, pl) : land.canPlaceFlag(i, pl) && land.use[i] !== Use.Road) tiles.push(i);
        }
      } else if (this.tool === "hedge") {
        for (let i = 0; i < land.territory.length; i++) if (land.territory[i] === pl + 1 && hedgeable(land, i)) tiles.push(i);
      } else if (this.tool === "bridge") {
        for (let i = 0; i < land.territory.length; i++) if (land.territory[i] === pl + 1 && land.bridgeBlocked(i, pl) === null) tiles.push(i);
      } else if (this.tool === "causeway") {
        for (let i = 0; i < land.territory.length; i++) if (land.territory[i] === pl + 1 && land.tidal[i] && !land.causeway[i] && land.use[i] !== Use.Building) tiles.push(i);
      }
      ov.setMarkers(tiles, this.tool === "flag" ? "#f0d08a" : this.tool === "hedge" ? "#8fd07a" : this.tool === "causeway" ? "#c8c0b0" : this.tool === "bridge" ? "#d8b878" : "#b8f08c");
    }
    if (t < 0) return;

    if (this.tool === "flag") {
      ov.setGhost("flag", t, -1, land.canPlaceFlag(t, pl));
    } else if (this.isBuilding(this.tool)) {
      const def = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
      const flagTile = land.bestFlagTile(t, pl, def?.ferry !== undefined && land.territory[t] === 0);
      const eco = w.economy;
      const existing = eco.flagAt(flagTile);
      const ok = flagTile >= 0 && !!def && land.canBuildDef(t, flagTile, def, pl) && !(existing && existing.building >= 0);
      ov.setGhost(this.tool, t, flagTile, ok);
    } else if (this.tool === "road" && this.roadStart >= 0 && t !== this.roadStart) {
      const path = this.roadPath(this.roadStart, t);
      if (path) ov.setPreview(path, w.economy.checkRoad(path, pl) === null);
    }
  }

  private roadPath(from: number, to: number): number[] | null {
    const land = this.host.world().land;
    const pl = this.host.player();
    return land.findPath(from, to, (x) => land.roadable(x, pl), 2500);
  }

  click(t: number): void {
    const w = this.host.world();
    const land = w.land;
    const eco = w.economy;
    const pl = this.host.player();
    if (t < 0) return;
    switch (this.tool) {
      case "select": {
        const ref = land.ref[t] as number;
        const u = land.use[t];
        if (u === Use.Building) this.host.select({ kind: "building", id: ref });
        else if (u === Use.Flag) this.host.select({ kind: "flag", id: ref });
        else if (u === Use.Road) this.host.select({ kind: "road", id: ref });
        else this.host.select(null);
        return;
      }
      case "flag":
        if (this.host.command({ t: "flag", tile: t })) this.refresh();
        return;
      case "hedge":
        if (this.host.command({ t: "hedge", tile: t })) this.refresh();
        return;
      case "causeway":
        if (this.host.command({ t: "causeway", tile: t })) this.refresh();
        return;
      case "bridge":
        if (this.host.command({ t: "bridge", tile: t })) this.refresh();
        return;
      case "road": {
        if (this.roadStart < 0) {
          if (land.use[t] === Use.Flag) this.roadStart = t;
          else if (land.use[t] === Use.Building) {
            const b = eco.buildingAt(t);
            if (b) this.roadStart = (eco.flags[b.flag] as { tile: number }).tile;
          } else if (land.canPlaceFlag(t, pl)) {
            if (this.host.command({ t: "flag", tile: t })) this.roadStart = t;
          } else this.host.notify("Start a road at a flag.", "warn");
          this.refresh();
          return;
        }
        if (t === this.roadStart) return;
        const path = this.roadPath(this.roadStart, t);
        if (!path) {
          this.host.notify("No way through there.", "warn");
          return;
        }
        const err = eco.checkRoad(path, pl);
        if (err) {
          this.host.notify(err, "warn");
          return;
        }
        if (this.host.command({ t: "road", tiles: path })) {
          // Keep drawing from the new end, unless we reached the existing network.
          const endFlag = eco.flagAt(t);
          const joined = endFlag && endFlag.roads.length > 1;
          this.roadStart = joined ? -1 : t;
        }
        this.refresh();
        return;
      }
      case "demolish": {
        const now = performance.now();
        if (land.use[t] === Use.Free || land.use[t] === Use.Blocked) {
          // Hedgerows are grubbed up, and ancient giants marked (or spared) at once.
          if (land.feature[t] === Feature.Hedge || land.feature[t] === Feature.Giant) {
            if (this.host.command({ t: "demolish", tile: t })) this.refresh();
            return;
          }
          this.host.notify(land.feature[t] === Feature.Tree ? "Trees are felled by woodcutters." : "Nothing to demolish here.", "warn");
          return;
        }
        if (this.demolishArm === t && now - this.demolishTime < 2500) {
          this.host.command({ t: "demolish", tile: t });
          this.demolishArm = -1;
          this.refresh();
        } else {
          this.demolishArm = t;
          this.demolishTime = now;
          this.host.notify("Click again to demolish.", "info");
        }
        return;
      }
      default: {
        if (!this.isBuilding(this.tool)) return;
        const bdef = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
        const foothold = bdef?.ferry !== undefined && land.territory[t] === 0;
        const flagTile = land.bestFlagTile(t, pl, foothold);
        const why = bdef ? land.buildBlocker(t, bdef, pl, foothold) : null;
        if (flagTile < 0 || why) {
          this.host.notify(why ?? "No room for this building's flag here.", "warn");
          return;
        }
        if (this.host.command({ t: "build", type: this.tool, tile: t, flagTile })) {
          const name = BUILDINGS[BUILDING_INDEX.get(this.tool) as number]?.name ?? "Building";
          // Flow into road building from the new flag, unless it already touches the network.
          const flag = eco.flagAt(flagTile);
          if (flag && flag.roads.length === 0) {
            this.set("road");
            this.roadStart = flagTile;
            this.host.notify(`${name} site placed. Now draw a road to it.`, "good");
          } else this.host.notify(`${name} site placed.`, "good");
          this.refresh();
        }
      }
    }
  }
}
