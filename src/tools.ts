import { BUILDINGS, BUILDING_INDEX } from "./sim/econ/defs";
import type { Command } from "./sim/econ/economy";
import { Feature, Use } from "./sim/econ/landuse";
import type { World } from "./sim/world";
import type { Overlays } from "./render/overlays";
import type { ToolId } from "./ui/buildBar";
import type { Selection } from "./ui/infoPanel";
import { tr } from "./core/i18n";

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
  /** The side the next building's flag goes on changed (null: chosen automatically). */
  flagDirChanged(label: string | null): void;
}

/** Compass sectors for the flag direction, clockwise from north (see LandUse.neighborInDirection). */
export const FLAG_DIRS = [tr("north"), tr("north-east"), tr("south-east"), tr("south"), tr("south-west"), tr("north-west")];

/**
 * Turns hover and clicks into commands. Road building works like Serf City: start at a flag,
 * click where the road should end; the game finds the path, and keeps going from the new flag.
 */
export class Tools {
  tool: ToolId = "select";
  private roadStart = -1;
  private hover = -1;
  /** Touch placement: the tile the first tap put the ghost on, waiting for a second tap. -1 if none. */
  private pending = -1;
  private markerKey = "";
  private demolishArm = -1;
  private demolishTime = 0;
  /** Which side the flag of a building being placed goes on: -1 picks the best, else 0..5 (FLAG_DIRS). */
  private flagDir = -1;

  constructor(private readonly host: ToolHost) {}

  set(id: ToolId): void {
    this.tool = id;
    this.roadStart = -1;
    this.demolishArm = -1;
    this.markerKey = "";
    this.pending = -1;
    if (!this.isBuilding(id)) this.setFlagDir(-1);
    this.host.toolChanged(id);
    this.refresh();
  }

  cancel(): boolean {
    if (this.pending >= 0) {
      this.pending = -1;
      this.refresh();
      return true;
    }
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

  /** The tile the building ghost sits on: the one a touch tap chose, else the hovered one. */
  private at(): number {
    return this.pending >= 0 ? this.pending : this.hover;
  }

  /** Is a building in hand, so the flag direction can be turned? */
  placing(): boolean {
    return this.isBuilding(this.tool);
  }

  /** Can the building in hand stand on `t` with its flag on side `d` (-1: the game's pick)? */
  private sideWorks(t: number, d: number): boolean {
    const w = this.host.world();
    const land = w.land;
    const pl = this.host.player();
    const def = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
    if (!def) return false;
    const foothold = def.ferry !== undefined && land.territory[t] === 0;
    const f = d < 0 ? land.bestFlagTile(t, pl, foothold) : land.neighborInDirection(t, d);
    const existing = w.economy.flagAt(f);
    return f >= 0 && land.canBuildDef(t, f, def, pl) && !(existing && existing.building >= 0);
  }

  /**
   * Turn the flag to the next (step 1) or previous (-1) side that works on the hovered tile,
   * skipping sides that don't; "auto" sits before north.
   */
  rotateFlag(step: number): void {
    if (!this.placing()) return;
    const n = FLAG_DIRS.length + 1;
    // With no spot under the pointer (a phone, before the tap) there is nothing to check yet.
    if (this.at() < 0) {
      this.setFlagDir((((this.flagDir + 1 + step) % n) + n) % n - 1);
      return;
    }
    const land = this.host.world().land;
    const pl = this.host.player();
    const def = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
    const foothold = def?.ferry !== undefined && land.territory[this.at()] === 0;
    const flagOf = (d: number) => (d < 0 ? land.bestFlagTile(this.at(), pl, foothold) : land.neighborInDirection(this.at(), d));
    const here = flagOf(this.flagDir);
    for (let i = 1; i < n; i++) {
      const d = ((((this.flagDir + 1 + step * i) % n) + n) % n) - 1;
      // A side that lands on the same tile as the current one is no change.
      if (flagOf(d) === here || !this.sideWorks(this.at(), d)) continue;
      this.setFlagDir(d);
      this.refresh();
      return;
    }
    this.host.notify("The flag can only go on one side here.", "info");
  }

  private setFlagDir(d: number): void {
    this.flagDir = d;
    this.markerKey = "";
    this.host.flagDirChanged(d < 0 ? null : (FLAG_DIRS[d] as string));
  }

  /** Where the flag of a building on `t` would stand: the chosen side, or the best spot. */
  private flagTileFor(t: number, pl: number, foothold: boolean): number {
    const land = this.host.world().land;
    return this.flagDir < 0 ? land.bestFlagTile(t, pl, foothold) : land.neighborInDirection(t, this.flagDir);
  }

  hoverTile(t: number): void {
    if (t === this.hover) return;
    this.hover = t;
    this.refresh();
  }

  /** Why the building in hand can't go on the hovered tile, or null (also null for other tools). */
  hoverBlocker(): string | null {
    if (this.at() < 0 || !this.isBuilding(this.tool)) return null;
    const def = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
    if (!def) return null;
    const land = this.host.world().land;
    const pl = this.host.player();
    const foothold = def.ferry !== undefined && land.territory[this.at()] === 0;
    return land.buildBlocker(this.at(), def, pl, foothold, this.flagDir < 0 ? -1 : this.flagTileFor(this.at(), pl, foothold));
  }

  private isBuilding(id: ToolId): boolean {
    return BUILDING_INDEX.has(id);
  }

  /** Update previews, ghosts and placement markers for the current tool and hover tile. */
  refresh(): void {
    const w = this.host.world();
    const land = w.land;
    const ov = this.host.overlays();
    const t = this.at();
    ov.setPreview(null, false);
    ov.setGhost(null, -1, -1, false);
    ov.setAnchor(this.tool === "road" ? this.roadStart : -1);

    const pl = this.host.player();
    const key = `${this.tool}:${this.flagDir}:${pl}:${land.useVersion}:${land.featureVersion}:${land.territoryVersion}:${land.causewayVersion}`;
    if (key !== this.markerKey) {
      this.markerKey = key;
      const tiles: number[] = [];
      if (this.tool === "flag" || this.isBuilding(this.tool)) {
        const def = this.isBuilding(this.tool) ? BUILDINGS[BUILDING_INDEX.get(this.tool) as number] : undefined;
        for (let i = 0; i < land.territory.length; i++) {
          const free = def?.ferry !== undefined && land.territory[i] === 0;
          if (land.territory[i] !== pl + 1 && !free) continue;
          if (def ? land.canBuildDef(i, this.flagTileFor(i, pl, free), def, pl) : land.canPlaceFlag(i, pl) && land.use[i] !== Use.Road) tiles.push(i);
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
      const flagTile = this.flagTileFor(t, pl, def?.ferry !== undefined && land.territory[t] === 0);
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

  click(t: number, touch = false): void {
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
        // Touch has no hover: the first tap shows the ghost (turn its flag with the Flag button),
        // a second tap on the same spot places it.
        if (touch && this.pending !== t) {
          this.pending = t;
          this.refresh();
          const why = this.hoverBlocker();
          if (why) this.host.notify(why, "warn");
          return;
        }
        const bdef = BUILDINGS[BUILDING_INDEX.get(this.tool) as number];
        const foothold = bdef?.ferry !== undefined && land.territory[t] === 0;
        const flagTile = this.flagTileFor(t, pl, foothold);
        const why = bdef ? land.buildBlocker(t, bdef, pl, foothold, this.flagDir < 0 ? -1 : flagTile) : null;
        if (flagTile < 0 || why) {
          this.host.notify(why ?? "No room for this building's flag here.", "warn");
          return;
        }
        if (this.host.command({ t: "build", type: this.tool, tile: t, flagTile })) {
          this.pending = -1;
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
