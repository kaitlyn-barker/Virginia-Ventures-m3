// englandPort.ts
// ----------------------------------------------------------------------------
// The ENGLAND port scenery — the second leg of Captain's Voyage. Like the
// Virginia port, this is per-leg dressing that sits AROUND the shared ship +
// ocean base (built in environment.ts). The ship and sea stay loaded the whole
// voyage; only this surrounding scenery changes from port to port.
//
// Everything here is built from IWSDK PRIMITIVE SHAPES (boxes, planes,
// cylinders) — no imported 3D models. It is lit by the SAME warm "sun" and
// ambient fill as the base, so it matches automatically; the only thing that
// changes is the PALETTE we paint it in.
//
// England is meant to read as the cold, grand "Old World" counterpoint to
// Virginia's warm timber frontier. So where Virginia is dark wood + green
// shore, England is COOL STONE GREY: a grey stone dock and a pair of taller,
// grander gabled buildings in cooler greys, with a slate quay and a cold
// grey-green coast. The one warm note is the GOLD "England" sign — the same
// brass-gold used on the ship's railing — tying the two ports to one world.
//
// One reusable function, `createEnglandPort(world)`. It is called when the
// player clicks "Set Sail" at Virginia (see voyagePhases.ts), after that leg's
// scenery has been torn down. Its entities are NON-persistent (the default), so
// the persistent ship + ocean remain while this scenery is what's on stage.
//
// Layout mirrors Virginia so the two legs feel like the same dock seen at two
// different ports: the ship is moored facing -Z (out to sea); the port sits off
// the STARBOARD side (+X). A stone dock runs from the ship out to a low stone
// quay, where two grand grey buildings rise behind a gold "England" sign. Turn
// to your right on deck to see it.
//
// Behind that first row the SKYLINE keeps going: a church tower rises over the
// rooftops, a wooden crane leans over the dock end frozen mid-hoist, three
// iron quay lamps glow gold, and a second ship sits at anchor out on the port
// bow. Down at the waterline, foam rings cling to the pilings and a gangplank
// bridges the ship's rail to the dock — small touches that make the harbor
// feel busy and REAL, not just a backdrop.
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  RingGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  CanvasTexture,
  SRGBColorSpace,
} from "@iwsdk/core";

import { PALETTE } from "./palette.js";

// England's COOL palette. These greys are NOT in the shared PALETTE (which is
// the warm wood/cream/gold/sea/sky world), so we name them here — exactly as
// virginiaPort.ts names its own SHORE_GREEN. Kept cool and a little desaturated
// so the whole port reads as cold Old-World stone against the golden-hour light,
// the deliberate contrast to Virginia's warm timber.
const STONE_DOCK = "#8c9196"; // mid cool-grey — the dock slabs and pilings
const STONE_LIGHT = "#a4abb1"; // light cool-grey — the grander building's walls
const STONE_DARK = "#727a82"; // darker cool-grey — the second building's walls
const SLATE_ROOF = "#454e57"; // cold dark slate — the peaked roofs
const STONE_QUAY = "#7d848b"; // the paved quay slab the buildings stand on
const WINDOW_LIT = "#e7c98a"; // warm window glow — golden hour through the glass
const COAST_GREY = "#5f6f64"; // cold grey-green English coast (cf. Virginia green)
const CRANE_WOOD = "#4a3624"; // dark tarred timber — the dockside crane
const ROPE_DARK = "#2a2a2a"; // near-black hemp — the crane's hoisting rope
const ANCHORED_WOOD = "#4a3a2c"; // weathered hull wood — the ship at anchor
const LAMP_IRON = "#2f343a"; // cold cast iron — the quay lamp posts

export function createEnglandPort(world: World): Entity {
  // One parent group for the whole port, so the entire leg can be moved or
  // cleared as a unit. Non-persistent = it belongs to the current level.
  const portGroup = world.createTransformEntity(new Group());

  // Shared materials (made once, reused by many parts — cheaper than one each).
  const dockMat = new MeshStandardMaterial({
    color: STONE_DOCK,
    roughness: 0.95, // rough quarried stone
  });
  const quayMat = new MeshStandardMaterial({
    color: STONE_QUAY,
    roughness: 0.95,
  });
  const wallLightMat = new MeshStandardMaterial({
    color: STONE_LIGHT,
    roughness: 0.9,
  });
  const wallDarkMat = new MeshStandardMaterial({
    color: STONE_DARK,
    roughness: 0.9,
  });
  const roofMat = new MeshStandardMaterial({
    color: SLATE_ROOF,
    roughness: 0.6, // wet slate is a touch glossy
  });
  const doorMat = new MeshStandardMaterial({
    color: SLATE_ROOF, // a dark slate door, same cold tone as the roofs
    roughness: 0.7,
  });
  // Windows self-glow a warm gold so the cold grey buildings read as lit and
  // lived-in at golden hour — the only warmth on the stone, echoing the sign.
  const windowMat = new MeshStandardMaterial({
    color: WINDOW_LIT,
    emissive: WINDOW_LIT,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const coastMat = new MeshStandardMaterial({
    color: COAST_GREY,
    roughness: 1.0, // grass/earth is fully matte
  });
  const craneWoodMat = new MeshStandardMaterial({
    color: CRANE_WOOD,
    roughness: 0.9, // rough tarred timber
  });
  const ropeMat = new MeshStandardMaterial({
    color: ROPE_DARK,
    roughness: 1.0, // rope has no shine at all
  });
  const lampPostMat = new MeshStandardMaterial({
    color: LAMP_IRON,
    roughness: 0.8, // dull painted iron
  });
  const anchoredShipMat = new MeshStandardMaterial({
    color: ANCHORED_WOOD,
    roughness: 0.9, // one material for the whole far-off ship — at this
    // distance you read the silhouette, not the details
  });
  // Foam is a MeshBasicMaterial (unlit) so the white water stays bright no
  // matter how the light hits it. `depthWrite: false` keeps the see-through
  // rings from fighting the water surface for which one is "in front".
  const foamMat = new MeshBasicMaterial({
    color: PALETTE.FOAM,
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
  });

  // Tiny helper: build a mesh, set its shadow flags, parent it to the port group
  // at a position, and return the ENTITY (its `.object3D` is the mesh, handy if
  // we need to rotate it afterwards). Mirrors virginiaPort.ts's `addMesh`.
  const addMesh = (
    geometry: BoxGeometry | CylinderGeometry | PlaneGeometry | RingGeometry,
    material: MeshStandardMaterial | MeshBasicMaterial,
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
    return world.createTransformEntity(mesh, { parent: portGroup });
  };

  // --- 1. The English coast ---------------------------------------------------
  // A single big flat plane BEHIND the dock to suggest the land — same idea as
  // Virginia's shore, but a cold grey-green instead of a warm meadow green. It
  // sits just above the waterline (ocean is at y = -0.5) and fills the
  // background off to starboard.
  const coast = addMesh(
    new PlaneGeometry(60, 60),
    coastMat,
    41, // centered far out to starboard so its front edge is the shoreline
    -0.3, // a low bank, just above the sea
    0,
    false, // the ground doesn't cast a shadow
    true,
  );
  coast.object3D!.rotation.x = -Math.PI / 2; // lay it flat (normal points up)

  // --- 2. The stone dock ------------------------------------------------------
  // A stone boardwalk running along X, from just off the ship's starboard hull
  // (x ~= 1.8) out to the quay (x ~= 11). Built from three long slab boxes laid
  // side by side so you read individual flagstones. Its top sits at y = 0 — the
  // same height as the ship's deck — so it reads as something you could step
  // onto. Same plan as the Virginia dock, swapped from planks to stone slabs.
  const dockStartX = 1.8;
  const dockEndX = 11;
  const dockLength = dockEndX - dockStartX; // 9.2 m
  const dockCenterX = (dockStartX + dockEndX) / 2;
  const slabGeo = new BoxGeometry(dockLength, 0.18, 0.78);
  for (const z of [-0.82, 0, 0.82]) {
    addMesh(slabGeo, dockMat, dockCenterX, -0.09, z, false, true); // top lands at y=0
  }

  // Pilings: stout stone posts holding the dock up out of the water. A few
  // cylinders dropping from the dock down past the sea surface.
  const pilingGeo = new CylinderGeometry(0.16, 0.16, 0.9);
  for (const x of [3, 6, 9]) {
    for (const z of [-1.0, 1.0]) {
      addMesh(pilingGeo, dockMat, x, -0.45, z, true, false); // y spans 0 -> -0.9
    }
  }

  // --- 3. The quay ------------------------------------------------------------
  // A broad low paved slab at the land end that the grand buildings stand on. It
  // raises them a hair above the dock (top at y = 0.05) so they read as set up
  // on a proper stone quayside rather than floating on the coast plane.
  addMesh(
    new BoxGeometry(5.4, 0.4, 9.2),
    quayMat,
    13.6, // centered over the land behind the dock end
    -0.15, // center so its top lands just above the dock at y = 0.05
    0,
    false,
    true,
  );

  // --- 4. The grand buildings -------------------------------------------------
  // Two taller, grander shapes than anything at Virginia: a box body with a
  // simple PEAKED-ROOF prism on top, in cooler greys. The roof prism is the
  // classic primitive trick (the same one the ship's bow uses): a box turned 45°
  // about an axis becomes a diamond in cross-section, and the half that pokes
  // above the wall reads as a triangular gable. We run the ridge along X so the
  // gable END faces the ship (-X), giving the player the storybook "row of
  // gabled harbour houses" silhouette as they look down the dock.
  //
  // `addBuilding` places one: walls + half-buried gable roof, then a dark door
  // and two warm-lit windows on the face that looks back toward the ship.
  const addBuilding = (
    centerX: number,
    centerZ: number,
    widthZ: number, // side-to-side span (along Z), the gable's base width
    depthX: number, // how far the building runs back from the quay (along X)
    wallHeight: number,
    wallMat: MeshStandardMaterial,
  ) => {
    // Everything stands on TOP of the quay slab (its surface is y = 0.05) —
    // basing the walls at y = 0 would sink them 5 cm into the slab and make
    // the two surfaces flicker where they overlap ("z-fighting").
    const QUAY_TOP = 0.05;

    // Walls: one box sitting on the quay.
    addMesh(
      new BoxGeometry(depthX, wallHeight, widthZ),
      wallMat,
      centerX,
      QUAY_TOP + wallHeight / 2,
      centerZ,
    );

    // Roof: a box whose square YZ cross-section (side `a`) we turn 45° about X
    // into a diamond. `a` is sized so the diamond's horizontal diagonal (a*sqrt2)
    // slightly overhangs the wall width for eaves. Centering the diamond at the
    // wall top buries its lower half inside the walls; the visible upper half is
    // the gable, peaking a*sqrt2/2 above the roofline.
    const a = (widthZ / Math.SQRT2) * 1.08; // 8% eave overhang past the walls
    const roof = addMesh(
      new BoxGeometry(depthX * 1.04, a, a), // ridge runs along X (the depth)
      roofMat,
      centerX,
      QUAY_TOP + wallHeight, // half-buried: horizontal diagonal on the roofline
      centerZ,
    );
    roof.object3D!.rotation.x = Math.PI / 4; // square -> diamond -> gable peak

    // The face that looks back toward the ship is the building's -X side.
    const frontX = centerX - depthX / 2;

    // A tall dark door, centered on that front face, standing just proud of it.
    addMesh(
      new BoxGeometry(0.06, 1.6, 0.9),
      doorMat,
      frontX - 0.03,
      QUAY_TOP + 0.8, // base on the quay, 1.6 m tall
      centerZ,
    );

    // Two warm-lit windows flanking the door, set just proud of the same face.
    const windowGeo = new BoxGeometry(0.06, 0.7, 0.6);
    const windowY = QUAY_TOP + Math.min(2.4, wallHeight - 0.8); // upper storey
    addMesh(windowGeo, windowMat, frontX - 0.03, windowY, centerZ - 0.95, false, false);
    addMesh(windowGeo, windowMat, frontX - 0.03, windowY, centerZ + 0.95, false, false);
  };

  // The grander, taller building to one side of the dock's end...
  addBuilding(13.6, -1.7, 3.2, 2.8, 4.2, wallLightMat);
  // ...and a shorter, darker one to the other side, framing the gold sign.
  addBuilding(13.2, 2.2, 2.6, 2.4, 3.2, wallDarkMat);

  // --- 5. The "England" sign --------------------------------------------------
  // A small world-space sign at the land end of the dock, facing back toward the
  // ship so you read it as you look down the dock — the England twin of the
  // Virginia sign. The word "England" is drawn in GOLD (the shared brass-gold)
  // on a slate board. We render the text by painting it onto a 2D canvas and
  // using that canvas as a texture — no font files or models to import.
  const signTexture = makeSignTexture();
  const signMat = new MeshStandardMaterial({ map: signTexture, roughness: 0.7 });

  // Two stone posts holding the board up.
  const signPostGeo = new BoxGeometry(0.12, 1.7, 0.12);
  addMesh(signPostGeo, dockMat, 10.55, 0.85, -0.95);
  addMesh(signPostGeo, dockMat, 10.55, 0.85, 0.95);

  // A solid slate board behind the lettering (gives the sign physical thickness).
  addMesh(new BoxGeometry(0.08, 0.8, 2.5), roofMat, 10.5, 1.7, 0);

  // The lettering itself: a plane carrying the canvas texture, mounted just in
  // FRONT of the board (toward the ship) and turned to face -X so the player
  // reads it from the deck.
  // (cast=false: a zero-thickness plane makes a degenerate shadow — the board
  // box behind it already casts the sign's real shadow.)
  const signFace = addMesh(new PlaneGeometry(2.4, 0.72), signMat, 10.46, 1.7, 0, false, false);
  signFace.object3D!.rotation.y = -Math.PI / 2; // face -X, toward the moored ship

  // --- 6. The gangplank ---------------------------------------------------------
  // One short plank bridging the ship's rail (hull edge at x ~= 1.3) to the
  // start of the dock (x = 1.8). The invisible floor already LETS you walk from
  // deck to dock — this little board is what makes that walk look believable.
  // A tiny tilt (the deck and dock are not quite level) sells it as a real
  // plank someone threw down, not part of the dock.
  const gangplank = addMesh(
    new BoxGeometry(0.9, 0.06, 0.7),
    dockMat,
    1.55, // centered over the gap between hull and dock
    0.02, // just proud of the deck/dock tops at y = 0
    0,
  );
  gangplank.object3D!.rotation.z = 0.04; // a hair of slope, ship end up

  // --- 7. Foam rings at the pilings ---------------------------------------------
  // Where each stone piling meets the sea, a flat see-through ring of white
  // water hugs the post — the same trick real water does around anything that
  // stands in it. One shared ring shape + the one shared foam material serve
  // all six pilings. Laid flat 1 cm ABOVE the ocean plane (y = -0.5) so the
  // foam floats on the water instead of being swallowed by it.
  const foamRingGeo = new RingGeometry(0.18, 0.34, 12);
  for (const x of [3, 6, 9]) {
    for (const z of [-1.0, 1.0]) {
      const foam = addMesh(foamRingGeo, foamMat, x, -0.49, z, false, false);
      foam.object3D!.rotation.x = -Math.PI / 2; // lay the ring flat on the sea
    }
  }

  // --- 8. The church tower --------------------------------------------------------
  // The silhouette that says "Old World": a tall square stone tower with a
  // four-sided spire, rising a full 3 m over the grandest building's ridge.
  // Virginia has nothing this tall — one glance at the skyline tells you which
  // port you're in. It stands BEHIND the buildings (z = -5.6), past the edge of
  // the main quay slab, so it gets its own small stone pad to stand on —
  // without it the tower would float over the coast plane.
  addMesh(new BoxGeometry(2.4, 0.3, 2.4), quayMat, 15.6, -0.15, -5.6, false, true);
  addMesh(new BoxGeometry(1.7, 6.5, 1.7), wallLightMat, 15.6, 3.25, -5.6);
  // The spire: a cone with only 4 sides is a pyramid. We spin it 45° so its
  // flat faces line up with the tower's flat walls instead of its corners.
  const spire = addMesh(new CylinderGeometry(0, 1.25, 2.2, 4), roofMat, 15.6, 7.6, -5.6);
  spire.object3D!.rotation.y = Math.PI / 4;
  // One tall lit window high on the side facing the ship (-X), so the tower
  // shares the warm-glass glow of the houses below it.
  addMesh(new BoxGeometry(0.06, 0.9, 0.5), windowMat, 14.72, 5.2, -5.6, false, false);

  // --- 9. The harbor crane ----------------------------------------------------------
  // A wooden cargo crane leaning out over the dock end, frozen mid-hoist with a
  // crate still on the rope — pure storytelling. Nobody is working it, but it
  // says "goods move through this harbor all day". The post stands clear of
  // the walking lane (z = 4.0), and the jib is a leaning cylinder whose top end
  // lands at about (10.7, 3.2) — out over the dock, where the rope drops from.
  addMesh(new CylinderGeometry(0.12, 0.14, 3.4), craneWoodMat, 12.4, 1.7, 4.0);
  const jib = addMesh(new CylinderGeometry(0.08, 0.08, 2.6), craneWoodMat, 11.62, 2.28, 4.0);
  jib.object3D!.rotation.z = Math.PI / 4; // lean it 45°: foot at the post, tip over the dock
  addMesh(new BoxGeometry(0.025, 1.6, 0.025), ropeMat, 10.7, 2.4, 4.0, false, false);
  addMesh(new BoxGeometry(0.55, 0.55, 0.55), craneWoodMat, 10.7, 1.8, 4.0);

  // --- 10. The quay lamps -----------------------------------------------------------
  // Three iron lamp posts along the land end of the dock, each topped with a
  // small glowing lamp head in the same warm window material. The glow is
  // EMISSIVE only (the material shines on its own) — no real lights, so they
  // cost almost nothing — echoing the lit windows behind them.
  const lampPostGeo = new CylinderGeometry(0.05, 0.05, 2.2);
  const lampHeadGeo = new BoxGeometry(0.16, 0.2, 0.16);
  for (const z of [-3.2, 0, 3.2]) {
    addMesh(lampPostGeo, lampPostMat, 11.4, 1.1, z);
    addMesh(lampHeadGeo, windowMat, 11.4, 2.3, z, false, false);
  }

  // --- 11. A second ship at anchor ---------------------------------------------------
  // Far out on the port bow (off to the LEFT as you face out to sea), another
  // trading ship rides at anchor, sails furled, waiting for its turn at the
  // dock. It's scale storytelling: a busy harbor has more than one ship. At
  // 65 m away it only needs to read as a silhouette, so the whole thing is a
  // handful of plain boxes and cylinders in ONE weathered-wood material.
  //
  // We build it in its OWN little Group first, using easy ship-local
  // coordinates (origin at the waterline, bow toward -Z), then hand the whole
  // group to the world as ONE entity parented to the port group — so it sails
  // away with the rest of England when this leg is torn down. It's far outside
  // the sun's shadow box, so shadow flags stay off (they'd be wasted work).
  const anchoredShip = new Group();
  const addShipPart = (
    geometry: BoxGeometry | CylinderGeometry,
    x: number,
    y: number,
    z: number,
  ): Mesh => {
    const part = new Mesh(geometry, anchoredShipMat);
    part.position.set(x, y, z);
    part.castShadow = false;
    part.receiveShadow = false;
    anchoredShip.add(part); // plain three parenting INSIDE the group, which
    return part; //            becomes a single entity just below
  };
  // Hull: sits a little low in the water, like a loaded ship should.
  addShipPart(new BoxGeometry(2.0, 1.0, 7.0), 0, 0.35, 0);
  // Prow: the same 45°-box trick as the buildings' roofs, but turned about Y —
  // the diamond's front corner pokes ahead of the hull as a pointed bow.
  const prow = addShipPart(new BoxGeometry(1.42, 1.0, 1.42), 0, 0.35, -3.5);
  prow.rotation.y = Math.PI / 4;
  // A low cabin at the stern, a main mast, and a mizzen (rear) mast.
  addShipPart(new BoxGeometry(1.6, 0.55, 1.3), 0, 1.1, 2.7);
  addShipPart(new CylinderGeometry(0.07, 0.07, 5), 0, 3.35, 0.4);
  addShipPart(new CylinderGeometry(0.05, 0.06, 3.4), 0, 2.5, 2.4);
  // The furled sail: canvas rolled up against its crossbar reads as one thick
  // horizontal cylinder on the main mast.
  const furledSail = addShipPart(new CylinderGeometry(0.18, 0.18, 2.4), 0, 2.7, 0.4);
  furledSail.rotation.z = Math.PI / 2; // lie it across the mast
  // The bowsprit: the spar that points forward-and-up over the bow.
  const bowsprit = addShipPart(new CylinderGeometry(0.05, 0.05, 1.6), 0, 0.95, -4.2);
  bowsprit.rotation.x = -1.2; // tip up out of the bow, toward -Z
  // Drop the finished ship into the harbor: out at anchor, swung a little on
  // its anchor line so it isn't perfectly square to the coast.
  const anchoredShipEntity = world.createTransformEntity(anchoredShip, {
    parent: portGroup,
  });
  anchoredShipEntity.object3D!.position.set(-35, -0.5, -55);
  anchoredShipEntity.object3D!.rotation.y = 0.4;

  return portGroup;
}

// Paints "England" in gold on a dark slate board and returns it as a texture.
// Using a 2D canvas means we get crisp text from a normal web font with nothing
// to download — the same approach as the Virginia sign, kept consistent so the
// two ports' signs read as a matched pair (gold lettering, gold frame).
function makeSignTexture(): CanvasTexture {
  const width = 600;
  const height = 180;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Slate board background (cool dark grey to match the roofs).
  ctx.fillStyle = SLATE_ROOF;
  ctx.fillRect(0, 0, width, height);

  // A thin gold border to frame it.
  ctx.strokeStyle = PALETTE.GOLD;
  ctx.lineWidth = 12;
  ctx.strokeRect(12, 12, width - 24, height - 24);

  // The gold lettering, centered.
  ctx.fillStyle = PALETTE.GOLD;
  ctx.font = "bold 96px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("England", width / 2, height / 2 + 4);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // canvas colors are sRGB — tell three so
  texture.anisotropy = 8; // keep the text sharp at a grazing angle
  return texture;
}
