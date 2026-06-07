// voyageState.js
// ----------------------------------------------------------------------------
// This file holds the single "source of truth" for the Captain's Voyage
// experience. Think of `voyageState` as the ship's logbook: one plain object
// that every part of the app can read from and update as the voyage unfolds.
//
// For now this is JUST DATA — there is no gameplay wired up yet. We export it
// so other files can import it later, and index.ts logs it to the console on
// load so you can confirm everything is connected.
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

// Log the whole logbook on load so you can confirm in the browser console that the
// new gamification fields show up alongside the original ones. (index.ts also logs
// the state when the world starts; this one fires the moment this module loads.)
console.log("Captain's Voyage — voyageState on load:", voyageState);
