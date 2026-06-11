// voyageSummary.ts
// ----------------------------------------------------------------------------
// The VOYAGE SUMMARY - the final screen of Captain's Voyage.
//
// After the route map sails the ship home, this screen appears and throws a
// little SCORING CEREMONY: the three score numbers count up from 0 like a coin
// counter, then up to three gold stars light one at a time - each with a ring
// of the ship's bell - and a play-style rank medal caps it off. Two buttons
// close the show: "Sail Again!" restarts the whole voyage, "Finish my voyage"
// ends the experience cleanly with a three-bell farewell peal.
//
//   beginVoyageSummary(world) — the route map calls this when the voyage ends.
//   createSummaryPanel(world) — spawns the floating summary card.
//   VoyageSummarySystem       — runs the ceremony and wires both buttons.
//
// The three scores (read from voyageState - we only READ it here):
//   - Cargo Value      (what England said the hold was worth)
//   - Profit           (the coins the captain actually keeps from the sale)
//   - Crown Compliance (100 is a perfect record; smuggling lowers it)
//
// CEREMONY PERF RULES: this system has an update(delta) that runs every frame
// while the ceremony plays. To keep VR at frame rate we (1) clamp delta,
// (2) keep ALL ceremony state in class fields set up in init - nothing is
// allocated per frame, and (3) only call setProperties when a DISPLAYED
// integer actually changes (guarded by a last-shown int per score line), so
// the whole count-up costs about 60 small text writes total, then the system
// goes idle behind a done flag.
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

// The voyage "logbook" - the scores we display live here.
import { voyageState } from "./voyageState.js";

// The shared, safe teardown helper (frees GPU + clears the ECS).
import { disposeEntityTree } from "./voyagePhases.js";

// The ship's bell at the main mast - one ring per star, three for farewell.
import { ringShipBell } from "./ambientMotion.js";

// Button juice: click sound + gold flash on every tap.
import { juiceButton } from "./uiFx.js";

// The persistent ledger HUD - we hide it so the ceremony owns the moment.
import { setHudVisible } from "./hud.js";

// --- Ceremony timing (seconds) ----------------------------------------------
// The numbers spin up first, then the stars land one... at a time, each with
// a bell ring. The gaps are wide enough that each ding reads as its own beat.
const COUNT_UP_SECONDS = 1.5; // 0.0-1.5s: all three numbers count up from 0
const STAR_TIMES = [1.8, 2.4, 3.0]; // when star 1, 2, 3 reveal (if earned)

// The kit colors the ceremony paints with.
const STAR_GOLD = "#c8962a"; // an EARNED star (matches every tappable gold)
const SAIL_AGAIN_COLORS = { backgroundColor: "#c8962a", color: "#1a120b" };
const FINISH_COLORS = { backgroundColor: "#ece0c4", color: "#5b3a21" };

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
    // Interactable lets the controller/mouse ray click the two buttons.
    .addComponent(Interactable);

  // Place it a few meters along +X at eye height, turned to face the player
  // standing at the origin. (Same spot the rule card and route map used.)
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0); // aim the panel's readable +Z face at the player

  return panel;
}

/**
 * VoyageSummarySystem - runs the scoring ceremony once the card has loaded,
 * and wires Sail Again + Finish.
 */
export class VoyageSummarySystem extends createSystem({
  summaryPanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR summary card.
    where: [eq(PanelUI, "config", "./ui/voyageSummary.json")],
  },
}) {
  // --- Ceremony state: ALL of it lives here as class fields (set in init), ---
  // --- so update() never allocates a single object per frame. ----------------
  private ceremonyActive!: boolean; // flips true once the card is wired
  private ceremonyDone!: boolean; //   the gate: true = update() does nothing
  private elapsed!: number; //         ceremony clock, in seconds

  // The final numbers each score line counts up TO.
  private targetCargo!: number;
  private targetProfit!: number;
  private targetCompliance!: number;

  // The integer each line currently SHOWS - we only write text when these
  // change, so the count-up costs ~60 writes total, not one per frame.
  private shownCargo!: number;
  private shownProfit!: number;
  private shownCompliance!: number;

  // The score line + star elements, grabbed once when the card loads.
  private cargoEl!: UIKit.Text | null;
  private profitEl!: UIKit.Text | null;
  private complianceEl!: UIKit.Text | null;
  private starEls!: (UIKit.Text | null)[];
  private starEarned!: boolean[]; //   which of the 3 stars the captain earned
  private starRevealed!: boolean[]; // which have already lit (or been skipped)

  init() {
    this.ceremonyActive = false;
    this.ceremonyDone = false;
    this.elapsed = 0;
    this.targetCargo = 0;
    this.targetProfit = 0;
    this.targetCompliance = 0;
    // The markup placeholders already read "0 coins" / "0 / 100", so the lines
    // start at a shown value of 0 - no need to rewrite the zeros on frame one.
    this.shownCargo = 0;
    this.shownProfit = 0;
    this.shownCompliance = 0;
    this.cargoEl = null;
    this.profitEl = null;
    this.complianceEl = null;
    this.starEls = [null, null, null];
    this.starEarned = [false, false, false];
    this.starRevealed = [false, false, false];

    // "qualify" fires once, when the card's document has finished loading and
    // its score lines and buttons actually exist to fill in and wire up.
    this.queries.summaryPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  /** Set the ceremony's targets, judge the stars and rank, wire the buttons. */
  private wirePanel(entity: Entity, doc: UIKitDocument) {
    // The ceremony owns this moment - tuck the ledger HUD away.
    setHudVisible(false);

    // --- Grab the three score lines; they count up from 0 in update() ---------
    this.cargoEl = doc.getElementById("cargo-value") as UIKit.Text | null;
    this.profitEl = doc.getElementById("profit") as UIKit.Text | null;
    this.complianceEl = doc.getElementById(
      "crown-compliance",
    ) as UIKit.Text | null;

    // "Spent" is everything the voyage cost: the goods bought at Virginia plus
    // any storm-detour provisions - the same math the ledger HUD uses.
    const spent = voyageState.purchaseCost + voyageState.detourCost;

    // Cargo Value: England's list valuation of the hold (the rules-based worth).
    this.targetCargo = voyageState.cargoValue;
    // Profit: the coins the captain actually KEEPS. The sale step records what
    // the buyer PAID in voyageState.profit; real profit subtracts what the
    // voyage cost. The hint on the card says "Coins you keep", so the number
    // must honor that - this is the game's core buying-margin lesson. (It can
    // even go negative - a caught smuggler's fine may not cover the costs -
    // and a negative number is exactly the right lesson in that moment.)
    this.targetProfit = voyageState.profit - spent;
    // Crown Compliance: a 0-100 score (drops only if the captain smuggled).
    this.targetCompliance = voyageState.crownCompliance;

    // --- Judge the three stars (revealed later, one bell ring each) -----------
    this.starEls = [
      doc.getElementById("star-1") as UIKit.Text | null,
      doc.getElementById("star-2") as UIKit.Text | null,
      doc.getElementById("star-3") as UIKit.Text | null,
    ];
    this.starEarned = [
      // Star 1: you finished the voyage with a sale - any sale. Every captain
      // who reaches this card has sold somewhere, so this is the "you did it!"
      // star that guarantees at least one bell ring.
      voyageState.soldVia !== "",
      // Star 2: a REAL net gain - the sale brought in more coins than the whole
      // trip cost. (profit here is the sale amount kept, so beating `spent`
      // means the captain truly came out ahead.)
      voyageState.profit > 0 && voyageState.profit > spent,
      // Star 3: a near-perfect record AND a sale at (or above) the hold's full
      // list value. Reachable legally - two won haggle pushes reach exactly
      // 100% of cargoValue with compliance still 100 - and by a lucky smuggler
      // (compliance 80, smuggler prices always beat England's list).
      voyageState.crownCompliance >= 80 &&
        voyageState.profit >= voyageState.cargoValue,
    ];
    this.starRevealed = [false, false, false];

    // --- Play-style rank: five tiers, worn like a medal ------------------------
    // Picked from HOW the captain sold - soldVia, caughtSmuggling, compliance,
    // and how hard they haggled. "Master Trader" is the TOP rank: a perfect
    // record AND a price pushed past the hold's full list value (three won
    // haggle pushes reach 110% of base, so any hold worth 100+ coins can do it).
    const STRONG_HAGGLE_RATIO = 1.0; // profit >= ratio * cargoValue => "strong"
    const MASTER_TRADER_MARGIN = 10; // coins ABOVE list value for the top rank
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
    } else if (
      voyageState.crownCompliance === 100 &&
      voyageState.profit >= voyageState.cargoValue + MASTER_TRADER_MARGIN
    ) {
      // The top rank: perfect record AND a price beyond the full list value.
      rankName = "Master Trader";
      rankDesc =
        "Perfect record AND a price above full value. The best rank there is!";
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

    // --- The takeaway: the purse math, then the lesson -------------------------
    // Lead with the full "Earned - Spent = Kept" equation so the buying-margin
    // lesson is visible: profit is what is LEFT after the spending.
    const purseLine = `Earned ${voyageState.profit} coins - Spent ${spent} coins = ${voyageState.profit - spent} coins kept.`;
    const lessonLine = voyageState.soldToSmuggler
      ? "You chased profit past the Crown's rules - selling to a smuggler for more coin while defying the Navigation Acts. That tension between profit and obedience was mercantilism."
      : "England's rules shaped your whole trip - what you carried, who you sold to, and who got rich. That is mercantilism.";
    const takeaway = doc.getElementById("takeaway") as UIKit.Text | null;
    takeaway?.setProperties({ text: `${purseLine} ${lessonLine}` });

    console.log(
      "Captain's Voyage - summary ceremony begins. profit:",
      voyageState.profit,
      "cargoValue:",
      voyageState.cargoValue,
      "crownCompliance:",
      voyageState.crownCompliance,
      "soldVia:",
      voyageState.soldVia,
      "rank:",
      rankName,
      "stars:",
      this.starEarned,
    );

    // --- Wire the two buttons, the juicy way -----------------------------------
    // Both buttons keep one fixed look, so a plain color object restores them
    // after the gold tap-flash.
    const sailAgainBtn = doc.getElementById("sail-again") as UIKit.Text | null;
    if (sailAgainBtn) {
      juiceButton(
        sailAgainBtn,
        () => this.handleSailAgain(),
        SAIL_AGAIN_COLORS,
      );
    }
    const finishBtn = doc.getElementById("finish-btn") as UIKit.Text | null;
    if (finishBtn) {
      juiceButton(finishBtn, () => this.handleFinish(entity), FINISH_COLORS);
    }

    // Lights up - the update() loop below takes it from here.
    this.elapsed = 0;
    this.ceremonyActive = true;
  }

  /**
   * The ceremony itself, one small step per frame:
   *   0.0-1.5s  the three numbers count up from 0 (eased, so they sprint
   *             early and settle gently onto the real value)
   *   1.8s      star 1 lights gold + one bell ring (if earned)
   *   2.4s      star 2, same deal
   *   3.0s      star 3, then the done flag closes the show for good
   * No allocations in here: text is only built when a shown integer changes.
   */
  update(delta: number) {
    if (!this.ceremonyActive || this.ceremonyDone) return;

    // Clamp delta: a long first frame (or a tab hiccup) must not let the whole
    // ceremony finish in one giant step.
    const dt = delta > 0.1 ? 0.1 : delta;
    this.elapsed += dt;

    // --- The count-up: eased progress, write only on integer change -----------
    const t = this.elapsed >= COUNT_UP_SECONDS ? 1 : this.elapsed / COUNT_UP_SECONDS;
    const inv = 1 - t;
    const eased = 1 - inv * inv * inv; // ease-out cubic: fast start, soft landing

    const cargoNow = Math.round(this.targetCargo * eased);
    if (cargoNow !== this.shownCargo) {
      this.shownCargo = cargoNow;
      this.cargoEl?.setProperties({ text: `${cargoNow} coins` });
    }

    // `|| 0` turns the -0 that Math.round gives a tiny negative into a plain 0,
    // so a money-losing voyage never flashes "-0 coins" on its first frame.
    const profitNow = Math.round(this.targetProfit * eased) || 0;
    if (profitNow !== this.shownProfit) {
      this.shownProfit = profitNow;
      this.profitEl?.setProperties({ text: `${profitNow} coins` });
    }

    const complianceNow = Math.round(this.targetCompliance * eased);
    if (complianceNow !== this.shownCompliance) {
      this.shownCompliance = complianceNow;
      this.complianceEl?.setProperties({ text: `${complianceNow} / 100` });
    }

    // --- The star reveals: gold + one bell ring per EARNED star ---------------
    for (let i = 0; i < 3; i++) {
      if (!this.starRevealed[i] && this.elapsed >= STAR_TIMES[i]) {
        this.starRevealed[i] = true; // earned or not, this beat is spent
        if (this.starEarned[i]) {
          this.starEls[i]?.setProperties({ color: STAR_GOLD });
          ringShipBell(1);
        }
      }
    }

    // After the last star beat the show is over - close the gate so this
    // system never touches the card again (even after it is disposed).
    if (this.elapsed >= STAR_TIMES[2]) {
      this.ceremonyDone = true;
    }
  }

  /** Sail Again - one more voyage! A page reload is the honest full reset. */
  private handleSailAgain() {
    // Stop the ceremony first so update() can't write to a dying page.
    this.ceremonyDone = true;
    console.log("Captain's Voyage - sailing again. Reloading for a fresh voyage.");

    // Leave the headset session if we're in one - reloading mid-session would
    // end it abruptly. In a flat browser tab there's nothing to exit.
    try {
      this.world.exitXR();
    } catch {
      // Not in an XR session - nothing to exit, which is fine.
    }

    // A short beat so the click sound and gold flash land, then start over.
    setTimeout(() => {
      window.location.reload();
    }, 250);
  }

  /** Finish - end the voyage cleanly: dismiss the card, leave XR, say farewell. */
  private handleFinish(entity: Entity) {
    // Stop the ceremony so update() never touches the card we're about to
    // dispose (the done flag is the gate).
    this.ceremonyDone = true;
    voyageState.currentLeg = "finished";
    console.log("Captain's Voyage - finished. Final voyageState:", voyageState);

    // A three-ring farewell peal from the ship's bell - the voyage is over.
    ringShipBell(3);

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
