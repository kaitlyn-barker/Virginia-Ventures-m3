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
