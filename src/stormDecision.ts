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
//
// Drama wiring (shared modules, built once in index.ts): the card's arrival slams
// the weather to its "raging" phase and rings the ship's bell three times; a
// jettison arcs that good's deck crates overboard with one more bell; Continue
// starts the sky "clearing" so England arrives under friendlier weather. The
// captain's ledger (refreshHud) repaints after every logbook change made here.
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
import {
  voyageState,
  GOOD_SLOTS,
  STORM_DAMAGE_CHANCE,
  markPhase,
} from "./voyageState.js";

// The reusable tutorial coach: a short teaching card gates the storm decision.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// Shared drama + polish helpers (each built and registered ONCE in index.ts):
//   setStormPhase / ringShipBell - sky darkening, ship rocking, rain, and the
//                                  positional ship's bell at the main mast.
//   juiceButton                  - click sound + gold flash on every button.
//   refreshHud                   - repaint the captain's ledger after we touch
//                                  voyageState (cargo tossed, storm damage).
//   jettisonCargoProps           - arc the tossed good's deck crates overboard.
import { setStormPhase, ringShipBell } from "./ambientMotion.js";
import { juiceButton } from "./uiFx.js";
import { refreshHud } from "./hud.js";
import { jettisonCargoProps } from "./cargoProps.js";

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
    // The card is on screen - this IS the storm's big entrance. Slam the weather
    // to its darkest phase (black sky, hard rocking, rain) and ring the ship's
    // bell three times - the old "all hands on deck!" signal - so the choice
    // below feels urgent, not abstract.
    setStormPhase("raging");
    ringShipBell(3);

    const jettisonBtn = doc.getElementById("jettison") as UIKit.Text | null;
    const rideBtn = doc.getElementById("ride") as UIKit.Text | null;
    // The label lines INSIDE the two choice cards. Dimming the container does
    // not recolor these spans, so lockChoices() dims them by id as well.
    const jettisonLabel = doc.getElementById("jettison-label") as UIKit.Text | null;
    const rideLabel = doc.getElementById("ride-label") as UIKit.Text | null;
    const message = doc.getElementById("storm-message") as UIKit.Text | null;
    const continueBtn = doc.getElementById("storm-continue") as UIKit.Text | null;

    // The running list of voyage choices (typed view of the JS array we push to).
    const decisions = voyageState.decisionsLog as string[];

    // Guard so a second click can't re-decide the storm after a choice is made.
    let decided = false;

    // Dim both choice cards so they read as locked once a course is set. The
    // container dim covers the card itself; the label spans inside keep their
    // own colors, so we dim those directly too.
    const lockChoices = () => {
      for (const b of [jettisonBtn, rideBtn]) {
        b?.setProperties({ backgroundColor: "#2a323b", color: "#6b7682" });
      }
      for (const l of [jettisonLabel, rideLabel]) {
        l?.setProperties({ color: "#6b7682" });
      }
    };

    // Repaint Continue to match its TRUE state: the locked "Choose first" look
    // (colors straight from ui/stormDecision.uikitml) before a course is set,
    // bright gold "Continue" after. juiceButton's flash restores through this
    // too, so a tap can never leave the button painted the wrong way.
    const paintContinue = () => {
      if (decided) {
        continueBtn?.setProperties({
          text: "Continue",
          backgroundColor: "#c8962a",
          color: "#1a120b",
        });
      } else {
        continueBtn?.setProperties({
          text: "Choose first",
          backgroundColor: "#3a2f24",
          color: "#9a8568",
        });
      }
    };

    // Show the big outcome banner and unlock Continue (its label now says so).
    const reveal = (text: string, color: string) => {
      message?.setProperties({ text, color });
      paintContinue();
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

      // Make the loss VISIBLE: that good's deck crates arc over the rail and
      // splash into the sea, one bell rings as they go, and the ledger's slot
      // count drops in the same beat - cause and effect land together. Only ONE
      // purchase went over the side, so only its slot count of crates may fly -
      // if the captain bought the same good twice, the other purchase's crates
      // stay safely on deck (matching what cargoLoaded still holds).
      if (tossed) jettisonCargoProps(tossed, SLOT_COST[tossed] ?? 1);
      ringShipBell(1);
      refreshHud();

      const label = tossed ? GOOD_LABEL[tossed] ?? tossed : "cargo";
      decisions.push(
        `A storm struck - you threw the ${label} overboard to keep the ship safe.`,
      );
      reveal(`You heave the ${label} over the side! The ship steadies.`, "#9fd29f");
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
        reveal("Ouch! The storm damaged your cargo. It will sell for less.", "#e08a5a");
        decisions.push(
          "A storm struck - you rode it out, and the cargo took damage.",
        );
      } else {
        reveal("You held on and got lucky! Your cargo is safe.", "#9fd29f");
        decisions.push(
          "A storm struck - you rode it out and kept every crate safe.",
        );
      }
      // The logbook changed (and maybe stormDamage too) - repaint the ledger.
      refreshHud();
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

      // Close the storm segment's Efficiency clock (the England haggle starts the
      // next one), then start the sky re-warming NOW, so England arrives under
      // clearing weather instead of mid-tempest.
      markPhase("storm");
      setStormPhase("clearing");

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

    // Every button gets the full juice: click sound + a quick gold flash. The
    // third argument repaints each button's TRUE state after the flash - any
    // click on a choice card decides the storm, so lockChoices is always the
    // right restore there, and Continue repaints itself from `decided`.
    if (jettisonBtn) juiceButton(jettisonBtn, throwOverboard, lockChoices);
    if (rideBtn) juiceButton(rideBtn, rideItOut, lockChoices);
    if (continueBtn) juiceButton(continueBtn, proceed, paintContinue);
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
