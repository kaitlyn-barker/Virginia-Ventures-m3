// tutorial.ts
// ----------------------------------------------------------------------------
// The REUSABLE tutorial "coach". Before each leg of the voyage, a short teaching
// card floats in front of the player: it names the historical/economic idea that
// leg is about and tells the student what to do. The player taps the button to
// dismiss the card, which then runs a callback that reveals that leg's real
// activity (the cargo panel, the storm card, and so on). This "gate then reveal"
// flow keeps exactly one card on screen at a time and ties the teaching directly
// to the section it introduces.
//
// One markup file (ui/tutorial.uikitml) is reused for every section; the WORDS
// for each section live in the TUTORIALS table below and are written into the
// card at runtime. Each call site does:
//
//     showTutorial(world, TUTORIALS.storm, () => createStormPanel(world));
//
// Mirrors the other phase files exactly: a panel + a createSystem matched by its
// config, wired on "qualify", with a deferred, tag-stripped teardown on dismiss.
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
import { juiceButton } from "./uiFx";

// ----------------------------------------------------------------------------
// Tutorial content
// ----------------------------------------------------------------------------

/** One section's coach-card text. Every field is plain ASCII (the panel font has
 *  no em-dash glyph), and all of it is filled into the reusable card at runtime. */
export interface TutorialContent {
  eyebrow: string; // the small gold step-tracker line ("STEP 2 OF 6 - ...")
  title: string; //  the card's heading
  body: string; //   the teaching paragraph (the history/economics of this leg)
  task: string; //   the "What to do" call-to-action
  button: string; // the dismiss button's label
}

// The teaching script, one entry per leg. Each body connects to the instructional
// content of the section it introduces, so the tutorial and the activity teach the
// same idea. Written for 5th graders: short sentences, big words defined right
// where they appear. The eyebrow doubles as a voyage step tracker ("STEP 2 OF 6")
// so students always know how far along they are. ASCII-only, like every panel.
export const TUTORIALS: Record<string, TutorialContent> = {
  virginia: {
    eyebrow: "STEP 1 OF 6 - VIRGINIA PORT",
    title: "Load Your Hold",
    body: "England wants raw goods from its colonies. That rule is called mercantilism. It means the colony's job is to make England rich. Your ship has 6 cargo slots. Big goods take more slots.",
    task: "What to do: Tap a good to load it into the hold. Fill it, then tap Set Sail.",
    button: "Got it - load my hold",
  },
  storm: {
    eyebrow: "STEP 2 OF 6 - STORM AT SEA",
    title: "A Choice in the Swell",
    body: "Storms made ocean crossings dangerous. You must choose. Toss your heaviest crate to stay safe, or hold on and hope. Holding on is a gamble - 4 out of 10 ships take damage.",
    task: "What to do: Pick a course, then tap Continue.",
    button: "Got it - face the storm",
  },
  england: {
    eyebrow: "STEP 3 OF 6 - ENGLAND",
    title: "The Crown's Market",
    body: "England has trade laws called the Navigation Acts. Colonists may only sell to England. England names the price - not you. But a clever captain can haggle for more.",
    task: "What to do: Push for more or Accept a price, then tap Continue.",
    button: "Got it - meet the merchant",
  },
  smuggler: {
    eyebrow: "STEP 4 OF 6 - A SHADY OFFER",
    title: "Loyalty or Profit?",
    body: "A smuggler offers MORE coins than England. But selling to him breaks the law. If customs catch you, they seize your cargo. Safe and legal, or risky and rich?",
    task: "What to do: Choose your buyer, then tap Continue.",
    button: "Got it - weigh the offer",
  },
  map: {
    eyebrow: "STEP 5 OF 6 - THE VOYAGE HOME",
    title: "The Triangular Trade",
    body: "Your trip was one side of a triangle. Ships moved goods between England, the colonies, and West Africa. This trade also carried enslaved people - a cruel part of history. Watch your ship sail home.",
    task: "What to do: Watch the chart sail home - your voyage summary follows.",
    button: "Got it - chart the course",
  },
};

// ----------------------------------------------------------------------------
// One-at-a-time request slot + a once-only system registration guard
// ----------------------------------------------------------------------------

// The card currently being raised. Because tutorials GATE (one is dismissed
// before the next is ever shown), a single slot is enough: showTutorial sets it,
// and the system reads + clears it the instant the card's document loads.
let pending: { content: TutorialContent; onClose: () => void } | null = null;

// We register TutorialSystem lazily on the first showTutorial, and only once.
let systemRegistered = false;

/**
 * showTutorial - raise the coach card for one section, then run `onClose` when
 * the student dismisses it. Registers the system on first use. Returns the panel
 * entity (rarely needed; the card disposes itself on dismiss).
 */
export function showTutorial(
  world: World,
  content: TutorialContent,
  onClose: () => void,
): Entity {
  if (!systemRegistered) {
    world.registerSystem(TutorialSystem);
    systemRegistered = true;
  }

  // Stash the words + the reveal callback BEFORE the card exists, so the system's
  // "qualify" handler finds them the moment the document finishes loading.
  pending = { content, onClose };

  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/tutorial.json automatically).
    .addComponent(PanelUI, {
      config: "./ui/tutorial.json",
      maxWidth: 1.5,
      maxHeight: 1.3,
    })
    // Interactable lets the controller/mouse ray click the dismiss button.
    .addComponent(Interactable);

  // Same spot every card in this voyage uses: a few meters along +X at eye height,
  // turned so its readable +Z face looks back at the player at the origin.
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * TutorialSystem - fills the reusable card with the current section's words once
 * its document loads, and wires the dismiss button to tear the card down and run
 * the reveal callback. Registered once, lazily, by showTutorial.
 */
export class TutorialSystem extends createSystem({
  tutorialPanel: {
    required: [PanelUI, PanelDocument],
    // Only match the tutorial card (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/tutorial.json")],
  },
}) {
  init() {
    // "qualify" fires once, when a card's document has finished loading and its
    // text + button actually exist to fill in and wire up.
    this.queries.tutorialPanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;

      // Claim the pending request and clear the slot, so a later card can't read
      // stale content. (Gating means there is exactly one in flight at a time.)
      const req = pending;
      pending = null;
      if (!req) return;

      this.wirePanel(entity, doc, req.content, req.onClose);
    });
  }

  /** Write the section's words into the card and wire the dismiss button. */
  private wirePanel(
    entity: Entity,
    doc: UIKitDocument,
    content: TutorialContent,
    onClose: () => void,
  ) {
    (doc.getElementById("tutorial-eyebrow") as UIKit.Text | null)?.setProperties({
      text: content.eyebrow,
    });
    (doc.getElementById("tutorial-title") as UIKit.Text | null)?.setProperties({
      text: content.title,
    });
    (doc.getElementById("tutorial-body") as UIKit.Text | null)?.setProperties({
      text: content.body,
    });
    (doc.getElementById("tutorial-task") as UIKit.Text | null)?.setProperties({
      text: content.task,
    });

    const nextBtn = doc.getElementById("tutorial-next") as UIKit.Text | null;
    nextBtn?.setProperties({ text: content.button });
    if (nextBtn) {
      // juiceButton = click sound + gold flash on every tap. This button's
      // colors never change at runtime, so the restore is just its true colors
      // straight from ui/tutorial.uikitml (#tutorial-next: gold bar, dark ink).
      juiceButton(nextBtn, () => this.dismiss(entity, onClose), {
        backgroundColor: "#c8962a",
        color: "#1a120b",
      });
    }
  }

  /** Dismiss - tear the card down and reveal this section's activity. */
  private dismiss(entity: Entity, onClose: () => void) {
    // Defer one tick so we aren't disposing the very panel whose click is still
    // being dispatched, and strip its interaction tags first so the InputSystem
    // doesn't try to clear Hovered/Pressed off a destroyed entity.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      entity.dispose();

      // Now reveal the section the student just read about. (The reveal callback
      // closes over whatever world/state it needs - we don't pass one in.)
      onClose();
    }, 0);
  }
}
