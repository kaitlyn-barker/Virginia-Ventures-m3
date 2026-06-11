// cargoProps.ts
// ----------------------------------------------------------------------------
// The cargo you can SEE. When the student buys a good at Virginia, real crates
// pop onto the ship's deck — one prop per cargo slot — and then sail with the
// ship through the whole voyage. If the storm forces a jettison, those same
// crates fly overboard in an arc and splash into the sea. When the cargo is
// finally sold, the deck empties. Cause and effect a 10-year-old can watch.
//
//   registerCargoProps(world, shipGroup) — call once from index.ts.
//   addCargoProps(good, startSlot, slotCount) — spawn props on the deck.
//   jettisonCargoProps(good) — throw that good's crates into the sea.
//   removeAllCargoProps() — clear the deck (the cargo was sold).
//
// Perf notes (VR: 72-90 fps): ONE shared geometry + material per good type,
// created once at module scope. The pop/jettison animations run in a tiny
// system whose update() only writes scale/position numbers — it never
// allocates, and it goes idle the moment nothing is animating.
// ----------------------------------------------------------------------------

import {
  createSystem,
  createComponent,
  Types,
  Mesh,
  BoxGeometry,
  MeshStandardMaterial,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type World,
  type Entity,
} from "@iwsdk/core";

// ----------------------------------------------------------------------------
// The six deck anchor spots, ship-local [x, z] — midship, between the bow rail
// and the main mast, clear of the crew. Slot 1 fills the first spot, and so on.
// ----------------------------------------------------------------------------
const ANCHORS: [number, number][] = [
  [-0.55, 0.8],
  [0.55, 0.8],
  [-0.55, 1.4],
  [0.55, 1.4],
  [-0.55, 2.0],
  [0.55, 2.0],
];

// One look per trade good — same bright hues as the cargo panel's hold slots,
// so the panel and the deck visibly match. [width, height, depth] per prop.
const PROP_STYLE: Record<
  string,
  { color: string; size: [number, number, number] }
> = {
  tobacco: { color: "#a9b964", size: [0.5, 0.45, 0.5] }, // leaf-green bale
  lumber: { color: "#c08a4f", size: [0.55, 0.28, 0.95] }, // sawn plank stack
  furs: { color: "#d8b48e", size: [0.45, 0.42, 0.45] }, // soft pelt bundle
};

// Shared GPU resources — one geometry + one material per good, made ONCE.
// (Props are removed with entity.destroy(), never dispose(), so these survive.)
const sharedGeo: Record<string, BoxGeometry> = {};
const sharedMat: Record<string, MeshStandardMaterial> = {};
for (const [good, style] of Object.entries(PROP_STYLE)) {
  sharedGeo[good] = new BoxGeometry(...style.size);
  sharedMat[good] = new MeshStandardMaterial({
    color: style.color,
    roughness: 0.85,
  });
}

// ----------------------------------------------------------------------------
// CargoCrate — the data riding on each deck prop: which good it is, where its
// arc starts, and the two animation clocks (pop-in and jettison).
// ----------------------------------------------------------------------------
export const CargoCrate = createComponent("CargoCrate", {
  good: { type: Types.String, default: "" },
  appearElapsed: { type: Types.Float32, default: 0 },
  jettisoning: { type: Types.Boolean, default: false },
  jettisonElapsed: { type: Types.Float32, default: 0 },
  anchorX: { type: Types.Float32, default: 0 },
  anchorZ: { type: Types.Float32, default: 0 },
  restY: { type: Types.Float32, default: 0 },
});

// Module wiring, stashed by registerCargoProps.
let worldRef: World | null = null;
let shipRef: Entity | null = null;
// The live props, tracked here (module scope, like the other phase files) so
// jettison/removal can find them by good without scanning queries from outside.
let crates: { good: string; entity: Entity }[] = [];

// The one reusable SPLASH ring, parented to the WORLD at the waterline (never
// to the rocking ship) and repositioned wherever a crate lands.
let splashMesh: Mesh | null = null;
let splashMat: MeshBasicMaterial | null = null;

/** Hook everything up. Call once from index.ts with the persistent ship group. */
export function registerCargoProps(world: World, shipGroup: Entity): void {
  worldRef = world;
  shipRef = shipGroup;

  splashMat = new MeshBasicMaterial({
    color: "#dfe8ec",
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  splashMesh = new Mesh(new RingGeometry(0.25, 0.55, 14), splashMat);
  splashMesh.rotation.x = -Math.PI / 2; // flat on the water
  splashMesh.position.set(0, -0.49, 0);
  splashMesh.visible = false;
  world.createTransformEntity(splashMesh, {
    parent: world.sceneEntity,
    persistent: true,
  });

  world.registerSystem(CratePopSystem);
}

/**
 * Spawn this good's deck props: one per cargo slot it fills, starting at
 * `startSlot` (0-based). Each pops in with a happy little overshoot.
 */
export function addCargoProps(
  good: string,
  startSlot: number,
  slotCount: number,
): void {
  if (!worldRef || !shipRef) return;
  const style = PROP_STYLE[good];
  if (!style) return;

  for (let i = 0; i < slotCount; i++) {
    const slot = startSlot + i;
    if (slot < 0 || slot >= ANCHORS.length) continue;
    const [x, z] = ANCHORS[slot];
    const restY = style.size[1] / 2; // sit flat on the deck

    const mesh = new Mesh(sharedGeo[good], sharedMat[good]);
    mesh.position.set(x, restY, z);
    mesh.scale.setScalar(0.2); // the pop animation grows it to full size
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = worldRef
      .createTransformEntity(mesh, { parent: shipRef, persistent: true })
      .addComponent(CargoCrate, {
        good,
        appearElapsed: 0,
        jettisoning: false,
        jettisonElapsed: 0,
        anchorX: x,
        anchorZ: z,
        restY,
      });
    crates.push({ good, entity });
  }
}

/**
 * The storm takes its toll: that good's crates arc overboard and splash.
 *
 * `maxCount` limits HOW MANY crates go over — important when the same good was
 * bought twice (e.g. furs + furs fills all six slots): the storm only takes ONE
 * purchase, so only that purchase's crates (its slot count) may fly. The most
 * recently spawned crates go first, matching "the top of the stack washes off".
 */
export function jettisonCargoProps(good: string, maxCount = Infinity): void {
  let flagged = 0;
  for (let i = crates.length - 1; i >= 0 && flagged < maxCount; i--) {
    if (crates[i].good === good) {
      crates[i].entity.setValue(CargoCrate, "jettisoning", true);
      flagged++;
    }
  }
}

/** The cargo was sold — clear the deck. */
export function removeAllCargoProps(): void {
  for (const crate of crates) {
    if (crate.entity.object3D) crate.entity.object3D.visible = false;
    crate.entity.destroy(); // never dispose(): geometry/materials are shared
  }
  crates = [];
}

// Drop one tracked crate after its jettison animation finishes.
function releaseCrate(entity: Entity): void {
  crates = crates.filter((c) => c.entity !== entity);
  // Defer the destroy a tick — we're inside the system's own update loop.
  setTimeout(() => entity.destroy(), 0);
}

// ----------------------------------------------------------------------------
// CratePopSystem — animates pop-ins, jettison arcs, and the splash ring.
// ----------------------------------------------------------------------------
export class CratePopSystem extends createSystem({
  crates: { required: [CargoCrate] },
}) {
  // Splash clock: < 0 means idle. Preallocated scratch vector for positions.
  private splashClock = -1;
  private tmpVec!: Vector3;

  init() {
    this.tmpVec = new Vector3();
  }

  update(delta: number) {
    // Defensive clamp — a stalled frame must not teleport the animations.
    const dt = Math.min(delta, 0.1);

    for (const entity of this.queries.crates.entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      // --- pop-in: 0.2 → 1.12 → 1.0 over 0.35 s --------------------------------
      const appear = entity.getValue(CargoCrate, "appearElapsed") as number;
      if (appear < 0.35) {
        const t = appear + dt;
        entity.setValue(CargoCrate, "appearElapsed", t);
        let s: number;
        if (t < 0.25) {
          s = 0.2 + (1.12 - 0.2) * (t / 0.25); // grow past full size
        } else if (t < 0.35) {
          s = 1.12 + (1.0 - 1.12) * ((t - 0.25) / 0.1); // settle back
        } else {
          s = 1.0;
        }
        obj.scale.setScalar(s);
      }

      // --- jettison: a 1.2 s arc over the starboard rail into the sea ----------
      if (entity.getValue(CargoCrate, "jettisoning")) {
        const t =
          (entity.getValue(CargoCrate, "jettisonElapsed") as number) + dt;
        entity.setValue(CargoCrate, "jettisonElapsed", t);
        const ax = entity.getValue(CargoCrate, "anchorX") as number;
        const az = entity.getValue(CargoCrate, "anchorZ") as number;
        obj.position.set(
          ax + 3 * t, // out over the starboard rail
          0.4 + 2.2 * t - 4.5 * t * t, // up, over, and down
          az,
        );
        obj.rotation.z = -4 * t; // tumbling as it goes

        if (obj.position.y < -0.8 || t > 1.2) {
          // SPLASH where it landed (world position — the ship may be rocking).
          if (splashMesh && splashMat) {
            obj.getWorldPosition(this.tmpVec);
            splashMesh.position.set(this.tmpVec.x, -0.49, this.tmpVec.z);
            splashMesh.scale.setScalar(0.4);
            splashMesh.visible = true;
            splashMat.opacity = 0.7;
            this.splashClock = 0;
          }
          obj.visible = false;
          entity.setValue(CargoCrate, "jettisoning", false);
          releaseCrate(entity);
        }
      }
    }

    // --- the splash ring: grow + fade over 0.8 s, then back to sleep ------------
    if (this.splashClock >= 0 && splashMesh && splashMat) {
      this.splashClock += dt;
      const t = Math.min(this.splashClock / 0.8, 1);
      splashMesh.scale.setScalar(0.4 + 1.2 * t);
      splashMat.opacity = 0.7 * (1 - t);
      if (t >= 1) {
        splashMesh.visible = false;
        this.splashClock = -1;
      }
    }
  }
}
