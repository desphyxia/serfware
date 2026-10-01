import { goodId } from "../econ/defs";
import { demoSettlement } from "../econ/planner";
import type { World } from "../world";
import type { ScenarioDef } from "./scenario";

/** The curated world of The Long Voyage: a temperate planet with river valleys, hills and coast. */
export const LANTERNE = "lanterne";

/** A head start for later chapters: the Hearthship's stores topped up. */
function stores(w: World, goods: Record<string, number>): void {
  const keep = w.economy.buildings[w.economy.keeps[0] ?? -1];
  if (!keep) return;
  for (const [g, n] of Object.entries(goods)) keep.stock[goodId(g)] = (keep.stock[goodId(g)] as number) + n;
}

/** A settlement already under way (sites laid out, materials in store). */
function underway(w: World, goods: Record<string, number> = {}): void {
  demoSettlement(w);
  stores(w, { plank: 30, stone: 30, log: 20, bread: 20, fish: 10, ...goods });
}

export const TUTORIAL: ScenarioDef = {
  id: "tutorial",
  kind: "tutorial",
  title: "First steps",
  blurb: "Learn to build a settlement, one step at a time.",
  seed: LANTERNE,
  opts: { size: "small", difficulty: "gentle", rivals: 0 },
  sequential: true,
  intro:
    "Your Hearthship has come down on Lanterne. Its people are ready to build, but everything moves along roads: each building has a flag at its door, and carriers hand goods from flag to flag.\n\nFollow the goals on the left. Each one says which tool to use.",
  goals: [
    { text: "Place a flag", when: { k: "flags", n: 2 }, tool: "flag", hint: "Pick Flag (1) and click open ground near the Hearthship." },
    { text: "Build a woodcutter by the trees", when: { k: "build", type: "woodcutter" }, tool: "materials", hint: "Open Materials (3), pick Woodcutter and click a green spot near trees." },
    { text: "Connect it with a road", when: { k: "roads", n: 2 }, tool: "road", hint: "With Road (2), click the new flag, then the Hearthship's flag. Carriers start at once." },
    { text: "Build a quarry by the rocks", when: { k: "build", type: "quarry" }, tool: "materials", hint: "Materials (3): Quarry, next to grey rocks." },
    { text: "Build a sawmill", when: { k: "build", type: "sawmill" }, tool: "materials", hint: "Materials (3): Sawmill turns logs into planks, which most buildings need." },
    { text: "Build a house", when: { k: "build", type: "house" }, tool: "storage", hint: "Homes (6): House. Homes let more people settle and lift Glow." },
    { text: "Light a lantern to widen your border", when: { k: "lit", n: 1 }, tool: "lantern", hint: "Lanterns (7): Lantern near your border. A warden walks out and lights it." },
  ],
  outro: "Well done: your settlement can stand on its own. Try The Long Voyage next, or a scenario.",
};

const ch = (n: number, def: Omit<ScenarioDef, "kind" | "chapter" | "seed" | "id">): ScenarioDef => ({ ...def, id: `voyage-${n}`, kind: "chapter", chapter: n, seed: LANTERNE });

/** The Long Voyage: twelve chapters on Lanterne, from landfall to a second world in bloom. */
export const VOYAGE: ScenarioDef[] = [
  ch(1, {
    title: "Landfall",
    blurb: "The first chains: wood, stone, planks.",
    opts: { size: "medium", difficulty: "gentle" },
    intro: "After the long crossing the Hearthship rests on Lanterne at last. Before anything else, the settlement needs wood, stone and planks, and roads to carry them.",
    goals: [
      { text: "Build two woodcutters", when: { k: "build", type: "woodcutter", n: 2 } },
      { text: "Build a quarry", when: { k: "build", type: "quarry" } },
      { text: "Build a sawmill", when: { k: "build", type: "sawmill" } },
      { text: "Build a forester to replant", when: { k: "build", type: "forester" } },
      { text: "Store 20 planks", when: { k: "stock", good: "plank", n: 20 } },
    ],
    outro: "Chapter 1 complete. The yards are busy; now the people need feeding.",
  }),
  ch(2, {
    title: "Bread and Fish",
    blurb: "Feed the settlement before winter.",
    opts: { size: "medium", difficulty: "gentle" },
    setup: (w) => stores(w, { plank: 25, stone: 20 }),
    intro: "The stores of the crossing are running low. Fields, a mill and an oven, and boats on the water: the settlement must feed itself.",
    goals: [
      { text: "Build a farm", when: { k: "build", type: "farm" } },
      { text: "Build a mill and a bakery", when: { k: "all", of: [{ k: "build", type: "mill" }, { k: "build", type: "bakery" }] } },
      { text: "Build a fisher", when: { k: "build", type: "fisher" } },
      { text: "Store 15 bread", when: { k: "stock", good: "bread", n: 15 } },
    ],
    triggers: [{ when: { k: "day", n: 3 }, do: [{ a: "say", text: "The evenings are drawing in. The elders say the first frost is not far off." }] }],
    outro: "Chapter 2 complete. Nobody goes hungry on Lanterne.",
  }),
  ch(3, {
    title: "Hands and Homes",
    blurb: "Houses, newcomers and a happier people.",
    opts: { size: "medium", difficulty: "gentle" },
    setup: (w) => underway(w),
    intro: "Word of the landing has spread to those who stayed aboard in the cold sleep. They will wake and come ashore, if there are homes for them and the settlement looks like a good place to live.",
    goals: [
      { text: "Build four houses", when: { k: "build", type: "house", n: 4 } },
      { text: "Grow to 50 people", when: { k: "people", n: 50 } },
      { text: "Raise Glow to 60", when: { k: "glow", n: 60 } },
    ],
    outro: "Chapter 3 complete. The village is filling with voices.",
  }),
  ch(4, {
    title: "The Tools of Living",
    blurb: "Mines, a smelter and a toolsmith.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w),
    intro: "Every new trade needs a tool, and the tools from the ship are wearing out. Send a geologist into the hills, dig coal and iron, and set up a forge.",
    goals: [
      { text: "Build a coal mine", when: { k: "build", type: "coalmine" } },
      { text: "Build an iron mine", when: { k: "build", type: "ironmine" } },
      { text: "Build a smelter", when: { k: "build", type: "smelter" } },
      { text: "Build a toolsmith", when: { k: "build", type: "toolsmith" } },
      { text: "Store 5 iron", when: { k: "stock", good: "iron", n: 5 } },
    ],
    outro: "Chapter 4 complete. The forge rings day and night.",
  }),
  ch(5, {
    title: "Lanterns in the Dark",
    blurb: "Push the border out across the valley.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w, { plank: 20, stone: 25 }),
    intro: "Beyond the light of the Hearthship the valley is wild. Every lantern a warden lights claims the land around it. Light the way along the river.",
    goals: [
      { text: "Light four lanterns", when: { k: "lit", n: 4 } },
      { text: "Hold 400 tiles of land", when: { k: "land", n: 400 } },
      { text: "Win over a hamlet in the wild", when: { k: "hamlet" } },
    ],
    outro: "Chapter 5 complete. The valley is yours from ridge to river.",
  }),
  ch(6, {
    title: "Wardens",
    blurb: "A rival arrives. Hold your ground.",
    opts: { size: "medium", difficulty: "honest", rivals: 1, personalities: ["warden"], peaceDays: 3 },
    setup: (w) => underway(w, { blade: 6, bow: 4 }),
    intro: "Another ship has come down on Lanterne, and its people are Wardens: they trust strength. Train wardens, arm them, and make sure your Hearthship still stands when the peace ends.",
    goals: [
      { text: "Raise three wardens to rank 1", when: { k: "wardens", rank: 1, n: 3 } },
      { text: "Build a weaponsmith", when: { k: "build", type: "weaponsmith" } },
      { text: "Stand for twelve days", when: { k: "day", n: 12 } },
    ],
    fail: { when: { k: "defeated", player: 0 }, text: "Your Hearthship has fallen. Chapter 6 failed: try again with more wardens on the frontier." },
    triggers: [{ when: { k: "day", n: 2 }, do: [{ a: "say", text: "Scouts report the Wardens drilling on their side of the valley. The peace will not hold much longer." }] }],
    outro: "Chapter 6 complete. The Wardens have learned to leave you be.",
  }),
  ch(7, {
    title: "The Almanac",
    blurb: "Learn the ways of the world, and celebrate.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w),
    intro: "Lanterne is not the world the ancestors knew. Watch its weather, its seasons and its stars, write down what you learn, and hold a festival when the calendar allows.",
    goals: [
      { text: "Fill six pages of the Almanac", when: { k: "pages", n: 6 } },
      { text: "Learn to hold a festival", when: { k: "page", id: "festival" } },
      { text: "Raise Glow to 70", when: { k: "glow", n: 70 } },
    ],
    outro: "Chapter 7 complete. The Almanac grows thick with notes and sketches.",
  }),
  ch(8, {
    title: "Hard Seasons",
    blurb: "Floods, blight and frost. Keep the people well.",
    opts: { size: "medium", difficulty: "hard" },
    setup: (w) => underway(w, { bread: 20 }),
    intro: "The elders read the signs: a run of hard seasons is coming. Floods by the river, blight in the fields, a frost to crack stone. Prepare, and keep Glow up through it all.",
    goals: [
      { text: "Come through ten days", when: { k: "day", n: 10 } },
      { text: "Keep at least 40 people", when: { k: "all", of: [{ k: "day", n: 10 }, { k: "people", n: 40 }] } },
      { text: "Build two wells against fire", when: { k: "build", type: "well", n: 2 } },
    ],
    triggers: [
      { when: { k: "day", n: 1 }, do: [{ a: "event", kind: "coldsnap", hours: 30 }] },
      { when: { k: "day", n: 4 }, do: [{ a: "event", kind: "blight", hours: 20 }] },
      { when: { k: "day", n: 7 }, do: [{ a: "event", kind: "flood", hours: 20 }] },
    ],
    outro: "Chapter 8 complete. Whatever Lanterne throws at you, you endure.",
  }),
  ch(9, {
    title: "Neighbours",
    blurb: "Truce and trade with two other settlements.",
    opts: { size: "medium", difficulty: "honest", rivals: 2, personalities: ["trader", "builder"], peaceDays: 6 },
    setup: (w) => underway(w),
    intro: "Two more ships have landed: a town of Traders downriver and a quiet people of Builders in the hills. Make peace, open trade, and share the roads (Diplomacy, J).",
    goals: [
      { text: "Agree a truce", when: { k: "treaty", kind: "truce" } },
      { text: "Agree a trade pact", when: { k: "treaty", kind: "trade" } },
      { text: "Agree to share roads", when: { k: "treaty", kind: "roads" } },
    ],
    outro: "Chapter 9 complete. Three settlements, one valley, and goods moving between them.",
  }),
  ch(10, {
    title: "The Sky Above",
    blurb: "A launch rail, and a probe to another world.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w, { plank: 40, stone: 40, iron: 20, gold: 6 }),
    intro: "At night the other planets of the system cross Lanterne's sky. Build a launch rail and send a probe to one of them (the star system, O).",
    goals: [
      { text: "Build a launch rail", when: { k: "build", type: "launchrail" } },
      { text: "Send a probe to another planet", when: { k: "probe" } },
    ],
    outro: "Chapter 10 complete. The probe's signal comes back across the dark: another world, waiting.",
  }),
  ch(11, {
    title: "Hearthfall",
    blurb: "Found a colony on another world.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w, { plank: 60, stone: 60, iron: 30, gold: 10, bread: 30 }),
    intro: "Pack a Hearthship with your boldest people and the goods to start again, and send it to the world the probe found. Then help the colony take root.",
    goals: [
      { text: "Land a Hearthship on another planet", when: { k: "colony" } },
      { text: "Help the colony take root", when: { k: "rooted" } },
    ],
    outro: "Chapter 11 complete. Lanterne has a daughter world.",
  }),
  ch(12, {
    title: "Bloom",
    blurb: "Terraform the colony until it blooms.",
    opts: { size: "medium", difficulty: "honest" },
    setup: (w) => underway(w, { plank: 80, stone: 80, iron: 40, gold: 12, bread: 40 }),
    intro: "The last chapter: make the new world live. Mirrors, greenhouses, comets and seeding: change its air, its water and its ground until it blooms.",
    goals: [
      { text: "Found a colony", when: { k: "colony" } },
      { text: "Bring the colony's world to bloom", when: { k: "bloom" } },
    ],
    outro: "The Long Voyage is complete. A second world breathes, and it began with one Hearthship on Lanterne.",
  }),
];

/** Handmade scenarios: one situation, one challenge. */
export const SCENARIOS: ScenarioDef[] = [
  {
    id: "long-winter",
    kind: "scenario",
    title: "The Long Winter",
    blurb: "Hard frosts on a cold world. Keep everyone alive for twelve days.",
    seed: "frost-hollow-31",
    opts: { size: "small", difficulty: "hard" },
    setup: (w) => stores(w, { bread: 15, log: 30, plank: 20 }),
    intro: "You came down late in the year on a cold world. Frost after frost is coming. Feed your people, keep them warm and housed, and get them through.",
    goals: [
      { text: "Come through twelve days", when: { k: "day", n: 12 } },
      { text: "With at least 35 people", when: { k: "all", of: [{ k: "day", n: 12 }, { k: "people", n: 35 }] } },
    ],
    triggers: [
      { when: { k: "day", n: 1 }, do: [{ a: "event", kind: "coldsnap", hours: 24 }] },
      { when: { k: "day", n: 5 }, do: [{ a: "event", kind: "coldsnap", hours: 24 }] },
      { when: { k: "day", n: 9 }, do: [{ a: "event", kind: "coldsnap", hours: 24 }] },
    ],
    outro: "Spring at last. Every one of them made it through.",
  },
  {
    id: "rival-valley",
    kind: "scenario",
    title: "Rival Valley",
    blurb: "One valley, two settlements. Only one Hearthship will still stand.",
    seed: "rival-valley-5",
    opts: { size: "small", difficulty: "honest", rivals: 1, personalities: ["warden"], aiLevel: "hard", peaceDays: 2 },
    setup: (w) => stores(w, { blade: 4, bow: 2 }),
    intro: "A hard-handed Warden settlement shares your valley, and it will not share for long. Arm, expand and take its Hearthship before it takes yours.",
    goals: [{ text: "Take the Wardens' Hearthship", when: { k: "defeated", player: 1 } }],
    fail: { when: { k: "defeated", player: 0 }, text: "Your Hearthship has fallen to the Wardens." },
    outro: "The valley is yours.",
  },
  {
    id: "traders-road",
    kind: "scenario",
    title: "The Traders' Road",
    blurb: "Win over two Trader towns with pacts and shared roads.",
    seed: "amber-fern-212",
    opts: { size: "small", difficulty: "gentle", rivals: 2, personalities: ["trader", "trader"], peaceDays: 20 },
    intro: "Two Trader towns sit on the old road through these hills. They deal with those they trust. Earn a good name, sign pacts with both, and make your people the happiest on the road.",
    goals: [
      { text: "A trade pact with a Trader town", when: { k: "treaty", kind: "trade" } },
      { text: "Shared roads", when: { k: "treaty", kind: "roads" } },
      { text: "Raise Glow to 70", when: { k: "glow", n: 70 } },
    ],
    outro: "Caravans go back and forth along the road, and your name is good in every town.",
  },
  {
    id: "star-wells",
    kind: "scenario",
    title: "Race for the Star Wells",
    blurb: "Three settlements, twelve Star Wells. Hold three.",
    seed: "glade-iris-904",
    opts: { size: "small", difficulty: "honest", rivals: 2, personalities: ["builder", "warden"], peaceDays: 4 },
    intro: "The ancients' Star Wells sing when a settlement holds them. Two rivals want them too. Push your lanterns out and hold three wells at once.",
    goals: [{ text: "Hold three Star Wells", when: { k: "wells", n: 3 } }],
    fail: { when: { k: "defeated", player: 0 }, text: "Your Hearthship has fallen." },
    outro: "Three Star Wells sing for you.",
  },
];

export const ALL_SCENARIOS: ScenarioDef[] = [TUTORIAL, ...VOYAGE, ...SCENARIOS];

export function scenarioById(id: string): ScenarioDef | undefined {
  return ALL_SCENARIOS.find((s) => s.id === id);
}

/** The seed and world options a scenario is played with. */
export function scenarioWorld(id: string): { seed: string; opts: import("../world").WorldOptions } | null {
  const def = scenarioById(id);
  return def ? { seed: def.seed, opts: { ...def.opts, scenario: id } } : null;
}
