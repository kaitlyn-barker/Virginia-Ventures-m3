// stormDecision.ts
// ----------------------------------------------------------------------------
// The STORM AT SEA beat — the first gamified decision, inserted between leaving
// Virginia and arriving in England. After the Virginia scenery is torn down, the
// ship sits on the open ocean and this card asks the captain a single question:
// throw cargo overboard to stay safe, or hold on and ride it out?
//
//   createStormPanel(world)   — spawns the floating storm card on the open sea.
//   StormDecisionSystem       — wires the two choice buttons + Continue.
//   beginStormDecision(world, onResolved)
//                             — registers the system, builds the card, and stashes
//                               the continuation to run once the storm is resolved
//                               (the phase controller passes "now build England").
//
// The two choices (per the design):
//   • Throw cargo overboard → remove the SINGLE highest-slot good from the hold
//     (you still PAID for it, so profit suffers), but the ship rides safe.
//   • Hold on and ride it out → keep all cargo, but roll STORM_DAMAGE_CHANCE; on a
//     bad roll the storm damages the cargo (voyageState.stormDamage = true).
//
// Either way the voyage ALWAYS continues on to England — the event never dead-ends.
//
// This file mirrors englandRules.ts exactly: a panel + a createSystem matched by
// its config, wired on the "qualify" subscription, with a deferred, tag-stripped
// teardown when the screen advances.
// ----------------------------------------------------------------------------

import {
  createSystem,
  PanelUI,
  PanelDocument,
  Interactable,
  RayInteractable,
  PokeInteractable,
  eq,
  UIKitDocument,
  UIKit,
  type World,
  type Entity,
} from "@iwsdk/core";

// The voyage "logbook", the storm's tuning constant (STORM_DAMAGE_CHANCE), and the
// slot-size lookup (GOOD_SLOTS) we read to find the heaviest good to jettison.
import { voyageState, GOOD_SLOTS, STORM_DAMAGE_CHANCE } from "./voyageState.js";

// The reusable tutorial coach: a short teaching card gates the storm decision.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// How many cargo slots each good takes up. We read this to find the "highest-slot"
// good (the heaviest crate) to throw overboard. We only READ it — the values live
// in voyageState.js.
const SLOT_COST = GOOD_SLOTS as Record<string, number>;

// Friendly labels for the goods, used to name the jettisoned crate in the log.
// (Presentation only — the goods themselves come from voyageState.cargoLoaded.)
const GOOD_LABEL: Record<string, string> = {
  tobacco: "Tobacco",
  lumber: "Lumber",
  furs: "Furs",
};

// The continuation to run once the storm is resolved (build England + begin its
// phase). Stored at module scope because the SYSTEM — not the caller — decides
// when the storm is over, exactly as returnHomeMap.ts stashes its map group.
let onStormResolved: (() => void) | null = null;

/**
 * Create the floating storm card and place it in front of the player, who faces
 * +X for the whole voyage (see index.ts). Call once, after the Virginia scenery
 * has been torn down. Returns the panel entity.
 */
export function createStormPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/stormDecision.json automatically).
    .addComponent(PanelUI, {
      config: "./ui/stormDecision.json",
      maxWidth: 1.6,
      maxHeight: 1.4,
    })
    // Interactable lets the controller/mouse ray click the choice buttons.
    .addComponent(Interactable);

  // Same spot every card in this voyage uses: a few meters along +X at eye height,
  // turned so its readable +Z face looks back at the player at the origin.
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * Wires the storm card: it waits for the document to load, then connects the two
 * choice buttons and the Continue button.
 */
export class StormDecisionSystem extends createSystem({
  stormPanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR card (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/stormDecision.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the card's document has finished loading and its
    // buttons + message line actually exist to wire up.
    this.queries.stormPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  /** Connect the two storm choices (jettison / ride it out) and Continue. */
  private wirePanel(entity: Entity, doc: UIKitDocument) {
    const jettisonBtn = doc.getElementById("jettison") as UIKit.Text | null;
    const rideBtn = doc.getElementById("ride") as UIKit.Text | null;
    const message = doc.getElementById("storm-message") as UIKit.Text | null;
    const continueBtn = doc.getElementById("storm-continue") as UIKit.Text | null;

    // The running list of voyage choices (typed view of the JS array we push to).
    const decisions = voyageState.decisionsLog as string[];

    // Guard so a second click can't re-decide the storm after a choice is made.
    let decided = false;

    // Dim both choice buttons so they read as locked once a choice is made.
    const lockChoices = () => {
      for (const b of [jettisonBtn, rideBtn]) {
        b?.setProperties({ backgroundColor: "#2a323b", color: "#6b7682" });
      }
    };

    // Show the one-line outcome and brighten Continue so the captain can sail on.
    const reveal = (text: string, color: string) => {
      message?.setProperties({ text, color });
      continueBtn?.setProperties({ backgroundColor: "#c8962a", color: "#1a120b" });
    };

    // --- Choice A: throw the heaviest good overboard to stay safe -------------
    const throwOverboard = () => {
      if (decided) return;
      decided = true;
      lockChoices();

      // Remove the SINGLE highest-slot good (the heaviest crate). With GOOD_SLOTS
      // tobacco=1, lumber=2, furs=3, that's furs first, then lumber, then tobacco.
      // (Set Sail guarantees at least one good is aboard, but we guard anyway.)
      const cargo = voyageState.cargoLoaded as string[];
      let worst = -1;
      for (let i = 0; i < cargo.length; i++) {
        if (worst === -1 || (SLOT_COST[cargo[i]] ?? 0) > (SLOT_COST[cargo[worst]] ?? 0)) {
          worst = i;
        }
      }
      const tossed = worst >= 0 ? cargo.splice(worst, 1)[0] : undefined;

      decisions.push("storm: jettisoned");
      reveal("You lightened the load and sailed on safely.", "#9fd29f");
      console.log(
        "Captain's Voyage - storm: jettisoned",
        tossed ? GOOD_LABEL[tossed] ?? tossed : "(nothing)",
        "cargo now:",
        cargo,
      );
    };

    // --- Choice B: hold on and ride it out (gamble on STORM_DAMAGE_CHANCE) ----
    const rideItOut = () => {
      if (decided) return;
      decided = true;
      lockChoices();

      // Keep all cargo, but roll the dice: on a bad roll the storm damages it.
      // The chance comes straight from the STORM_DAMAGE_CHANCE constant.
      if (Math.random() < STORM_DAMAGE_CHANCE) {
        voyageState.stormDamage = true;
        reveal("You held your cargo, but the storm damaged some of it.", "#e08a5a");
      } else {
        reveal("You held your cargo and got lucky.", "#9fd29f");
      }

      decisions.push("storm: rode it out");
      console.log(
        "Captain's Voyage - storm: rode it out. stormDamage:",
        voyageState.stormDamage,
      );
    };

    // --- Continue: end the storm beat and run the stashed continuation --------
    const proceed = () => {
      // Belt-and-braces: Continue ships dim and the captain must choose first.
      if (!decided) {
        message?.setProperties({
          text: "Choose first - throw cargo overboard, or hold on and ride it out.",
          color: "#e08a5a",
        });
        return;
      }

      const world = this.world;
      // Defer one tick so we aren't disposing the very panel whose click is still
      // being dispatched, and strip its interaction tags first so the InputSystem
      // doesn't try to clear Hovered/Pressed off a destroyed entity.
      setTimeout(() => {
        for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
          if (entity.hasComponent(tag)) entity.removeComponent(tag);
        }
        entity.dispose();

        // Continue to England EXACTLY as before: run the continuation the phase
        // controller handed us (build the England port + begin its arrival beat).
        // Clear it first so it can only ever run once.
        const resolve = onStormResolved;
        onStormResolved = null;
        resolve?.();
      }, 0);
    };

    jettisonBtn?.addEventListener("click", throwOverboard);
    rideBtn?.addEventListener("click", rideItOut);
    continueBtn?.addEventListener("click", proceed);
  }
}

/**
 * beginStormDecision — stash the continuation, register the system (so its
 * "qualify" subscription is ready), then build the card. The phase controller
 * (voyagePhases.ts) calls this after tearing down Virginia, passing the work to
 * run once the storm is resolved (build England).
 */
export function beginStormDecision(world: World, onResolved: () => void): void {
  onStormResolved = onResolved;
  world.registerSystem(StormDecisionSystem);
  // Teach first, then decide: the storm tutorial gates the decision card. When
  // the student dismisses it, the storm card appears in its place.
  showTutorial(world, TUTORIALS.storm, () => createStormPanel(world));
}
