// npcs.ts
// ----------------------------------------------------------------------------
// The people of Captain's Voyage — sailors crewing the ship, and colonists /
// merchants / officials at each port. They are built in the SAME style as the
// previous VR experience (Virginia-Ventures-m1's colonists): low-poly,
// Minecraft-style humanoids assembled entirely from PRIMITIVE SHAPES
// (boxes / cylinders / spheres) — there are no rigged character GLBs.
//
// Because primitives carry no animation clips, every figure is STATIC, modelled
// in a relaxed standing pose (arms hang at the sides, never a T-pose). What is
// honoured fully, exactly as before:
//   - Per-NPC clothing tints applied to clothing meshes only (skin is always a
//     separate mesh, never tinted by clothing).
//   - Matte materials (high roughness, no emissive) — never neon / glowing.
//   - Varied skin tones for diversity.
//   - Role-based size variation (blacksmith broader, captain taller, children
//     short).
//   - Period-appropriate silhouettes (shirts / breeches, long dresses + aprons,
//     bonnets, wide-brim / tricorn / straw / cap hats, a long coat for the
//     captain) and period props (hoe, basket, hammer, book, scroll, pouch).
//
// Three placement functions drop them into the world:
//   - addShipCrew(world, shipGroup) — sailors on the deck. Parented to the
//     PERSISTENT ship group so they sail along with it across every leg.
//   - addVirginiaColonists(world, portGroup) — frontier planters, a tobacco
//     trader and a dockhand on the warm timber Virginia dock + green shore.
//   - addEnglandColonists(world, portGroup) — a fine merchant, a Crown customs
//     official and dockhands on the cold stone England quay.
// Port NPCs parent to that leg's (non-persistent) port group, so they clear out
// with the rest of the scenery when the leg changes.
//
// Swap-in path (unchanged from before): when rigged colonist GLBs exist, replace
// makeColonist() with AssetManager.getGLTF(...) clones and play their idle clips;
// the placement tables below can stay as-is.
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  BoxGeometry,
  CylinderGeometry,
  SphereGeometry,
  Group,
  Mesh,
  Object3D,
  MeshStandardMaterial,
} from "@iwsdk/core";

// ── Palettes ────────────────────────────────────────────────────────────────
// Skin tones (varied for diversity). Never tinted by clothing colours.
const SKIN = {
  light: 0xe7c6a3,
  medium: 0xc89a6e,
  tan: 0xa9794d,
  dark: 0x8a5e38,
} as const;

const HAIR = {
  brown: 0x4a3526,
  grey: 0x9a958c,
  black: 0x2a2420,
  sandy: 0x8a6a3f,
} as const;

// Clothing colours (matte; applied to cloth meshes only).
const C = {
  offWhite: 0xd4c9a8,
  warmBrown: 0x6b4f3a,
  darkLeather: 0x3d2b1f,
  sage: 0x7a8b6f,
  cream: 0xe8dcc8,
  charcoal: 0x4a4a4a,
  burgundy: 0x6b3a3a,
  forest: 0x3a5a3a,
  navy: 0x1b2a4a,
  darkGold: 0x8b7332,
  fadedTan: 0xb8a88a,
  headCream: 0xe0d5c0,
  grayBlue: 0x6b7b8a,
  fadedSage: 0x7a8b6f,
  sailorNavy: 0x2e3a4a,
  fadedBrown: 0x6b5b4a,
} as const;

// Prop materials (held items).
const PROP = {
  brown: 0x6b4f3a, // default wood / leather / basket weave
  darkBrown: 0x3d2b1f, // book leather, pouch
  gray: 0x8a857c, // hoe blade, hammer head (iron)
  green: 0x3f6a2c, // herbs in the basket
  cream: 0xe8dcc8, // rolled scroll / document / pages
} as const;

type Geometry = BoxGeometry | CylinderGeometry | SphereGeometry;

// Small matte part helper: a shadow-casting mesh with a flat-shaded (low-poly)
// matte material, mirroring m1's `solid(...)`.
function part(geo: Geometry, color: number, flat = true): Mesh {
  const mat = new MeshStandardMaterial({
    color,
    roughness: 0.9,
    flatShading: flat,
  });
  const mesh = new Mesh(geo, mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

type HatType = "wide" | "tricorn" | "straw" | "bonnet" | "cap" | "low";

/**
 * A held prop, parented to a colonist's hand mesh (the primitive equivalent of a
 * hand bone — there is no rigged skeleton here). `build` returns a Group whose
 * local origin is the grip point. Model "front" is local +Z, so the anatomical
 * RIGHT hand sits on −X and the LEFT hand on +X.
 */
interface PropSpec {
  build: () => Object3D;
  hand: "left" | "right";
  pos?: [number, number, number];
  rot?: [number, number, number];
}

interface ColonistOpts {
  name?: string;
  prop?: PropSpec;
  skin: number;
  shirt: number; // torso colour when no coat/dress
  legs?: number; // breeches colour (ignored if `dress` set)
  belt?: number;
  apron?: number; // front panel (blacksmith / herbalist)
  vest?: number; // bodice / vest overlay
  coat?: number; // long coat (captain)
  trim?: number; // coat collar + button strips
  boots?: number;
  dress?: number; // long flared dress
  headwrap?: number;
  hair?: number;
  hat?: { type: HatType; color: number };
  broad?: boolean; // wider torso / limbs
  beard?: number; // optional beard colour (lower face)
}

/**
 * Build one relaxed-standing colonist from primitives. Feet rest at local y = 0
 * so the group can be dropped straight onto the ground (or dock / deck via a y
 * offset), and uniform scaling keeps the feet grounded.
 */
function makeColonist(o: ColonistOpts): Group {
  const g = new Group();
  if (o.name) g.name = o.name;
  const bw = o.broad ? 1.16 : 1; // body-width factor
  const hipY = 0.85;

  // ── Lower body: a blocky skirt, or two box breeches legs (+ optional boots) ─
  if (o.dress !== undefined) {
    const skirt = part(new BoxGeometry(0.5, hipY + 0.05, 0.3), o.dress);
    skirt.position.y = (hipY + 0.05) / 2;
    g.add(skirt);
  } else {
    const legColor = o.legs ?? o.shirt;
    for (const sx of [-1, 1]) {
      const leg = part(new BoxGeometry(0.19 * bw, hipY, 0.2), legColor);
      leg.position.set(sx * 0.11, hipY / 2, 0);
      g.add(leg);
      if (o.boots !== undefined) {
        const boot = part(new BoxGeometry(0.17 * bw, 0.22, 0.26), o.boots);
        boot.position.set(sx * 0.1, 0.11, 0.03);
        g.add(boot);
      }
    }
  }

  // ── Torso ────────────────────────────────────────────────────────────────
  const torsoColor = o.dress ?? o.coat ?? o.shirt;
  const torsoH = 0.56;
  const torsoY = hipY + torsoH / 2; // 1.13
  const torso = part(new BoxGeometry(0.42 * bw, torsoH, 0.24), torsoColor);
  torso.position.y = torsoY;
  g.add(torso);
  const torsoTopY = hipY + torsoH; // 1.41

  // ── Long coat (captain) — hangs from chest to mid-thigh, with trim ────────
  if (o.coat !== undefined) {
    const coat = part(new BoxGeometry(0.46 * bw, 1.0, 0.27), o.coat);
    coat.position.y = 0.9;
    g.add(coat);
    if (o.trim !== undefined) {
      const collar = part(new BoxGeometry(0.22, 0.1, 0.29), o.trim);
      collar.position.y = torsoTopY - 0.03;
      g.add(collar);
      for (const sx of [-0.06, 0.06]) {
        const strip = part(new BoxGeometry(0.03, 0.75, 0.02), o.trim);
        strip.position.set(sx, torsoY - 0.05, 0.145);
        g.add(strip);
      }
    }
  }

  // ── Apron (front panel) ──────────────────────────────────────────────────
  if (o.apron !== undefined) {
    const apron = part(new BoxGeometry(0.3 * bw, 0.72, 0.06), o.apron);
    apron.position.set(0, hipY + 0.06, 0.13);
    g.add(apron);
  }

  // ── Vest / bodice overlay ────────────────────────────────────────────────
  if (o.vest !== undefined) {
    const vest = part(new BoxGeometry(0.44 * bw, 0.5, 0.27), o.vest);
    vest.position.y = torsoY + 0.02;
    g.add(vest);
  }

  // ── Belt ─────────────────────────────────────────────────────────────────
  if (o.belt !== undefined) {
    const belt = part(new BoxGeometry(0.45 * bw, 0.1, 0.26), o.belt);
    belt.position.y = hipY + 0.02;
    g.add(belt);
  }

  // ── Arms: blocky sleeves with a skin "hand" band at the wrist (Minecraft
  //    style). Vertical at the sides — never a T-pose. ──────────────────────
  const sleeveColor = o.coat ?? o.shirt;
  const armW = 0.19 * bw;
  const armX = 0.21 * bw + armW / 2 - 0.02;
  const sleeveLen = 0.44;
  let rightHand: Object3D | undefined; // sx = −1 (anatomical right)
  let leftHand: Object3D | undefined; //  sx = +1 (anatomical left)
  for (const sx of [-1, 1]) {
    const sleeve = part(new BoxGeometry(armW, sleeveLen, 0.2), sleeveColor);
    sleeve.position.set(sx * armX, torsoTopY - sleeveLen / 2, 0);
    g.add(sleeve);
    const hand = part(new BoxGeometry(armW, 0.12, 0.2), o.skin);
    hand.position.set(sx * armX, torsoTopY - sleeveLen - 0.06, 0);
    g.add(hand);
    if (sx === -1) rightHand = hand;
    else leftHand = hand;
  }

  // ── Head: a blocky cube + a painted face ─────────────────────────────────
  const headSize = 0.42;
  const headHalf = headSize / 2;
  const headY = torsoTopY + headHalf + 0.02;
  const head = part(new BoxGeometry(headSize, headSize, headSize), o.skin);
  head.position.y = headY;
  g.add(head);
  buildFace(g, headY, headHalf, o);

  // Hair as box shells on top + back (skipped when a hat covers the head).
  if (o.hair !== undefined && !o.hat) {
    const hairTop = part(
      new BoxGeometry(headSize + 0.03, 0.12, headSize + 0.03),
      o.hair,
    );
    hairTop.position.y = headY + headHalf - 0.04;
    g.add(hairTop);
    const hairBack = part(
      new BoxGeometry(headSize + 0.03, headSize * 0.7, 0.06),
      o.hair,
    );
    hairBack.position.set(0, headY + 0.05, -headHalf - 0.005);
    g.add(hairBack);
  }

  if (o.headwrap !== undefined) {
    const wrap = part(
      new BoxGeometry(headSize + 0.04, 0.14, headSize + 0.04),
      o.headwrap,
    );
    wrap.position.y = headY + headHalf - 0.05;
    g.add(wrap);
  }

  if (o.hat) addHat(g, o.hat, headY);

  // ── Held prop: parent to the chosen hand mesh so it tracks that hand. ──────
  if (o.prop) {
    const target = o.prop.hand === "right" ? rightHand : leftHand;
    if (target) {
      const prop = o.prop.build();
      prop.name = `${o.name ?? "colonist"}-prop`;
      if (o.prop.pos) prop.position.set(...o.prop.pos);
      if (o.prop.rot) prop.rotation.set(...o.prop.rot);
      target.add(prop);
    }
  }

  return g;
}

/**
 * Paint a simple blocky face on the head's front (+Z) face: white eyes with dark
 * pupils, eyebrows, a small protruding nose, a mouth, and an optional beard.
 */
function buildFace(g: Group, headY: number, headHalf: number, o: ColonistOpts) {
  const z = headHalf + 0.001; // flush against the front face
  const browColor = o.hair ?? 0x3a2a1c;
  for (const sx of [-1, 1]) {
    const eyeX = sx * 0.085;
    const sclera = part(new BoxGeometry(0.062, 0.05, 0.02), 0xf2efe6);
    sclera.position.set(eyeX, headY + 0.045, z);
    g.add(sclera);
    const pupil = part(new BoxGeometry(0.028, 0.034, 0.02), 0x2a2018);
    pupil.position.set(eyeX + sx * 0.008, headY + 0.045, z + 0.012);
    g.add(pupil);
    const brow = part(new BoxGeometry(0.078, 0.02, 0.02), browColor);
    brow.position.set(eyeX, headY + 0.096, z);
    g.add(brow);
  }
  const nose = part(new BoxGeometry(0.05, 0.07, 0.05), o.skin);
  nose.position.set(0, headY - 0.01, z + 0.01);
  g.add(nose);
  const mouth = part(new BoxGeometry(0.12, 0.025, 0.02), 0x5a3d30);
  mouth.position.set(0, headY - 0.1, z);
  g.add(mouth);
  if (o.beard !== undefined) {
    const beard = part(new BoxGeometry(0.36, 0.18, 0.07), o.beard);
    beard.position.set(0, headY - 0.13, headHalf - 0.025);
    g.add(beard);
  }
}

/** Add a blocky, Minecraft-style period hat at the given head height. */
function addHat(g: Group, hat: { type: HatType; color: number }, headY: number) {
  const c = hat.color;
  const top = headY + 0.21; // ≈ top of the head cube
  if (hat.type === "wide" || hat.type === "straw" || hat.type === "low") {
    const brim = part(new BoxGeometry(0.62, 0.04, 0.62), c);
    const crown = part(new BoxGeometry(0.34, 0.18, 0.34), c);
    const y = hat.type === "low" ? headY + 0.11 : top - 0.01;
    brim.position.y = y;
    crown.position.y = y + 0.1;
    g.add(brim, crown);
  } else if (hat.type === "tricorn") {
    const brim = part(new BoxGeometry(0.56, 0.05, 0.5), c);
    brim.position.y = top;
    brim.rotation.y = Math.PI / 4; // angled square → tricorn-ish silhouette
    const crown = part(new BoxGeometry(0.3, 0.16, 0.3), c);
    crown.position.y = top + 0.09;
    g.add(brim, crown);
  } else if (hat.type === "bonnet") {
    const shell = part(new BoxGeometry(0.48, 0.36, 0.46), c);
    shell.position.set(0, headY + 0.05, -0.05);
    g.add(shell);
  } else if (hat.type === "cap") {
    const cap = part(new BoxGeometry(0.46, 0.16, 0.46), c);
    cap.position.y = top - 0.05;
    g.add(cap);
  }
}

// ── Prop builders ───────────────────────────────────────────────────────────
// Each returns a Group whose local origin is the GRIP point. Tools stand up from
// the grip along +Y; the blade / head sits at the far end.

/** Hoe: thin ~0.8 m brown handle + a flattened gray blade up top. */
function makeHoe(): Group {
  const g = new Group();
  const handleLen = 0.8;
  const handle = part(new CylinderGeometry(0.016, 0.018, handleLen, 8), PROP.brown);
  handle.position.y = handleLen / 2 - 0.15;
  g.add(handle);
  const blade = part(new BoxGeometry(0.12, 0.15, 0.03), PROP.gray);
  blade.position.set(0, 0.59, 0.06);
  blade.rotation.x = Math.PI / 2.6;
  g.add(blade);
  return g;
}

/** Herb basket: short wide brown cylinder + green bits poking out. */
function makeBasket(): Group {
  const g = new Group();
  const r = 0.1;
  const h = 0.15;
  const wall = part(new CylinderGeometry(r, r * 0.85, h, 12, 1, true), PROP.brown);
  wall.position.y = h / 2;
  g.add(wall);
  const floor = part(new CylinderGeometry(r * 0.85, r * 0.85, 0.015, 12), PROP.brown);
  floor.position.y = 0.0075;
  g.add(floor);
  for (const [hx, hz] of [[-0.03, 0.02], [0.04, -0.01], [0.0, -0.04]] as const) {
    const herb = part(new BoxGeometry(0.05, 0.07, 0.05), PROP.green);
    herb.position.set(hx, h + 0.02, hz);
    g.add(herb);
  }
  return g;
}

/** Hammer / mallet: ~0.4 m brown handle + a gray cube head. */
function makeHammer(): Group {
  const g = new Group();
  const handleLen = 0.4;
  const handle = part(new CylinderGeometry(0.013, 0.015, handleLen, 8), PROP.brown);
  handle.position.y = handleLen / 2 - 0.1;
  g.add(handle);
  const head = part(new BoxGeometry(0.08, 0.06, 0.05), PROP.gray);
  head.position.y = handleLen - 0.1;
  g.add(head);
  return g;
}

/** Book / ledger: palm-sized flattened cube, brown leather, lies flat. */
function makeBook(): Group {
  const g = new Group();
  const cover = part(new BoxGeometry(0.15, 0.03, 0.2), PROP.darkBrown);
  g.add(cover);
  const pages = part(new BoxGeometry(0.13, 0.018, 0.18), PROP.cream);
  pages.position.y = 0.018;
  g.add(pages);
  return g;
}

/** Scroll / document: small tapered cream tube. */
function makeScroll(): Group {
  const g = new Group();
  const scroll = part(new CylinderGeometry(0.028, 0.032, 0.25, 10), PROP.cream);
  g.add(scroll);
  return g;
}

/** Coiled rope: a stout brown torus-ish ring (a short fat cylinder shell). */
function makeRopeCoil(): Group {
  const g = new Group();
  const coil = part(new CylinderGeometry(0.1, 0.1, 0.07, 12, 1, true), PROP.brown);
  coil.position.y = 0.035;
  g.add(coil);
  const inner = part(new CylinderGeometry(0.06, 0.06, 0.07, 12, 1, true), PROP.darkBrown);
  inner.position.y = 0.035;
  g.add(inner);
  return g;
}

/** Crate / small cargo box, held two-handed in front of the chest. */
function makeCargoBox(): Group {
  const g = new Group();
  const box = part(new BoxGeometry(0.34, 0.3, 0.3), PROP.brown);
  g.add(box);
  // A pale band across it, like a roped parcel.
  const band = part(new BoxGeometry(0.36, 0.05, 0.32), PROP.cream);
  g.add(band);
  return g;
}

// ── Placement helper ──────────────────────────────────────────────────────────
function placeNpc(
  world: World,
  parent: Entity,
  g: Object3D,
  x: number,
  z: number,
  opts: {
    y?: number;
    yaw?: number;
    faceShip?: boolean;
    scale?: [number, number, number] | number;
  } = {},
): void {
  if (opts.scale !== undefined) {
    if (Array.isArray(opts.scale)) g.scale.set(...opts.scale);
    else g.scale.setScalar(opts.scale);
  }
  g.position.set(x, opts.y ?? 0, z);
  // Model "front" is local +Z. The ship sits around the parent origin (x ≈ 0),
  // so to face the moored ship we point +Z back toward (0, 0): yaw = atan2(−x, −z).
  if (opts.faceShip) g.rotation.y = Math.atan2(-x, -z);
  else if (opts.yaw !== undefined) g.rotation.y = opts.yaw;
  world.createTransformEntity(g, { parent });
}

// =============================================================================
// SHIP CREW — sailors on the deck. Parented to the PERSISTENT ship group, so
// they sail with the ship through every leg. Deck top is local y = 0; the deck
// is ~2.4 m wide (|x| ≲ 0.95) and runs bow (−Z) to stern (+Z). The player stands
// at ship-local ≈ (0, 0, 1), so crew are placed clear of that spot: two working
// amidships/aft by the masts, and a lookout up at the bow rail facing the sea.
// =============================================================================
export function addShipCrew(world: World, shipGroup: Entity): void {
  // Sailor coiling rope, amidships to starboard, facing inboard toward the deck.
  placeNpc(
    world,
    shipGroup,
    makeColonist({
      skin: SKIN.tan,
      shirt: C.offWhite,
      vest: C.sailorNavy,
      legs: C.fadedBrown,
      hat: { type: "cap", color: C.sailorNavy },
      prop: { build: makeRopeCoil, hand: "left", pos: [-0.02, -0.04, 0.06] },
    }),
    0.7,
    2.6,
    { yaw: -2.3 },
  );

  // Sailor hauling cargo near the main mast, port side, facing the player.
  placeNpc(
    world,
    shipGroup,
    makeColonist({
      skin: SKIN.medium,
      shirt: C.offWhite,
      vest: C.fadedBrown,
      legs: C.fadedBrown,
      hair: HAIR.brown,
      beard: HAIR.brown,
      hat: { type: "cap", color: C.fadedBrown },
      prop: { build: makeCargoBox, hand: "right", pos: [0.18, 0.0, 0.12] },
    }),
    -0.7,
    3.6,
    { yaw: 0.5 },
  );

  // Lookout at the bow rail, gazing out to sea (-Z). A weathered older hand.
  placeNpc(
    world,
    shipGroup,
    makeColonist({
      skin: SKIN.dark,
      shirt: C.grayBlue,
      vest: C.sailorNavy,
      legs: C.darkLeather,
      hair: HAIR.grey,
      hat: { type: "wide", color: C.fadedBrown },
    }),
    -0.55,
    -3.4,
    { yaw: Math.PI }, // face -Z, out over the bow toward the horizon
  );
}

// =============================================================================
// VIRGINIA COLONISTS — the warm timber New-World frontier. Frontier planters and
// a tobacco trader on the wooden dock (top y = 0, x ≈ 1.8…11, |z| ≲ 1), with a
// couple of figures up on the green shore behind (shore plane top y ≈ -0.3,
// land starts near x ≈ 11). Parented to the (non-persistent) Virginia port group.
// =============================================================================
export function addVirginiaColonists(world: World, portGroup: Entity): void {
  // Dockhand loading cargo by the crates near the ship end, facing the ship.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      skin: SKIN.tan,
      shirt: C.offWhite,
      legs: C.warmBrown,
      belt: C.darkLeather,
      hair: HAIR.brown,
      prop: { build: makeCargoBox, hand: "right", pos: [0.18, 0.0, 0.12] },
    }),
    6.0,
    0.7,
    { faceShip: true },
  );

  // Tobacco trader near the sign, ledger in hand, ready to deal — faces the ship.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Trader",
      skin: SKIN.light,
      shirt: C.cream,
      dress: C.burgundy,
      vest: C.forest,
      hair: HAIR.brown,
      prop: { build: makeBook, hand: "left", pos: [-0.03, 0.05, 0.06] },
    }),
    9.2,
    -0.6,
    { faceShip: true },
  );

  // Planter up on the shore with his hoe, looking out over the dock to the ship.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Planter",
      skin: SKIN.tan,
      shirt: C.offWhite,
      legs: C.warmBrown,
      belt: C.darkLeather,
      hair: HAIR.brown,
      beard: HAIR.brown,
      hat: { type: "wide", color: C.warmBrown },
      prop: { build: makeHoe, hand: "right", pos: [0.0, 0.02, 0.06] },
    }),
    12.6,
    -2.0,
    { y: -0.3, faceShip: true },
  );

  // Herbalist on the shore with her basket, a long dress + bonnet.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Herbalist",
      skin: SKIN.medium,
      shirt: C.sage,
      dress: C.sage,
      apron: C.cream,
      hat: { type: "bonnet", color: C.cream },
      prop: { build: makeBasket, hand: "left", pos: [-0.03, -0.06, 0.08] },
    }),
    13.2,
    1.6,
    { y: -0.3, faceShip: true },
  );

  // A child on the shore, plain clothes, short (uniform 0.6 scale keeps feet down).
  placeNpc(
    world,
    portGroup,
    makeColonist({
      skin: SKIN.medium,
      shirt: C.fadedTan,
      dress: C.fadedSage,
      hair: HAIR.sandy,
    }),
    12.0,
    0.4,
    { y: -0.3, yaw: -1.4, scale: 0.6 },
  );
}

// =============================================================================
// ENGLAND COLONISTS — the cold stone Old-World harbour. A fine merchant and a
// Crown customs official on the stone dock / quay (dock top y = 0; the quay slab
// behind tops out at y ≈ 0.05), with dockhands working the slabs. Parented to the
// (non-persistent) England port group.
// =============================================================================
export function addEnglandColonists(world: World, portGroup: Entity): void {
  // Dockhand coiling rope on the stone slabs near the ship end, facing the ship.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      skin: SKIN.medium,
      shirt: C.grayBlue,
      vest: C.fadedBrown,
      legs: C.darkLeather,
      hair: HAIR.black,
      hat: { type: "cap", color: C.fadedBrown },
      prop: { build: makeRopeCoil, hand: "left", pos: [-0.02, -0.04, 0.06] },
    }),
    6.4,
    0.7,
    { faceShip: true },
  );

  // Fine merchant in a bodiced burgundy dress with a ledger, near the sign.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Merchant",
      skin: SKIN.light,
      shirt: C.cream,
      dress: C.burgundy,
      vest: C.charcoal,
      hair: HAIR.brown,
      hat: { type: "bonnet", color: C.cream },
      prop: { build: makeBook, hand: "left", pos: [-0.03, 0.05, 0.06] },
    }),
    9.2,
    -0.7,
    { faceShip: true },
  );

  // Crown customs official up on the quay: navy coat + gold trim, tricorn, boots,
  // scroll in the left hand — the most formal figure, slightly taller. Faces ship.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Customs Official",
      skin: SKIN.light,
      shirt: C.offWhite,
      legs: C.navy,
      coat: C.navy,
      trim: C.darkGold,
      boots: C.darkLeather,
      hat: { type: "tricorn", color: C.navy },
      hair: HAIR.grey,
      prop: {
        build: makeScroll,
        hand: "left",
        pos: [-0.02, 0.03, 0.05],
        rot: [Math.PI / 2.2, 0, 0],
      },
    }),
    11.8,
    0.2,
    { y: 0.05, faceShip: true, scale: [1.0, 1.03, 1.0] },
  );

  // Blacksmith working near the quay buildings: charcoal shirt, leather apron,
  // broader build, hammer in hand.
  placeNpc(
    world,
    portGroup,
    makeColonist({
      name: "Smith",
      skin: SKIN.tan,
      shirt: C.charcoal,
      legs: C.darkLeather,
      apron: C.darkLeather,
      belt: C.darkLeather,
      hair: HAIR.black,
      beard: HAIR.black,
      broad: true,
      prop: { build: makeHammer, hand: "right", pos: [0.0, 0.0, 0.05] },
    }),
    12.6,
    2.4,
    { y: 0.05, yaw: -2.3, scale: [1.08, 1.05, 1.1] },
  );
}
