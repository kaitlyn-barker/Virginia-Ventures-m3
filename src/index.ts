// index.ts
// ----------------------------------------------------------------------------
// Captain's Voyage — entry point.
//
// This file does three small things:
//   1. Creates the IWSDK World (the VR runtime).
//   2. Builds the shared visual environment (sky, sun, ocean, ship).
//   3. Places the player standing at the bow rail, looking out to sea.
//
// There is NO gameplay or UI here on purpose — this is the reusable scenic base
// that every leg of the voyage sits inside. Game logic lives elsewhere.
// ----------------------------------------------------------------------------

import { LocomotionSystem, SessionMode, World } from "@iwsdk/core";

// The shared environment builder (sky + sun + ocean + ship from primitives).
import { createVoyageEnvironment } from "./environment.js";

// The Virginia leg's port scenery (dock, cargo, shore, sign) — sits on the base.
import { createVirginiaPort } from "./virginiaPort.js";

// The people of the voyage: sailors crewing the ship + colonists at each port,
// built in the previous experience's low-poly primitive style. The ship crew is
// added here; the Virginia colonists are added below; England's are added by the
// phase controller when that port is built.
import { addShipCrew, addVirginiaColonists } from "./npcs.js";

// The Virginia leg's ONE interaction: the cargo-loading panel + its logic.
import { createCargoPanel, VirginiaCargoSystem } from "./virginiaCargo.js";

// The phase controller: it owns the Virginia -> England swap on "Set Sail".
import { registerVirginiaPhase } from "./voyagePhases.js";

// Onboarding: the welcome card and the reusable per-leg tutorial coach. The
// welcome card opens the experience; the Virginia tutorial gates the cargo panel.
import { showWelcome } from "./welcomePanel.js";
import { showTutorial, TUTORIALS } from "./tutorial.js";

// The voyage's "logbook" — a single data object holding the state of the trip.
// No gameplay uses it yet; we import it here so we can confirm it loads.
import { voyageState } from "./voyageState.js";

// Print the starting state to the browser console on load. Open the browser's
// DevTools console to confirm you see this object when the app starts.
console.log("Captain's Voyage — initial voyageState:", voyageState);

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  render: {
    // We light the scene ourselves in environment.ts (sky dome + ambient fill +
    // the sun), so turn OFF IWSDK's automatic default lighting to avoid two sets
    // of lights fighting each other.
    defaultLighting: false,
    // The ocean stretches 250 m to the horizon, so push the camera's far clip
    // plane out past it — otherwise distant water would be clipped away.
    far: 1000,
    // The INITIAL BROWSER (non-XR) camera pose. In a headset the head tracking
    // takes over, but on load in a flat browser tab the view comes from here.
    // Without it, the camera sits at a default pose and you mostly see empty sky
    // and sea. We put the eye at standing height (1.6 m) on the foredeck, looking
    // out over the bow (-Z) and tilted slightly down, so the pointed prow and the
    // bowsprit lead the eye across the water to the horizon and the low sun —
    // unmistakably "standing on a ship, looking out to sea."
    camera: {
      position: [0, 1.6, 0],
      lookAt: [0, 0.9, -8],
    },
  },
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    // "always" surfaces the browser's built-in Enter-VR prompt automatically, so
    // we don't need any custom UI to get into the headset.
    offer: "always",
  },
  features: {
    // The player can walk the deck, so locomotion is on. The deck is tagged as
    // a LocomotionEnvironment (in environment.ts) so they don't fall through it.
    //
    // The player spawns at the world origin (0,0,0) facing -Z. Rather than try to
    // move the player to the ship, environment.ts moves the SHIP so the origin
    // lands on the foredeck by the bow rail (see `SHIP_Z` there). The tiny +0.5
    // in Y starts them just above the deck so the locomotion engine settles them
    // neatly down onto it (it drives the player rig via a downward ground ray).
    //
    // `browserControls: true` turns on KEYBOARD (and browser-gamepad) movement for
    // the flat, non-headset view — so you can walk the deck with the Arrow keys
    // (or WASD): Up/Down = forward/back, Left/Right = strafe, Space = jump. In a
    // headset the thumbstick still drives locomotion exactly as before.
    locomotion: {
      useWorker: true,
      initialPlayerPosition: [0, 0.5, 0],
      browserControls: true,
    },
    // This base scene has nothing to grab, no physics, and no AR, so we leave
    // those features OFF — enabling unused features just wastes performance.
    grabbing: false,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  // Build the whole environment in one call. Returns handles to the ship group,
  // ocean, and sun in case you want to animate or reposition them later.
  const env = createVoyageEnvironment(world);

  // Crew the ship: a few sailors at work on the deck and a lookout at the bow.
  // They parent to the PERSISTENT ship group, so they sail along through every
  // leg rather than being torn down with each port's scenery.
  addShipCrew(world, env.shipGroup);

  // Dress the scene for the Virginia leg: dock, cargo, shore, and the sign.
  // (Later legs would swap this call for a different port builder.)
  const virginiaPort = createVirginiaPort(world);

  // Populate the Virginia dock + shore with frontier colonists (a dockhand, a
  // tobacco trader, a planter, a herbalist, a child). They parent to the port
  // group, so they clear out with the rest of the Virginia scenery on Set Sail.
  addVirginiaColonists(world, virginiaPort);

  // Register the system that runs the cargo panel's buttons NOW, even though the
  // panel itself isn't built until onboarding finishes. The system catches its
  // panel on a "qualify" subscription, so it's fine (and tidiest) to have it
  // waiting before the panel exists.
  world.registerSystem(VirginiaCargoSystem);

  // Gentle the smooth-locomotion (thumbstick "slide") speed. The default 5 m/s
  // feels fast on a small deck and makes it easy to overshoot; ~2.5 m/s is a
  // calmer, more comfortable walking pace for moving around the ship.
  const locomotion = world.getSystem(LocomotionSystem);
  if (locomotion) {
    locomotion.config.slidingSpeed.value = 2.5;
  }

  // Onboarding orientation: start facing the VIRGINIA PORT (the dock, cargo, and
  // sign off the starboard side, +X) rather than out over the bow. The player
  // rig spawns facing -Z, so we turn it -90° about Y to look straight down the
  // dock toward the shore. Because the browser camera's pose is defined relative
  // to this rig, rotating the rig reorients BOTH the flat view and the headset
  // view. (The rig's facing is app-owned — locomotion only changes it on a turn
  // input — so this initial rotation sticks.)
  world.player.rotation.y = -Math.PI / 2;

  // Onboarding flow (gate then reveal):
  //   1. The WELCOME card opens the experience.
  //   2. "Begin Voyage" dismisses it and raises the VIRGINIA tutorial, which
  //      teaches the buying/mercantilism idea of this leg.
  //   3. "Got it" dismisses the tutorial and finally builds the cargo panel,
  //      then hands the leg's scenery (port + panel) to the phase controller so
  //      "Set Sail" can later clear it and build England.
  // Each card disposes itself before the next appears, so only one is ever on
  // screen at a time.
  showWelcome(world, () => {
    showTutorial(world, TUTORIALS.virginia, () => {
      const cargoPanel = createCargoPanel(world);
      registerVirginiaPhase(world, [virginiaPort, cargoPanel]);
    });
  });
});
