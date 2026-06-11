// virginiaCargo.ts
// ----------------------------------------------------------------------------
// The ONE interactive mechanic of the Virginia leg: loading trade goods into
// the ship's cargo hold.
//
// Two pieces live here:
//   1. createCargoPanel(world) — spawns the floating "Load Cargo" panel entity
//      over the dock. (Its look/markup is in ui/virginiaCargo.uikitml.)
//   2. VirginiaCargoSystem — finds that panel once it loads and wires up the
//      clicks: each good button, the six-slot hold display, and Set Sail.
//
// IMPORTANT design rule for this phase: we READ the numbers in voyageState.js
// (the total slot count and GOOD_SLOTS) but never edit that file. We DO update
// the live voyageState object at runtime — pushing loaded goods and, on Set
// Sail, advancing currentLeg — because that IS the gameplay. No prices are
// shown anywhere here; England reveals pricing in a later phase.
// ----------------------------------------------------------------------------

import {
  createSystem,
  PanelUI,
  PanelDocument,
  Interactable,
  eq,
  UIKitDocument,
  UIKit,
  type World,
  type Entity,
} from "@iwsdk/core";

// The voyage "logbook" (live state we update), the fixed slot costs, and the
// per-good BUY prices (what each good costs the captain to load at Virginia).
import { voyageState, GOOD_SLOTS, GOOD_COST } from "./voyageState.js";

// Leaving Virginia: hand off to the phase controller, which clears this leg's
// scenery (this very panel included) and raises the England port in its place.
import { sailToEngland } from "./voyagePhases.js";

// Shared polish helpers (built once in index.ts — we just call them):
//   juiceButton    — wires a click with sound + a quick gold flash.
//   refreshHud     — repaints the captain's ledger after any cargo change.
//   addCargoProps  — pops real crates onto the deck for each slot we fill.
import { juiceButton } from "./uiFx.js";
import { refreshHud } from "./hud.js";
import { addCargoProps } from "./cargoProps.js";

// Display info for each good: a friendly label and the color its filled cargo
// slots turn. These are presentation only — the slot COSTS come from
// GOOD_SLOTS in voyageState.js, never hard-coded here.
const GOOD_INFO: Record<string, { label: string; color: string }> = {
  tobacco: { label: "Tobacco", color: "#a9b964" }, // bright tobacco-leaf green
  lumber: { label: "Lumber", color: "#c08a4f" }, //  fresh sawn-pine gold
  furs: { label: "Furs", color: "#d8b48e" }, //     pale pelt tan
};

// Colors reused for an EMPTY slot, so filling/emptying always matches the panel.
const EMPTY_SLOT_BG = "#2a1e14";
const EMPTY_SLOT_FG = "#8a7860";

// voyageState.js is plain JavaScript, so TypeScript infers very tight types for
// it (GOOD_SLOTS as exactly its three keys, cargoLoaded as an empty array). We
// only READ these shapes, so we view them through small typed aliases to keep
// the logic readable — we never change the values in voyageState.js itself.
const SLOT_COST = GOOD_SLOTS as Record<string, number>;

// A typed view of each good's BUY price (coins), read the same safe way. We only
// READ these; the values live in voyageState.js.
const BUY_COST = GOOD_COST as Record<string, number>;

// How many coins the captain has spent buying goods so far (sum of BUY_COST over
// everything currently in the hold). Recomputed fresh so it's always correct.
const coinsSpent = (cargo: string[]): number =>
  cargo.reduce((sum, good) => sum + (BUY_COST[good] ?? 0), 0);

/**
 * Create the floating "Load Cargo" panel and place it over the dock, turned to
 * face the player standing at the bow. Call once, after createVirginiaPort().
 */
export function createCargoPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml
    // in ui/ into public/ui/virginiaCargo.json automatically).
    .addComponent(PanelUI, {
      config: "./ui/virginiaCargo.json",
      maxWidth: 1.25, // meters — the panel scales to fit within this box
      maxHeight: 1.0,
    })
    // Interactable lets the controller/mouse ray click the buttons on it.
    .addComponent(Interactable);

  // Place it over the starboard dock (the port is off +X) at eye height.
  const obj = panel.object3D!;
  obj.position.set(2.8, 1.5, -1.0);

  // Turn the readable face toward the player standing at the origin. A UIKit
  // panel's readable face is its +Z side, and lookAt() aims that +Z at the
  // target — so we simply look at the player. Both points share y = 1.5 so the
  // panel stays upright (no tilt).
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * Wires the cargo panel's behavior. It waits for the panel document to load,
 * then connects the good buttons, the hold display, and Set Sail.
 */
export class VirginiaCargoSystem extends createSystem({
  cargoPanel: {
    required: [PanelUI, PanelDocument],
    // Only match OUR panel (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/virginiaCargo.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the panel's document has finished loading and
    // its elements (buttons, slots) actually exist and can be wired up.
    this.queries.cargoPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(doc);
    });
  }

  /** Connect every interactive part of the panel to the cargo-loading logic. */
  private wirePanel(doc: UIKitDocument) {
    // --- Grab the elements we need by their id (set in the .uikitml) ----------
    const message = doc.getElementById("message") as UIKit.Text | null;
    const purse = doc.getElementById("purse") as UIKit.Text | null;
    const setSailBtn = doc.getElementById("set-sail") as UIKit.Text | null;
    // The six hold slots, slot-1 … slot-6, kept in order so slot index 0 = slot-1.
    const slots = [1, 2, 3, 4, 5, 6].map(
      (n) => doc.getElementById(`slot-${n}`) as UIKit.Text | null,
    );

    // A typed view of the live "what's loaded" list. Pushing onto this pushes
    // onto the real voyageState.cargoLoaded (same array), which is the gameplay.
    const cargo = voyageState.cargoLoaded as string[];

    // --- How many slots are used right now ------------------------------------
    // Sum GOOD_SLOTS for every good already in the hold. This is the heart of
    // the room check: it's recomputed fresh each time so it's always correct.
    const usedSlots = (): number =>
      cargo.reduce((sum, good) => sum + (SLOT_COST[good] ?? 0), 0);

    // --- Redraw the hold + message-readiness from the current state -----------
    const refresh = () => {
      // Expand the loaded goods into a per-slot list, in the order loaded.
      // e.g. ["tobacco", "lumber"] (1 + 2 slots) -> ["tobacco","lumber","lumber"].
      const filledBy: string[] = [];
      for (const good of cargo) {
        const cost = SLOT_COST[good] ?? 0;
        for (let i = 0; i < cost; i++) filledBy.push(good);
      }

      // Paint each of the six slots: a good's color + name if filled, else a
      // dim "open" so kids can see it as room still waiting to be filled.
      slots.forEach((slot, index) => {
        if (!slot) return;
        const good = filledBy[index];
        if (good) {
          const info = GOOD_INFO[good];
          slot.setProperties({
            text: info?.label ?? good,
            backgroundColor: info?.color ?? "#5b3a21",
            color: "#1a120b", // dark text reads well on the bright fill
          });
        } else {
          slot.setProperties({
            text: "open",
            backgroundColor: EMPTY_SLOT_BG,
            color: EMPTY_SLOT_FG,
          });
        }
      });

      // Keep the purse honest: the running total of coins spent so far, in the
      // game's one money format ("{n} coins"). refresh() runs after every load,
      // so this line is always live with zero extra plumbing.
      purse?.setProperties({ text: `${coinsSpent(cargo)} coins` });

      // Set Sail is DISABLED until at least one good is aboard — and the LABEL
      // says why, so a locked button never reads as a broken one. The click
      // handler also refuses early clicks, as a second line of defense.
      const ready = cargo.length >= 1;
      setSailBtn?.setProperties(
        ready
          ? { text: "Set Sail!", backgroundColor: "#c8962a", color: "#1a120b" } // gold = go
          : {
              text: "Load 1 good first",
              backgroundColor: "#2e2519",
              color: "#9a8568",
            }, // dim = locked, label explains itself
      );
    };

    // --- A quick "the hold is FULL" blink --------------------------------------
    // On an over-capacity click, all six slot borders flash warning orange and
    // settle back to their normal wood color. One-shot timers only — nothing
    // here runs per frame.
    const SLOT_BORDER = "#4a3a28"; // the slots' resting border (matches the markup)
    const flashSlotsFull = () => {
      for (const slot of slots) {
        slot?.setProperties({ borderColor: "#e08a5a" });
      }
      setTimeout(() => {
        for (const slot of slots) {
          slot?.setProperties({ borderColor: SLOT_BORDER });
        }
      }, 350);
    };

    // --- loadGood: the core "try to load this good" rule ----------------------
    const loadGood = (goodName: string) => {
      const cost = SLOT_COST[goodName]; // slots THIS good needs (from voyageState)
      const used = usedSlots(); //          slots already taken

      if (used + cost <= voyageState.cargoSlotsTotal) {
        // There's room: add the good, praise the pick, and pop real crates onto
        // the deck. `used` is the count of slots filled BEFORE this load, so
        // the crates land in exactly the slots this purchase just claimed.
        cargo.push(goodName);
        addCargoProps(goodName, used, cost);
        const left = voyageState.cargoSlotsTotal - usedSlots();
        const price = BUY_COST[goodName] ?? 0;
        message?.setProperties({
          text: `Nice pick, Captain! Loaded ${GOOD_INFO[goodName]?.label ?? goodName} for ${price} coins. ${left} slot${left === 1 ? "" : "s"} left.`,
          color: "#e0b870",
        });
        // The cargo changed, so the captain's ledger repaints too.
        refreshHud();
      } else {
        // Not enough room: load NOTHING, tell the student (exact wording), and
        // blink the slot borders so the "hold is full" lesson lands visually.
        message?.setProperties({
          text: "Not enough cargo space! You'll have to leave something behind.",
          color: "#e08a5a",
        });
        flashSlotsFull();
      }

      // Redraw the hold and the Set Sail state to match whatever just happened.
      refresh();
    };

    // --- Set Sail: end the Virginia leg and head for England ------------------
    const handleSetSail = () => {
      // Belt-and-braces: the button looks disabled with no cargo, and we also
      // refuse the action here so an early click can't sneak the ship out.
      if (cargo.length < 1) {
        message?.setProperties({
          text: "Load at least one good before setting sail.",
          color: "#e08a5a",
        });
        return;
      }

      // Lock in what the captain PAID for this hold. Profit subtracts this later,
      // so the buying choices made here matter all the way to the summary.
      voyageState.purchaseCost = coinsSpent(cargo);

      // Advance the voyage to its first leg (Virginia -> England).
      voyageState.currentLeg = "leg1";
      message?.setProperties({
        text: `Anchors aweigh! You spent ${voyageState.purchaseCost} coins. Off to England!`,
        color: "#9fd29f",
      });
      // The spend is now locked in and the leg advanced — repaint the ledger.
      refreshHud();
      console.log(
        "Captain's Voyage — set sail. currentLeg =",
        voyageState.currentLeg,
        "cargo:",
        cargo,
        "purchaseCost:",
        voyageState.purchaseCost,
      );

      // Make the voyage actually happen: tear down Virginia and arrive at the
      // England port. The controller defers the teardown a tick, so it's safe
      // to call this from right here inside the button's own click handler.
      sailToEngland();
    };

    // --- Wire the clicks ------------------------------------------------------
    // Each good button loads its good, wired through juiceButton so every tap
    // answers with a click sound and a quick gold flash. We stamp the slot cost
    // and price into the label here, read straight from GOOD_SLOTS/GOOD_COST,
    // so the "- N slots - N coins" text can never disagree with the real
    // numbers — and we paint each button the same color as the slots it fills,
    // a cause-and-effect color link kids can see at a glance.
    for (const name of Object.keys(GOOD_INFO)) {
      const btn = doc.getElementById(`load-${name}`) as UIKit.Text | null;
      if (!btn) continue;
      const cost = SLOT_COST[name];
      const price = BUY_COST[name] ?? 0;
      btn.setProperties({
        text: `${GOOD_INFO[name].label} - ${cost} slot${cost === 1 ? "" : "s"} - ${price} coins`,
        backgroundColor: GOOD_INFO[name].color,
        color: "#1a120b", // dark ink on the bright fill, same as a filled slot
      });
      // These buttons' colors never change, so the flash restores plain colors.
      juiceButton(btn, () => loadGood(name), {
        backgroundColor: GOOD_INFO[name].color,
        color: "#1a120b",
      });
    }
    // Set Sail's look DEPENDS on state (locked vs ready), so its restore is
    // refresh() itself — the one function that knows the button's true colors.
    if (setSailBtn) {
      juiceButton(setSailBtn, handleSetSail, refresh);
    }

    // Draw the starting state (all six slots empty, Set Sail locked).
    refresh();
  }
}
