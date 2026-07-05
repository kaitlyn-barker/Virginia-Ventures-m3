// smugglerOffer.ts
// ----------------------------------------------------------------------------
// The SMUGGLER'S OFFER — the final sale decision, shown AFTER the England haggle.
//
// A Dutch smuggler sidles up in the customs-house shadow and offers MORE money
// for the same cargo — illegally. The student picks one of two buyers:
//   • Sell to England (legal)   — take the haggled price (englishSaleAmount).
//                                 Crown Compliance stays put.
//   • Sell to the smuggler (illegal) — a genuine GAMBLE, played as a SUSPENSE
//                                 BEAT: the buttons lock, "customs lanterns swing
//                                 closer", one soft bell rings, and only 1.4
//                                 seconds later does the roll against
//                                 SMUGGLE_DISCOVERY_CHANCE land:
//                                   - got away: the full (bigger) smuggler payout,
//                                     a modest Compliance hit, a green card edge,
//                                     one all-clear bell.
//                                   - caught:  cargo mostly seized + a fine, so you
//                                     keep only a fraction of England's price, a
//                                     big Compliance hit, a red-brown card edge,
//                                     and three fast customs bells.
//
// After ANY sale the deck crates are carried off (removeAllCargoProps) and the
// captain's ledger HUD repaints (refreshHud), so the world matches the logbook.
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
  markPhase,
} from "./voyageState.js";

// The next screens, in order: the England "buy for the next leg" step (the
// second half of the mercantile loop), then the West Africa reflection (the
// second side of the triangle), then the existing animated route map home.
import { beginReturnHomeMap } from "./returnHomeMap.js";
import { beginEnglandGoodsBuy } from "./englandGoods.js";
import { beginWestAfricaLeg } from "./westAfricaLeg.js";

// The reusable tutorial coach: a short teaching card gates the smuggler's offer.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// Shared polish helpers (all built once in index.ts — we just call them):
//   ringShipBell      — the positional ship's bell at the main mast.
//   juiceButton       — click sound + gold flash on every player-facing button.
//   refreshHud        — repaint the captain's ledger after logbook changes.
//   removeAllCargoProps — clear the deck crates once the cargo is sold/seized.
import { ringShipBell } from "./ambientMotion.js";
import { juiceButton } from "./uiFx.js";
import { refreshHud } from "./hud.js";
import { removeAllCargoProps } from "./cargoProps.js";

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
    // The whole card first (so outcomes can recolor its border), then every
    // line and button we fill in or wire up — all ids live in the markup.
    const card = doc.getElementById("smuggler-card") as UIKit.Text | null;
    const englandAmountText = doc.getElementById("england-amount") as UIKit.Text | null;
    const smugglerAmountText = doc.getElementById("smuggler-amount") as UIKit.Text | null;
    const sellEnglandBtn = doc.getElementById("sell-england") as UIKit.Text | null;
    const sellSmugglerBtn = doc.getElementById("sell-smuggler") as UIKit.Text | null;
    const sellEnglandLabel = doc.getElementById("sell-england-label") as UIKit.Text | null;
    const sellSmugglerLabel = doc.getElementById("sell-smuggler-label") as UIKit.Text | null;
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

    // State the gamble PLAINLY as "N in 10", derived from the catch-chance
    // constant so the copy can never drift from the real odds. Risk literacy,
    // not a hidden trap: the student sees the odds before choosing AND the roll
    // result after, so the lesson is about weighing a known risk, not luck.
    const catchInTen = Math.round(SMUGGLE_DISCOVERY_CHANCE * 10);

    // TWO small flags guard the flow:
    //   choiceLocked — a buyer has been clicked, so both buyer buttons stop
    //                  working (no re-deciding the sale).
    //   decided      — the sale has actually RESOLVED. England resolves at once;
    //                  the smuggler takes a 1.4 second suspense beat first.
    //                  Continue only unlocks when this is true.
    let choiceLocked = false;
    let decided = false;

    // Dim both buyer buttons (and their label lines) so they read as locked.
    const lockChoices = () => {
      for (const b of [sellEnglandBtn, sellSmugglerBtn]) {
        b?.setProperties({ backgroundColor: "#2a3942", color: "#6b7682" });
      }
      for (const label of [sellEnglandLabel, sellSmugglerLabel]) {
        label?.setProperties({ color: "#6b7682" });
      }
    };

    // After juiceButton's gold flash, repaint the buyer buttons' TRUE state:
    // locked-dim once a choice is made, or their markup colors before then.
    const repaintBuyers = () => {
      if (choiceLocked) {
        lockChoices();
        return;
      }
      sellEnglandBtn?.setProperties({ backgroundColor: "#1d2932", color: "#e7edf1" });
      sellSmugglerBtn?.setProperties({ backgroundColor: "#3a211c", color: "#e7edf1" });
    };

    // Show the big outcome banner and unlock Continue: it goes gold AND its
    // label flips from "Pick a buyer first" to a plain "Continue".
    const reveal = (text: string, color: string) => {
      outcome?.setProperties({ text, color });
      continueBtn?.setProperties({
        text: "Continue",
        backgroundColor: "#c8962a",
        color: "#1a120b",
      });
    };

    // After Continue's click-flash, repaint ITS true state: gold once the sale
    // has resolved, otherwise the dim locked look it shipped with.
    const repaintContinue = () => {
      if (decided) {
        continueBtn?.setProperties({
          text: "Continue",
          backgroundColor: "#c8962a",
          color: "#1a120b",
        });
      } else {
        continueBtn?.setProperties({ backgroundColor: "#2a3942", color: "#93a0ab" });
      }
    };

    // --- Sell to England: the LEGAL sale. Take the haggled price as-is. --------
    const sellToEngland = () => {
      if (choiceLocked) return;
      choiceLocked = true;
      decided = true; // the legal sale resolves instantly — no gamble to roll
      lockChoices();

      voyageState.soldVia = "england";
      voyageState.profit = englishAmount;
      // crownCompliance is LEFT at 100 — obeying the Crown costs nothing.
      decisions.push(
        `You sold to England for ${englishAmount} coins - legal and loyal to the Crown.`,
      );

      reveal(
        `A fair, legal sale! England pays ${englishAmount} coins. The King is pleased. Crown Compliance holds at ${voyageState.crownCompliance} / 100.`,
        "#9fd29f",
      );

      // The cargo is sold and carried off the deck; the ledger HUD catches up.
      removeAllCargoProps();
      refreshHud();
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
    // Played as a SUSPENSE BEAT: lock the buttons, show the held-breath line,
    // ring one soft bell... then a single one-shot 1.4 second timer rolls the
    // dice and reveals. Continue stays locked until the roll lands (decided
    // only flips inside the timeout), so nobody can sail off mid-gamble.
    const sellToSmuggler = () => {
      if (choiceLocked) return;
      choiceLocked = true;
      lockChoices();

      voyageState.soldVia = "smuggler";
      // BUGFIX: the logbook's soldToSmuggler flag was never set before.
      voyageState.soldToSmuggler = true;
      refreshHud();

      // The held-breath moment: warm "info" gold while the lanterns close in.
      outcome?.setProperties({
        text: "You hand the cargo over in the dark... customs lanterns swing closer.",
        color: "#e0b870",
      });
      ringShipBell(1);

      setTimeout(() => {
        // The gamble: a SMUGGLE_DISCOVERY_CHANCE (30%) chance the Crown catches you.
        const caught = Math.random() < SMUGGLE_DISCOVERY_CHANCE;

        if (!caught) {
          // Got away with it: the full, bigger smuggler payout; a modest hit.
          voyageState.profit = smugglerTotal;
          voyageState.crownCompliance = Math.max(
            0,
            voyageState.crownCompliance - SMUGGLE_SUCCESS_COMPLIANCE_PENALTY,
          );
          decisions.push(
            `You sold to the smuggler for ${smugglerTotal} coins and slipped away in the dark.`,
          );
          // The whole card's edge turns green, and one low all-clear bell rings.
          card?.setProperties({ borderColor: "#9fd29f" });
          reveal(
            `The odds were ${catchInTen} in 10 to be caught, and this time luck was with you. You got away with it! The smuggler pays ${smugglerTotal} coins. Crown Compliance slips to ${voyageState.crownCompliance} / 100.`,
            "#9fd29f",
          );
          ringShipBell(1);
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
          decisions.push(
            `You sold to the smuggler - but customs caught you, seized the cargo, and left you only ${fineProfit} coins.`,
          );
          // The card's edge flushes the illicit red-brown, and three fast
          // customs bells raise the alarm.
          card?.setProperties({ borderColor: "#8a4636" });
          reveal(
            `The odds were ${catchInTen} in 10 to be caught, and today luck was not with you. Caught! Customs seize most of your cargo. You keep only ${fineProfit} coins. Crown Compliance crashes to ${voyageState.crownCompliance} / 100.`,
            "#e08a5a",
          );
          ringShipBell(3, 250);
        }

        // Either way the cargo leaves the deck, the ledger HUD repaints, and
        // ONLY NOW does Continue unlock.
        removeAllCargoProps();
        refreshHud();
        decided = true;
        console.log(
          "Captain's Voyage - smuggled. caught:",
          caught,
          "profit:",
          voyageState.profit,
          "crownCompliance:",
          voyageState.crownCompliance,
        );
      }, 1400);
    };

    // --- Initial draw + wiring ------------------------------------------------
    englandAmountText?.setProperties({ text: `${englishAmount} coins` });
    smugglerAmountText?.setProperties({ text: `${smugglerTotal} coins` });
    outcome?.setProperties({
      text: `Take England's legal ${englishAmount} coins, or gamble on the smuggler's ${smugglerTotal} coins? The smuggler pays more - but there is a ${catchInTen} in 10 chance customs catch you.`,
      color: "#9fb0bb",
    });

    // Every player-facing button gets the shared juice (click sound + gold
    // flash). The restore callbacks repaint each button's TRUE current state
    // once the flash fades, so a flash can never strand a wrong color.
    if (sellEnglandBtn) juiceButton(sellEnglandBtn, sellToEngland, repaintBuyers);
    if (sellSmugglerBtn) juiceButton(sellSmugglerBtn, sellToSmuggler, repaintBuyers);
    if (continueBtn) {
      juiceButton(
        continueBtn,
        () => {
          // Continue is gated on a RESOLVED sale (it also ships dim + labeled
          // "Pick a buyer first" until then).
          if (!decided) {
            // Mid-suspense (a buyer IS picked, the roll just hasn't landed),
            // stay quiet so the lanterns line keeps the screen.
            if (!choiceLocked) {
              outcome?.setProperties({
                text: "Pick a buyer first - England, or the smuggler.",
                color: "#e08a5a",
              });
            }
            return;
          }
          this.handleContinue(entity);
        },
        repaintContinue,
      );
    }
  }

  /** Sale settled — now BUY English goods for the trip home, then sail. */
  private handleContinue(entity: Entity) {
    // Close the smuggler decision's Efficiency clock — the buy step is untimed,
    // and this is the last gamble before heading home.
    markPhase("smuggler");
    refreshHud();
    console.log(
      "Captain's Voyage - sale settled. soldVia:",
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

      // The rest of the triangle: buy English goods, then witness the West
      // Africa leg (no gameplay), then sail home on the EXISTING route map.
      beginEnglandGoodsBuy(world, () =>
        beginWestAfricaLeg(world, () => beginReturnHomeMap(world)),
      );
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
