// returnHomeMap.ts
// ----------------------------------------------------------------------------
// The ROUTE MAP - the teaching visual the student reaches after England.
//
// When the player clicks "Continue voyage" on the Navigation Acts card, that
// card is dismissed and THIS chart appears in its place: a hand-drawn-style sea
// chart of the WHOLE triangular trade - Virginia, England, and West Africa laid
// out in a triangle - with a little ship marker that sails the legs the student
// actually travelled (Virginia -> England -> back toward Virginia).
//
// Everything here is built from PRIMITIVE SHAPES (a flat plane for the paper,
// thin boxes for the route lines, small spheres for the ports and the ship) -
// no imported art. That keeps it tiny and fast, and the flat "chart" look suits
// the colonial theme better than a photographic map would.
//
// Two teaching rules drive the design:
//   1. Draw the FULL triangle in gold so students see the whole trade system.
//   2. Only ANIMATE the marker on the legs the student really sailed. The third
//      leg (West Africa -> Virginia) - and the England -> West Africa leg that
//      completes the triangle - are drawn DIMMER and DASHED, so the full system
//      is visible without ever implying the student sailed those waters.
//
// When the little ship finishes its voyage home, the map sets the voyage's
// `currentLeg` to "summary" and hands off to the Voyage Summary screen.
// ----------------------------------------------------------------------------

import {
  createComponent,
  createSystem,
  Types,
  eq,
  Group,
  Mesh,
  PlaneGeometry,
  BoxGeometry,
  SphereGeometry,
  MeshBasicMaterial,
  Vector3,
  PanelUI,
  PanelDocument,
  UIKitDocument,
  UIKit,
  type World,
  type Entity,
} from "@iwsdk/core";

import { PALETTE } from "./palette.js";

// The voyage "logbook" we update when the animation ends.
import { voyageState } from "./voyageState.js";

// The shared, safe teardown helper (collects child entities, frees GPU, clears
// the ECS) - the same one the Virginia -> England swap uses.
import { disposeEntityTree } from "./voyagePhases.js";

// The next (and final) screen: the Voyage Summary with the two scores.
import { beginVoyageSummary } from "./voyageSummary.js";

// The reusable tutorial coach: a short teaching card gates the route map.
import { showTutorial, TUTORIALS } from "./tutorial.js";

// The ship's bell at the main mast. One ding marks arriving in England, two
// dings mark making it home - an audible spine for the 8-second sail, so a
// student who looked away knows to look back at the chart.
import { ringShipBell } from "./ambientMotion.js";

// ----------------------------------------------------------------------------
// Custom components
// ----------------------------------------------------------------------------

// RouteMarker marks the one little "ship" sphere that sails the chart, and
// carries its animation clock. `elapsed` is how many seconds the voyage has
// been playing; `done` flips true once it has sailed home, so we only hand off
// to the summary once. `rangEngland` and `rangHome` remember whether the
// ship's bell has already rung for each arrival, so each one rings exactly once
// no matter how many frames pass after the moment.
export const RouteMarker = createComponent("RouteMarker", {
  elapsed: { type: Types.Float32, default: 0 },
  done: { type: Types.Boolean, default: false },
  rangEngland: { type: Types.Boolean, default: false },
  rangHome: { type: Types.Boolean, default: false },
});

// MapLabel marks a floating text label on the chart and holds the words it
// should show. The map system writes `text` into the label once its little
// panel has finished loading. (One reusable label panel, many different words.)
export const MapLabel = createComponent("MapLabel", {
  text: { type: Types.String, default: "Label" },
});

// ----------------------------------------------------------------------------
// Chart layout - all coordinates are LOCAL to the map group, measured in meters
// in the map's own flat plane (x = right, y = up). The group is turned to face
// the player, so "local up/right" read as up/right on the chart.
//
// The three ports sit in a triangle: England across the Atlantic at the top,
// Virginia at the lower-left (the colonies), West Africa at the lower-right.
// ----------------------------------------------------------------------------
const VIRGINIA = new Vector3(-0.52, -0.28, 0); // lower-left
const ENGLAND = new Vector3(0.0, 0.3, 0); // top-center
const WEST_AFRICA = new Vector3(0.52, -0.28, 0); // lower-right

// How far in FRONT of the cream paper (toward the player) each layer floats, so
// lines sit on the paper, ports sit on the lines, and the ship sits on top.
const Z_DASH = 0.01; // dashed (un-sailed) legs - lowest
const Z_SOLID = 0.012; // the solid sailed leg, a touch in front
const Z_PORT = 0.02; // the port dots
const Z_MARKER = 0.026; // the ship marker - closest to the viewer
const Z_LABEL = 0.035; // text labels - in front of everything

// Marker animation timing (seconds). A short pause at each end lets the student
// read where the ship is before it moves.
const T_START = 0.8; // hold at Virginia before departing
const T_LEG = 3.2; // seconds to sail one leg
const T_HOLD = 0.8; // pause at England before the return
const T_END = T_START + T_LEG + T_HOLD + T_LEG; // total run time
const T_ARRIVE_ENGLAND = T_START + T_LEG; // the moment the marker docks in England

// The golden WAKE TRAIL the ship bead leaves behind it. The trail is a small
// POOL of dash meshes built once up front (never created mid-animation): every
// TRAIL_SPACING_S seconds of sailing, the next pooled dash is moved to wherever
// the bead is right now and scaled up from 0 (hidden) to 1 (visible). When the
// pool runs out we wrap around and reuse the OLDEST dash - on the return leg
// that makes the trail overdraw the outbound one, which reads exactly right:
// "sailing home the same way we came".
const TRAIL_COUNT = 26; // dashes in the pool (enough for both legs)
const TRAIL_SPACING_S = 0.18; // seconds of travel between dropped dashes
const Z_TRAIL = Z_SOLID + 0.001; // just in front of the solid sailed leg

// Where the chart floats: a few meters along +X at eye height - exactly where
// the England rule card stood, so it reads as the next screen in the voyage.
const MAP_POSITION = new Vector3(3.0, 1.5, 0);

// We keep ONE reference to the map group at module scope so the system can tear
// the whole chart down in one call when the voyage finishes. (Like the phase
// controller, this is a single, one-shot screen - no need for a full ECS lookup.)
let routeMapGroup: Entity | null = null;

// ----------------------------------------------------------------------------
// Small reusable materials (made once, shared by many parts). We use
// MeshBasicMaterial - an UNLIT, flat color - on purpose: the chart should read
// as crisp drawn ink no matter where the scene's sun is, not shade like a 3D
// object. (The ship and ports are lit by nothing; they're just colored shapes.)
// ----------------------------------------------------------------------------
const paperMat = new MeshBasicMaterial({ color: PALETTE.CREAM });
const goldMat = new MeshBasicMaterial({ color: PALETTE.GOLD }); // bright sailed leg
const goldDimMat = new MeshBasicMaterial({
  color: PALETTE.GOLD,
  transparent: true,
  opacity: 0.4, // the un-sailed legs: same gold, faded back
});
const portMat = new MeshBasicMaterial({ color: PALETTE.GOLD }); // the three port dots
const shipMat = new MeshBasicMaterial({ color: PALETTE.SHIP_WOOD }); // dark ship bead
const trailMat = new MeshBasicMaterial({
  color: PALETTE.GOLD,
  transparent: true,
  opacity: 0.55, // brighter than the un-sailed dashes, dimmer than the solid leg
});

// ONE shared geometry for every wake dash (the pool re-uses it 26 times), plus
// the pool itself: plain mesh references the system repositions from update().
// Rebuilt fresh each time the chart is built; the meshes live as entities under
// the map group, so the group's disposeEntityTree sweep cleans them up too.
const trailGeometry = new BoxGeometry(0.022, 0.008, 0.004);
let trailDashes: Mesh[] = [];

/**
 * addBar - build one thin flat bar (a thin box) lying in the chart plane.
 * Used for every straight line on the map. `length` runs along the bar; we
 * rotate it about the chart's facing axis (local Z) to point it any direction.
 */
function addBar(
  world: World,
  group: Entity,
  material: MeshBasicMaterial,
  cx: number,
  cy: number,
  z: number,
  length: number,
  thickness: number,
  angle: number,
): void {
  const bar = new Mesh(new BoxGeometry(length, thickness, 0.004), material);
  bar.position.set(cx, cy, z);
  bar.rotation.z = angle; // turn the bar to lie along the edge
  world.createTransformEntity(bar, { parent: group });
}

/**
 * addSolidEdge - draw a single solid line between two chart points. Used for
 * the leg the student actually sailed (Virginia <-> England).
 */
function addSolidEdge(world: World, group: Entity, a: Vector3, b: Vector3): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);
  addBar(world, group, goldMat, (a.x + b.x) / 2, (a.y + b.y) / 2, Z_SOLID, length, 0.014, angle);
}

/**
 * addDashedEdge - draw a dashed, faded line between two chart points. Used for
 * the legs of the triangle the student did NOT sail, so the whole system shows
 * without implying travel. We lay a row of short gold dashes with gaps between.
 */
function addDashedEdge(world: World, group: Entity, a: Vector3, b: Vector3): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const angle = Math.atan2(dy, dx);

  const dashLen = 0.05; // length of one dash
  const gap = 0.035; // empty space after each dash
  const step = dashLen + gap; // dash-to-dash spacing along the line

  // Walk from one end to the other, dropping a dash each `step` until we'd run
  // past the far point.
  for (let d = dashLen / 2; d + dashLen / 2 <= length; d += step) {
    const t = d / length; // 0..1 along the edge
    const cx = a.x + dx * t;
    const cy = a.y + dy * t;
    addBar(world, group, goldDimMat, cx, cy, Z_DASH, dashLen, 0.01, angle);
  }
}

/** addPort - a small filled gold circle (sphere) marking one port. */
function addPort(world: World, group: Entity, at: Vector3): void {
  const dot = new Mesh(new SphereGeometry(0.028, 16, 12), portMat);
  dot.position.set(at.x, at.y, Z_PORT);
  world.createTransformEntity(dot, { parent: group });
}

/**
 * addLabel - a floating text label (its own little reusable panel). Short port
 * names use the default width; longer phrases (the title, the "third leg"
 * caption) pass a wider `maxWidth` so they don't wrap awkwardly.
 */
function addLabel(
  world: World,
  group: Entity,
  text: string,
  x: number,
  y: number,
  maxWidth = 0.5,
  maxHeight = 0.16,
): void {
  const label = world
    .createTransformEntity(new Group(), { parent: group })
    .addComponent(PanelUI, {
      config: "./ui/mapLabel.json",
      maxWidth,
      maxHeight,
    })
    // Remember the words this label should show; the system writes them in once
    // the panel's document has loaded.
    .addComponent(MapLabel, { text });
  label.object3D!.position.set(x, y, Z_LABEL);
}

/**
 * createRouteMap - build the whole chart and place it in front of the player.
 * Returns the map group entity (also stashed in `routeMapGroup`).
 */
export function createRouteMap(world: World): Entity {
  // One empty group holds every part of the chart, so we can move and (later)
  // dispose the whole thing as a unit.
  const group = world.createTransformEntity(new Group());
  const obj = group.object3D!;
  obj.position.copy(MAP_POSITION);
  // Turn the chart's readable face (its +Z) toward the player standing at the
  // origin. Same y keeps it upright (no tilt). After this, the chart's local
  // up/right line up with up/right as the player sees it.
  obj.lookAt(0, 1.5, 0);

  // --- The cream "paper" -----------------------------------------------------
  const paper = new Mesh(new PlaneGeometry(1.9, 1.2), paperMat);
  world.createTransformEntity(paper, { parent: group });

  // --- The triangle's three edges -------------------------------------------
  // SAILED leg (solid, bright): Virginia <-> England. The marker rides this one.
  addSolidEdge(world, group, VIRGINIA, ENGLAND);
  // UN-SAILED legs (dashed, faded) complete the triangle: England -> West Africa
  // and the "third leg" West Africa -> Virginia.
  addDashedEdge(world, group, ENGLAND, WEST_AFRICA);
  addDashedEdge(world, group, WEST_AFRICA, VIRGINIA);

  // --- The three ports -------------------------------------------------------
  addPort(world, group, VIRGINIA);
  addPort(world, group, ENGLAND);
  addPort(world, group, WEST_AFRICA);

  // --- The ship marker (starts at Virginia) ----------------------------------
  const marker = new Mesh(new SphereGeometry(0.022, 16, 12), shipMat);
  marker.position.set(VIRGINIA.x, VIRGINIA.y, Z_MARKER);
  world.createTransformEntity(marker, { parent: group }).addComponent(RouteMarker);

  // --- The wake trail pool (all hidden at first) ------------------------------
  // Build every wake dash NOW, so the animation never has to create anything.
  // Each dash starts at scale 0 (invisible); the system pops them to scale 1
  // one by one as the ship sails. They all share one geometry and one material,
  // and they all lie along the Virginia <-> England line - both sailed legs run
  // on that same line, so a single fixed angle keeps the wake looking drawn-in.
  const wakeAngle = Math.atan2(ENGLAND.y - VIRGINIA.y, ENGLAND.x - VIRGINIA.x);
  trailDashes = [];
  for (let i = 0; i < TRAIL_COUNT; i++) {
    const dash = new Mesh(trailGeometry, trailMat);
    dash.position.set(VIRGINIA.x, VIRGINIA.y, Z_TRAIL);
    dash.rotation.z = wakeAngle;
    dash.scale.setScalar(0); // hidden until the ship sails past this spot
    world.createTransformEntity(dash, { parent: group });
    trailDashes.push(dash);
  }

  // --- The text labels -------------------------------------------------------
  // Title across the top; port names beside their dots; the "third leg" caption
  // tucked just under the dashed base of the triangle. Wider phrases get wider
  // panels so they stay on one line.
  addLabel(world, group, "The Triangular Trade", 0.0, 0.53, 0.95, 0.18); // title
  addLabel(world, group, "England", 0.3, 0.35); // up-right of the top port dot
  addLabel(world, group, "Virginia", -0.52, -0.46); // below the lower-left port
  addLabel(world, group, "West Africa", 0.52, -0.46, 0.6); // below the lower-right port
  addLabel(world, group, "the third leg of the triangle", 0.0, -0.41, 0.85, 0.16); // dashed base

  routeMapGroup = group;
  return group;
}

// ----------------------------------------------------------------------------
// RouteMapSystem - runs the chart: sails the marker, fills in the labels, and
// hands off to the summary when the voyage home is complete.
// ----------------------------------------------------------------------------
export class RouteMapSystem extends createSystem({
  // The one moving ship marker.
  marker: { required: [RouteMarker] },
  // Every loaded label panel that still needs its words written in.
  labels: {
    required: [PanelUI, PanelDocument, MapLabel],
    where: [eq(PanelUI, "config", "./ui/mapLabel.json")],
  },
}) {
  // Wake-trail bookkeeping, set up once in init() so update() never allocates:
  // `trailIndex` is which pooled dash gets placed next (it wraps around), and
  // `trailAccum` counts seconds of sailing since the last dash was dropped.
  private trailIndex!: number;
  private trailAccum!: number;

  init() {
    this.trailIndex = 0;
    this.trailAccum = 0;

    // When a label's little panel finishes loading, write its remembered words
    // into the text element. (Setting text only "takes" once the document
    // exists, which is exactly when "qualify" fires.)
    this.queries.labels.subscribe("qualify", (entity) => {
      const doc = PanelDocument.data.document[entity.index] as UIKitDocument;
      if (!doc) return;
      const words = entity.getValue(MapLabel, "text") ?? "";
      const el = doc.getElementById("label") as UIKit.Text | null;
      el?.setProperties({ text: words });
    });
  }

  update(delta: number) {
    // Sail the marker along its route. There's only ever one, but a query loop
    // keeps the system stateless and tidy.
    for (const entity of this.queries.marker.entities) {
      // Already arrived home and handed off? Leave it be.
      if (entity.getValue(RouteMarker, "done")) continue;

      // Advance this marker's personal clock. We CLAMP delta first: if the app
      // ever hands us a huge frame gap (a load hitch, a GC pause, or a browser
      // throttling a backgrounded tab and then catching up), an unclamped delta
      // could leap past the whole voyage in a single frame and skip the
      // animation entirely. Capping each step at 0.1s keeps the ship visibly
      // sailing every leg no matter how choppy the frame rate gets.
      const step = Math.min(delta, 0.1);
      const elapsed = (entity.getValue(RouteMarker, "elapsed") ?? 0) + step;
      entity.setValue(RouteMarker, "elapsed", elapsed);

      // Work out where on the route the ship should be right now.
      const pos = this.positionAt(elapsed);
      entity.object3D!.position.set(pos.x, pos.y, Z_MARKER);

      // --- Drop wake dashes while the ship is actually SAILING ---------------
      // The ship moves during two windows: Virginia -> England, and England ->
      // home. During the holds at each port it sits still, so we don't count
      // that time - a wake only forms behind a moving ship. Every 0.18s of
      // travel we move the next POOLED dash (never a new one) to the bead's
      // current spot and pop it visible. The while-loop catches up cleanly if
      // one clamped frame spans more than one spacing.
      const departEngland = T_ARRIVE_ENGLAND + T_HOLD;
      const sailing =
        (elapsed > T_START && elapsed < T_ARRIVE_ENGLAND) ||
        (elapsed > departEngland && elapsed < T_END);
      if (sailing && trailDashes.length > 0) {
        this.trailAccum += step;
        while (this.trailAccum >= TRAIL_SPACING_S) {
          this.trailAccum -= TRAIL_SPACING_S;
          const dash = trailDashes[this.trailIndex];
          dash.position.set(pos.x, pos.y, Z_TRAIL);
          dash.scale.setScalar(1); // reveal it (pooled meshes start at scale 0)
          this.trailIndex = (this.trailIndex + 1) % trailDashes.length;
        }
      }

      // --- Ring the ship's bell at each arrival, exactly once -----------------
      // One ding when the ship first reaches England; two when it makes it
      // home. The guard booleans live on the RouteMarker component, so each
      // bell can only ring on the single frame its moment first passes.
      if (elapsed >= T_ARRIVE_ENGLAND && !entity.getValue(RouteMarker, "rangEngland")) {
        entity.setValue(RouteMarker, "rangEngland", true);
        ringShipBell(1);
      }

      // Reached the end of the voyage home: finish up exactly once.
      if (elapsed >= T_END) {
        if (!entity.getValue(RouteMarker, "rangHome")) {
          entity.setValue(RouteMarker, "rangHome", true);
          ringShipBell(2);
        }
        entity.setValue(RouteMarker, "done", true);
        this.finishVoyage();
      }
    }
  }

  /**
   * positionAt - the marker's chart position at a given elapsed time. The route
   * is: hold at Virginia, sail to England, hold, sail back toward Virginia.
   * We reuse the module's VIRGINIA/ENGLAND points and a smooth ease so the ship
   * glides rather than jerks. Returns ENGLAND/VIRGINIA directly during holds.
   */
  private positionAt(t: number): Vector3 {
    const t1 = T_START; // depart Virginia
    const t2 = T_START + T_LEG; // arrive England
    const t3 = t2 + T_HOLD; // depart England

    if (t <= t1) return VIRGINIA; // waiting at Virginia
    if (t <= t2) return this.lerp(VIRGINIA, ENGLAND, this.ease((t - t1) / T_LEG));
    if (t <= t3) return ENGLAND; // pausing at England
    if (t <= T_END) return this.lerp(ENGLAND, VIRGINIA, this.ease((t - t3) / T_LEG));
    return VIRGINIA; // arrived home
  }

  /** smoothstep easing: 0..1 in, eased 0..1 out (gentle start and stop). */
  private ease(x: number): number {
    const c = Math.min(1, Math.max(0, x));
    return c * c * (3 - 2 * c);
  }

  // A scratch vector reused for the lerp result, so the per-frame math never
  // allocates a new object (important for staying at frame rate in VR).
  private _scratch = new Vector3();
  private lerp(a: Vector3, b: Vector3, p: number): Vector3 {
    return this._scratch.set(a.x + (b.x - a.x) * p, a.y + (b.y - a.y) * p, 0);
  }

  /**
   * finishVoyage - the ship has reached home. Advance the logbook to "summary",
   * tear down the chart, and raise the Voyage Summary screen. We DEFER the
   * teardown one tick so we never dispose entities mid-update.
   */
  private finishVoyage() {
    voyageState.currentLeg = "summary";
    console.log(
      "Captain's Voyage - home again. currentLeg =",
      voyageState.currentLeg,
      "cargoValue:",
      voyageState.cargoValue,
      "crownCompliance:",
      voyageState.crownCompliance,
    );

    const world = this.world;
    setTimeout(() => {
      if (routeMapGroup) {
        disposeEntityTree(world, routeMapGroup);
        routeMapGroup = null;
      }
      beginVoyageSummary(world);
    }, 0);
  }
}

/**
 * beginReturnHomeMap - the entry point the England phase calls on "Continue
 * voyage". It registers the map's custom components and system, then builds the
 * chart. (Components must be registered before the system's queries use them.)
 */
export function beginReturnHomeMap(world: World): void {
  world.registerComponent(RouteMarker).registerComponent(MapLabel);
  world.registerSystem(RouteMapSystem);
  // Teach first, then sail: the route-map tutorial (the Triangular Trade) gates
  // the chart. When the student dismisses it, the animated map appears in its
  // place and sails the leg they travelled.
  showTutorial(world, TUTORIALS.map, () => createRouteMap(world));
}
