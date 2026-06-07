# Captain's Voyage

A standalone WebXR trade-route experience for 5th graders, built with [IWSDK](https://github.com/meta-quest/immersive-web-sdk) (Immersive Web SDK).

The student captains a colonial trade ship and sails the Atlantic leg of the
triangular trade route between **Virginia** and **England**. Along the way they
load cargo, learn the rules of British mercantilism, weather an Atlantic storm,
face a smuggler's tempting (and illegal) offer, and sail home — finishing with a
summary of how their voyage went.

It runs in a flat browser tab (keyboard / mouse) and in a Meta Quest headset
from the same build. It is self-contained — no dependency on any other module —
and is designed to deploy as a static site and open in the Quest browser.

## The voyage

1. **Welcome** — a title card opens the experience on the foredeck of the ship.
2. **Virginia port** — a short tutorial, then the one hands-on mechanic: load
   trade goods into the ship's 6-slot cargo hold, then **Set Sail**.
3. **The crossing** — an Atlantic storm forces a decision: how do you handle it?
4. **The smuggler** — a tempting offer to trade outside the law tests what the
   student has learned about mercantilism.
5. **England port** — arrive, see the rules of trade, and complete the leg.
6. **Return home** — a map traces the route back to Virginia.
7. **Summary** — a logbook recap of the choices made and how the voyage ended.

All gameplay is driven by a single shared state object (`src/voyageState.js`),
the voyage "logbook."

## Project structure

```
src/
  index.ts          # World.create() entry point — builds the scenic base
  environment.ts    # Sky, sun, ocean, and ship built from primitives
  palette.js        # Shared color palette
  npcs.ts           # Low-poly ship crew + port colonists
  voyageState.js    # The shared "logbook" — voyage state object
  voyagePhases.ts   # Phase controller (Virginia -> England swap)
  welcomePanel.ts   # Opening title card
  tutorial.ts       # Reusable per-leg tutorial coach
  virginiaPort.ts   # Virginia dock / shore / cargo scenery
  virginiaCargo.ts  # The cargo-loading panel + its system
  stormDecision.ts  # Atlantic storm decision point
  smugglerOffer.ts  # Smuggler's illegal-trade offer
  englandPort.ts    # England port scenery
  englandRules.ts   # Rules-of-trade (mercantilism) panel
  returnHomeMap.ts  # Return-voyage map
  voyageSummary.ts  # End-of-voyage logbook recap
ui/
  *.uikitml         # UIKitML source for each panel above
```

**Convention:** one system per file with its related components; no barrel
`index.ts` files.

## Running locally

Requires Node `>=20.19` (see `engines` in `package.json`).

```bash
npm install      # first time only — installs dependencies
npm run dev      # starts the dev server and opens the app
```

Open the browser DevTools console on load to see the initial `voyageState`.

The dev server also works with the Meta XR Simulator / emulator for testing
without a headset.

## Building & deploying

```bash
npm run build    # produces a static site in dist/
npm run preview  # serve the production build locally
```

The contents of `dist/` can be hosted on any static host (e.g. GitHub Pages)
and opened in the Meta Quest browser.

## Built with

[IWSDK](https://github.com/meta-quest/immersive-web-sdk) — a 3D web framework
with first-class WebXR support, built on an ECS (entity-component-system)
architecture, reactive signals, and Three.js.
