// virginiaPort.ts
// ----------------------------------------------------------------------------
// The VIRGINIA port scenery — the first leg of Captain's Voyage. This is the
// per-leg dressing that sits AROUND the shared ship + ocean base (built in
// environment.ts). The ship and sea stay loaded the whole voyage; only this
// surrounding scenery changes from port to port.
//
// Everything here is built from IWSDK PRIMITIVE SHAPES (boxes, planes,
// cylinders) in the shared warm palette — no imported 3D models. It's lit by the
// same warm "sun" and ambient fill as the base, so it matches automatically.
//
// One reusable function, `createVirginiaPort(world)`. Call it once after
// `createVoyageEnvironment(world)`. Its entities are NON-persistent (the default),
// so if you later switch legs with `world.loadLevel(...)` this scenery clears
// out while the persistent ship + ocean remain.
//
// Layout: the ship is moored facing -Z (out to sea). The port sits off the
// STARBOARD side (+X): a wooden dock runs from the ship out to a low green
// Virginia shore, with crates and barrels stacked on it and a gold "Virginia"
// sign at the land end. Turn to your right on deck to see it.
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

// A warm, muted green for the shore — not in the shared palette (which is wood/
// sea/sky tones), so we name it here. Kept earthy so it reads as land at golden
// hour rather than a bright cartoon green.
const SHORE_GREEN = "#62803f";

export function createVirginiaPort(world: World): Entity {
  // One parent group for the whole port, so the entire leg can be moved or
  // cleared as a unit. Non-persistent = it belongs to the current level.
  const portGroup = world.createTransformEntity(new Group());

  // Shared materials (made once, reused by many parts — cheaper than one each).
  const woodMat = new MeshStandardMaterial({
    color: PALETTE.SHIP_WOOD,
    roughness: 0.85,
  });
  const creamMat = new MeshStandardMaterial({
    color: PALETTE.CREAM,
    roughness: 0.8,
  });
  const greenMat = new MeshStandardMaterial({
    color: SHORE_GREEN,
    roughness: 1.0, // grass/earth is fully matte
  });

  // Tiny helper: build a mesh, set its shadow flags, parent it to the port group
  // at a position, and return the ENTITY (its `.object3D` is the mesh, handy if
  // we need to rotate it afterwards).
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

  // --- 1. The Virginia shore --------------------------------------------------
  // A single big flat green plane BEHIND the dock to suggest the land. It sits
  // just above the waterline (ocean is at y = -0.5) and starts past the end of
  // the dock (around x = 11), filling the background off to starboard.
  const shore = addMesh(
    new PlaneGeometry(60, 60),
    greenMat,
    41, // centered far out to starboard so its front edge is the shoreline
    -0.3, // a low bank, just above the sea
    0,
    false, // the ground doesn't cast a shadow
    true,
  );
  shore.object3D!.rotation.x = -Math.PI / 2; // lay it flat (normal points up)

  // --- 2. The dock ------------------------------------------------------------
  // A wooden boardwalk running along X, from just off the ship's starboard hull
  // (x ≈ 1.8) out to the shore (x ≈ 11). Built from three long plank boxes laid
  // side by side so you read individual planks. Its top sits at y = 0 — the same
  // height as the ship's deck — so it reads as something you could step onto.
  const dockStartX = 1.8;
  const dockEndX = 11;
  const dockLength = dockEndX - dockStartX; // 9.2 m
  const dockCenterX = (dockStartX + dockEndX) / 2;
  const plankGeo = new BoxGeometry(dockLength, 0.18, 0.78);
  for (const z of [-0.82, 0, 0.82]) {
    addMesh(plankGeo, woodMat, dockCenterX, -0.09, z, false, true); // top lands at y=0
  }

  // Pilings: round posts holding the dock up out of the water. A few cylinders
  // dropping from the dock down past the sea surface.
  const pilingGeo = new CylinderGeometry(0.13, 0.13, 0.9);
  for (const x of [3, 6, 9]) {
    for (const z of [-1.0, 1.0]) {
      addMesh(pilingGeo, woodMat, x, -0.45, z, true, false); // y spans 0 → -0.9
    }
  }

  // --- 3. Cargo: crates and barrels -------------------------------------------
  // Crates are boxes, barrels are short cylinders — a mix of SHIP_WOOD and CREAM.
  // Stacked near the ship end of the dock, as if waiting to be loaded. (A crate
  // of size s sits with its center at y = s/2 so it rests on the dock at y = 0.)
  addMesh(new BoxGeometry(0.7, 0.7, 0.7), woodMat, 4.0, 0.35, -0.5); // base crate
  addMesh(new BoxGeometry(0.6, 0.6, 0.6), creamMat, 4.0, 1.0, -0.5); // stacked on top
  addMesh(new BoxGeometry(0.55, 0.55, 0.55), creamMat, 4.8, 0.275, -0.4); // beside
  addMesh(new BoxGeometry(0.65, 0.65, 0.65), woodMat, 5.1, 0.325, 0.55); // another

  const barrelGeo = new CylinderGeometry(0.3, 0.3, 0.66);
  addMesh(barrelGeo, woodMat, 3.2, 0.33, 0.6); // barrel center at half-height
  addMesh(barrelGeo, creamMat, 3.85, 0.33, 0.8);
  addMesh(new CylinderGeometry(0.28, 0.28, 0.6), woodMat, 3.1, 0.3, -0.55);

  // --- 4. The "Virginia" sign -------------------------------------------------
  // A small world-space sign at the shore end of the dock, facing back toward the
  // ship so you read it as you look down the dock. The word "Virginia" is drawn
  // in GOLD on a wood board. We render the text by painting it onto a 2D canvas
  // and using that canvas as a texture — no font files or models to import.
  const signTexture = makeSignTexture();
  const signMat = new MeshStandardMaterial({ map: signTexture, roughness: 0.7 });

  // Two posts holding the board up.
  const signPostGeo = new BoxGeometry(0.12, 1.7, 0.12);
  addMesh(signPostGeo, woodMat, 10.55, 0.85, -0.95);
  addMesh(signPostGeo, woodMat, 10.55, 0.85, 0.95);

  // A solid wood board behind the lettering (gives the sign physical thickness).
  addMesh(new BoxGeometry(0.08, 0.8, 2.5), woodMat, 10.5, 1.7, 0);

  // The lettering itself: a plane carrying the canvas texture, mounted just in
  // FRONT of the board (toward the ship) and turned to face -X so the player
  // reads it from the deck.
  const signFace = addMesh(new PlaneGeometry(2.4, 0.72), signMat, 10.46, 1.7, 0, true, false);
  signFace.object3D!.rotation.y = -Math.PI / 2; // face -X, toward the moored ship

  return portGroup;
}

// Paints "Virginia" in gold on a dark-wood board and returns it as a texture.
// Using a 2D canvas means we get crisp text from a normal web font with nothing
// to download — perfect for a single primitive-built sign.
function makeSignTexture(): CanvasTexture {
  const width = 600;
  const height = 180;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  // Wood board background.
  ctx.fillStyle = PALETTE.SHIP_WOOD;
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
  ctx.fillText("Virginia", width / 2, height / 2 + 4);

  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace; // canvas colors are sRGB — tell three so
  texture.anisotropy = 8; // keep the text sharp at a grazing angle
  return texture;
}
