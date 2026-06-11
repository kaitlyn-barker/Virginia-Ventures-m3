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
  SphereGeometry,
  CircleGeometry,
  RingGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  DirectionalLight,
  DoubleSide,
  PCFSoftShadowMap,
  ACESFilmicToneMapping,
  Fog,
  CanvasTexture,
  RepeatWrapping,
  SRGBColorSpace,
  type Object3D,
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

  // Live handles for the things the AmbientMotionSystem animates each frame.
  // They are plain Three.js objects/materials (not entities) — the system just
  // writes a few numbers into them per frame, which is as cheap as it gets.
  anim: {
    sunLight: DirectionalLight; // dimmed + cooled during the storm
    oceanTexture: CanvasTexture; // scrolled slowly so the water drifts
    oceanMaterial: MeshStandardMaterial; // storm darkening
    pennant: Object3D; // the little masthead flag — flutters
    cloudsGroup: Object3D; // the whole cloud bank — drifts in a slow circle
    gulls: GullRig[]; // the three circling seagulls
    foamMaterial: MeshBasicMaterial; // foam rings — opacity gently pulses
  };
}

// One seagull's moving parts. The PIVOT spins to circle the bird around the
// ship; the GULL itself bobs up and down; the two WINGS flap.
export interface GullRig {
  pivot: Object3D;
  gull: Object3D;
  leftWing: Object3D;
  rightWing: Object3D;
  speed: number; // circling speed (radians/sec); negative = opposite direction
  phase: number; // per-bird offset so the three never move in lockstep
}

export function createVoyageEnvironment(world: World): VoyageEnvironment {
  // --- 0. Turn on soft shadows -------------------------------------------------
  // Shadows are off by default. We enable them once on the renderer and pick the
  // "PCF soft" filter so shadow edges are gentle, not jagged — fitting the calm
  // golden-hour mood. Only the sun light below actually casts them.
  world.renderer.shadowMap.enabled = true;
  world.renderer.shadowMap.type = PCFSoftShadowMap;

  // Filmic tone mapping: ACES rolls bright highlights off gently (the glowing
  // sails, sun disc, and lanterns bloom instead of clipping to flat white) and
  // richens the midtones — the single cheapest "looks like a real game" switch.
  // The slight exposure bump compensates for ACES darkening the mids.
  world.renderer.toneMapping = ACESFilmicToneMapping;
  world.renderer.toneMappingExposure = 1.15;

  // Distance fog: everything far away melts gently into a pale haze. This hides
  // the hard edge of the ocean plane, makes the distant islands feel truly far
  // (aerial perspective), and costs nothing per frame. The sun disc, clouds, and
  // gulls opt OUT of fog (fog: false on their materials) so they stay crisp.
  world.scene.fog = new Fog("#cfdde8", 80, 480);

  // --- 1. Sky + ambient lighting ----------------------------------------------
  // Environment components (the sky dome and image-based lighting) must live on
  // the LEVEL ROOT entity, not a random entity, or IWSDK silently ignores them.
  // DomeGradient = the sky you SEE (background). IBLGradient = soft fill light
  // that gently illuminates every surface so shadowed sides aren't pure black.
  const levelRoot = world.activeLevel?.peek(); // one-time read, no subscription
  if (levelRoot) {
    // The visible sky: pale up top (SKY), a warm cream glow at the horizon
    // (golden hour), and the OCEAN color below the horizon line so sea and sky
    // meet believably.
    levelRoot.addComponent(DomeGradient, {
      sky: hexToRgba(PALETTE.SKY),
      equator: hexToRgba(PALETTE.HORIZON_PEACH), // peachy golden-hour glow
      ground: hexToRgba(PALETTE.OCEAN),
      intensity: 1.0,
    });

    // Ambient fill lighting — kept low (0.6) so the directional sun stays the
    // dominant light and shadows still read clearly. Warm cream up high, cool
    // ocean from below (light bouncing off the water). Slightly brighter than
    // before to compensate for ACES tone mapping darkening the midtones.
    levelRoot.addComponent(IBLGradient, {
      sky: hexToRgba("#f8e8c8"),
      equator: hexToRgba(PALETTE.CREAM),
      ground: hexToRgba(PALETTE.OCEAN),
      intensity: 0.6,
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
  const sunLight = new DirectionalLight("#ffd9a0", 3.5); // warm gold, fairly strong
  // Position = the direction the sun shines FROM. The light AIMS at the center
  // of the action (its target below, between ship and dock), and shining from
  // (-1, 8, -10) keeps the same low ~32° golden-hour elevation as before.
  sunLight.position.set(-1, 8, -10);
  sunLight.castShadow = true;

  // Aim the light between the ship and the port so the shadow box (below) wraps
  // ALL the action: ship, dock, cargo, sign, and the port buildings. A light's
  // target only updates while it is part of the scene, so it gets its own
  // entity right after the light itself.
  sunLight.target.position.set(7, 0, -1);

  // Shadow quality vs. performance: one 2048² shadow map for one directional
  // light is comfortably within the Quest 3S budget. The shadow "camera" box is
  // sized to wrap the ship AND the dock/port (±13 × ±12 m around the target) so
  // the buildings and shore props get real shadows too. `radius` softens the
  // edges; `bias`/`normalBias` stop the self-shadowing speckle ("shadow acne").
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 0.5;
  sunLight.shadow.camera.far = 60;
  sunLight.shadow.camera.left = -13;
  sunLight.shadow.camera.right = 13;
  sunLight.shadow.camera.top = 12;
  sunLight.shadow.camera.bottom = -12;
  sunLight.shadow.radius = 4;
  sunLight.shadow.bias = -0.0005;
  sunLight.shadow.normalBias = 0.02;

  // Add the sun as a PERSISTENT entity so it stays lit across every voyage leg.
  const sun = world.createTransformEntity(sunLight, {
    parent: world.sceneEntity,
    persistent: true,
  });
  // The target must ALSO live in the scene graph or the light silently keeps
  // aiming at the origin.
  world.createTransformEntity(sunLight.target, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 2b. The VISIBLE sun ------------------------------------------------------
  // The DirectionalLight is invisible — these two flat circles are the sun you
  // can actually point at: a bright core and a soft warm halo behind it. They
  // sit 420 m out along the light's direction so the lighting and the visible
  // sun always agree. MeshBasicMaterial = unlit, fog: false = stays crisp.
  const sunDir = sunLight.position
    .clone()
    .sub(sunLight.target.position)
    .normalize();
  const sunDiscMat = new MeshBasicMaterial({
    color: "#ffeec9",
    fog: false,
    depthWrite: false,
  });
  const sunDisc = new Mesh(new CircleGeometry(10, 24), sunDiscMat);
  sunDisc.position.copy(sunDir).multiplyScalar(420);
  sunDisc.lookAt(0, 0, 0); // CircleGeometry faces +Z, so turn it back at us
  const sunHaloMat = new MeshBasicMaterial({
    color: "#ffd9a0",
    transparent: true,
    opacity: 0.22,
    fog: false,
    depthWrite: false,
  });
  const sunHalo = new Mesh(new CircleGeometry(26, 24), sunHaloMat);
  sunHalo.position.copy(sunDir).multiplyScalar(419); // a hair closer, behind-glow
  sunHalo.lookAt(0, 0, 0);
  const skyGroup = new Group();
  skyGroup.add(sunHalo, sunDisc);
  world.createTransformEntity(skyGroup, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 3. The ocean -----------------------------------------------------------
  // A single huge flat plane, but now painted with a hand-made WAVE TEXTURE: a
  // small canvas covered in soft wave-top dabs and tiny sparkle flecks, tiled
  // ~26 times across the plane. The AmbientMotionSystem scrolls the texture's
  // offset a tiny amount each frame, so the whole sea drifts — alive, for the
  // cost of one texture fetch. 500×500 m reaches the horizon in every direction
  // while staying a single cheap quad. It only RECEIVES shadows.
  const oceanTexture = makeWaterTexture();
  const oceanMat = new MeshStandardMaterial({
    map: oceanTexture,
    color: "#ffffff", // the texture carries the color; don't tint it darker
    roughness: 0.28, // a touch glossy so the sun leaves a soft sheen
    metalness: 0.15, // and glints across the moving flecks
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
  const mainMastHeight = 6.5;
  const mizzenMastHeight = 5.2;
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

  // 4e. Sails — cream canvas rigged across each mast. Instead of flat cards, the
  // sails are now BILLOWED: each plane gets a grid of vertices and a one-time
  // push of its middle toward the bow (-Z), like wind from astern filling the
  // canvas. Curved cloth catches the warm sun across its surface — instantly
  // "real sailing ship" instead of "paper cutout". The bend happens ONCE here at
  // build time (never per frame). DoubleSide shows it from deck and sea alike.
  const billowSail = (width: number, height: number): PlaneGeometry => {
    const geo = new PlaneGeometry(width, height, 8, 6);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      // A smooth dome: zero at the edges, deepest (40 cm) in the center.
      const belly =
        0.4 *
        Math.sin(Math.PI * (x / width + 0.5)) *
        Math.sin(Math.PI * (y / height + 0.5));
      pos.setZ(i, -belly); // belly toward -Z — the wind blows us toward the bow
    }
    geo.computeVertexNormals(); // re-light the curved surface correctly
    return geo;
  };
  addPart(
    billowSail(2.6, 3.2),
    sailMat,
    0,
    DECK_Y + 4.2, // hung high on the (taller) main mast
    mainMastZ,
  );
  addPart(
    billowSail(2.0, 2.4),
    sailMat,
    0,
    DECK_Y + 3.4, // hung on the shorter mizzen mast
    mizzenMastZ,
  );

  // Yards — the horizontal spars the sails hang from. One wood crossbar across
  // the top edge of each sail; this single shape is what makes the silhouette
  // read "square-rigged tall ship" from any distance.
  const mainYard = addPart(
    new CylinderGeometry(0.045, 0.045, 2.9),
    woodMat,
    0,
    DECK_Y + 5.8,
    mainMastZ,
  );
  mainYard.object3D!.rotation.z = Math.PI / 2; // lay the spar horizontal
  const mizzenYard = addPart(
    new CylinderGeometry(0.045, 0.045, 2.3),
    woodMat,
    0,
    DECK_Y + 4.6,
    mizzenMastZ,
  );
  mizzenYard.object3D!.rotation.z = Math.PI / 2;

  // Pennant — a slim gold flag at the very masthead. Its geometry is shifted so
  // the LEFT edge sits on the mast (the pivot), letting the AmbientMotionSystem
  // flutter it by rotating around Y. MeshBasicMaterial = always bright.
  const pennantGeo = new PlaneGeometry(0.55, 0.16);
  pennantGeo.translate(0.275, 0, 0); // pivot at the leading (mast) edge
  const pennantMesh = new Mesh(
    pennantGeo,
    new MeshBasicMaterial({ color: PALETTE.GOLD, side: DoubleSide, fog: false }),
  );
  pennantMesh.position.set(0, DECK_Y + mainMastHeight + 0.1, mainMastZ);
  const pennant = world.createTransformEntity(pennantMesh, {
    parent: shipGroup,
    persistent: true,
  });

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

  // --- 5. Clouds ----------------------------------------------------------------
  // Seven puffball clouds drifting high over the sea: each is 3 squashed spheres
  // overlapping into one fluffy cluster. ONE shared geometry + ONE shared unlit
  // material for all of them (cheap), fog off so they stay bright. The whole
  // bank hangs off a single group that the AmbientMotionSystem rotates very
  // slowly — a full lap takes about an hour, just enough to feel alive.
  const cloudGeo = new SphereGeometry(1, 7, 5);
  const cloudMat = new MeshBasicMaterial({ color: "#f7f3ea", fog: false });
  const cloudsGroup = new Group();
  // Each row: cluster center [x, y, z] far out on a wide ring. Two sit near the
  // sun's corner of the sky (-X, -Z) so the brightest sky has clouds to catch.
  const cloudSpots: [number, number, number][] = [
    [-180, 62, -210],
    [-90, 75, -260],
    [150, 58, -200],
    [240, 70, -60],
    [200, 80, 160],
    [-40, 66, 280],
    [-260, 72, 80],
  ];
  for (const [cx, cy, cz] of cloudSpots) {
    const puffs: [number, number, number, number, number][] = [
      // [offsetX, offsetY, offsetZ, scaleX..] — a big middle, two smaller sides
      [0, 0, 0, 7, 2.2],
      [-5, -0.6, 1.5, 5, 1.8],
      [4.5, -0.4, -1, 4, 1.5],
    ];
    for (const [ox, oy, oz, sx, sy] of puffs) {
      const puff = new Mesh(cloudGeo, cloudMat);
      puff.position.set(cx + ox, cy + oy, cz + oz);
      puff.scale.set(sx, sy, sx * 0.55);
      cloudsGroup.add(puff);
    }
  }
  world.createTransformEntity(cloudsGroup, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 6. Seagulls ---------------------------------------------------------------
  // Three little gulls circling the masts. Each bird is 3 tiny boxes (a body and
  // two wings) hanging from its own invisible PIVOT at the center of the ship;
  // spinning the pivot swings the bird in a wide circle, and the
  // AmbientMotionSystem flaps the wings and bobs the height. Unlit cream so they
  // never silhouette black against the sky.
  const gullMat = new MeshBasicMaterial({ color: PALETTE.CREAM, fog: false });
  const gullBodyGeo = new BoxGeometry(0.1, 0.06, 0.22);
  const gullWingGeo = new BoxGeometry(0.42, 0.015, 0.12);
  const gulls: GullRig[] = [];
  const gullSpecs = [
    { radius: 4.5, speed: 0.35, phase: 0.0 },
    { radius: 6.0, speed: 0.45, phase: 2.1 },
    { radius: 7.0, speed: -0.4, phase: 4.2 }, // negative = circles the other way
  ];
  for (const spec of gullSpecs) {
    const pivot = new Group();
    pivot.position.set(0, 9, -4); // high over the foredeck, clear of the masts
    const gull = new Group();
    gull.position.set(spec.radius, 0, 0);
    const body = new Mesh(gullBodyGeo, gullMat);
    const leftWing = new Mesh(gullWingGeo, gullMat);
    leftWing.position.set(-0.24, 0, 0);
    leftWing.rotation.z = 0.25;
    const rightWing = new Mesh(gullWingGeo, gullMat);
    rightWing.position.set(0.24, 0, 0);
    rightWing.rotation.z = -0.25;
    gull.add(body, leftWing, rightWing);
    pivot.add(gull);
    world.createTransformEntity(pivot, {
      parent: world.sceneEntity,
      persistent: true,
    });
    gulls.push({
      pivot,
      gull,
      leftWing,
      rightWing,
      speed: spec.speed,
      phase: spec.phase,
    });
  }

  // --- 7. Distant islands ---------------------------------------------------------
  // Low hazy cones far out on the horizon in every direction — a depth cue, and
  // something to sail toward. One shared 7-sided cone geometry, one shared hazy
  // blue-grey material; the distance fog pushes them back convincingly. All of
  // them stay BELOW the horizon glow line (very flat, very far).
  const islandGeo = new CylinderGeometry(0, 1, 1, 7); // radius-0 top = a cone
  const islandMat = new MeshStandardMaterial({ color: "#7e95a8", roughness: 1.0 });
  const islandsGroup = new Group();
  const islandSpots: [number, number, number, number, number][] = [
    // [x, z, footprint, height, footprintZ]
    [-60, -300, 140, 22, 110], // dead ahead off the bow — "land ho!"
    [-130, -290, 60, 9, 50], // its smaller companion
    [200, -240, 110, 14, 90], // off the starboard bow
    [-300, 60, 160, 18, 120], // far off to port
    [120, 280, 90, 10, 70], // astern, so turning around isn't empty
  ];
  for (const [x, z, sx, sy, sz] of islandSpots) {
    const island = new Mesh(islandGeo, islandMat);
    // Cones are centered on their middle, so sit the base at the waterline.
    island.position.set(x, WATER_Y + sy / 2, z);
    island.scale.set(sx, sy, sz);
    islandsGroup.add(island);
  }
  world.createTransformEntity(islandsGroup, {
    parent: world.sceneEntity,
    persistent: true,
  });

  // --- 8. Hull foam ----------------------------------------------------------------
  // Four soft white rings hugging the waterline along the hull — the "white
  // water" where the sea meets the ship. They parent to the WORLD (not the
  // ship), pinned at water height, so when the ship gently bobs it moves through
  // its own foam exactly like a real moored hull. One shared material whose
  // opacity the AmbientMotionSystem pulses gently.
  const foamMaterial = new MeshBasicMaterial({
    color: PALETTE.FOAM,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });
  const hullFoamGeo = new RingGeometry(0.3, 0.7, 14);
  const foamGroup = new Group();
  for (const [fx, fz] of [
    [-1.45, -3], // port side, toward the bow (ship z offset already applied)
    [1.45, -3],
    [-1.45, 1],
    [1.45, 1],
  ]) {
    const foam = new Mesh(hullFoamGeo, foamMaterial);
    foam.rotation.x = -Math.PI / 2; // lay flat on the water
    foam.scale.set(3.5, 1.4, 1);
    foam.position.set(fx, WATER_Y + 0.01, fz);
    foamGroup.add(foam);
  }
  world.createTransformEntity(foamGroup, {
    parent: world.sceneEntity,
    persistent: true,
  });

  return {
    shipGroup,
    ocean,
    sun,
    anim: {
      sunLight,
      oceanTexture,
      oceanMaterial: oceanMat,
      pennant: pennant.object3D!,
      cloudsGroup,
      gulls,
      foamMaterial,
    },
  };
}

// ----------------------------------------------------------------------------
// makeWaterTexture — paints a small square of "sea" onto a hidden 2D canvas:
// the base ocean blue, ~140 soft wave-top dabs in lighter and darker blues, and
// ~40 tiny cream flecks that catch the sun as sparkle. Tiled across the big
// ocean plane (and slowly scrolled by the AmbientMotionSystem) it turns the
// flat sheet into living water. Built ONCE at startup.
// ----------------------------------------------------------------------------
function makeWaterTexture(): CanvasTexture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = PALETTE.OCEAN;
  ctx.fillRect(0, 0, size, size);

  // Soft elliptical wave dabs — half lighter (sunlit tops), half darker
  // (troughs). Random sizes and angles so no repeating pattern jumps out.
  const dab = (fill: string, count: number) => {
    ctx.fillStyle = fill;
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const rx = 6 + Math.random() * 20;
      const ry = 3 + Math.random() * 6;
      ctx.beginPath();
      ctx.ellipse(x, y, rx, ry, Math.random() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  dab("rgba(77, 108, 128, 0.30)", 70); // PALETTE.WATER_LIT — lit wave tops
  dab("rgba(54, 80, 95, 0.25)", 70); // a darker blue — the troughs

  // Tiny cream flecks: the sparkle the sun glints off as the texture drifts.
  ctx.fillStyle = "rgba(216, 230, 238, 0.5)";
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    ctx.fillRect(x, y, 1 + Math.random(), 1 + Math.random());
  }

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // canvas colors are sRGB — tell three so
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.repeat.set(26, 26); // ~19 m of sea per tile on the 500 m plane
  return texture;
}
