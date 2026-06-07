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
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  Group,
  Mesh,
  BoxGeometry,
  CylinderGeometry,
  PlaneGeometry,
  MeshStandardMaterial,
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

  // Tiny helper: build a mesh, set its shadow flags, parent it to the port group
  // at a position, and return the ENTITY (its `.object3D` is the mesh, handy if
  // we need to rotate it afterwards). Mirrors virginiaPort.ts's `addMesh`.
  const addMesh = (
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
    // Walls: one box sitting on the quay (base at y = 0).
    addMesh(
      new BoxGeometry(depthX, wallHeight, widthZ),
      wallMat,
      centerX,
      wallHeight / 2,
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
      wallHeight, // half-buried: horizontal diagonal sits on the roofline
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
      0.8, // base on the quay, 1.6 m tall
      centerZ,
    );

    // Two warm-lit windows flanking the door, set just proud of the same face.
    const windowGeo = new BoxGeometry(0.06, 0.7, 0.6);
    const windowY = Math.min(2.4, wallHeight - 0.8); // upper storey, clear of the roof
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
  const signFace = addMesh(new PlaneGeometry(2.4, 0.72), signMat, 10.46, 1.7, 0, true, false);
  signFace.object3D!.rotation.y = -Math.PI / 2; // face -X, toward the moored ship

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
