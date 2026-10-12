/**
 * Behaviours that are off unless a harness switches them on, so the AI plays as before by default.
 * `relocateQuarries`: a quarry with no rock left in reach stops counting against the quarry quota and is
 * pulled down (its worker and tool go back to the pool), and new quarries are looked for farther out.
 * `stoneFallback`: when the rock inside the border is nearly used up, start on granite (a geologist, a mine) before
 * the stores are bare, and push the border toward rock outside it.
 * `foodByNeed`: while the food in the warehouses runs under a day's need, keep adding food buildings (one at a time,
 * up to a cap that grows with the population) past the fixed opening quotas.
 * `stonePriority`: no new houses while there is room for everyone, and, with stone nearly gone, none of the wants that
 * spend it on comforts and side projects (wells, flowerbeds, benches, sea, works, biome and terra), so food, lanterns and
 * the basic chains get what stone there is.
 * `borderReach`: lanterns for the border are only tried on tiles the Hearthship's land reaches (by land or bridge), with at
 * least BORDER_FREE free tiles of that land within 5: a tile across water cannot be joined by road, and a border try on one
 * is wasted. A seat with no such tile counts as land-locked, which is what lets it turn to the sea.
 * `borderClear`: when a border try placed nothing and a tree is what stands in the way (on the tile, on every spot for its
 * flag, or across the road to it), build a woodcutter within reach of that tree: at most BORDER_CUTS of them, a day apart.
 * `toolsByDemand`: the toolsmith's priorities follow demand: a tool is made only while a workplace or site that needs it has
 * none in the stores (and one spare of hammer, axe, pick, scythe and rod is kept), instead of topping every tool up to the
 * same stock, which spent the little iron there is on picks, saws and tongs that nobody waited for.
 * `oreMines`: see `EconPlanner` (ai/economy.ts): geologists do not wait for a toolsmith (a hammer in the stores is enough)
 * and go on while a kind the settlement wants shows no usable sign, starting from the flags with the most surveyable
 * ground near them; an exhausted mine is pulled down and no longer counts against its quota; and a coal or iron mine is
 * allowed for every ORE_PER_BUILT buildings.
 * `releaseStalled`: a seat stopped at the sites cap pulls down the site that has had no material delivered or used for
 * STALL_DAYS (the delivered goods are lost) and does not place that kind of building again for SHUN_DAYS, so a site that
 * waits for something that never comes (a flowerbed for its log) no longer holds the builder, and with it the land-use
 * step (geologists, mines, smelter), shut for the rest of the game.
 * `toolsmithAnyway`: the builder wants its toolsmith once a sawmill stands and 8 buildings are placed, with a quarry standing
 * or, if not, at least TOOLSMITH_STONE stone in the stores. Before, a standing quarry was required, and with the rock gone
 * and the quarry pulled down a seat never built one.
 * `forgeRoom`: the smelter, goldsmith, bowyer and stable are looked for within 9 steps of the Hearthship, as before, and,
 * when that ring has no room, within 9 steps of a few lit lanterns (a different few on each try). The 9 steps round the
 * Hearthship fill with the first buildings, and a seat with ore and no room for a smelter never makes iron.
 * `surveyAgain` (needs `oreMines`): when three tries in a row to place a coal, iron, gold or granite mine on the remembered
 * signs fail, those signs are forgotten (except any within reach of a mine that still works), so the geologists see the kind
 * as lacking and survey again; not again for 120 thoughts. Remembered signs count as found, and a seat whose signs have no
 * tile a mine can stand on (no flag spot, a field or tree, no road) otherwise retries them for the rest of the game.
 * `graniteFirst` (needs `oreMines`, for the signs it remembers and the tiles it tries): granite mines are wanted whether or
 * not stone is short, 1 + one for every 30 buildings, at most 3 at once (an exhausted mine does not count), and the
 * geologists look for a granite sign while that quota has none. Before, one granite mine was wanted only while the stores held
 * under 8 stone (and `relieveStone` placed up to two when stone ran bare), so a seat that had stone for a day built none.
 * `turnBuildings`: a building is placed with the best of its flag sides, as a player turns it with the mouse wheel, instead of
 * the flattest one: every side it can have is planned (the new road to the network, the distance to the buildings it trades
 * with, the height step) and the cheapest taken, the default side winning ties (planner.ts `placeOn`). A large building also
 * fits on tiles where only another side leaves its other neighbours clear.
 * `widePlacement`: when the 9 steps round the Hearthship (or the lantern a building is tried round) hold no spot for a building,
 * the search goes on round up to three lit lanterns and then over the seat's own land out to 16 steps from the Hearthship
 * (planner.ts `placeConnected`), so a launch rail, a smelter or a farm is no longer lost to a full ring. The first search is
 * unchanged.
 * `borderCandidates`: the border lanterns are tried on the frontier tiles where a lantern fits (a flag side it can stand on),
 * not on the first 40 of the list sorted by unclaimed land lit, which on a wooded or hilly border are mostly tiles a tree or a
 * slope rules out while usable tiles lie further down (#150).
 * `woodByNeed`: while the stores hold under WOOD_SHORT planks and under WOOD_SHORT logs, the builder adds a woodcutter (a forester
 * for every three), one at a time, a pause of WOOD_GAP thoughts between orders, up to a number that grows with the finished
 * buildings; the woodcutters were otherwise added only when 6 adults stood idle, so wood grew with unemployment, not demand (#150).
 * `reserveRail`: once a seat has 15 finished buildings and no launch rail, the voyage planner picks a site for it (the tile and the
 * ring round it that a large building needs, within WIDE_REACH of the keep) and the AI's placements, flags and roads keep off those
 * tiles until the rail is placed there; a wider search alone cannot help a seat whose land fills up first (#147).
 * `turnBlockWeight` (needs `turnBuildings`): a flag side costs this much for each free tile beside its flag that it would take out
 * of use (a flag allows no flag next to it), so a side on a flag that stands, which takes none, is preferred (#148).
 */
export const aiOptions = { relocateQuarries: false, stoneFallback: false, foodByNeed: false, stonePriority: false, borderReach: false, borderClear: false, toolsByDemand: false, oreMines: false, releaseStalled: false, toolsmithAnyway: false, forgeRoom: false, surveyAgain: false, graniteFirst: false, turnBuildings: false, widePlacement: false, turnPartnerWeight: 2, borderCandidates: false, woodByNeed: false, reserveRail: false, turnBlockWeight: 0 };
