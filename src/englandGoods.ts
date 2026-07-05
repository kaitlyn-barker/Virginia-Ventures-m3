// englandGoods.ts
// ----------------------------------------------------------------------------
// The ENGLAND "buy for the next leg" step — the second half of the mercantile
// loop, shown AFTER the sale is settled and BEFORE the ship leaves England.
//
// The captain has just been paid for their raw colonial goods. Now they spend
// those proceeds on English MANUFACTURED goods (iron tools, cloth, furniture),
// made from colonial raw materials and sold BACK to the colonies at England's
// price. Carried home (Leg 3), they resell for a modest gain. That round trip —
// raw out, finished back, England setting both prices — IS mercantilism.
//
//   createEnglandGoodsPanel(world) — spawns the floating buy panel.
//   EnglandGoodsSystem             — wires the good buttons + Sail Home.
//   beginEnglandGoodsBuy(world, onDone)
//                                  — registers the system and builds the panel,
//                                    stashing the continuation to run when the
//                                    captain sails home.
//
// Mirrors virginiaCargo.ts closely (same six-slot hold, same slot-painting), but
// spending is capped by the sale proceeds — the student can never spend more
// than they earned. Buying is OPTIONAL; the captain may sail home empty.
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

// The voyage "logbook" and the England-goods price/slot tables. We READ the
// tables and WRITE the live buy state (goodsBoughtInEngland, englandPurchaseCost,
// virginiaResaleGain) — that IS the gameplay.
import {
  voyageState,
  ENGLAND_GOODS_SLOTS,
  ENGLAND_GOODS_PRICE,
  VIRGINIA_RESALE_PRICE,
} from "./voyageState.js";

// Shared polish: juiceButton (click + gold flash) and refreshHud (repaint the
// captain's ledger, which shows the remaining purse during this step).
import { juiceButton } from "./uiFx.js";
import { refreshHud } from "./hud.js";

// Typed views of the England-goods tables (we only READ them).
const GOODS_SLOTS = ENGLAND_GOODS_SLOTS as Record<string, number>;
const GOODS_PRICE = ENGLAND_GOODS_PRICE as Record<string, number>;
const RESALE_PRICE = VIRGINIA_RESALE_PRICE as Record<string, number>;

// Presentation only: a friendly label and the color a filled slot turns. The
// blue-grey palette sets these English goods apart from the Virginia raw goods.
const GOOD_INFO: Record<string, { label: string; color: string }> = {
  tools: { label: "Tools", color: "#8fa9c0" }, //     cold iron blue-grey
  cloth: { label: "Cloth", color: "#c0a0b8" }, //     dyed-textile mauve
  furniture: { label: "Chair", color: "#b79a6a" }, // polished-wood tan
};

// Empty-slot colors, matched to the panel markup.
const EMPTY_SLOT_BG = "#2a1e14";
const EMPTY_SLOT_FG = "#8a7860";

// The continuation to run once the captain sails home (build the return map, or
// — once it exists — the West Africa leg). Stored at module scope, cleared after
// it runs, exactly as stormDecision.ts stashes its continuation.
let onSailHome: (() => void) | null = null;

/**
 * Create the floating England buy panel and place it in the usual card spot
 * (a few meters along +X, facing the player). Call once, after the sale.
 */
export function createEnglandGoodsPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/englandGoods.json",
      maxWidth: 1.25,
      maxHeight: 1.05,
    })
    .addComponent(Interactable);

  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * Wires the buy panel: waits for its document to load, then connects the good
 * buttons (each capped by the remaining purse and the six-slot hold) and Sail Home.
 */
export class EnglandGoodsSystem extends createSystem({
  buyPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/englandGoods.json")],
  },
}) {
  init() {
    this.queries.buyPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  private wirePanel(entity: Entity, doc: UIKitDocument) {
    const message = doc.getElementById("message") as UIKit.Text | null;
    const purse = doc.getElementById("purse") as UIKit.Text | null;
    const sailHomeBtn = doc.getElementById("sail-home") as UIKit.Text | null;
    const slots = [1, 2, 3, 4, 5, 6].map(
      (n) => doc.getElementById(`slot-${n}`) as UIKit.Text | null,
    );

    // The live "what's bought" list (pushing onto this pushes onto voyageState).
    const bought = voyageState.goodsBoughtInEngland as string[];
    const decisions = voyageState.decisionsLog as string[];

    // The purse: the captain may spend up to what the sale paid (voyageState.profit
    // is the sale proceeds at this point). This is the hard "can't spend more than
    // you earned" cap. remaining() is recomputed fresh so it's always correct.
    const budget = Math.max(0, voyageState.profit);
    const usedSlots = (): number =>
      bought.reduce((sum, good) => sum + (GOODS_SLOTS[good] ?? 0), 0);
    const spent = (): number =>
      bought.reduce((sum, good) => sum + (GOODS_PRICE[good] ?? 0), 0);
    const remaining = (): number => budget - spent();

    // Redraw the hold slots + the purse + the ledger from the current state.
    const refresh = () => {
      const filledBy: string[] = [];
      for (const good of bought) {
        const cost = GOODS_SLOTS[good] ?? 0;
        for (let i = 0; i < cost; i++) filledBy.push(good);
      }
      slots.forEach((slot, index) => {
        if (!slot) return;
        const good = filledBy[index];
        if (good) {
          const info = GOOD_INFO[good];
          slot.setProperties({
            text: info?.label ?? good,
            backgroundColor: info?.color ?? "#5b3a21",
            color: "#1a120b",
          });
        } else {
          slot.setProperties({
            text: "open",
            backgroundColor: EMPTY_SLOT_BG,
            color: EMPTY_SLOT_FG,
          });
        }
      });
      // Keep voyageState's running spend live so the ledger HUD can show the
      // remaining purse while this step is on screen.
      voyageState.englandPurchaseCost = spent();
      purse?.setProperties({ text: `${remaining()} coins` });
      refreshHud();
    };

    // A quick "can't do that" blink on the slot borders (full hold or no coins).
    const SLOT_BORDER = "#4a3a28";
    const flashSlots = () => {
      for (const slot of slots) slot?.setProperties({ borderColor: "#e08a5a" });
      setTimeout(() => {
        for (const slot of slots) slot?.setProperties({ borderColor: SLOT_BORDER });
      }, 350);
    };

    // Try to buy one good: it must FIT the hold AND be affordable.
    const buyGood = (goodName: string) => {
      const cost = GOODS_SLOTS[goodName] ?? 0;
      const price = GOODS_PRICE[goodName] ?? 0;
      const label = GOOD_INFO[goodName]?.label ?? goodName;

      if (usedSlots() + cost > voyageState.cargoSlotsTotal) {
        message?.setProperties({
          text: "No room in the hold for that. You'll have to leave it.",
          color: "#e08a5a",
        });
        flashSlots();
        return;
      }
      if (price > remaining()) {
        message?.setProperties({
          text: `Not enough coins for ${label}. You can only spend what you earned.`,
          color: "#e08a5a",
        });
        flashSlots();
        return;
      }

      bought.push(goodName);
      const left = voyageState.cargoSlotsTotal - usedSlots();
      message?.setProperties({
        text: `Bought ${label} for ${price} coins. ${remaining()} coins and ${left} slot${left === 1 ? "" : "s"} left.`,
        color: "#9fd29f",
      });
      refresh();
    };

    // Sail Home: total the resale value, log the purchase, and run the stashed
    // continuation (return map / West Africa). Buying is optional — an empty
    // hold is fine, and the captain simply carries no goods home.
    const handleSailHome = () => {
      voyageState.englandPurchaseCost = spent();
      // Leg 3 payoff: what these goods will fetch when resold in Virginia.
      voyageState.virginiaResaleGain = bought.reduce(
        (sum, good) => sum + (RESALE_PRICE[good] ?? 0),
        0,
      );

      if (bought.length) {
        const labels = bought.map((g) => GOOD_INFO[g]?.label ?? g).join(", ");
        decisions.push(
          `You spent ${voyageState.englandPurchaseCost} coins on English goods (${labels}) to sell back home.`,
        );
      } else {
        decisions.push("You sailed home from England carrying no goods to resell.");
      }

      voyageState.currentLeg = "leg3";
      refreshHud();
      console.log(
        "Captain's Voyage - bought English goods:",
        bought,
        "englandPurchaseCost:",
        voyageState.englandPurchaseCost,
        "virginiaResaleGain:",
        voyageState.virginiaResaleGain,
      );

      const world = this.world;
      // Defer one tick (don't dispose the panel mid-click) and strip interaction
      // tags first, the standard teardown idiom.
      setTimeout(() => {
        for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
          if (entity.hasComponent(tag)) entity.removeComponent(tag);
        }
        entity.dispose();

        const resolve = onSailHome;
        onSailHome = null;
        resolve?.();
      }, 0);
    };

    // Stamp each good button's label from the real tables so it can never drift,
    // paint it its slot color, and wire the click through the shared juice.
    for (const name of Object.keys(GOOD_INFO)) {
      const btn = doc.getElementById(`buy-${name}`) as UIKit.Text | null;
      if (!btn) continue;
      const cost = GOODS_SLOTS[name] ?? 0;
      const price = GOODS_PRICE[name] ?? 0;
      btn.setProperties({
        text: `${GOOD_INFO[name].label} - ${cost} slot${cost === 1 ? "" : "s"} - ${price} coins`,
        backgroundColor: GOOD_INFO[name].color,
        color: "#1a120b",
      });
      juiceButton(btn, () => buyGood(name), {
        backgroundColor: GOOD_INFO[name].color,
        color: "#1a120b",
      });
    }
    // Sail Home ships gold and stays gold, so its restore is plain colors.
    if (sailHomeBtn) {
      juiceButton(sailHomeBtn, handleSailHome, {
        backgroundColor: "#c8962a",
        color: "#1a120b",
      });
    }

    // Draw the starting state (empty hold, full purse shown).
    refresh();
  }
}

// Registered once, lazily, on first use.
let systemRegistered = false;

/**
 * beginEnglandGoodsBuy — register the system (so its "qualify" subscription is
 * ready) and build the buy panel. `onDone` runs when the captain sails home.
 * The smuggler step calls this once the sale is settled.
 */
export function beginEnglandGoodsBuy(world: World, onDone: () => void): void {
  onSailHome = onDone;
  // Mark the buy leg so the ledger HUD shows the remaining purse + English hold.
  voyageState.currentLeg = "leg2buy";
  if (!systemRegistered) {
    world.registerSystem(EnglandGoodsSystem);
    systemRegistered = true;
  }
  createEnglandGoodsPanel(world);
}
