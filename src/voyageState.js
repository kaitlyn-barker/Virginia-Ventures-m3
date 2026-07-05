// voyageState.js
// ----------------------------------------------------------------------------
// This file holds the single "source of truth" for the Captain's Voyage
// experience. Think of `voyageState` as the ship's logbook: one plain object
// that every part of the app can read from and update as the voyage unfolds.
//
// Every phase file READS from and WRITES to this one object — that IS the
// gameplay. Alongside the state it also holds the tunable balance constants and
// a tiny stopwatch (markPhase / ratedEfficiency) that scores Voyage Efficiency
// at the summary. Keeping all of that in one place is the project convention.
// ----------------------------------------------------------------------------

export const voyageState = {
  // How many cargo slots the ship's hold has in total. This is fixed at 6 —
  // the cargo hold has exactly six spaces to fill at the Virginia port.
  cargoSlotsTotal: 6,

  // Which trade goods the student has loaded so far. Starts empty; as goods are
  // loaded, their names (e.g. "tobacco") get added to this list.
  cargoLoaded: [],

  // The running total value of everything loaded into the hold so far.
  // Starts at 0 and goes up as goods are added.
  cargoValue: 0,

  // How many coins the captain PAID to buy the goods loaded at Virginia. Recorded
  // on Set Sail (sum of GOOD_COST over cargoLoaded). Profit subtracts this.
  purchaseCost: 0,

  // The coins the buyer ACTUALLY pays for the hold — set when the captain accepts
  // England's (possibly haggled) offer, or takes the smuggler's deal. 0 until sold.
  salePrice: 0,

  // Coins spent on extra provisions if the captain sailed AROUND the storm rather
  // than braving it. 0 if they braved it. Profit subtracts this.
  detourCost: 0,

  // Whether the captain sold to the smuggler (illegal) instead of England. Drives
  // the Crown Compliance hit and the summary's lesson takeaway.
  soldToSmuggler: false,

  // The captain's PROFIT — actual coins netted on the voyage. Computed at the
  // summary as salePrice - purchaseCost - detourCost. Starts at 0.
  profit: 0,

  // A 0–100 measure of how well the captain is following the Crown's (England's)
  // trade rules. Starts at a perfect 100.
  crownCompliance: 100,

  // Which part of the trade route the student is currently on. The voyage goes
  // Virginia → England → West Africa → Virginia. "departure" means we're still
  // at the start, in Virginia, getting ready to set sail.
  currentLeg: "departure",

  // Whether England has revealed the prices it will pay for goods yet.
  // Starts false (prices are still hidden); flips to true once shown.
  englishPricesRevealed: false,

  // --- Gamification state (storm / haggle / smuggler mechanics) ----------------
  // NOTE: `profit` already exists above (added earlier), so it is NOT repeated here.

  // WHO the captain finally sold the cargo to. Empty until a sale is made, then
  // becomes "england" (the legal sale) or "smuggler" (the illegal one). Lets the
  // summary and lesson text know which path the captain chose.
  soldVia: "",

  // Whether the captain got CAUGHT smuggling. Selling to the smuggler is a gamble:
  // there is a chance (SMUGGLE_DISCOVERY_CHANCE) the Crown finds out. True if caught.
  caughtSmuggling: false,

  // Whether the storm DAMAGED the cargo. True if the captain braved the storm and
  // the bad-luck roll (STORM_DAMAGE_CHANCE) came up, costing some cargo value.
  stormDamage: false,

  // A running list of the choices the captain made this voyage (e.g. "braved the
  // storm", "haggled 2 rounds", "sold to smuggler"). Each decision pushes a short
  // note here so the summary can recap the journey. Starts as an empty list.
  decisionsLog: [],

  // The price England AGREED to after haggling, recorded BEFORE the captain decides
  // whether to take it or defy the Crown and sell to the smuggler instead. Starts 0.
  englishSaleAmount: 0,

  // --- Voyage Efficiency + Captain's Log (revealed only at the summary) ---------
  // Efficiency is one of the module's three required scores. We time each
  // decision point (NOT the West Africa reflection, which is paused) and band the
  // total into a 1-3 star rating shown ONLY on the summary — never a countdown
  // during play, which would just rush a 10-year-old in a headset.

  // One { label, seconds } entry per timed decision point, pushed at each phase
  // hand-off by markPhase(). The West Africa leg calls pauseTiming() so its
  // reflection is never counted.
  phaseTimings: [],

  // Fumbles that nudge Efficiency down: a load that didn't fit the hold, a haggle
  // push that annoyed the merchant. Each adds WASTED_ACTION_PENALTY_SECONDS.
  wastedActions: 0,

  // Goods the captain WANTED to load at Virginia but had no room for. Deduped
  // (a good is recorded once) so the summary's Captain's Log can answer the
  // debrief question "What did you leave behind?" with concrete material.
  leftBehind: [],

  // --- England "buy for the next leg" (the mercantile loop) ---------------------
  // After selling raw colonial goods, the captain spends the proceeds on English
  // MANUFACTURED goods (made from colonial raw materials, sold back to colonists
  // at England's price) to carry home. That round trip IS mercantilism.

  // Which manufactured goods the captain bought in England (into a fresh 6-slot
  // hold). Names from ENGLAND_GOODS_SLOTS; starts empty.
  goodsBoughtInEngland: [],

  // Coins PAID to England for those manufactured goods. Profit subtracts this.
  englandPurchaseCost: 0,

  // Coins the manufactured goods fetch when resold back home in Virginia (Leg 3
  // payoff). Profit adds this. Resale beats the England price, so the loop nets
  // a modest gain — England still set both prices.
  virginiaResaleGain: 0,
};

// GOOD_SLOTS maps each trade good to the specific cargo-hold slot number it
// belongs in (the hold has slots 1–6). This lets us drop the right good into
// the right place later on.
export const GOOD_SLOTS = {
  tobacco: 1,
  lumber: 2,
  furs: 3,
};

// ENGLAND_PRICE maps each trade good to the price (in coins) that England will
// pay for it. We use this to calculate cargoValue when goods are sold.
export const ENGLAND_PRICE = {
  tobacco: 30,
  lumber: 50,
  furs: 90,
};

// GOOD_COST maps each trade good to the price (in coins) the captain PAYS to buy
// it at Virginia. Each is below its ENGLAND_PRICE, so every good turns a profit —
// furs the largest margin (+35), then lumber (+20), then tobacco (+15). Profit is
// what's left after subtracting these costs from the sale, so the buying choice
// at Virginia now matters, not just the selling.
export const GOOD_COST = {
  tobacco: 15, // sells for 30 -> +15 margin
  lumber: 30, //  sells for 50 -> +20 margin
  furs: 55, //    sells for 90 -> +35 margin
};

// --- England manufactured goods (the "buy for the next leg" step) ----------------
// England sells finished goods MADE FROM colonial raw materials back to the
// colonies at prices England sets. The captain buys these with the sale proceeds
// and resells them at home for a modest gain — the mercantile loop in miniature.
// Same 6-slot hold model as Virginia: bigger goods take more slots.
export const ENGLAND_GOODS_SLOTS = {
  tools: 1, //     iron tools — small, 1 slot
  cloth: 2, //     bolts of textile — 2 slots
  furniture: 3, // finished furniture — bulky, 3 slots
};

// What England CHARGES the colonist for each manufactured good (England's price).
export const ENGLAND_GOODS_PRICE = {
  tools: 25,
  cloth: 45,
  furniture: 80,
};

// What each manufactured good RESELLS for back in Virginia (Leg 3 payoff). Each
// is above its England price, so carrying goods home turns a modest profit:
// tools +10, cloth +15, furniture +25.
export const VIRGINIA_RESALE_PRICE = {
  tools: 35, //     paid 25 -> +10
  cloth: 60, //     paid 45 -> +15
  furniture: 105, // paid 80 -> +25
};

// SMUGGLER_PRICE maps each trade good to the price (in coins) a SMUGGLER will pay
// for it — illegally, outside the Navigation Acts. Each is HIGHER than the matching
// ENGLAND_PRICE: that gap is the temptation. More coin, but selling here risks
// getting caught and wrecking Crown Compliance.
export const SMUGGLER_PRICE = {
  tobacco: 45, // vs England's 30
  lumber: 70, //  vs England's 50
  furs: 130, //   vs England's 90
};

// --- Tunable gameplay constants -------------------------------------------------
// These are the "knobs" for balancing the game. They live here so every number
// that shapes difficulty sits in one place, next to the data it affects. Tweak
// freely — nothing else needs to change.

// The chance (0–1) that selling to the smuggler gets the captain CAUGHT.
// 0.30 means a 30% risk each time they smuggle.
export const SMUGGLE_DISCOVERY_CHANCE = 0.3;

// The most rounds of haggling England will tolerate before its offer is final.
export const HAGGLE_MAX_ROUNDS = 3;

// The chance (0–1) that braving the storm actually DAMAGES the cargo.
// 0.40 means a 40% chance of damage.
export const STORM_DAMAGE_CHANCE = 0.4;

// How much of the cargo's value is lost when the storm damages it.
// 0.15 means 15% is knocked off.
export const STORM_DAMAGE_PCT = 0.15;

// --- Voyage Efficiency tuning ---------------------------------------------------
// The total decision time (in seconds) banded into a 1-3 star rating. Bands are
// generous on purpose: this rewards a captain who keeps the voyage moving without
// ever punishing one who reads carefully. The West Africa reflection is excluded
// from the total entirely, so pausing to take in that history never costs a star.
export const EFFICIENCY_BANDS = [
  { maxSeconds: 210, stars: 3, label: "Swift and sure" }, //     <= 3.5 min
  { maxSeconds: 360, stars: 2, label: "Steady and careful" }, // <= 6 min
  { maxSeconds: Infinity, stars: 1, label: "You took your time" },
];

// Each fumble (a load that didn't fit, a haggle that annoyed the merchant) adds
// this many seconds to the timed total, so wasted actions gently lower Efficiency.
export const WASTED_ACTION_PENALTY_SECONDS = 20;

// --- Voyage timing plumbing -----------------------------------------------------
// A tiny stopwatch for Voyage Efficiency. It does NO per-frame work: markPhase()
// is called only at decision-point hand-offs. The West Africa leg brackets itself
// with pauseTiming()/resumeTiming() so that reflection is never counted.
let _lastMarkMs = 0; //     performance.now() at the last mark (0 = not started)
let _timingPaused = false; // true during the West Africa reflection

/** Start (or restart) the voyage stopwatch. Call when the first decision begins. */
export function startTiming() {
  _lastMarkMs = performance.now();
  _timingPaused = false;
}

/** Record the time spent since the previous mark, tagged with `label`. */
export function markPhase(label) {
  const now = performance.now();
  if (!_timingPaused && _lastMarkMs > 0) {
    voyageState.phaseTimings.push({
      label,
      seconds: Math.max(0, (now - _lastMarkMs) / 1000),
    });
  }
  _lastMarkMs = now;
}

/** Stop counting time (used around the West Africa reflection). */
export function pauseTiming() {
  _timingPaused = true;
}

/** Resume counting time from now (the West Africa reflection is over). */
export function resumeTiming() {
  _timingPaused = false;
  _lastMarkMs = performance.now();
}

/** Total of all timed segments, in seconds. */
export function totalTimedSeconds() {
  return voyageState.phaseTimings.reduce((sum, t) => sum + t.seconds, 0);
}

/**
 * Band the timed total (plus any wasted-action penalty) into a star rating.
 * Returns { stars, label, seconds } — the summary shows this and nothing else;
 * the raw seconds are never displayed to the student.
 */
export function ratedEfficiency() {
  const seconds =
    totalTimedSeconds() + voyageState.wastedActions * WASTED_ACTION_PENALTY_SECONDS;
  const band =
    EFFICIENCY_BANDS.find((b) => seconds <= b.maxSeconds) ??
    EFFICIENCY_BANDS[EFFICIENCY_BANDS.length - 1];
  return { stars: band.stars, label: band.label, seconds };
}
