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
// sign at the land end. Behind the sign the COLONY itself spreads across the
// shore: two log cabins with warm-lit windows, a palisade arc of log posts
// (the Jamestown fort wall), neat rows of tobacco plants, a scatter of pine
// trees, and two glowing lantern posts along the dock. Turn to your right on
// deck to see it all.
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

// A warm, muted green for the shore — not in the shared palette (which is wood/
// sea/sky tones), so we name it here. Kept earthy so it reads as land at golden
// hour rather than a bright cartoon green.
const SHORE_GREEN = "#62803f";

// Colony-only colors, named here the same way SHORE_GREEN is. The cabin tones
// are warmer and redder than the ship's wood so the buildings read as their own
// thing; WINDOW_LIT is the exact warm glow England's windows use, so lit
// windows look the same in both ports.
const CABIN_WALL = "#6b4a2b"; // warm mid-brown log walls
const CABIN_ROOF = "#3e2a16"; // darker bark-brown roofs (and doors)
const WINDOW_LIT = "#e7c98a"; // golden-hour glow through the glass

// The shore plane sits at this height (just above the sea at y = -0.5). Every
// prop that stands ON the land — cabins, palisade, tobacco, trees — uses this
// as its ground level so nothing floats above the grass.
const SHORE_Y = -0.3;

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
  const cabinWallMat = new MeshStandardMaterial({
    color: CABIN_WALL,
    roughness: 0.9, // rough-hewn logs
  });
  const cabinRoofMat = new MeshStandardMaterial({
    color: CABIN_ROOF,
    roughness: 0.8,
  });
  const leafMat = new MeshStandardMaterial({
    color: PALETTE.LEAF_GREEN,
    roughness: 1.0, // leaves are fully matte, like the grass
  });
  // Windows and lanterns GLOW: `emissive` makes a material shine its own color
  // even in shadow. That glow is purely painted-on — it does NOT light up
  // anything around it, so it costs nothing (no real lights here).
  const windowMat = new MeshStandardMaterial({
    color: WINDOW_LIT,
    emissive: WINDOW_LIT,
    emissiveIntensity: 0.6,
    roughness: 0.4,
  });
  const lanternMat = new MeshStandardMaterial({
    color: PALETTE.LANTERN_GLOW,
    emissive: PALETTE.LANTERN_GLOW,
    emissiveIntensity: 1.2, // brighter than the windows — these are the flames
  });
  // Foam is a Basic material (unlit — foam is just white water, it shouldn't
  // pick up shadows) and see-through, so the sea shows faintly underneath.
  // ONE shared material for every ring keeps it cheap.
  const foamMat = new MeshBasicMaterial({
    color: PALETTE.FOAM,
    transparent: true,
    opacity: 0.5,
    depthWrite: false, // don't fight the water surface over who's in front
  });

  // Tiny helper: build a mesh, set its shadow flags, parent it to the port group
  // at a position, and return the ENTITY (its `.object3D` is the mesh, handy if
  // we need to rotate it afterwards).
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

  // --- 1. The Virginia shore --------------------------------------------------
  // A single big flat green plane BEHIND the dock to suggest the land. It sits
  // just above the waterline (ocean is at y = -0.5) and starts past the end of
  // the dock (around x = 11), filling the background off to starboard.
  const shore = addMesh(
    new PlaneGeometry(60, 60),
    greenMat,
    41, // centered far out to starboard so its front edge is the shoreline
    SHORE_Y, // a low bank, just above the sea
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

  // Foam rings: a flat white ring of "churned water" hugging each piling where
  // it meets the sea. One shared ring shape + the shared see-through foam
  // material, laid flat 1 cm ABOVE the water (y = -0.49 vs the sea's -0.5) so
  // it floats on the surface instead of fighting it. Foam doesn't cast or
  // receive shadows — it's just bright water.
  const foamGeo = new RingGeometry(0.18, 0.34, 12);
  for (const x of [3, 6, 9]) {
    for (const z of [-1.0, 1.0]) {
      const ring = addMesh(foamGeo, foamMat, x, -0.49, z, false, false);
      ring.object3D!.rotation.x = -Math.PI / 2; // lay the ring flat on the sea
    }
  }

  // The gangplank: one short board bridging the gap between the ship's hull
  // edge (x ≈ 1.3) and the start of the dock (x = 1.8). A tiny tilt makes it
  // read as a board LEANED from ship to dock rather than a floating shelf.
  // This is the prop that says "the ship is moored at THIS dock" — and it gives
  // the invisible walkable floor a visible reason to let you cross.
  const gangplank = addMesh(new BoxGeometry(0.9, 0.06, 0.7), woodMat, 1.55, 0.02, 0);
  gangplank.object3D!.rotation.z = 0.04; // the gentle lean, ship side up

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
  // (cast=false: a zero-thickness plane makes a degenerate shadow — the board
  // box behind it already casts the sign's real shadow.)
  const signFace = addMesh(new PlaneGeometry(2.4, 0.72), signMat, 10.46, 1.7, 0, false, false);
  signFace.object3D!.rotation.y = -Math.PI / 2; // face -X, toward the moored ship

  // --- 5. Settler cabins --------------------------------------------------------
  // Two small log cabins on the shore behind the sign, so Virginia reads as a
  // real colony and not just a dock. Each is the classic primitive trick England
  // uses for its grand houses (see englandPort.ts `addBuilding`), shrunk down
  // and re-dressed in warm cabin wood: a box of walls, plus a roof made from a
  // box turned 45° about X — the square cross-section becomes a diamond, and the
  // half poking above the walls reads as a triangular gable. The ridge runs
  // along X so the gable END faces the ship and you see the storybook cabin
  // shape from the deck. A dark door and two warm-lit windows finish the face
  // that looks back at you.
  const addBuilding = (
    centerX: number,
    centerZ: number,
    widthZ: number, // side-to-side span (along Z), the gable's base width
    depthX: number, // how far the cabin runs back from the shore (along X)
    wallHeight: number,
    wallMat: MeshStandardMaterial,
  ) => {
    // Walls: one box standing on the grass (base at SHORE_Y).
    addMesh(
      new BoxGeometry(depthX, wallHeight, widthZ),
      wallMat,
      centerX,
      SHORE_Y + wallHeight / 2,
      centerZ,
    );

    // Roof: size the diamond so its horizontal diagonal (a·√2) slightly
    // overhangs the walls for eaves. Centering it at the wall top buries its
    // lower half inside the walls; the visible upper half is the gable.
    const a = (widthZ / Math.SQRT2) * 1.08; // 8% eave overhang past the walls
    const roof = addMesh(
      new BoxGeometry(depthX * 1.04, a, a), // ridge runs along X (the depth)
      cabinRoofMat,
      centerX,
      SHORE_Y + wallHeight, // half-buried: the diagonal sits on the roofline
      centerZ,
    );
    roof.object3D!.rotation.x = Math.PI / 4; // square → diamond → gable peak

    // The face that looks back toward the ship is the cabin's -X side.
    const frontX = centerX - depthX / 2;

    // A dark door, centered on that front face, standing just proud of it.
    addMesh(
      new BoxGeometry(0.06, 1.6, 0.9),
      cabinRoofMat,
      frontX - 0.03,
      SHORE_Y + 0.8, // base on the grass, 1.6 m tall
      centerZ,
    );

    // Two warm-lit windows flanking the door, set just proud of the same face.
    // Glowing things don't cast or receive shadows — they make their own light.
    const windowGeo = new BoxGeometry(0.06, 0.7, 0.6);
    const windowY = SHORE_Y + Math.min(2.4, wallHeight - 0.8); // clear of the roof
    addMesh(windowGeo, windowMat, frontX - 0.03, windowY, centerZ - 0.95, false, false);
    addMesh(windowGeo, windowMat, frontX - 0.03, windowY, centerZ + 0.95, false, false);
  };

  // One cabin on each side of the dock's end, framing the view inland.
  addBuilding(14.0, -2.6, 3.0, 2.4, 2.2, cabinWallMat);
  addBuilding(15.2, 2.6, 2.6, 2.2, 2.0, cabinWallMat);

  // --- 6. The palisade ----------------------------------------------------------
  // A shallow arc of 16 tall log posts sweeping behind the tobacco field —
  // the wall of the Jamestown fort. All 16 posts share ONE cylinder shape; only
  // their positions differ. We walk a straight line between the two end points
  // and bow each post a little way OUT from the colony (most in the middle,
  // none at the ends) so the row curves like a real fort wall.
  const palisadeGeo = new CylinderGeometry(0.07, 0.07, 1.7);
  const palStart = { x: 12.5, z: -5.5 };
  const palEnd = { x: 18.5, z: -7.5 };
  for (let i = 0; i < 16; i++) {
    const t = i / 15; // 0 at the first post, 1 at the last
    const bow = Math.sin(t * Math.PI) * 0.6; // biggest bulge mid-arc
    // (-0.316, -0.949) is the direction at right angles to the wall line,
    // pointing away from the cabins — the side the arc bulges toward.
    const x = palStart.x + (palEnd.x - palStart.x) * t - 0.316 * bow;
    const z = palStart.z + (palEnd.z - palStart.z) * t - 0.949 * bow;
    addMesh(palisadeGeo, woodMat, x, SHORE_Y + 0.85, z, true, false); // base on the grass
  }

  // --- 7. The tobacco field -----------------------------------------------------
  // Virginia's cash crop — the thing this whole voyage is about! Each plant is
  // one squat five-sided cone (wide at the bottom like a leafy bush), all
  // sharing ONE shape and the leaf material. Planted in a neat 4-row × 6-plant
  // grid so the farm rows read clearly from the deck.
  const tobaccoGeo = new CylinderGeometry(0.03, 0.24, 0.55, 5);
  for (let row = 0; row < 4; row++) {
    for (let plant = 0; plant < 6; plant++) {
      const x = 16 + plant * 0.9; // 6 plants per row, x 16 → 20.5
      const z = -3.2 - row * 0.8; // 4 rows, z -3.2 → -5.6
      addMesh(tobaccoGeo, leafMat, x, SHORE_Y + 0.275, z); // base on the grass
    }
  }

  // --- 8. Trees -----------------------------------------------------------------
  // Six pines scattered across the shore so Virginia reads as the wooded New
  // World. Every tree is the same three pieces — a tapered trunk plus two
  // stacked cones of leaves — sharing the SAME three shapes. Each whole tree is
  // scaled up or down a little (`s`) so the woods don't look copy-pasted; the
  // y-positions are multiplied by `s` too so a scaled tree still stands exactly
  // on the grass.
  const trunkGeo = new CylinderGeometry(0.1, 0.14, 1.3);
  const canopyLowGeo = new CylinderGeometry(0, 0.9, 1.3, 7);
  const canopyTopGeo = new CylinderGeometry(0, 0.65, 1.0, 7);
  const addTree = (x: number, z: number, s: number) => {
    const trunk = addMesh(trunkGeo, woodMat, x, SHORE_Y + 0.65 * s, z);
    trunk.object3D!.scale.setScalar(s);
    const lower = addMesh(canopyLowGeo, leafMat, x, SHORE_Y + 1.75 * s, z);
    lower.object3D!.scale.setScalar(s);
    const upper = addMesh(canopyTopGeo, leafMat, x, SHORE_Y + 2.35 * s, z);
    upper.object3D!.scale.setScalar(s);
  };
  addTree(19, 4.5, 1.1);
  addTree(23, 7, 0.9);
  addTree(26, -9, 1.25);
  addTree(30, 2, 1.0);
  addTree(22, -12, 0.85);
  addTree(34, -4, 1.15);

  // --- 9. Lantern posts on the dock ----------------------------------------------
  // Two slim posts at the dock's outer edges, each topped with a glowing lantern
  // cube. The glow is painted on with the emissive lantern material — there are
  // NO real lights here, so two lanterns cost the same as two plain cubes. They
  // sit at the very edge of the planks, well clear of the walkway down the
  // middle of the dock.
  const lanternPostGeo = new CylinderGeometry(0.05, 0.05, 1.5);
  const lanternCubeGeo = new BoxGeometry(0.18, 0.22, 0.18);
  addMesh(lanternPostGeo, woodMat, 4.6, 0.75, 1.05); // post spans y 0 → 1.5
  addMesh(lanternCubeGeo, lanternMat, 4.6, 1.6, 1.05, false, false); // the flame
  addMesh(lanternPostGeo, woodMat, 8.2, 0.75, -1.05);
  addMesh(lanternCubeGeo, lanternMat, 8.2, 1.6, -1.05, false, false);

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
