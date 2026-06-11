// uiFx.ts
// ----------------------------------------------------------------------------
// Tiny shared "button juice" for every panel in the voyage: a soft click sound
// and a quick gold flash whenever any button is tapped. Market games answer
// every tap with sound + motion within a tenth of a second — this file is how
// all our panels get that for free.
//
//   createUiSounds(world) — call ONCE from index.ts. Builds the shared,
//     non-positional click sound (reusing chime.mp3, our one audio file).
//   playClick()           — play that click from anywhere.
//   juiceButton(el, handler, restore) — wire a button the juicy way: click
//     sound + handler + 120 ms gold flash, then `restore` puts the button's
//     true colors back (pass the owner's refresh function for stateful buttons,
//     or a {backgroundColor, color} object for simple ones).
// ----------------------------------------------------------------------------

import {
  type World,
  type Entity,
  AudioSource,
  AudioUtils,
  PlaybackMode,
} from "@iwsdk/core";

// The one shared click-sound entity. Persistent and parented to the scene, so
// no phase teardown can sweep it away mid-voyage.
let clickEntity: Entity | null = null;

/** Build the shared UI click sound. Safe to call more than once. */
export function createUiSounds(world: World): void {
  if (clickEntity) return;
  clickEntity = world.createTransformEntity(undefined, {
    parent: world.sceneEntity,
    persistent: true,
  });
  clickEntity.addComponent(AudioSource, {
    src: "/audio/chime.mp3",
    positional: false, // a UI tick, not a sound "in the world"
    volume: 0.3,
    playbackMode: PlaybackMode.Restart, // rapid taps re-trigger crisply
  });
}

/** Play the UI click. Quietly does nothing if createUiSounds wasn't called. */
export function playClick(): void {
  if (clickEntity) AudioUtils.play(clickEntity);
}

// The minimal shape of a UIKit element we need — keeps this file independent
// of UIKit's concrete classes (Text, Container, ...), all of which have these.
export interface JuicyElement {
  setProperties(props: Record<string, unknown>): void;
  addEventListener(type: string, listener: () => void): void;
}

// What to do after the flash: either the owner's repaint function (best for
// buttons whose colors depend on game state) or the plain colors to restore.
export type JuiceRestore =
  | (() => void)
  | { backgroundColor: string; color: string };

/**
 * Wire a button with full juice: on click it (1) plays the click sound,
 * (2) runs your handler immediately — no input lag, (3) flashes bright gold,
 * and (4) 120 ms later calls `restore` to repaint the button's real state.
 *
 * The restore runs in a try/catch because many handlers dispose their own
 * panel — flashing a button that no longer exists should never crash.
 */
export function juiceButton(
  el: JuicyElement,
  handler: () => void,
  restore: JuiceRestore,
): void {
  el.addEventListener("click", () => {
    playClick();
    handler();
    el.setProperties({ backgroundColor: "#e8b84a", color: "#1a120b" });
    setTimeout(() => {
      try {
        if (typeof restore === "function") restore();
        else el.setProperties(restore);
      } catch {
        // The panel was disposed by the handler — nothing left to repaint.
      }
    }, 120);
  });
}
