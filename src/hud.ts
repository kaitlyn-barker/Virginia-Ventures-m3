// hud.ts
// ----------------------------------------------------------------------------
// The CAPTAIN'S LEDGER — a small always-on scoreboard floating above the phase
// cards. It keeps the three numbers the student is playing for in view for the
// whole voyage: cargo slots filled, coins spent (then earned), and the Crown
// Compliance meter — ten gold segments that visibly go dark when the captain
// breaks the rules. Market games never hide the score; now neither do we.
//
// It is EVENT-DRIVEN, never polled: phase files call refreshHud() after every
// state change (loading cargo, paying for a detour, making the sale, getting
// caught). Between calls the HUD costs nothing per frame.
//
//   createHud(world)   — build the ledger panel (call once, after onboarding).
//   refreshHud()       — repaint all values from voyageState.
//   setHudVisible(v)   — hide it during the end-of-voyage ceremony.
// ----------------------------------------------------------------------------

import {
  createSystem,
  PanelUI,
  PanelDocument,
  eq,
  UIKitDocument,
  UIKit,
  type World,
  type Entity,
} from "@iwsdk/core";

import {
  voyageState,
  GOOD_SLOTS,
  GOOD_COST,
  ENGLAND_GOODS_SLOTS,
} from "./voyageState.js";

const GOLD = "#c8962a"; // a lit compliance segment
const DIM = "#3a2f24"; // a lost segment
const ALARM = "#e08a5a"; // the flash when segments are lost

// The wired elements, stashed when the panel's document loads.
let els: {
  cargo: UIKit.Text;
  coins: UIKit.Text;
  segs: UIKit.Text[];
} | null = null;

let hudEntity: Entity | null = null;
let systemRegistered = false;

// The compliance we last painted — lets refreshHud spot a DROP and flash the
// segments the captain just lost.
let prevCompliance = 100;

/**
 * Build the ledger. It floats just above the standard card spot (the phase
 * cards all appear at x≈3 facing the player) and never moves or goes away.
 */
export function createHud(world: World): void {
  if (hudEntity) return;
  if (!systemRegistered) {
    world.registerSystem(HudSystem);
    systemRegistered = true;
  }

  hudEntity = world
    .createTransformEntity(undefined, {
      parent: world.sceneEntity,
      persistent: true, // survives every port teardown
    })
    .addComponent(PanelUI, {
      config: "./ui/hudLedger.json",
      // Generous size: at 3 m away the ledger must stay readable for a
      // 10-year-old, so it gets a wider box than a typical floating strip.
      maxWidth: 1.15,
      maxHeight: 0.34,
    });

  const obj = hudEntity.object3D!;
  obj.position.set(3.0, 2.45, 0); // above the cards, below the sails
  obj.lookAt(0, 1.6, 0); // tipped down toward the player's eyes
}

/** Show/hide the ledger (hidden during the final ceremony). */
export function setHudVisible(visible: boolean): void {
  if (hudEntity?.object3D) hudEntity.object3D.visible = visible;
}

/** Repaint every ledger value from voyageState. Call after any state change. */
export function refreshHud(): void {
  if (!els) return;

  if (voyageState.currentLeg === "leg2buy") {
    // During the England "buy for the next leg" step the ledger switches to the
    // FRESH hold of English goods and the coins the captain has LEFT to spend, so
    // the overhead ledger and the buy panel always agree.
    const boughtSlots = (voyageState.goodsBoughtInEngland as string[]).reduce(
      (n, good) => n + ((ENGLAND_GOODS_SLOTS as Record<string, number>)[good] ?? 1),
      0,
    );
    els.cargo.setProperties({
      text: `${boughtSlots} / ${voyageState.cargoSlotsTotal} slots`,
    });
    const left = Math.max(0, voyageState.profit - voyageState.englandPurchaseCost);
    els.coins.setProperties({ text: `${left} coins left` });
  } else {
    // Cargo: how many of the six slots are full right now.
    const slotsUsed = (voyageState.cargoLoaded as string[]).reduce(
      (n, good) => n + ((GOOD_SLOTS as Record<string, number>)[good] ?? 1),
      0,
    );
    els.cargo.setProperties({
      text: `${slotsUsed} / ${voyageState.cargoSlotsTotal} slots`,
    });

    // Coins: while buying we show the running spend; once the cargo is SOLD the
    // line flips to what the sale earned — the number the summary celebrates.
    // (The sale step records what the captain was paid in `profit`; some paths
    // may also fill `salePrice`, so accept either as the "we sold!" signal.)
    const earned = voyageState.salePrice || voyageState.profit;
    if (earned > 0) {
      els.coins.setProperties({ text: `Earned ${earned} coins` });
    } else {
      // Before Set Sail, purchaseCost is still 0, so total the hold live.
      const liveSpend = (voyageState.cargoLoaded as string[]).reduce(
        (n, good) => n + ((GOOD_COST as Record<string, number>)[good] ?? 0),
        0,
      );
      const spent =
        (voyageState.purchaseCost || liveSpend) + voyageState.detourCost;
      els.coins.setProperties({ text: `Spent ${spent} coins` });
    }
  }

  // Crown Compliance: light one segment per 10 points.
  const comp = voyageState.crownCompliance;
  const lit = Math.max(0, Math.min(10, Math.round(comp / 10)));
  for (let i = 0; i < 10; i++) {
    const color = i < lit ? GOLD : DIM;
    // background AND ink together — the "." placeholder stays invisible.
    els.segs[i].setProperties({ backgroundColor: color, color });
  }

  // Drama: if compliance just DROPPED, flash the segments that were lost so a
  // kid watches the bar crash rather than noticing later. Two quick orange
  // blinks, then they settle to dark.
  if (comp < prevCompliance) {
    const prevLit = Math.max(0, Math.min(10, Math.round(prevCompliance / 10)));
    const lost = els.segs.slice(lit, prevLit);
    const paint = (color: string) => {
      for (const seg of lost) seg.setProperties({ backgroundColor: color, color });
    };
    setTimeout(() => paint(ALARM), 0);
    setTimeout(() => paint(DIM), 220);
    setTimeout(() => paint(ALARM), 440);
    setTimeout(() => paint(DIM), 660);
  }
  prevCompliance = comp;
}

/**
 * HudSystem — finds the ledger panel once its document loads, stashes the
 * elements, and paints the first values.
 */
export class HudSystem extends createSystem({
  hudPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/hudLedger.json")],
  },
}) {
  init() {
    this.queries.hudPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;

      const segs: UIKit.Text[] = [];
      for (let i = 1; i <= 10; i++) {
        const seg = doc.getElementById(`comp-${i}`) as UIKit.Text | null;
        if (seg) segs.push(seg);
      }
      els = {
        cargo: doc.getElementById("hud-cargo") as UIKit.Text,
        coins: doc.getElementById("hud-coins") as UIKit.Text,
        segs,
      };
      refreshHud();
    });
  }
}
