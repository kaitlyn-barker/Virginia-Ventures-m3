// environment.ts
// ----------------------------------------------------------------------------
// The SHARED visual environment for Captain's Voyage: the sky, the sun, the
// ocean, and the ship the player stands on. Every leg of the voyage (Virginia,
// England, West Africa, ...) reuses this exact base — only the surrounding port
// scenery changes per leg.
//
// Everything here is built from IWSDK PRIMITIVE SHAPES (boxes, planes,
// cylinders) — no imported 3D models. That keeps it tiny and fast for the
// Quest 3S browser.
//
// The whole thing is one reusable function, `createVoyageEnvironment(world)`.
// Call it once after `World.create(...)`. The ship + ocean are created as
// PERSISTENT entities, so they survive level changes and stay loaded the entire
// voyage while you swap port scenery around them.
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  // Three.js building blocks (re-exported by @iwsdk/core — always import them
  // from here, NEVER from 'three' directly, or you get duplicate-Three bugs).
  Group,
  Mesh,
  BoxGeometry,
  PlaneGeometry,
  CylinderGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  DirectionalLight,
  DoubleSide,
  PCFSoftShadowMap,
  // IWSDK environment + locomotion components.
  DomeGradient,
  IBLGradient,
  LocomotionEnvironment,
  EnvironmentType,
} from "@iwsdk/core";

import { PALETTE } from "./palette.js";

// ----------------------------------------------------------------------------
// Layout constants — all measured in meters, so they read like real life.
// Tweak these in one place and the whole ship re-proportions.
// ----------------------------------------------------------------------------
// We make the DECK the player's natural floor at y = 0. That matters for VR:
// IWSDK's locomotion engine settles the player onto walkable ground using a
// downward ray, so the surface they stand on should be at (or just below) their
// feet. Keeping the deck at y = 0 means "the deck is the floor" — the simplest,
// most reliable setup. The ocean then sits a little BELOW the deck, so the ship
// reads as floating with the deck a short step above the waterline.
const DECK_Y = 0; // top of the deck — the player's floor
const WATER_Y = -0.5; // sea surface, half a meter below the deck (the "freeboard")
const HULL_LENGTH = 11.0; // bow-to-stern length (along Z) — long enough that the
// foredeck's converging rails read as strong "leading lines" out to the horizon
const HULL_BEAM = 2.6; // side-to-side width (along X)
const HULL_HEIGHT = 1.4; // total hull height (part sits below the waterline)
const RAIL_HEIGHT = 0.9; // railing height above the deck (about waist-high)

// Where the ship sits relative to the world origin. The player always spawns at
// the origin (0,0,0) facing -Z (forward = toward the bow and the open horizon).
// We slide the whole ship so the origin lands a little aft of midship: a long
// FOREDECK runs ahead of the player and narrows to a pointed prow with a bowsprit
// jutting out over the water, while the masts, sails, and stern rise up BEHIND
// them. Looking forward, the deck's converging rails lead your eye straight down
// the bow to the horizon — unmistakably "sailing out to sea." Move the whole ship
// later by changing `shipGroup`'s position.
const SHIP_Z = -1.0;

// The deck is slightly smaller than the hull so the hull reads as a lip/edge.
const DECK_LENGTH = HULL_LENGTH - 0.4;
const DECK_WIDTH = HULL_BEAM - 0.2;

// ----------------------------------------------------------------------------
// Small helper: turn a "#rrggbb" hex string into IWSDK's [r, g, b, a] color
// format (each channel 0..1). The sky/lighting components want arrays, not
// hex strings — unlike materials, which accept hex directly.
// ----------------------------------------------------------------------------
function hexToRgba(hex: string, alpha = 1): [number, number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, alpha];
}

// ----------------------------------------------------------------------------
// What the builder hands back, in case a caller wants to move/inspect things
// later (e.g. gently bob the ship, or attach port scenery to the ship group).
// ----------------------------------------------------------------------------
export interface VoyageEnvironment {
  shipGroup: Entity; // parent of every ship part — move this to move the ship
  ocean: Entity; // the big sea plane
  sun: Entity; // the warm directional "sun" light
}

export function createVoyageEnvironment(world: World): VoyageEnvironment {
  // --- 0. Turn on soft shadows -------------------------------------------------
  // Shadows are off by default. We enable them once on the renderer and pick the
  // "PCF soft" filter so shadow edges are gentle, not jagged — fitting the calm
  // golden-hour mood. Only the sun light below actually casts them.
  world.renderer.shadowMap.enabled = true;
  world.renderer.shadowMap.type = PCFSoftShadowMap;

  // --- 1. Sky + ambient lighting ----------------------------------------------
  // Environment components (the sky dome and image-based lighting) must live on
  // the LEVEL ROOT entity, not a random entity, or IWSDK silently ignores them.
  // DomeGradient = the sky you SEE (background). IBLGradient = soft fill light
  // that gently illuminates every surface so shadowed sides aren't pure black.
  const levelRoot = world.activeLevel?.value;
  if (levelRoot) {
    // The visible sky: pale up top (SKY), a warm cream glow at the horizon
    // (golden hour), and the OCEAN color below the horizon line so sea and sky
    // meet believably.
    levelRoot.addComponent(DomeGradient, {
      sky: hexToRgba(PALETTE.SKY),
      equator: hexToRgba(PALETTE.CREAM),
      ground: hexToRgba(PALETTE.OCEAN),
      intensity: 1.0,
    });

    // Ambient fill lighting — kept low (0.5) so the directional sun stays the
    // dominant light and shadows still read clearly. Warm cream up high, cool
    // ocean from below (light bouncing off the water).
    levelRoot.addComponent(IBLGradient, {
      sky: hexToRgba(PALETTE.CREAM),
      equator: hexToRgba(PALETTE.CREAM),
      ground: hexToRgba(PALETTE.OCEAN),
      intensity: 0.5,
    });
  } else {
    // Defensive: if no active level exists yet, say so instead of failing quietly.
    console.warn(
      "[environment] No active level root found — sky/ambient lighting was skipped.",
    );
  }

  // --- 2. The warm, low "sun" -------------------------------------------------
  // One DirectionalLight stands in for the sun: parallel rays from a single
  // direction, like real sunlight. We give it a warm golden tint and place it
  // LOW and to the front-left so the light rakes across the deck at a golden-
  // hour angle (~32° above the horizon) and casts long, soft shadows.
  const sunLight = new DirectionalLight("#ffd9a0", 3.0); // warm gold, fairly strong
  // Position = the direction the sun shines FROM. A light source at (-8, 8, -10)
  // aiming at the origin gives roughly a 32° elevation: low and golden.
  sunLight.position.set(-8, 8, -10);
  sunLight.castShadow = true;

  // Shadow quality vs. performance: a 1024² shadow map is plenty for one ship
  // and cheap enough for the Quest 3S. We tighten the shadow "camera" to a box
  // just big enough to wrap the ship (±6 m) so the limited resolution is spent
  // where it matters. `radius` softens the edges; `bias`/`normalBias` stop the
  // self-shadowing speckle artifact ("shadow acne").
  sunLight.shadow.mapSize.set(1024, 1024);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 40;
  sunLight.shadow.camera.left = -6;
  sunLight.shadow.camera.right = 6;
  sunLight.shadow.camera.top = 6;
  sunLight.shadow.camera.bottom = -6;
  sunLight.shadow.radius = 4;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;

  // Add the sun as a PERSISTENT entity so it stays lit across every voyage leg.
  const sun = world.createTransformEntity(sunLight, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 3. The ocean -----------------------------------------------------------
  // A single huge flat plane painted with the OCEAN color. 500×500 m is far more
  // than the eye can tell from a ship, so it reaches the horizon in every
  // direction while staying a single cheap quad. It only RECEIVES shadows.
  //
  // (Optional later: a "shimmer" by slowly scrolling the material's UV offset in
  // a tiny system. We keep it static here — one flat quad is the cheapest, most
  // Quest-friendly option, and the calm sea reads fine without motion.)
  const oceanMat = new MeshStandardMaterial({
    color: PALETTE.OCEAN,
    roughness: 0.35, // a touch glossy so the sun leaves a soft sheen
    metalness: 0.1,
  });
  const oceanMesh = new Mesh(new PlaneGeometry(500, 500), oceanMat);
  oceanMesh.rotation.x = -Math.PI / 2; // lay the plane flat (normal points up)
  oceanMesh.position.y = WATER_Y;
  oceanMesh.receiveShadow = true;
  const ocean = world.createTransformEntity(oceanMesh, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 4. The ship ------------------------------------------------------------
  // Everything from here parents under ONE empty group entity. Moving or
  // rotating `shipGroup` moves the whole ship as a unit — handy for a gentle
  // bob later, or for repositioning the ship per leg.
  const shipGroup = world.createTransformEntity(new Group(), {
    parent: world.sceneEntity,
    persistent: true,
  });
  // Slide the ship so the player (who spawns at the world origin) ends up on the
  // foredeck: the pointed bow + bowsprit sit just ahead, the ship rises behind.
  shipGroup.object3D!.position.set(0, 0, SHIP_Z);

  // Reusable materials (made once, shared by many parts — cheaper than one per
  // mesh).
  const woodMat = new MeshStandardMaterial({
    color: PALETTE.SHIP_WOOD,
    roughness: 0.85,
  });
  const goldMat = new MeshStandardMaterial({
    color: PALETTE.GOLD,
    roughness: 0.4,
    metalness: 0.6, // a little metallic glint for the brass railing cap
  });
  const sailMat = new MeshStandardMaterial({
    color: PALETTE.CREAM,
    roughness: 0.9,
    side: DoubleSide, // a sail is thin — show its fabric from both sides
    // The sun sits out beyond the bow, so from the deck we look at the SHADED
    // back of the sails. A gentle warm "emissive" (self-glow) keeps them reading
    // as bright cream canvas — physically it mimics golden-hour sunlight glowing
    // THROUGH the thin sailcloth. Low intensity so it stays soft, not cartoonish.
    emissive: PALETTE.CREAM,
    emissiveIntensity: 0.35,
  });

  // Tiny helper: build a mesh, set shadow flags, attach it to the ship group at
  // a given position, and return its ENTITY (whose `.object3D` is the mesh).
  // `cast`/`receive` default to true.
  const addPart = (
    geometry: BoxGeometry | CylinderGeometry | PlaneGeometry,
    material: MeshStandardMaterial,
    x: number,
    y: number,
    z: number,
    cast = true,
    receive = true,
  ): Entity => {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    return world.createTransformEntity(mesh, {
      parent: shipGroup,
      persistent: true,
    });
  };

  // 4a. Hull — one long box. Its center sits so the top lands exactly at DECK_Y
  // and the bottom dips below the waterline (so the ship looks like it floats
  // IN the water, not on top of it).
  const hullCenterY = DECK_Y - HULL_HEIGHT / 2;
  addPart(
    new BoxGeometry(HULL_BEAM, HULL_HEIGHT, HULL_LENGTH),
    woodMat,
    0,
    hullCenterY,
    0,
  );

  // 4b. Deck — a flat plane the player stands on, laid just above the hull top.
  // We rotate it flat (normal up) and nudge it up 1 mm to avoid z-fighting
  // (two surfaces fighting over the same pixels) with the hull top.
  const deck = addPart(
    new PlaneGeometry(DECK_WIDTH, DECK_LENGTH),
    woodMat,
    0,
    DECK_Y + 0.001,
    0,
    false, // the flat deck doesn't need to cast a shadow
    true, // but it should catch the railing/mast shadows
  );
  deck.object3D!.rotation.x = -Math.PI / 2;

  // Walkable ground for locomotion. IMPORTANT: the visible deck is narrow and the
  // thin railings DON'T physically stop you — locomotion only "stands" you on
  // surfaces tagged as LocomotionEnvironment and lets you walk off their edges
  // (and fall). If the thin deck plane were the only walkable surface, the first
  // step toward a rail would drop you into the sea.
  //
  // So instead we lay down ONE big INVISIBLE floor at deck height and tag THAT as
  // the locomotion ground. It renders nothing (the visible deck and dock sit on
  // top of it). We make it LARGE on purpose: locomotion lets you walk off the
  // edge of any surface and fall, and only "catches" a step-down if the next
  // ground is within ~5 m below — out over the open sea there's nothing, so a
  // small floor would still let a quick slide shoot off the edge and plummet. A
  // big floor keeps the edge far away, so you can freely roam the ship and dock
  // without ever reaching it. STATIC = it never moves.
  const walkableFloor = new Mesh(
    new PlaneGeometry(60, 60),
    new MeshBasicMaterial({ visible: false }), // collision-only, never drawn
  );
  walkableFloor.rotation.x = -Math.PI / 2; // lay it flat (normal points up)
  walkableFloor.position.set(0, DECK_Y, -1.6); // deck height, centered on the ship
  world
    .createTransformEntity(walkableFloor, {
      parent: world.sceneEntity,
      persistent: true,
    })
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  // 4c. Railing — thin boxes around the deck edge. A waist-high GOLD top rail on
  // each of the four sides, held up by short SHIP_WOOD posts. Low enough to lean
  // on, tall enough to feel safe at the rail.
  const railY = DECK_Y + RAIL_HEIGHT; // height of the top rail
  const halfW = DECK_WIDTH / 2;
  const halfL = DECK_LENGTH / 2;
  const railThickness = 0.06; // "thin boxes"
  const postSize = 0.08;

  // Top rail: two long bars running bow-to-stern (left & right edges) and one
  // short bar across the STERN. (The BOW has no straight rail — its angled prow
  // bulwarks, added in step 4f, close it off instead.) GOLD brass cap.
  addPart(new BoxGeometry(railThickness, railThickness, DECK_LENGTH), goldMat, -halfW, railY, 0);
  addPart(new BoxGeometry(railThickness, railThickness, DECK_LENGTH), goldMat, halfW, railY, 0);
  addPart(new BoxGeometry(DECK_WIDTH, railThickness, railThickness), goldMat, 0, railY, halfL);

  // Posts: short vertical wood boxes holding the rail up. We space a row of them
  // down each long side using a simple loop instead of writing each by hand.
  const postGeo = new BoxGeometry(postSize, RAIL_HEIGHT, postSize);
  const postCenterY = DECK_Y + RAIL_HEIGHT / 2;
  const postCount = 8; // posts per side (more, since the deck is now longer)
  for (let i = 0; i < postCount; i++) {
    // Spread posts evenly from bow (-halfL) to stern (+halfL).
    const z = -halfL + (i / (postCount - 1)) * DECK_LENGTH;
    addPart(postGeo, woodMat, -halfW, postCenterY, z); // left side
    addPart(postGeo, woodMat, halfW, postCenterY, z); // right side
  }

  // 4d. Masts — tall thin cylinders rising from the deck. Two of them, both set
  // BEHIND the player (who stands at the bow) so the forward view to the horizon
  // stays open. They tower overhead and fill the view when you turn around: a
  // taller main mast just behind you and a shorter mizzen mast further aft.
  const mainMastHeight = 5.0;
  const mizzenMastHeight = 4.0;
  const mastRadius = 0.08;
  const mainMastZ = 2.5; // behind the player (~1.5 m aft), towering overhead
  const mizzenMastZ = 4.0; // further toward the stern (~3 m aft)
  // A cylinder is centered on its own middle, so center Y = deck + height/2 to
  // make its base sit on the deck.
  addPart(
    new CylinderGeometry(mastRadius, mastRadius, mainMastHeight),
    woodMat,
    0,
    DECK_Y + mainMastHeight / 2,
    mainMastZ,
  );
  addPart(
    new CylinderGeometry(mastRadius, mastRadius, mizzenMastHeight),
    woodMat,
    0,
    DECK_Y + mizzenMastHeight / 2,
    mizzenMastZ,
  );

  // 4e. Sails — cream planes rigged across each mast. A flat PlaneGeometry already
  // faces along Z (its normal points down the ship), exactly how a square sail
  // catches the wind, so no rotation is needed. DoubleSide makes it visible from
  // both deck and sea.
  addPart(
    new PlaneGeometry(2.2, 2.6),
    sailMat,
    0,
    DECK_Y + 3.2, // hung high on the main mast
    mainMastZ,
  );
  addPart(
    new PlaneGeometry(1.8, 2.0),
    sailMat,
    0,
    DECK_Y + 2.6, // hung on the shorter mizzen mast
    mizzenMastZ,
  );

  // 4f. Bow / prow — the pointed FRONT of the ship, and the strongest "this is a
  // boat heading out to sea" cue. We build the point from a single box turned 45°
  // about its vertical axis: a square seen corner-on is a diamond, and the
  // forward corner becomes the prow. Its TOP face sits exactly at deck level, so
  // it doubles as a triangular foredeck; its body below is the hull cutting the
  // water. Two angled rails close off the prow, and a bowsprit spar juts out over
  // the sea toward the horizon.
  //
  // `bowTipZ` is the very point of the bow, a bit ahead of the deck's front edge.
  const bowTipZ = -halfL - 1.2;

  // Hull wedge: a beam-wide box rotated 45°. Half its diagonal (= HULL_BEAM / 2)
  // sits ahead of its center, so centering it that far back from the tip lands
  // the forward corner exactly on `bowTipZ` and its side corners flush with the
  // hull's front edges.
  const hullWedge = addPart(
    new BoxGeometry(HULL_BEAM / Math.SQRT2, HULL_HEIGHT, HULL_BEAM / Math.SQRT2),
    woodMat,
    0,
    hullCenterY, // same height as the hull — its top face lands at deck level
    bowTipZ + HULL_BEAM / 2,
  );
  hullWedge.object3D!.rotation.y = Math.PI / 4; // turn the square corner-forward

  // Angled prow rails (bulwarks): two thin GOLD bars running from the deck's
  // front corners inward to the bow tip. Their converging lines lead the eye
  // straight out to the horizon — a classic "looking out to sea" composition.
  // Each side is a 45° diagonal (the tip is 1.2 m ahead of, and 1.2 m inboard of,
  // each front corner), so the bars are sqrt(1.2² + 1.2²) long and turned 135°.
  const bowRailLength = Math.SQRT2 * 1.2;
  const bowRailGeo = new BoxGeometry(railThickness, railThickness, bowRailLength);
  const bowRailMidZ = (-halfL + bowTipZ) / 2; // midpoint between front corner and tip
  const starboardBowRail = addPart(bowRailGeo, goldMat, halfW / 2, railY, bowRailMidZ);
  starboardBowRail.object3D!.rotation.y = -(3 * Math.PI) / 4;
  const portBowRail = addPart(bowRailGeo, goldMat, -halfW / 2, railY, bowRailMidZ);
  portBowRail.object3D!.rotation.y = (3 * Math.PI) / 4;

  // Bowsprit: a slim spar that rises from the prow and juts up-and-out over the
  // water. It "points" at the horizon and is the single most recognizable
  // sailing-ship silhouette. We start it at the rail line (so it stands clear of
  // the deck, silhouetted against the sea instead of hidden behind the bulwarks)
  // and reach it forward over the water. A cylinder's length runs along its own Y
  // axis, so we tilt it ~76° about X to lay it nearly horizontal (pointing -Z)
  // with the tip raised ~14°.
  const bowsprit = addPart(
    new CylinderGeometry(0.06, 0.06, 2.6),
    woodMat,
    0,
    DECK_Y + 1.2, // midpoint height — rises above the bulwarks toward its tip
    bowTipZ - 1.25, // midpoint, reaching out well beyond the prow over the sea
  );
  bowsprit.object3D!.rotation.x = -1.326; // ≈ -76°: forward and tilted slightly up

  return { shipGroup, ocean, sun };
}
