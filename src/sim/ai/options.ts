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
 */
export const aiOptions = { relocateQuarries: false, stoneFallback: false, foodByNeed: false, stonePriority: false, borderReach: false, borderClear: false, toolsByDemand: false, oreMines: false, releaseStalled: false, toolsmithAnyway: false, forgeRoom: false };
