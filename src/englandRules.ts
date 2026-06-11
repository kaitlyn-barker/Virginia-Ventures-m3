// englandRules.ts
// ----------------------------------------------------------------------------
// The ENGLAND arrival beat — the teaching heart of this leg.
//
// When the ship reaches England, three things happen here:
//   1. arriveInEngland()        — the DATA step. England reveals its prices and
//                                 we work out what the hold is worth.
//   2. createEnglandRulePanel() — spawns the floating "Navigation Acts" rule
//                                 card in front of the player. (Its look/markup
//                                 lives in ui/englandRules.uikitml.)
//   3. EnglandRulesSystem       — applies any storm damage, runs the HAGGLE, and
//                                 wires the Continue button to the smuggler step.
//
// `beginEnglandPhase(world)` at the bottom runs all three in order; the phase
// controller (voyagePhases.ts) calls it the moment the England port is built.
//
// IMPORTANT LESSON RULE for this phase: the student's cargo is LOCKED IN. We
// only READ voyageState.cargoLoaded (their choices) — we never change it here, and
// there is no way to re-load goods. England sets the list price; the student may
// HAGGLE the final England offer, but the smuggler choice (Edit 4) comes later.
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

// The voyage "logbook", the prices England will pay, and two tunable constants:
// STORM_DAMAGE_PCT (how much a storm-damaged hold loses) and HAGGLE_MAX_ROUNDS
// (how many times the student may push for more).
import {
  voyageState,
  ENGLAND_PRICE,
  STORM_DAMAGE_PCT,
  HAGGLE_MAX_ROUNDS,
} from "./voyageState.js";

// The next step: the smuggler's offer (England's legal haggled price vs. the
// smuggler's bigger illegal one). It sets the FINAL sale (profit + Crown
// Compliance) and then hands off to the existing route map.
import { beginSmugglerOffer } from "./smugglerOffer.js";

// The reusable tutorial coach: a short teaching card gates the England rule card.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// Shared polish: juiceButton answers every tap with a click sound and a quick
// gold flash, and refreshHud repaints the captain's ledger overhead whenever
// this file changes the voyage logbook.
import { juiceButton } from "./uiFx.js";
import { refreshHud } from "./hud.js";

// voyageState.js is plain JavaScript, so TypeScript infers very tight types for
// it (ENGLAND_PRICE as exactly its three keys, cargoLoaded as an empty array).
// We view them through small typed aliases so the logic reads cleanly — we never
// change the values in voyageState.js itself.
const PRICE = ENGLAND_PRICE as Record<string, number>;

// --- Haggle tuning (labeled so the numbers are easy to find and tweak) ----------
// All percentages below are of the "base" — the cargo's value AFTER any storm
// damage. HAGGLE_MAX_ROUNDS (how many pushes are allowed) lives in voyageState.js
// alongside the other tunable constants.
const HAGGLE_OPENING_PCT = 0.8; //   merchant's opening offer = 80% of base
const HAGGLE_PUSH_GAIN_PCT = 0.1; // each successful push adds 10% of base
const HAGGLE_ANNOY_CHANCE = 0.25; // 25% chance a push annoys the merchant
const HAGGLE_ANNOYED_PCT = 0.7; //   annoyed -> final take-it-or-leave-it = 70% of base

/**
 * arriveInEngland — the DATA step of reaching England.
 *
 * 1. Flip `englishPricesRevealed` to true: until now the prices were hidden, and
 *    arriving in port is what reveals them.
 * 2. Compute `cargoValue` by adding up ENGLAND_PRICE for every good already in
 *    the hold. We READ cargoLoaded but never modify it — the student's choices
 *    are locked, and only England's price list decides their worth.
 */
export function arriveInEngland(): void {
  // England now shows its hand.
  voyageState.englishPricesRevealed = true;

  // Add England's price for each good the student loaded back in Virginia.
  // (A good not in the price list contributes 0 — a safe default.)
  let total = 0;
  for (const good of voyageState.cargoLoaded as string[]) {
    total += PRICE[good] ?? 0;
  }

  // Record the total. This is England's LIST valuation of the hold — the starting
  // point the student then haggles from (and that storm damage is applied to in
  // wirePanel). We never overwrite it below, so the raw list value is preserved.
  voyageState.cargoValue = total;

  // The logbook changed, so repaint the captain's ledger floating overhead.
  refreshHud();
}

/**
 * Create the floating England rule card and place it in front of the player.
 * Call once, after arriveInEngland(). Returns the panel entity.
 */
export function createEnglandRulePanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/englandRules.json automatically). maxWidth/maxHeight
    // bound how big the card grows in meters — generous here, since it's wordy.
    .addComponent(PanelUI, {
      config: "./ui/englandRules.json",
      maxWidth: 1.7,
      maxHeight: 1.6,
    })
    // Interactable lets the controller/mouse ray click the Continue button.
    .addComponent(Interactable);

  // Place it just ahead of the player. On arriving in England the player rig is
  // turned to face +X (see index.ts), and they stand at the world origin, so a
  // spot a few meters along +X at eye height sits right in their view.
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);

  // Turn the readable face toward the player. A UIKit panel's readable face is
  // its +Z side, and lookAt() aims that +Z at the target — so we simply look at
  // the player's standing position. Both points share y = 1.5 so the card stays
  // upright (no tilt).
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * Wires the rule card's behavior: it waits for the panel document to load, then
 * writes in the cargo value and connects the "Continue voyage" button.
 */
export class EnglandRulesSystem extends createSystem({
  rulePanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR card (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/englandRules.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the panel's document has finished loading and
    // its elements (the value line, the button) actually exist to wire up.
    this.queries.rulePanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  /** Wire the HAGGLE: apply storm damage, let the student push or accept, store
   *  the agreed England price, then Continue toward the smuggler step. */
  private wirePanel(entity: Entity, doc: UIKitDocument) {
    // --- Grab the elements we need by their id (set in the .uikitml) ----------
    const offerText = doc.getElementById("offer-value") as UIKit.Text | null;
    const pushBtn = doc.getElementById("haggle-push") as UIKit.Text | null;
    const acceptBtn = doc.getElementById("haggle-accept") as UIKit.Text | null;
    const saleMessage = doc.getElementById("sale-message") as UIKit.Text | null;
    const continueBtn = doc.getElementById("continue-voyage") as UIKit.Text | null;

    // The running list of voyage choices (typed view of the JS array we push to).
    const decisions = voyageState.decisionsLog as string[];

    // --- Storm damage: knock STORM_DAMAGE_PCT off the EFFECTIVE value ----------
    // arriveInEngland() already set voyageState.cargoValue (England's list price
    // for the hold). We leave that raw number untouched and haggle from a local
    // "base": if the storm damaged the cargo, the base is 15% lower.
    const rawValue = voyageState.cargoValue;
    const stormHit = voyageState.stormDamage === true;
    const base = stormHit ? Math.round(rawValue * (1 - STORM_DAMAGE_PCT)) : rawValue;

    const count = (voyageState.cargoLoaded as string[]).length;
    const goods = `${count} good${count === 1 ? "" : "s"}`;

    // --- Haggle state (closure — no per-frame work, so no component needed) ----
    let currentOffer = Math.round(base * HAGGLE_OPENING_PCT); // opens at 80% of base
    let pushesUsed = 0; //         how many times the student has pushed
    let pushingClosed = false; //  no more pushes (hit the round cap, or annoyed)
    let settled = false; //        true once the student Accepts the price

    // Small helpers. renderOffer redraws the offer line - the NUMBER leads, so
    // the coins are the first thing a young captain reads. paintButtons repaints
    // every button to its TRUE state; it is also what juiceButton restores to
    // after its gold flash, so a flash can never strand a button in the wrong
    // colors.
    const renderOffer = () => {
      offerText?.setProperties({
        text: `${currentOffer} coins - England's offer for your ${goods}`,
      });
    };
    const LIVE = { backgroundColor: "#1d2932", color: "#e7edf1" }; // a tappable haggle button
    const LOCKED = { backgroundColor: "#2a3942", color: "#93a0ab" }; // locked reads calm, not broken
    const paintButtons = () => {
      pushBtn?.setProperties(settled || pushingClosed ? LOCKED : LIVE);
      acceptBtn?.setProperties(settled ? LOCKED : LIVE);
      // The Continue button explains itself: while locked its LABEL carries the
      // reason; once a price is agreed it turns gold and simply says "Continue".
      continueBtn?.setProperties(
        settled
          ? { text: "Continue", backgroundColor: "#c8962a", color: "#1a120b" }
          : { text: "Agree a price first", ...LOCKED },
      );
    };

    // --- Push for more: +10% of base, but a 25% chance the merchant balks ------
    const pushForMore = () => {
      if (settled || pushingClosed) return;
      pushesUsed += 1;

      if (Math.random() < HAGGLE_ANNOY_CHANCE) {
        // The merchant takes offense: a final, lower take-it-or-leave-it offer,
        // and no more haggling. The student can still Accept it.
        currentOffer = Math.round(base * HAGGLE_ANNOYED_PCT);
        pushingClosed = true;
        paintButtons();
        renderOffer();
        saleMessage?.setProperties({
          text: "The merchant takes offense - final offer, take it or leave it. Tap Accept to settle.",
          color: "#e08a5a",
        });
        return;
      }

      // Success: the offer climbs by 10% of base.
      currentOffer += Math.round(base * HAGGLE_PUSH_GAIN_PCT);

      if (pushesUsed >= HAGGLE_MAX_ROUNDS) {
        // Out of rounds: this is England's final offer now.
        pushingClosed = true;
        paintButtons();
        saleMessage?.setProperties({
          text: `Well haggled! The merchant comes up to ${currentOffer} coins. That is their final offer - tap Accept to settle.`,
          color: "#9fd29f",
        });
      } else {
        saleMessage?.setProperties({
          text: `Well haggled! The merchant comes up to ${currentOffer} coins. Push again, or Accept?`,
          color: "#9fd29f",
        });
      }
      renderOffer();
    };

    // --- Accept: settle the England price (but DON'T finalize profit yet) ------
    // We only record englishSaleAmount. The smuggler step (Edit 4) decides the
    // FINAL sale, and may override this with a bigger, illegal payout.
    const accept = () => {
      if (settled) return;
      settled = true;
      pushingClosed = true;
      voyageState.englishSaleAmount = currentOffer;
      decisions.push(`england: agreed ${currentOffer} coins`);

      // The logbook changed (the agreed price is in), so repaint the ledger.
      refreshHud();

      // Lock the haggle buttons and turn Continue bright gold. Its label flips
      // to a plain "Continue" - the lock reason is gone because the gate is open.
      paintButtons();

      saleMessage?.setProperties({
        text: `Deal! England will pay ${currentOffer} coins. Nice trading, Captain!`,
        color: "#9fd29f",
      });
      console.log(
        "Captain's Voyage - England haggle settled. englishSaleAmount:",
        voyageState.englishSaleAmount,
        "stormDamage:",
        stormHit,
      );
    };

    // --- Initial draw + wiring ------------------------------------------------
    renderOffer();
    // Paint every button from the same function that owns their state, so the
    // markup defaults can never drift out of sync with the LIVE/LOCKED colors.
    paintButtons();
    saleMessage?.setProperties({
      text: stormHit
        ? "The storm cost you - England values the damaged hold lower. Haggle, or accept the offer."
        : "Haggle for a better price, or accept England's offer.",
      color: "#9fb0bb",
    });

    // Every button gets the shared juice: click sound, gold flash, then
    // paintButtons puts its true colors (and the Continue label) back.
    if (pushBtn) juiceButton(pushBtn, pushForMore, paintButtons);
    if (acceptBtn) juiceButton(acceptBtn, accept, paintButtons);
    if (continueBtn) {
      juiceButton(
        continueBtn,
        () => {
          // Continue is gated on settling a price (the button ships locked,
          // wearing its reason - "Agree a price first" - as its label).
          if (!settled) {
            saleMessage?.setProperties({
              text: "Agree a price first - Push for more, or Accept England's offer.",
              color: "#e08a5a",
            });
            return;
          }
          this.proceedToSmugglerStep(entity);
        },
        paintButtons,
      );
    }
  }

  /**
   * proceedToSmugglerStep — leave the England haggle card and raise the smuggler's
   * offer (England's haggled price vs. the smuggler's bigger illegal one). That
   * step reads voyageState.englishSaleAmount, sets the FINAL sale, and then hands
   * off to the existing route map.
   */
  // Guards against a double-tap on the gold Continue scheduling this handoff
  // twice (which would dispose the panel twice and raise two smuggler cards).
  private forwarding = false;

  private proceedToSmugglerStep(entity: Entity) {
    if (this.forwarding) return;
    this.forwarding = true;
    const world = this.world;
    // Defer one tick so we aren't disposing the very panel whose click is still
    // being dispatched, and strip its interaction tags first so the InputSystem
    // doesn't try to clear Hovered/Pressed off a destroyed entity.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      entity.dispose();

      // The smuggler decision sits between England and the route map.
      beginSmugglerOffer(world);
    }, 0);
  }
}

/**
 * beginEnglandPhase — run the whole arrival beat, in order. The phase controller
 * (voyagePhases.ts) calls this right after it builds the England port.
 */
export function beginEnglandPhase(world: World): void {
  // 1. Reveal England's prices and value the cargo (pure data).
  arriveInEngland();

  // 2. Register the system BEFORE the card exists, so its "qualify" subscription
  //    is ready to catch the panel the instant its document finishes loading.
  world.registerSystem(EnglandRulesSystem);

  // 3. Teach first, then trade: the England tutorial (the Navigation Acts in
  //    brief) gates the rule card. When the student dismisses it, the rule card
  //    appears in its place.
  showTutorial(world, TUTORIALS.england, () => createEnglandRulePanel(world));
}
