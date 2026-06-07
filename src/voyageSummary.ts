// voyageSummary.ts
// ----------------------------------------------------------------------------
// The VOYAGE SUMMARY - the final screen of Captain's Voyage.
//
// After the route map sails the ship home, this screen appears. It shows the
// student their TWO (and only two) scores and the lesson takeaway, then offers a
// single "Finish" button that ends the experience cleanly.
//
//   beginVoyageSummary(world) — the route map calls this when the voyage ends.
//   createSummaryPanel(world) — spawns the floating summary card.
//   VoyageSummarySystem       — fills in the two scores and wires "Finish".
//
// IMPORTANT lesson rule: there are exactly TWO scores - Cargo Value and Crown
// Compliance. No third score is ever shown. We only READ voyageState here.
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

// The voyage "logbook" - the two scores we display live here.
import { voyageState } from "./voyageState.js";

// The shared, safe teardown helper (frees GPU + clears the ECS).
import { disposeEntityTree } from "./voyagePhases.js";

/**
 * createSummaryPanel - build the summary card and place it in front of the
 * player, where every screen of this leg has appeared. Returns the panel entity.
 */
export function createSummaryPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/voyageSummary.json automatically).
    .addComponent(PanelUI, {
      config: "./ui/voyageSummary.json",
      maxWidth: 1.5,
      maxHeight: 1.4,
    })
    // Interactable lets the controller/mouse ray click the Finish button.
    .addComponent(Interactable);

  // Place it a few meters along +X at eye height, turned to face the player
  // standing at the origin. (Same spot the rule card and route map used.)
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0); // aim the panel's readable +Z face at the player

  return panel;
}

/**
 * VoyageSummarySystem - fills in the two scores once the card has loaded, and
 * wires the Finish button to end the experience.
 */
export class VoyageSummarySystem extends createSystem({
  summaryPanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR summary card.
    where: [eq(PanelUI, "config", "./ui/voyageSummary.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the card's document has finished loading and
    // its score lines and button actually exist to fill in and wire up.
    this.queries.summaryPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  /** Show the three scores and connect the Finish button. */
  private wirePanel(entity: Entity, doc: UIKitDocument) {
    // --- Fill in the three scores from the logbook ----------------------------
    const cargoValue = doc.getElementById("cargo-value") as UIKit.Text | null;
    const profit = doc.getElementById("profit") as UIKit.Text | null;
    const crownCompliance = doc.getElementById("crown-compliance") as UIKit.Text | null;

    // Cargo Value: England's list valuation of the hold (the rules-based worth).
    cargoValue?.setProperties({ text: `${voyageState.cargoValue} coins` });
    // Profit: the FINAL coins kept, as decided by the sale step (England or the
    // smuggler). We display voyageState.profit AS SET THERE - we no longer
    // recompute it here, so the smuggler outcome (including a caught fine) shows
    // correctly instead of being overwritten.
    profit?.setProperties({ text: `${voyageState.profit} coins` });
    // Crown Compliance: a 0-100 score (drops only if the captain smuggled).
    crownCompliance?.setProperties({ text: `${voyageState.crownCompliance} / 100` });

    // --- Play-style rank (new) -----------------------------------------------
    // Pick a rank from HOW the captain sold - read from soldVia, caughtSmuggling,
    // and crownCompliance - and show it with a one-line description. A "strong
    // haggle" means the legal profit reached at least the cargo's full list value
    // (cargoValue), rewarding hard bargaining with England.
    const STRONG_HAGGLE_RATIO = 1.0; // profit >= ratio * cargoValue => "strong"
    const rankEl = doc.getElementById("rank") as UIKit.Text | null;
    const rankDescEl = doc.getElementById("rank-desc") as UIKit.Text | null;

    let rankName: string;
    let rankDesc: string;
    if (voyageState.soldVia === "smuggler") {
      // Illegal sale: whether you were caught decides the rank.
      if (voyageState.caughtSmuggling) {
        rankName = "Caught Red-Handed";
        rankDesc = "You smuggled - and the Crown's customs caught you in the act.";
      } else {
        rankName = "Daring Smuggler";
        rankDesc = "You defied the Navigation Acts and got away with it - for now.";
      }
    } else {
      // Legal sale to England (Crown Compliance stays at 100). A strong haggle
      // earns the shrewder rank; otherwise the loyal one.
      const stronglyHaggled =
        voyageState.crownCompliance === 100 &&
        voyageState.profit >=
          Math.round(voyageState.cargoValue * STRONG_HAGGLE_RATIO);
      if (stronglyHaggled) {
        rankName = "Shrewd Trader";
        rankDesc = "You obeyed the Crown but haggled hard for a strong price.";
      } else {
        rankName = "Loyal Merchant";
        rankDesc = "You played by the Crown's rules and sold your hold to England.";
      }
    }
    rankEl?.setProperties({ text: rankName });
    rankDescEl?.setProperties({ text: rankDesc });

    // --- Tailor the takeaway if the captain defied the Crown ------------------
    if (voyageState.soldToSmuggler) {
      const takeaway = doc.getElementById("takeaway") as UIKit.Text | null;
      takeaway?.setProperties({
        text: "You chased profit past the Crown's rules - selling to a smuggler for more coin while defying the Navigation Acts. That tension between profit and obedience was mercantilism.",
      });
    }

    console.log(
      "Captain's Voyage - summary. profit:",
      voyageState.profit,
      "cargoValue:",
      voyageState.cargoValue,
      "crownCompliance:",
      voyageState.crownCompliance,
      "soldVia:",
      voyageState.soldVia,
      "rank:",
      rankName,
    );

    // --- Wire the one and only button -----------------------------------------
    const finishBtn = doc.getElementById("finish-btn") as UIKit.Text | null;
    finishBtn?.addEventListener("click", () => this.handleFinish(entity));
  }

  /** Finish - end the voyage cleanly: dismiss the card, leave XR, say farewell. */
  private handleFinish(entity: Entity) {
    voyageState.currentLeg = "finished";
    console.log("Captain's Voyage - finished. Final voyageState:", voyageState);

    const world = this.world;

    // Defer one tick so we aren't disposing the very panel whose click is still
    // being dispatched, and strip its interaction tags first so the InputSystem
    // doesn't try to clear Hovered/Pressed off a destroyed entity.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      disposeEntityTree(world, entity);

      // Leave the headset session if we're in one. In a flat browser tab there's
      // no session to exit, so we guard the call.
      try {
        world.exitXR();
      } catch {
        // Not in an XR session - nothing to exit, which is fine.
      }

      // Leave a gentle closing note in the world so the screen isn't suddenly
      // empty. It has no buttons and no logic - just text (see voyageEnd.uikitml).
      createFarewell(world);
    }, 0);
  }
}

/** createFarewell - a tiny, button-less closing card placed in front of the player. */
function createFarewell(world: World): Entity {
  const card = world.createTransformEntity().addComponent(PanelUI, {
    config: "./ui/voyageEnd.json",
    maxWidth: 0.9,
    maxHeight: 0.5,
  });
  const obj = card.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);
  return card;
}

/**
 * beginVoyageSummary - register the summary system (so it's ready to catch the
 * card the instant it loads), then build the card.
 */
export function beginVoyageSummary(world: World): void {
  world.registerSystem(VoyageSummarySystem);
  createSummaryPanel(world);
}
