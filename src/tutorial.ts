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

// ----------------------------------------------------------------------------
// Tutorial content
// ----------------------------------------------------------------------------

/** One section's coach-card text. Every field is plain ASCII (the panel font has
 *  no em-dash glyph), and all of it is filled into the reusable card at runtime. */
export interface TutorialContent {
  eyebrow: string; // the small gold "TUTORIAL - <section>" line
  title: string; //  the card's heading
  body: string; //   the teaching paragraph (the history/economics of this leg)
  task: string; //   the "What to do" call-to-action
  button: string; // the dismiss button's label
}

// The teaching script, one entry per leg. Each body connects to the instructional
// content of the section it introduces, so the tutorial and the activity teach the
// same idea. Wording is ASCII-only to match the rest of the project's panels.
export const TUTORIALS: Record<string, TutorialContent> = {
  virginia: {
    eyebrow: "TUTORIAL - VIRGINIA PORT",
    title: "Load Your Hold",
    body: "Under mercantilism the colonies supplied raw goods to the mother country. Here in Virginia you buy trade goods - tobacco, lumber, furs - and load them into your six-slot hold. What you pay now is subtracted from your profit later, so buy with an eye on the margin.",
    task: "What to do: Tap a good to load it into the hold. Fill it, then tap Set Sail.",
    button: "Got it - load my hold",
  },
  storm: {
    eyebrow: "TUTORIAL - STORM AT SEA",
    title: "A Choice in the Swell",
    body: "The Atlantic crossing was long and dangerous. A storm forces a gamble: throw your heaviest crate overboard to ride safe (you still paid for it, so your profit suffers), or hold on and risk the storm damaging the whole hold.",
    task: "What to do: Pick a course, then tap Continue.",
    button: "Got it - face the storm",
  },
  england: {
    eyebrow: "TUTORIAL - ENGLAND",
    title: "The Crown's Market",
    body: "The Navigation Acts required that colonial goods be shipped to England and sold to English merchants only - at England's price, not yours. You can haggle: push for more (the merchant may take offense) or accept the offer on the table.",
    task: "What to do: Push for more or Accept a price, then tap Continue.",
    button: "Got it - meet the merchant",
  },
  smuggler: {
    eyebrow: "TUTORIAL - A SHADOWY OFFER",
    title: "Loyalty or Profit?",
    body: "A smuggler offers more coin than England for the same cargo - illegally, outside the Navigation Acts. Sell to the Crown and keep your record clean, or risk the smuggler: a bigger payout, but if customs catch you the cargo is seized and Crown Compliance crashes.",
    task: "What to do: Choose your buyer, then tap Continue.",
    button: "Got it - weigh the offer",
  },
  map: {
    eyebrow: "TUTORIAL - THE VOYAGE HOME",
    title: "The Triangular Trade",
    body: "Your crossing was one leg of a triangle linking England, the colonies, and West Africa - the system that moved manufactured goods, raw materials, and enslaved people across the Atlantic. The chart draws the whole triangle, but your ship sails only the leg you travelled.",
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
    nextBtn?.addEventListener("click", () => this.dismiss(entity, onClose));
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
