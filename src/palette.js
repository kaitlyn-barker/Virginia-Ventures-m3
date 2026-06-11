// palette.js
// ----------------------------------------------------------------------------
// The Captain's Voyage color palette — the "warm golden-hour colonial" look.
//
// These are the ONLY colors the whole experience should use, so every leg of
// the voyage feels like the same world. Import this object anywhere you build
// visuals and reuse the named colors instead of typing raw hex codes:
//
//     import { PALETTE } from './palette.js';
//     new MeshStandardMaterial({ color: PALETTE.SHIP_WOOD });
//
// The values are plain CSS hex strings. Three.js (and IWSDK, which re-exports
// it) understands hex strings directly on materials and lights, so you can pass
// them straight through — no conversion needed for that case.
// ----------------------------------------------------------------------------

export const PALETTE = {
  SHIP_WOOD: "#5b3a21", // dark, warm wood — hull, deck, railing posts
  CREAM: "#f3e9d2", // soft off-white — sails, light accents
  GOLD: "#c8962a", // warm brass/gold — trim, the railing cap
  OCEAN: "#3f5a6b", // calm muted blue-grey — the sea
  SKY: "#79a8d6", // soft daytime blue — the upper sky

  // --- Enriched golden-hour hues (added with the visual-polish pass). All are
  // family-adjacent to the five originals, so the look stays recognizable.
  HORIZON_PEACH: "#f4cf9b", // the warm glow where the sky meets the sea
  WATER_LIT: "#4d6c80", // sun-touched wave tops painted into the water texture
  FOAM: "#dfe9ee", // white water — foam rings at pilings and the hull
  LEAF_GREEN: "#4f7034", // tree canopies and tobacco plants on the Virginia shore
  LANTERN_GLOW: "#ffd27a", // the warm glow of lanterns and lit windows
};
