// welcomePanel.ts
// ----------------------------------------------------------------------------
// The WELCOME / onboarding card - the first screen of Captain's Voyage.
//
// It introduces who the student is (a colonial sea captain), the goal of the
// voyage, the scores they are judged on, and the controls. A single "Begin
// Voyage" button starts the experience: it dismisses the card and runs a
// callback (index.ts uses that to show the Virginia tutorial, which in turn
// reveals the cargo-loading panel).
//
// The card's TEXT is all baked into ui/welcomePanel.uikitml - this file only
// wires the one button. Mirrors the other phase files exactly: a panel + a
// createSystem matched by its config, wired on "qualify", with a deferred,
// tag-stripped teardown when the student begins.
//
//   showWelcome(world, onBegin) - register the system (once), build the card,
//     and run onBegin when "Begin Voyage" is tapped.
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

// The callback to run when the student taps "Begin Voyage". Stored at module
// scope because the SYSTEM (not the caller) decides when the button is clicked.
// Only one welcome card is ever shown, so a single slot is enough.
let onBeginVoyage: (() => void) | null = null;

// Register WelcomeSystem lazily, and only once.
let systemRegistered = false;

/**
 * showWelcome - raise the welcome card and run `onBegin` when the student taps
 * "Begin Voyage". Registers the system on first use. Returns the panel entity.
 */
export function showWelcome(world: World, onBegin: () => void): Entity {
  if (!systemRegistered) {
    world.registerSystem(WelcomeSystem);
    systemRegistered = true;
  }

  onBeginVoyage = onBegin;

  const panel = world
    .createTransformEntity()
    // PanelUI points at the COMPILED json (the vite plugin turns our .uikitml in
    // ui/ into public/ui/welcomePanel.json automatically). The card is tall and
    // wordy, so we give it a generous box to grow into.
    .addComponent(PanelUI, {
      config: "./ui/welcomePanel.json",
      maxWidth: 1.6,
      maxHeight: 1.9,
    })
    // Interactable lets the controller/mouse ray click the Begin button.
    .addComponent(Interactable);

  // The standard card spot for this voyage: a few meters along +X at eye height,
  // turned so its readable +Z face looks back at the player at the origin. On
  // load the player rig is turned to face +X (see index.ts), so this sits dead
  // ahead.
  const obj = panel.object3D!;
  obj.position.set(3.0, 1.5, 0);
  obj.lookAt(0, 1.5, 0);

  return panel;
}

/**
 * WelcomeSystem - wires the welcome card's single "Begin Voyage" button once the
 * card has loaded. Registered once, lazily, by showWelcome.
 */
export class WelcomeSystem extends createSystem({
  welcomePanel: {
    required: [PanelUI, PanelDocument],
    // Only match the welcome card (a project could have several PanelUI entities).
    where: [eq(PanelUI, "config", "./ui/welcomePanel.json")],
  },
}) {
  init() {
    // "qualify" fires once, when the card's document has finished loading and its
    // Begin button actually exists to wire up.
    this.queries.welcomePanel.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;

      const beginBtn = doc.getElementById("welcome-begin") as UIKit.Text | null;
      if (beginBtn) {
        // juiceButton = click sound + gold flash on every tap. This button's
        // colors never change at runtime, so the restore is just its true colors
        // straight from ui/welcomePanel.uikitml (#welcome-begin: gold bar, dark
        // ink).
        juiceButton(beginBtn, () => this.beginVoyage(entity), {
          backgroundColor: "#c8962a",
          color: "#1a120b",
        });
      }
    });
  }

  /** Begin - tear the welcome card down and run the stashed onBegin callback. */
  private beginVoyage(entity: Entity) {
    // Claim the callback and clear the slot so it can only ever run once.
    const begin = onBeginVoyage;
    onBeginVoyage = null;

    // Defer one tick so we aren't disposing the very panel whose click is still
    // being dispatched, and strip its interaction tags first so the InputSystem
    // doesn't try to clear Hovered/Pressed off a destroyed entity.
    setTimeout(() => {
      for (const tag of [RayInteractable, PokeInteractable, Interactable]) {
        if (entity.hasComponent(tag)) entity.removeComponent(tag);
      }
      entity.dispose();

      begin?.();
    }, 0);
  }
}
