// voyagePhases.ts
// ----------------------------------------------------------------------------
// The voyage's PHASE CONTROLLER — it owns the one moment where the experience
// changes ports: Virginia -> England, when the player clicks "Set Sail".
//
// The shared ship + ocean + lighting (environment.ts) stay loaded the whole
// time as PERSISTENT entities. Each leg's scenery is NON-persistent, so swapping
// legs means: tear down the old port's scenery, then build the new one. This
// file does exactly that, and nothing else, so the swap logic lives in one
// place instead of being tangled into the cargo panel or index.ts.
//
//   registerVirginiaPhase(world, scenery) — index.ts calls this once, handing
//     over the entities that make up the Virginia leg (its port group + the
//     cargo panel) so we know what to clear when it's time to sail.
//
//   sailToEngland() — the cargo panel's "Set Sail" button calls this. It clears
//     the Virginia scenery and builds the England port in its place.
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  Interactable,
  RayInteractable,
  PokeInteractable,
} from "@iwsdk/core";

import { createEnglandPort } from "./englandPort.js";

// The England leg's colonists (a dockhand, a fine merchant, a Crown customs
// official, a smith), built in the same low-poly primitive style as the rest.
import { addEnglandColonists } from "./npcs.js";

// The England ARRIVAL beat: reveal prices, value the cargo, and show the
// Navigation Acts rule card. Runs the instant the England port is built.
import { beginEnglandPhase } from "./englandRules.js";

// The STORM AT SEA beat: a decision card shown on the open ocean BETWEEN leaving
// Virginia and making port in England. It resolves to the continuation we pass it.
import { beginStormDecision } from "./stormDecision.js";

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
    for (const root of virginiaScenery) {
      disposeEntityTree(world, root);
    }

    // A storm now stands between Virginia and England. With the port cleared, the
    // ship sits on the open ocean (the ship + sea are persistent), so we raise the
    // storm decision card there. Only once the captain resolves it do we make port:
    // the continuation builds the England port and begins its arrival beat.
    beginStormDecision(world, () => {
      const englandPort = createEnglandPort(world);
      // Populate the England quay with its colonists (parented to the port group
      // so they share the leg's lifecycle).
      addEnglandColonists(world, englandPort);
      beginEnglandPhase(world);
    });
  }, 0);
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
