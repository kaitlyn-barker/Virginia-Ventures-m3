// panelFollow.ts
// ----------------------------------------------------------------------------
// LAZY PANEL FOLLOW — the fix for the #1 classroom failure mode.
//
// Every decision card spawns at a fixed spot in the world. If a student in a
// headset physically turns or steps away, the card ends up behind them and the
// experience looks frozen. This system quietly rescues them: when an interactive
// card drifts more than ~45 degrees outside the player's gaze for more than 1.5
// seconds, it GLIDES (never snaps — snapping is uncomfortable) back in front of
// wherever they're now looking, keeping its distance so it only re-angles. A
// recenter button (B/Y on a controller, or "R" in the flat browser) brings every
// card to the current gaze at once.
//
// It follows only INTERACTIVE cards (PanelUI + Interactable) — the decision and
// narration panels — never the ledger HUD or the map's little labels (which have
// no Interactable). Each card is tagged with PanelFollow the first time it's
// seen, which carries its per-card dwell timer and glide state.
//
// Perf discipline (this runs every frame in VR): delta is clamped, all scratch
// vectors are allocated once in init(), glide endpoints live on the component
// (read through zero-copy views), and a card at rest costs one dot product.
//
//   registerPanelFollow(world) — index.ts calls this once.
// ----------------------------------------------------------------------------

import {
  createComponent,
  createSystem,
  Types,
  PanelUI,
  Interactable,
  InputComponent,
  Vector3,
  type World,
  type Entity,
} from "@iwsdk/core";

// PanelFollow tags a card the follow system watches, and carries its state:
//   dwell — seconds the card has spent outside the gaze cone (resets on look)
//   anim  — glide progress: -1 = at rest, else 0..1 while easing to `to`
//   from/to — the glide's start and end positions (world space)
export const PanelFollow = createComponent("PanelFollow", {
  dwell: { type: Types.Float32, default: 0 },
  anim: { type: Types.Float32, default: -1 },
  from: { type: Types.Vec3, default: [0, 0, 0] },
  to: { type: Types.Vec3, default: [0, 0, 0] },
});

// --- Tuning ---------------------------------------------------------------------
const FOLLOW_COS = Math.cos((45 * Math.PI) / 180); // outside a 45 deg half-cone
const DWELL_SECONDS = 1.5; //   how long off-gaze before we rescue the card
const GLIDE_SECONDS = 0.7; //   how long the ease-back takes (glide, never snap)
const MIN_DISTANCE = 2.0; //    keep the card a comfortable arm's-reach-plus away
const MAX_DISTANCE = 3.2;

export class PanelFollowSystem extends createSystem({
  // Interactive cards not yet tagged — tag them so they start being followed.
  untracked: {
    required: [PanelUI, Interactable],
    excluded: [PanelFollow],
  },
  // The cards we actively follow.
  tracked: {
    required: [PanelUI, Interactable, PanelFollow],
  },
}) {
  private head!: Vector3; //  head world position (scratch)
  private fwd!: Vector3; //   head forward, flattened to horizontal (scratch)
  private dir!: Vector3; //   head -> card direction, horizontal (scratch)

  init() {
    this.head = new Vector3();
    this.fwd = new Vector3();
    this.dir = new Vector3();

    // Tag every interactive card the moment it appears, so it's followed for
    // its whole life. (Adding PanelFollow moves it into the `tracked` query.)
    this.queries.untracked.subscribe("qualify", (entity) => {
      entity.addComponent(PanelFollow);
    });
  }

  update(delta: number) {
    if (this.queries.tracked.entities.size === 0) return; // idle

    const dt = delta > 0.1 ? 0.1 : delta; // clamp: a hitch must not fling cards

    // Where the player is looking, flattened to the horizontal plane.
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() < 1e-6) return; // looking near-straight up/down
    this.fwd.normalize();

    const recenter = this.recenterRequested();

    for (const entity of this.queries.tracked.entities) {
      const obj = entity.object3D;
      if (!obj) continue;

      let anim = entity.getValue(PanelFollow, "anim") ?? -1;

      // An explicit recenter starts (or restarts) a glide to the current gaze.
      if (recenter) {
        this.startGlide(entity, obj);
        anim = 0;
      }

      if (anim < 0) {
        // At rest: is the card still comfortably in view?
        this.dir.set(obj.position.x - this.head.x, 0, obj.position.z - this.head.z);
        const dist = this.dir.length();
        if (dist > 1e-3) {
          this.dir.multiplyScalar(1 / dist);
          const facing = this.fwd.x * this.dir.x + this.fwd.z * this.dir.z;
          if (facing < FOLLOW_COS) {
            // Off to the side or behind: count the dwell, and rescue once it
            // has persisted (a quick glance away shouldn't move the card).
            const dwell = (entity.getValue(PanelFollow, "dwell") ?? 0) + dt;
            if (dwell >= DWELL_SECONDS) {
              this.startGlide(entity, obj);
            } else {
              entity.setValue(PanelFollow, "dwell", dwell);
            }
          } else {
            entity.setValue(PanelFollow, "dwell", 0);
          }
        }
        continue;
      }

      // Mid-glide: ease from `from` to `to`, keeping the card facing the player.
      anim += dt / GLIDE_SECONDS;
      const c = anim >= 1 ? 1 : anim;
      const e = c * c * (3 - 2 * c); // smoothstep: gentle start and stop
      const from = entity.getVectorView(PanelFollow, "from") as Float32Array;
      const to = entity.getVectorView(PanelFollow, "to") as Float32Array;
      obj.position.set(
        from[0] + (to[0] - from[0]) * e,
        from[1] + (to[1] - from[1]) * e,
        from[2] + (to[2] - from[2]) * e,
      );
      // Keep the readable +Z face aimed at the player, upright (same y).
      obj.lookAt(this.head.x, obj.position.y, this.head.z);

      if (anim >= 1) {
        entity.setValue(PanelFollow, "anim", -1);
        entity.setValue(PanelFollow, "dwell", 0);
      } else {
        entity.setValue(PanelFollow, "anim", anim);
      }
    }
  }

  /**
   * startGlide — capture the card's current spot as the glide start and set its
   * target directly ahead of the player's gaze, at the SAME distance (so it only
   * re-angles into view, never lunges closer). Clamped to a comfortable range.
   */
  private startGlide(entity: Entity, obj: NonNullable<Entity["object3D"]>) {
    const from = entity.getVectorView(PanelFollow, "from") as Float32Array;
    from[0] = obj.position.x;
    from[1] = obj.position.y;
    from[2] = obj.position.z;

    let dist = Math.hypot(obj.position.x - this.head.x, obj.position.z - this.head.z);
    dist = dist < MIN_DISTANCE ? MIN_DISTANCE : dist > MAX_DISTANCE ? MAX_DISTANCE : dist;

    const to = entity.getVectorView(PanelFollow, "to") as Float32Array;
    to[0] = this.head.x + this.fwd.x * dist;
    to[1] = obj.position.y; // keep the card's height — no vertical jump
    to[2] = this.head.z + this.fwd.z * dist;

    entity.setValue(PanelFollow, "anim", 0);
    entity.setValue(PanelFollow, "dwell", 0);
  }

  /** True on the frame the player asks to recenter (controller B/Y, or "R"). */
  private recenterRequested(): boolean {
    const kb = this.input.keyboard;
    if (kb && kb.getKeyDown("KeyR")) return true;
    const gp = this.input.xr.gamepads;
    if (gp?.right?.getButtonDown(InputComponent.B_Button)) return true;
    if (gp?.left?.getButtonDown(InputComponent.Y_Button)) return true;
    return false;
  }
}

// Registered once, lazily.
let registered = false;

/**
 * registerPanelFollow — register the PanelFollow component and its system.
 * index.ts calls this once at startup; the system then tags and follows every
 * interactive card automatically for the rest of the session.
 */
export function registerPanelFollow(world: World): void {
  if (registered) return;
  registered = true;
  world.registerComponent(PanelFollow);
  world.registerSystem(PanelFollowSystem);
}
