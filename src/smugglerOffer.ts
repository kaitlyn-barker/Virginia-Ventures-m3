// smugglerOffer.ts
// ----------------------------------------------------------------------------
// The SMUGGLER'S OFFER — the final sale decision, shown AFTER the England haggle.
//
// A Dutch smuggler sidles up in the customs-house shadow and offers MORE money
// for the same cargo — illegally. The student picks one of two buyers:
//   • Sell to England (legal)   — take the haggled price (englishSaleAmount).
//                                 Crown Compliance stays put.
//   • Sell to the smuggler (illegal) — a genuine GAMBLE. Roll against
//                                 SMUGGLE_DISCOVERY_CHANCE:
//                                   - got away: the full (bigger) smuggler payout,
//                                     a modest Compliance hit.
//                                   - caught:  cargo mostly seized + a fine, so you
//                                     keep only a fraction of England's price, and
//                                     a big Compliance hit.
//
// This is the step that SETS THE FINAL PROFIT and changes crownCompliance, then
// hands off to the EXISTING route map (returnHomeMap.ts) — we don't rebuild the
// map or the summary here.
//
//   createSmugglerPanel(world) — spawns the offer card.
//   SmugglerOfferSystem        — wires the two buyer buttons + Continue.
//   beginSmugglerOffer(world)  — registers the system and builds the card. The
//                                England step (englandRules.ts) calls this once
//                                the student has agreed a price with England.
//
// Mirrors the other phase files exactly: a panel + a createSystem matched by its
// config, wired on "qualify", with a deferred, tag-stripped teardown on Continue.
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

// The voyage "logbook", the smuggler's price list, and the catch-chance constant.
import {
  voyageState,
  SMUGGLER_PRICE,
  SMUGGLE_DISCOVERY_CHANCE,
} from "./voyageState.js";

// The next (existing) screen: the animated route map home. We hand off to it
// unchanged when the sale is settled.
import { beginReturnHomeMap } from "./returnHomeMap.js";

// The reusable tutorial coach: a short teaching card gates the smuggler's offer.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// A typed view of the smuggler's price list (we only READ it).
const SMUGGLER_VALUE = SMUGGLER_PRICE as Record<string, number>;

// --- Penalty / fine numbers (labeled so they're easy to find and tweak) ---------
// Compliance is a 0-100 score; smuggling always costs some, getting caught costs
// far more. The caught "profit" is a small fraction of what England would have
// paid — the cargo is mostly seized and a fine is levied on top.
const SMUGGLE_SUCCESS_COMPLIANCE_PENALTY = 20; // got away with it: -20 compliance
const SMUGGLE_CAUGHT_COMPLIANCE_PENALTY = 50; //  caught red-handed: -50 compliance
const CAUGHT_PROFIT_PCT = 0.25; //                caught: keep 25% of England's price

/**
 * Create the floating smuggler-offer card and place it in front of the player
 * (who faces +X for the whole voyage). Call once, after the England haggle.
 */
export function createSmugglerPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/smugglerOffer.json automatically).
    .addComponent(PanelUI, {
      config: "./ui/smugglerOffer.json",
      maxWidth: 1.6,
      maxHeight: 1.4,
    })
    // Interactable lets the controller/mouse ray click the buyer buttons.
    .addComponent(Interactable);

  // Same spot every card in this voyage uses: a few meters along +X at eye height,
  // turned so its readable +Z face looks back at the player at the origin.
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * Wires the smuggler card: it waits for the document to load, then shows both
 * offers and connects the two buyer buttons + Continue.
 */
export class SmugglerOfferSystem extends createSystem({
  smugglerPanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR card (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/smugglerOffer.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the card's document has finished loading and its
    // amount lines + buttons actually exist to fill in and wire up.
    this.queries.smugglerPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  /** Show both offers and connect the buyer choice + Continue. */
  private wirePanel(entity: Entity, doc: UIKitDocument) {
    const englandAmountText = doc.getElementById("england-amount") as UIKit.Text | null;
    const smugglerAmountText = doc.getElementById("smuggler-amount") as UIKit.Text | null;
    const sellEnglandBtn = doc.getElementById("sell-england") as UIKit.Text | null;
    const sellSmugglerBtn = doc.getElementById("sell-smuggler") as UIKit.Text | null;
    const outcome = doc.getElementById("smuggler-message") as UIKit.Text | null;
    const continueBtn = doc.getElementById("smuggler-continue") as UIKit.Text | null;

    // The running list of voyage choices (typed view of the JS array we push to).
    const decisions = voyageState.decisionsLog as string[];

    // England's haggled amount, settled back on the England card.
    const englishAmount = voyageState.englishSaleAmount;

    // The smuggler's total: SMUGGLER_PRICE for each good STILL in the hold (after
    // any storm jettison). The smuggler always pays more for the SAME cargo —
    // that's the lure of breaking the Navigation Acts.
    let smugglerTotal = 0;
    for (const good of voyageState.cargoLoaded as string[]) {
      smugglerTotal += SMUGGLER_VALUE[good] ?? 0;
    }

    // Guard so a second click can't re-decide the sale after a choice is made.
    let decided = false;

    // Dim both buyer buttons so they read as locked once a choice is made.
    const lockChoices = () => {
      for (const b of [sellEnglandBtn, sellSmugglerBtn]) {
        b?.setProperties({ backgroundColor: "#2a3942", color: "#6b7682" });
      }
    };

    // Show the plain-language outcome and brighten Continue so the player sails on.
    const reveal = (text: string, color: string) => {
      outcome?.setProperties({ text, color });
      continueBtn?.setProperties({ backgroundColor: "#c8962a", color: "#1a120b" });
    };

    // --- Sell to England: the LEGAL sale. Take the haggled price as-is. --------
    const sellToEngland = () => {
      if (decided) return;
      decided = true;
      lockChoices();

      voyageState.soldVia = "england";
      voyageState.profit = englishAmount;
      // crownCompliance is LEFT at 100 — obeying the Crown costs nothing.
      decisions.push("sale: england (legal)");

      reveal(
        `You sell to England for ${englishAmount} coins, by the Crown's rules. The Crown is satisfied - Compliance holds at ${voyageState.crownCompliance}.`,
        "#9fd29f",
      );
      console.log(
        "Captain's Voyage - sold to England. soldVia:",
        voyageState.soldVia,
        "profit:",
        voyageState.profit,
        "crownCompliance:",
        voyageState.crownCompliance,
      );
    };

    // --- Sell to the smuggler: ILLEGAL, and a genuine gamble ------------------
    const sellToSmuggler = () => {
      if (decided) return;
      decided = true;
      lockChoices();

      voyageState.soldVia = "smuggler";

      // The gamble: a SMUGGLE_DISCOVERY_CHANCE (30%) chance the Crown catches you.
      const caught = Math.random() < SMUGGLE_DISCOVERY_CHANCE;

      if (!caught) {
        // Got away with it: the full, bigger smuggler payout; a modest hit.
        voyageState.profit = smugglerTotal;
        voyageState.crownCompliance = Math.max(
          0,
          voyageState.crownCompliance - SMUGGLE_SUCCESS_COMPLIANCE_PENALTY,
        );
        decisions.push("sale: smuggler (got away)");
        reveal(
          `The deal goes clean! The smuggler pays ${smugglerTotal} coins - well above England's price. Crown Compliance slips to ${voyageState.crownCompliance}.`,
          "#9fd29f",
        );
      } else {
        // Caught: cargo mostly seized + a fine. Keep only a fraction of England's
        // price, and take a heavy Compliance hit.
        voyageState.caughtSmuggling = true;
        const fineProfit = Math.round(englishAmount * CAUGHT_PROFIT_PCT);
        voyageState.profit = fineProfit;
        voyageState.crownCompliance = Math.max(
          0,
          voyageState.crownCompliance - SMUGGLE_CAUGHT_COMPLIANCE_PENALTY,
        );
        decisions.push("sale: smuggler (caught)");
        reveal(
          `Customs catch you! The cargo is mostly seized and you are fined - you walk away with just ${fineProfit} coins. Crown Compliance crashes to ${voyageState.crownCompliance}.`,
          "#e08a5a",
        );
      }
      console.log(
        "Captain's Voyage - smuggled. caught:",
        caught,
        "profit:",
        voyageState.profit,
        "crownCompliance:",
        voyageState.crownCompliance,
      );
    };

    // --- Initial draw + wiring ------------------------------------------------
    englandAmountText?.setProperties({ text: `${englishAmount} coins` });
    smugglerAmountText?.setProperties({ text: `${smugglerTotal} coins` });
    outcome?.setProperties({
      text: `Take England's legal ${englishAmount} coins, or risk the smuggler's ${smugglerTotal}?`,
      color: "#9fb0bb",
    });

    sellEnglandBtn?.addEventListener("click", sellToEngland);
    sellSmugglerBtn?.addEventListener("click", sellToSmuggler);
    continueBtn?.addEventListener("click", () => {
      // Continue is gated on a sale (the button also ships dim until then).
      if (!decided) {
        outcome?.setProperties({
          text: "Choose a buyer first - England, or the smuggler.",
          color: "#e08a5a",
        });
        return;
      }
      this.handleContinue(entity);
    });
  }

  /** Leave England for good and head home — exactly as the old England code did. */
  private handleContinue(entity: Entity) {
    // Advance the logbook to leg 3 (the journey home) — the SAME value the route
    // map + summary already expect, so they pick up from here unchanged.
    voyageState.currentLeg = "leg3";
    console.log(
      "Captain's Voyage - leaving England. soldVia:",
      voyageState.soldVia,
      "profit:",
      voyageState.profit,
      "crownCompliance:",
      voyageState.crownCompliance,
      "caughtSmuggling:",
      voyageState.caughtSmuggling,
    );

    const world = this.world;
    // Defer one tick so we aren't disposing the very panel whose click is still
    // being dispatched, and strip its interaction tags first so the InputSystem
    // doesn't try to clear Hovered/Pressed off a destroyed entity.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      entity.dispose();

      // Hand off to the EXISTING route map transition (unchanged).
      beginReturnHomeMap(world);
    }, 0);
  }
}

/**
 * beginSmugglerOffer — register the system (so its "qualify" subscription is ready)
 * then build the card. englandRules.ts calls this once a price is agreed.
 */
export function beginSmugglerOffer(world: World): void {
  world.registerSystem(SmugglerOfferSystem);
  // Teach first, then choose: the smuggler tutorial (loyalty vs. profit) gates
  // the offer card. When the student dismisses it, the offer appears in its place.
  showTutorial(world, TUTORIALS.smuggler, () => createSmugglerPanel(world));
}
