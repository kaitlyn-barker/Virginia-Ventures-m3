// ambientMotion.ts
// ----------------------------------------------------------------------------
// The ONE system that keeps the world alive — and runs the weather.
//
// Every frame it gives the scene its gentle motion: the sea drifts, the ship
// bobs, the pennant flutters, the gulls circle and flap, the clouds creep, and
// the foam pulses. It ALSO owns the STORM: when the voyage hits the Atlantic
// storm, other files call `setStormPhase("raging")` and this system smoothly
// darkens the sky, dims the sun, whips up the ship's rocking, and starts the
// rain — then eases it all back when the storm clears.
//
// Putting all motion in one place matters: two systems fighting over the ship's
// rotation would jitter. And because this runs EVERY frame in VR (72-90 fps),
// nothing in update() is allowed to allocate memory — every color, matrix, and
// array below is created once in init() and reused forever.
//
// Exports:
//   registerAmbientMotion(world, env) — call once from index.ts after
//     createVoyageEnvironment. Also rigs the ship's bell.
//   setStormPhase(phase) — "calm" | "building" | "raging" | "clearing".
//   ringShipBell(times, gapMs) — ding the ship's bell (the one audio file).
// ----------------------------------------------------------------------------

import {
  createSystem,
  type World,
  type Entity,
  DomeGradient,
  IBLGradient,
  AudioSource,
  AudioUtils,
  PlaybackMode,
  Color,
  Matrix4,
  InstancedMesh,
  BoxGeometry,
  MeshBasicMaterial,
} from "@iwsdk/core";

import { PALETTE } from "./palette.js";
import type { VoyageEnvironment } from "./environment.js";

// ----------------------------------------------------------------------------
// Module-scope wiring. The env handles are stashed here by registerAmbientMotion
// so the system (whose constructor IWSDK owns) can reach them, and so other
// phase files can flip the weather without holding a system reference.
// ----------------------------------------------------------------------------

export type StormPhase = "calm" | "building" | "raging" | "clearing";

let env: VoyageEnvironment | null = null;
let bellEntity: Entity | null = null;

// Where the weather is HEADED (0 = calm golden hour, 1 = full storm). The
// system eases its actual intensity toward this a little each frame, so the sky
// always changes smoothly, never snaps.
let stormTarget = 0;

/** Flip the voyage's weather. The change fades in over a few seconds. */
export function setStormPhase(phase: StormPhase): void {
  if (phase === "raging") stormTarget = 1;
  else if (phase === "building") stormTarget = 0.5;
  else stormTarget = 0; // "calm" and "clearing" both head back to golden hour
}

/**
 * Ring the ship's bell `times` times, `gapMs` apart. The bell is positional
 * audio at the main mast, so it really rings from the ship.
 */
export function ringShipBell(times = 1, gapMs = 700): void {
  if (!bellEntity) return;
  for (let i = 0; i < times; i++) {
    setTimeout(() => {
      if (bellEntity) AudioUtils.play(bellEntity);
    }, i * gapMs);
  }
}

/**
 * Hook the motion system up. Call ONCE from index.ts, right after
 * createVoyageEnvironment(world) — pass its return value in.
 */
export function registerAmbientMotion(
  world: World,
  environment: VoyageEnvironment,
): void {
  env = environment;

  // The ship's bell: chime.mp3 living at the main mast. Overlap mode lets quick
  // double- and triple-rings stack instead of cutting each other off.
  bellEntity = world.createTransformEntity(undefined, {
    parent: env.shipGroup,
    persistent: true,
  });
  bellEntity.object3D!.position.set(0, 1.5, 2.5); // ship-local: the main mast
  bellEntity.addComponent(AudioSource, {
    src: "/audio/chime.mp3",
    positional: true,
    refDistance: 4,
    volume: 0.8,
    playbackMode: PlaybackMode.Overlap,
    maxInstances: 3,
  });

  world.registerSystem(AmbientMotionSystem);
}

// ----------------------------------------------------------------------------
// Small helper: hex "#rrggbb" → [r, g, b] each 0..1 (for the sky lerp tables).
// ----------------------------------------------------------------------------
function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

// ----------------------------------------------------------------------------
// The system itself.
// ----------------------------------------------------------------------------
export class AmbientMotionSystem extends createSystem({}, {}) {
  // The weather's CURRENT intensity (eases toward stormTarget at ~0.4/s).
  private intensity = 0;
  // The intensity we last painted the sky with — lets us skip all the sky/sun
  // writes entirely on the (vast majority of) frames when the weather is steady.
  private lastApplied = -1;

  // --- everything below is allocated ONCE in init(), reused every frame ------
  // Calm and storm endpoint colors for the sky dome + ambient light, as plain
  // [r,g,b] rows: [sky, equator, ground].
  private calmDome!: [number, number, number][];
  private stormDome!: [number, number, number][];
  private calmIbl!: [number, number, number][];
  private stormIbl!: [number, number, number][];

  // Direct float views into the DomeGradient/IBLGradient color fields on the
  // level root. (Runtime env-color changes MUST go through getVectorView — the
  // component setValue path silently ignores arrays.)
  private domeViews: Float32Array[] | null = null;
  private iblViews: Float32Array[] | null = null;

  private sunCalm!: Color;
  private sunStorm!: Color;
  private oceanCalm!: Color;
  private oceanStorm!: Color;

  // The rain: one InstancedMesh of falling streaks, hidden while calm.
  private rain!: InstancedMesh;
  private rainX!: Float32Array;
  private rainY!: Float32Array;
  private rainZ!: Float32Array;
  private rainSpeed!: Float32Array;
  private rainMat!: MeshBasicMaterial;
  private tmpMatrix!: Matrix4;

  init() {
    // Sky endpoints. Calm = exactly what environment.ts set at startup; storm =
    // the same sky gone cold and heavy. Kept as plain number rows so the per-
    // frame lerp is pure arithmetic.
    this.calmDome = [
      hexToRgb(PALETTE.SKY),
      hexToRgb(PALETTE.HORIZON_PEACH),
      hexToRgb(PALETTE.OCEAN),
    ];
    this.stormDome = [hexToRgb("#3a4a57"), hexToRgb("#6b7884"), hexToRgb("#2c3a45")];
    this.calmIbl = [
      hexToRgb("#f8e8c8"),
      hexToRgb(PALETTE.CREAM),
      hexToRgb(PALETTE.OCEAN),
    ];
    this.stormIbl = [hexToRgb("#8a96a0"), hexToRgb("#6b7884"), hexToRgb("#2c3a45")];

    // Grab the writable color views off the level root once. If there is no
    // active level (shouldn't happen — environment.ts already used it), the
    // storm simply skips its sky writes instead of crashing. peek() reads the
    // signal without subscribing — we only need the value this once.
    const root = this.world.activeLevel?.peek();
    if (root) {
      this.domeViews = [
        root.getVectorView(DomeGradient, "sky") as Float32Array,
        root.getVectorView(DomeGradient, "equator") as Float32Array,
        root.getVectorView(DomeGradient, "ground") as Float32Array,
      ];
      this.iblViews = [
        root.getVectorView(IBLGradient, "sky") as Float32Array,
        root.getVectorView(IBLGradient, "equator") as Float32Array,
        root.getVectorView(IBLGradient, "ground") as Float32Array,
      ];
    }

    this.sunCalm = new Color("#ffd9a0");
    this.sunStorm = new Color("#cfd8de");
    this.oceanCalm = new Color("#ffffff"); // the texture carries the sea color
    this.oceanStorm = new Color("#7e8d96"); // storm tint multiplies it darker

    // Build the rain once: 240 thin streaks scattered in a box around the deck.
    // MeshBasicMaterial (unlit), never casts shadows, frustum culling off so the
    // single mesh never blinks out when its bounding box leaves the view.
    const count = 240;
    this.rainX = new Float32Array(count);
    this.rainY = new Float32Array(count);
    this.rainZ = new Float32Array(count);
    this.rainSpeed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.rainX[i] = (Math.random() - 0.5) * 14;
      this.rainY[i] = Math.random() * 8.6 - 0.6;
      this.rainZ[i] = (Math.random() - 0.5) * 14;
      this.rainSpeed[i] = 9 + Math.random() * 4;
    }
    this.rainMat = new MeshBasicMaterial({
      color: "#cfd8de",
      transparent: true,
      opacity: 0.35,
    });
    this.rain = new InstancedMesh(
      new BoxGeometry(0.012, 0.45, 0.012),
      this.rainMat,
      count,
    );
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.tmpMatrix = new Matrix4();
    for (let i = 0; i < count; i++) {
      this.tmpMatrix.makeTranslation(this.rainX[i], this.rainY[i], this.rainZ[i]);
      this.rain.setMatrixAt(i, this.tmpMatrix);
    }
    this.world.createTransformEntity(this.rain, {
      parent: this.world.sceneEntity,
      persistent: true,
    });
  }

  update(delta: number, time: number) {
    if (!env) return;
    // Defensive clamp: after a stall (tab hidden, big load) delta can arrive
    // huge and make everything lurch. Cap it at a tenth of a second.
    const dt = Math.min(delta, 0.1);

    // Ease the weather toward its target — never snap.
    const diff = stormTarget - this.intensity;
    if (diff !== 0) {
      const step = 0.4 * dt;
      this.intensity +=
        Math.abs(diff) <= step ? diff : Math.sign(diff) * step;
    }
    const t = this.intensity;

    // --- always-on ambient motion (a handful of float writes) -----------------
    const a = env.anim;

    // The sea drifts: scroll the water texture. Driven by absolute time, so it
    // never accumulates drift error.
    a.oceanTexture.offset.set((time * 0.006) % 1, (time * 0.0045) % 1);

    // The ship bobs at anchor — bigger seas as the storm builds. Amplitudes stay
    // small (≤ ~3° roll) because the player's actual floor is a static plane:
    // any more and their feet would visibly hover at the rail.
    const ship = env.shipGroup.object3D!;
    ship.position.y = Math.sin(time * 0.5) * (0.03 + 0.02 * t);
    ship.rotation.z = Math.sin(time * 0.9) * (0.01 + 0.04 * t);
    ship.rotation.x = Math.sin(time * 0.6 + 1.3) * (0.007 + 0.028 * t);

    // The masthead pennant flutters — harder in wind.
    a.pennant.rotation.y = 0.1 + Math.sin(time * (6 + 4 * t)) * (0.18 + 0.12 * t);

    // The cloud bank creeps around the sky (a full lap takes ~70 minutes).
    a.cloudsGroup.rotation.y = time * 0.0015;

    // Foam breathes gently at the waterline.
    a.foamMaterial.opacity = 0.42 + Math.sin(time * 1.3) * 0.12;

    // The gulls circle, bob, and flap — and head for shelter when a real storm
    // is up (they simply blink out past half intensity; kids read it as the
    // birds fleeing the weather).
    const gullsVisible = t < 0.5;
    for (let i = 0; i < a.gulls.length; i++) {
      const g = a.gulls[i];
      if (g.pivot.visible !== gullsVisible) g.pivot.visible = gullsVisible;
      if (!gullsVisible) continue;
      g.pivot.rotation.y = time * g.speed + g.phase;
      g.gull.position.y = Math.sin(time * 0.8 + g.phase) * 0.6;
      const flap = Math.sin(time * 7 + g.phase) * 0.45;
      g.leftWing.rotation.z = 0.25 + flap;
      g.rightWing.rotation.z = -0.25 - flap;
    }

    // --- weather repaint (only on frames where intensity actually changed) ----
    if (t !== this.lastApplied) {
      this.lastApplied = t;

      // Sky dome + ambient light: lerp each channel calm→storm, then poke
      // _needsUpdate so the EnvironmentSystem rebuilds the gradient. peek():
      // never subscribe from inside an update loop.
      const root = this.world.activeLevel?.peek();
      if (root && this.domeViews && this.iblViews) {
        for (let row = 0; row < 3; row++) {
          const dv = this.domeViews[row];
          const dc = this.calmDome[row];
          const ds = this.stormDome[row];
          const iv = this.iblViews[row];
          const ic = this.calmIbl[row];
          const is = this.stormIbl[row];
          for (let c = 0; c < 3; c++) {
            dv[c] = dc[c] + (ds[c] - dc[c]) * t;
            iv[c] = ic[c] + (is[c] - ic[c]) * t;
          }
        }
        root.setValue(DomeGradient, "_needsUpdate", true);
        root.setValue(IBLGradient, "_needsUpdate", true);
      }

      // The sun fades and cools; the sea darkens under the cloud cover.
      a.sunLight.intensity = 3.5 + (0.9 - 3.5) * t;
      a.sunLight.color.lerpColors(this.sunCalm, this.sunStorm, t);
      a.oceanMaterial.color.lerpColors(this.oceanCalm, this.oceanStorm, t);

      // Rain appears once the storm is really going.
      this.rain.visible = t > 0.05;
      this.rainMat.opacity = 0.35 * Math.min(1, t * 1.5);
    }

    // --- rain fall (only while visible) ---------------------------------------
    if (this.rain.visible) {
      const n = this.rainSpeed.length;
      for (let i = 0; i < n; i++) {
        let y = this.rainY[i] - this.rainSpeed[i] * dt;
        if (y < -0.6) y += 8.6; // wrap back to the sky
        this.rainY[i] = y;
        this.tmpMatrix.makeTranslation(this.rainX[i], y, this.rainZ[i]);
        this.rain.setMatrixAt(i, this.tmpMatrix);
      }
      this.rain.instanceMatrix.needsUpdate = true;
    }
  }
}
