// voyagePhases.ts
// ----------------------------------------------------------------------------
// The voyage's PHASE CONTROLLER — it owns the one moment where the experience
// changes ports: Virginia -> England, when the player clicks "Set Sail".
//
// The shared ship + ocean + lighting (environment.ts) stay loaded the whole
// time as PERSISTENT entities. Each leg's scenery is NON-persistent, so swapping
// legs means: tear down the old port's scenery, then build the new one. This
// file does exactly that — but the ports no longer POP. Departure SLIDES the
// Virginia dock away astern over a few seconds (the ship "getting underway"),
// and arrival GLIDES the England quay in over the bow before the arrival beat
// begins, with two bells and a welcome banner when we make port.
//
//   registerVirginiaPhase(world, scenery) — index.ts calls this once, handing
//     over the entities that make up the Virginia leg (its port group + the
//     cargo panel) so we know what to clear when it's time to sail.
//
//   sailToEngland() — the cargo panel's "Set Sail" button calls this. It clears
//     the cargo panel, slides Virginia astern, raises the storm, then glides
//     England into place.
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  createComponent,
  createSystem,
  Types,
  eq,
  Group,
  Interactable,
  RayInteractable,
  PokeInteractable,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
} from "@iwsdk/core";

import { createEnglandPort } from "./englandPort.js";

// The England leg's colonists (a dockhand, a fine merchant, a Crown customs
// official, a smith), built in the same low-poly primitive style as the rest.
import { addEnglandColonists } from "./npcs.js";

// The England ARRIVAL beat: reveal prices, value the cargo, and show the
// Navigation Acts rule card. Runs once the England port has glided into place.
import { beginEnglandPhase } from "./englandRules.js";

// The STORM AT SEA beat: a decision card shown on the open ocean BETWEEN leaving
// Virginia and making port in England. It resolves to the continuation we pass it.
import { beginStormDecision } from "./stormDecision.js";

// The shared weather + bell: the sky starts turning mid-departure, and the
// ship's bell rings twice ("making port") when England arrives.
import { setStormPhase, ringShipBell } from "./ambientMotion.js";

// The state this controller needs to do the swap. We keep it in module scope
// (not in a system) because it's a single, one-shot handoff — there's no
// per-frame work here, so a full ECS system would be overkill.
interface VoyagePhaseState {
  world: World;
  virginiaScenery: Entity[]; // the entities to dispose when we leave Virginia
  transitioned: boolean; // guard so a double-click can't sail us twice
}

let state: VoyagePhaseState | null = null;

/**
 * Record the Virginia leg's scenery so we can clear it later. Call once from
 * index.ts, passing the port group entity and the cargo panel entity.
 */
export function registerVirginiaPhase(world: World, virginiaScenery: Entity[]): void {
  state = { world, virginiaScenery, transitioned: false };
}

// ----------------------------------------------------------------------------
// Port transit — the slide that replaces the pop.
//
// Both legs of the swap are the SAME move: ease one port group's position.z
// between two values over a few seconds, then hand off. Departure eases IN
// (a ship pulls away slowly, then gathers way); arrival eases OUT (a ship
// glides to a stop at the quay).
// ----------------------------------------------------------------------------

// Timing and distances (seconds / meters). The bow faces -Z, so sliding
// Virginia toward +Z reads as the dock falling away astern, and starting
// England at -Z reads as land appearing off the bow.
const DEPART_SECONDS = 4.5; // how long Virginia takes to slide astern
const DEPART_DISTANCE = 28; // how far the port group travels (+Z = astern)
const STORM_BUILD_AT = 1.5; // mid-departure: the sky starts to turn
const ARRIVE_SECONDS = 3.5; // how long England takes to glide in
const ARRIVE_FROM_Z = -32; // England starts this far off the bow (-Z)

// The one in-flight transit. A single module-scope record, mutated in place and
// never reallocated, so the system's update() only reads plain numbers and
// writes ONE position value per frame — zero allocation. When `active` is
// false the system is idle and update() returns immediately.
const transit = {
  active: false,
  entity: null as Entity | null, // the port group on the move
  elapsed: 0, // seconds into the slide
  duration: 1, // total slide time (seconds)
  fromZ: 0,
  toZ: 0,
  easeIn: true, // true = ease-in (departure), false = ease-out (arrival)
  stormAt: -1, // elapsed seconds at which to flip the weather (-1 = never)
  stormFired: false,
  onDone: null as (() => void) | null, // hand-off, run (deferred a tick) at the end
};

// Register PortTransitSystem only once, the first time a transit starts.
let transitSystemRegistered = false;

/** End the active transit and run its hand-off on a clean stack next tick. */
function finishTransit(): void {
  const done = transit.onDone;
  transit.active = false;
  transit.entity = null;
  transit.onDone = null;
  // One-shot deferral, same idiom as the teardown below: never dispose (or
  // build) scenery from inside a system's update().
  if (done) setTimeout(done, 0);
}

/**
 * PortTransitSystem — slides the active port group along Z. Idle (an early
 * return) whenever no transit is running, so it costs nothing the rest of
 * the voyage.
 */
export class PortTransitSystem extends createSystem({}, {}) {
  update(delta: number) {
    if (!transit.active) return; // idle: no port on the move

    // The group we're sliding vanished out from under us? (Shouldn't happen,
    // but never crash the frame loop over scenery.) End the transit and let
    // the voyage carry on.
    const obj = transit.entity ? transit.entity.object3D : null;
    if (!obj) {
      finishTransit();
      return;
    }

    // CLAMP the step first: a load hitch, a GC pause, or a backgrounded tab
    // catching up can hand us a huge delta, and an unclamped step would leap
    // the whole slide in a single frame and skip the beat entirely.
    const step = Math.min(delta, 0.1);
    transit.elapsed += step;

    // Mid-departure weather cue: the sky starts turning while the dock is
    // still in sight, so the storm reads as "rolling in", not "switched on".
    if (transit.stormAt >= 0 && !transit.stormFired && transit.elapsed >= transit.stormAt) {
      transit.stormFired = true;
      setStormPhase("building");
    }

    // Where along the slide are we? Ease-in for departures (slow pull away,
    // then gathering way), ease-out for arrivals (glide to a stop).
    const t = Math.min(transit.elapsed / transit.duration, 1);
    const eased = transit.easeIn ? t * t : 1 - (1 - t) * (1 - t);
    obj.position.z = transit.fromZ + (transit.toZ - transit.fromZ) * eased;

    // Done (t clamped to 1 above, so z is already exactly at its target).
    if (transit.elapsed >= transit.duration) {
      finishTransit();
    }
  }
}

/**
 * startPortTransit — kick off one slide. Registers the system on first use,
 * snaps the group to its starting z, then lets the system carry it.
 */
function startPortTransit(
  world: World,
  entity: Entity,
  fromZ: number,
  toZ: number,
  duration: number,
  easeIn: boolean,
  stormAt: number,
  onDone: () => void,
): void {
  if (!transitSystemRegistered) {
    world.registerSystem(PortTransitSystem);
    transitSystemRegistered = true;
  }

  entity.object3D!.position.z = fromZ; // snap to the start before frame one
  transit.entity = entity;
  transit.elapsed = 0;
  transit.duration = duration;
  transit.fromZ = fromZ;
  transit.toZ = toZ;
  transit.easeIn = easeIn;
  transit.stormAt = stormAt;
  transit.stormFired = false;
  transit.onDone = onDone;
  transit.active = true;
}

/**
 * Leave Virginia and arrive at England. Safe to call from inside the Set Sail
 * click handler: the actual teardown/rebuild is DEFERRED to the next tick (see
 * below) so we never dispose the very panel whose click is still being
 * dispatched out from under the UIKit event system.
 */
export function sailToEngland(): void {
  // Nothing registered yet, or we've already sailed — ignore.
  if (!state || state.transitioned) return;
  state.transitioned = true;

  const { world, virginiaScenery } = state;

  // Defer one macrotask. The Set Sail click is still being dispatched through
  // the panel's UIKit document as we run; if we disposed that panel right now,
  // the dispatcher could touch freed elements after we return. setTimeout(0)
  // lets the current event finish first, then we swap on a clean stack. (This
  // is a one-shot deferral, not a per-frame poll.)
  setTimeout(() => {
    // Split the leg's scenery. UI panels (the cargo panel) are disposed right
    // away, exactly as before — but the PORT GROUP stays alive so it can slide
    // away astern instead of popping out of existence. (NPCs and the port sign
    // ride along: they're parented to the group.)
    const portGroups: Entity[] = [];
    for (const root of virginiaScenery) {
      if (root.hasComponent(PanelUI)) {
        disposeEntityTree(world, root);
      } else {
        portGroups.push(root);
      }
    }

    // Once Virginia has slid out of sight: tear it down exactly as before
    // (tags stripped while alive, dispose, destroy orphans). A storm now
    // stands between Virginia and England — with the port cleared, the ship
    // sits on the open ocean (the ship + sea are persistent), so we raise the
    // storm decision card there. Only once the captain resolves it do we make
    // port: the continuation builds the England port and glides it in.
    const departAndStorm = () => {
      for (const root of portGroups) {
        disposeEntityTree(world, root);
      }

      beginStormDecision(world, () => {
        const englandPort = createEnglandPort(world);
        // Populate the England quay with its colonists (parented to the port
        // group so they share the leg's lifecycle — and ride the glide-in).
        addEnglandColonists(world, englandPort);

        // ARRIVAL: England starts far off the bow and eases to its place.
        // Only when it stops do we ring two bells ("making port"), raise the
        // welcome banner, and begin the arrival beat.
        startPortTransit(world, englandPort, ARRIVE_FROM_Z, 0, ARRIVE_SECONDS, false, -1, () => {
          ringShipBell(2);
          spawnArrivalBanner(world, englandPort);
          beginEnglandPhase(world);
        });
      });
    };

    // DEPARTURE: slide the dock away astern. Partway out, the weather cue
    // fires so the storm builds while the dock is still shrinking behind us.
    const portGroup = portGroups[0];
    if (portGroup) {
      startPortTransit(
        world,
        portGroup,
        0,
        DEPART_DISTANCE,
        DEPART_SECONDS,
        true,
        STORM_BUILD_AT,
        departAndStorm,
      );
    } else {
      // Defensive: no port group registered? Fall back to the instant swap.
      departAndStorm();
    }
  }, 0);
}

// ----------------------------------------------------------------------------
// The "Welcome to England!" banner — a one-line celebration pill that floats
// over the quay for a few seconds when the ship makes port, so arrival reads
// as an EVENT, not a teleport.
// ----------------------------------------------------------------------------

// ArrivalBanner marks the banner panel and carries its words. The tiny system
// below writes them in once the panel's document loads — the same qualify-then-
// setProperties pattern the route map uses for its labels (text writes only
// "take" once the document exists, which is exactly when "qualify" fires).
export const ArrivalBanner = createComponent("ArrivalBanner", {
  text: { type: Types.String, default: "Welcome!" },
});

export class ArrivalBannerSystem extends createSystem({
  // Every loaded banner panel that still needs its words written in.
  banners: {
    required: [PanelUI, PanelDocument, ArrivalBanner],
    where: [eq(PanelUI, "config", "./ui/mapLabel.json")],
  },
}) {
  init() {
    this.queries.banners.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      const words = entity.getValue(ArrivalBanner, "text") ?? "";
      const el = doc.getElementById("label") as UIKit.Text | null;
      el?.setProperties({ text: words });
    });
  }
}

// Register the banner's component + system only once, on first use.
let bannerSystemRegistered = false;

/**
 * spawnArrivalBanner — float the welcome pill over the England quay, then
 * dismiss it after 4 seconds with the standard deferred teardown.
 */
function spawnArrivalBanner(world: World, portGroup: Entity): void {
  if (!bannerSystemRegistered) {
    world.registerComponent(ArrivalBanner);
    world.registerSystem(ArrivalBannerSystem);
    bannerSystemRegistered = true;
  }

  // The banner reuses the route map's little label pill (cream card, gold
  // border) and parents to the PORT GROUP, so if the leg were ever torn down
  // early, the standard sweep would take the banner with it.
  const banner = world
    .createTransformEntity(new Group(), { parent: portGroup })
    .addComponent(PanelUI, {
      config: "./ui/mapLabel.json",
      maxWidth: 1.1,
      maxHeight: 0.25,
    })
    .addComponent(ArrivalBanner, { text: "Welcome to England!" });

  // Float it over the quay, facing the captain on deck. (The port group sits
  // at the origin once the glide-in finishes, so local coords read as world.)
  const obj = banner.object3D!;
  obj.position.set(3.0, 2.0, 0);
  obj.lookAt(0, 1.5, 0);

  // A banner, not a fixture: after 4 seconds it dismisses itself with the
  // standard deferred teardown (tags stripped while alive, dispose, orphans
  // destroyed). The `active` check covers the rare case where the whole port
  // group was swept first — its sweep already took the banner with it.
  setTimeout(() => {
    if (banner.active) disposeEntityTree(world, banner);
  }, 4000);
}

/**
 * Fully tear down one entity and the subtree of entities parented under it.
 *
 * Why this is more than a single `dispose()`: `entity.dispose()` frees the GPU
 * resources for the WHOLE object3D subtree (it traverses every descendant mesh)
 * AND removes the root from the scene — but it only releases the ROOT entity
 * from the ECS. Child entities created with `createTransformEntity({ parent })`
 * would linger as empty Transform shells. So we first collect those child
 * entities (each mesh's object3D carries its owning entity's index via
 * `entityIdx`, set by the TransformSystem), then dispose the root for the GPU
 * sweep, then destroy the now-orphaned children to clear them from the ECS.
 *
 * Exported so the later phases (the route map, the summary) can tear down their
 * own primitive-built entity trees the exact same safe way.
 */
export function disposeEntityTree(world: World, root: Entity): void {
  const obj = root.object3D;
  if (!obj) {
    root.destroy();
    return;
  }

  // Collect descendant entities BEFORE we mutate the tree.
  const childEntities: Entity[] = [];
  obj.traverse((o) => {
    if (o === obj) return; // skip the root itself
    const idx = (o as { entityIdx?: number }).entityIdx;
    if (typeof idx === "number") {
      const child = world.entityManager.getEntityByIndex(idx);
      if (child) childEntities.push(child);
    }
  });

  // If this is an interactive entity (the cargo panel), drop its interaction
  // components FIRST, while it's still alive. The InputSystem clears a panel's
  // Hovered/Pressed tags from a `disqualify` subscription on RayInteractable; if
  // we just destroyed the panel, that cleanup would fire on the already-dead
  // entity and warn ("cannot remove component"). Removing RayInteractable now
  // triggers that same cleanup synchronously on the LIVE entity, so the dispose
  // below stays silent.
  for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
    if (root.hasComponent(tag)) root.removeComponent(tag);
  }

  // Dispose the root: frees GPU memory for the entire subtree and detaches it.
  root.dispose();

  // Clear the orphaned child entities from the ECS (their GPU memory is already
  // freed by the sweep above, so a plain destroy is enough here).
  for (const child of childEntities) {
    child.destroy();
  }
}
