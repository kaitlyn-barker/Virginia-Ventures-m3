// westAfricaLeg.ts
// ----------------------------------------------------------------------------
// The WEST AFRICA leg of the triangular trade — the second side of the triangle
// (England -> West Africa), reached after the captain buys English goods.
//
// This segment is DELIBERATELY NOT gameplay. When the ship arrives the whole
// experience slows down: there are no trading decisions, no cargo mechanic, no
// coins, and NOTHING here is scored. The student is a WITNESS receiving history,
// never a participant. So this file:
//   - HIDES the captain's ledger HUD for the entire segment (restored on Leg 3),
//   - PAUSES the Voyage Efficiency stopwatch, so reflecting here never costs a
//     star,
//   - uses a quiet slate "Continue" button with NO gold flash and NO click sound
//     (the game-feel "gold = fun tap" vocabulary is never applied here),
//   - carries the history entirely in TEXT (a short sequence of narration cards),
//     never depicting suffering and never rendering enslaved people as figures.
//
// The ship simply lies at anchor offshore at dusk (a gentle overcast sky), and
// the student advances the cards at their own pace. The final card bridges back
// to the voyage home.
//
//   beginWestAfricaLeg(world, onDone) — the England buy step calls this. It
//     hides the HUD, dims the sky, and shows the first narration card. `onDone`
//     runs (with the HUD restored and the clock resumed) once the student has
//     read the last card and chosen to sail home.
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

// The voyage "logbook" plus the timing controls — we PAUSE the Efficiency clock
// for the whole segment so reflection is never counted.
import { voyageState, pauseTiming, resumeTiming } from "./voyageState.js";

// Hide/restore the ledger HUD around the segment.
import { setHudVisible } from "./hud.js";

// The shared weather: a gentle overcast dusk while the cards are read, cleared
// again as the ship sails home. ("building" eases the sky to ~half-storm, which
// is only ~1.7 degrees of ship roll — a somber tone, well within comfort.)
import { setStormPhase } from "./ambientMotion.js";

// The safe teardown helper (frees GPU + clears the ECS).
import { disposeEntityTree } from "./voyagePhases.js";

// ----------------------------------------------------------------------------
// The narration script — one idea per card, written at a 5th-grade reading level.
// Factual and reverent: what these ships really carried, that it was a human
// tragedy and not a trade decision, and the cost to West African communities.
// Kept SHORT so each card is a single thought the student can sit with.
// ----------------------------------------------------------------------------
interface NarrationCard {
  title: string;
  body: string;
  button: string; // the quiet advance label ("Continue", then "Sail Home")
}

const CARDS: NarrationCard[] = [
  {
    title: "The Ship Drops Anchor",
    body: "Your ship reaches the coast of West Africa at dusk. This coast was one corner of the triangle of trade. Take a moment here. What happened on this shore was not a game.",
    button: "Continue",
  },
  {
    title: "What These Ships Carried",
    body: "On this side of the triangle, ships did not carry only goods. They carried people - African men, women, and children - taken from their homes against their will.",
    button: "Continue",
  },
  {
    title: "Not a Trade Decision",
    body: "Traders treated enslaved people as cargo to be bought and sold. But they were never cargo. They were human beings. This was a cruel and terrible part of history.",
    button: "Continue",
  },
  {
    title: "Homes and Families",
    body: "Across West Africa, whole families and villages were torn apart. Communities lost their children, their parents, and their futures. That loss caused pain for many, many generations.",
    button: "Continue",
  },
  {
    title: "Carry This With You",
    body: "You now know what these ships really carried. Sail home, and carry that with you.",
    button: "Sail Home",
  },
];

// The continuation to run once the student sails home (build the return map).
// Stored at module scope, cleared after it runs, like the storm beat.
let onSailHome: (() => void) | null = null;

/**
 * Create the muted narration card and place it in the usual card spot (a few
 * meters along +X, facing the player). Returns the panel entity.
 */
function createWestAfricaPanel(world: World): Entity {
  const panel = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: "./ui/westAfricaNarration.json",
      maxWidth: 1.4,
      maxHeight: 1.1,
    })
    .addComponent(Interactable);

  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * WestAfricaSystem — steps the narration cards. It wires the quiet Continue
 * button WITHOUT juiceButton (no gold flash, no click sound), advances an index
 * on each tap, and on the last card tears the panel down and sails home.
 */
export class WestAfricaSystem extends createSystem({
  narrationPanel: {
    required: [PanelUI, PanelDocument],
    where: [eq(PanelUI, "config", "./ui/westAfricaNarration.json")],
  },
}) {
  init() {
    this.queries.narrationPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      this.wirePanel(entity, doc);
    });
  }

  private wirePanel(entity: Entity, doc: UIKitDocument) {
    const titleEl = doc.getElementById("wa-title") as UIKit.Text | null;
    const bodyEl = doc.getElementById("wa-body") as UIKit.Text | null;
    const progressEl = doc.getElementById("wa-progress") as UIKit.Text | null;
    const continueBtn = doc.getElementById("wa-continue") as UIKit.Text | null;

    // Which card is on screen (0-based). A closure, no per-frame work.
    let index = 0;

    const render = () => {
      const card = CARDS[index];
      titleEl?.setProperties({ text: card.title });
      bodyEl?.setProperties({ text: card.body });
      progressEl?.setProperties({ text: `Card ${index + 1} of ${CARDS.length}` });
      continueBtn?.setProperties({ text: card.button });
    };

    const advance = () => {
      if (index < CARDS.length - 1) {
        index += 1;
        render();
        return;
      }
      // Last card: leave West Africa and sail home.
      this.finish(entity);
    };

    // Plain wiring — NO juiceButton. This leg never uses the gold tap flash or
    // the click chime; the button just quietly advances the reading.
    continueBtn?.addEventListener("click", advance);

    // Draw the first card.
    render();
  }

  // Guard against a double-tap on the last card scheduling the handoff twice.
  private leaving = false;

  private finish(entity: Entity) {
    if (this.leaving) return;
    this.leaving = true;

    // The reflection is over: bring the world back to a game footing. Clear the
    // dusk sky, restore the ledger HUD, resume the Efficiency clock, and advance
    // the logbook to Leg 3 (the journey home).
    setStormPhase("clearing");
    setHudVisible(true);
    resumeTiming();
    voyageState.currentLeg = "leg3";
    console.log("Captain's Voyage - leaving West Africa, sailing home. currentLeg =", voyageState.currentLeg);

    const world = this.world;
    // Defer one tick (don't dispose the panel mid-click) and strip interaction
    // tags first — the standard teardown idiom.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      disposeEntityTree(world, entity);

      const resolve = onSailHome;
      onSailHome = null;
      resolve?.();
    }, 0);
  }
}

// Registered once, lazily, on first use.
let systemRegistered = false;

/**
 * beginWestAfricaLeg — enter the West Africa reflection. Hides the HUD, pauses
 * the Efficiency clock, dims the sky to a somber dusk, and shows the first
 * narration card. `onDone` runs (HUD restored, clock resumed) once the student
 * reads the last card and sails home.
 */
export function beginWestAfricaLeg(world: World, onDone: () => void): void {
  onSailHome = onDone;

  // This segment is not gameplay: tuck the ledger away and stop the clock so
  // reflecting here can never affect the score.
  setHudVisible(false);
  pauseTiming();
  // The ship lies at anchor offshore at dusk — a gentle overcast, not a storm.
  setStormPhase("building");
  voyageState.currentLeg = "westafrica";

  if (!systemRegistered) {
    world.registerSystem(WestAfricaSystem);
    systemRegistered = true;
  }
  // No tutorial coach card here — the segment introduces itself.
  createWestAfricaPanel(world);
}
