// One description of the stylised figures, shared by the WebGL view, the 2D
// top view and the label extents, so the three cannot drift apart. No DOM and
// no three.js here, so node:test can check the geometry directly.
//
// Local frame of a figure: it faces +x, y is up, +z is its right-hand side,
// origin on the ground. A part is a box (size x, y, z), a cylinder (radius, or
// radiusTop and radiusBottom for a taper, length along its own y axis), a
// capsule (radius, length of its straight middle along its own y axis) or a
// sphere. `scale` stretches a part along its own axes before it is tilted by
// `tilt` radians about z and centred at `at`. Parts listed under `neck` hang
// from the neck pivot and turn with the horse's neck angle. `tone` picks the
// halter colour for the noseband, so the head end reads at a glance, or the
// dark shade for hooves, mane and tail. `plan: 'hand'` draws a part in the
// top plan only as a dot at its lower end, so arms read as hands from above.

export const NECK_RANGE = { min: -45, max: 30 };

// Axis of the head, from the poll forward and down at 45 degrees, relative to
// the neck pivot. The noseband sits on it where the lead rope attaches.
const POLL = [0.62, 0.8];
const HEAD_LENGTH = 0.7;
const alongHead = (s) => [POLL[0] + s * Math.SQRT1_2, POLL[1] - s * Math.SQRT1_2];
const HEAD_TILT = -3 * Math.PI / 4;
// The neck rises from the pivot at about 53 degrees, along (0.6, 0.8).
const NECK_TILT = -Math.atan2(0.6, 0.8);

const leg = (x, z) => [
  { shape: 'cylinder', radiusTop: 0.115, radiusBottom: 0.065, length: 1.02, at: [x, 0.53, z], segments: 12 },
  { shape: 'cylinder', radius: 0.075, length: 0.1, at: [x, 0.05, z], segments: 12, tone: 'dark' },
];

export const FIGURES = {
  horse: {
    // Barrel, shoulder and croup give the silhouette from the side and from above.
    parts: [
      { shape: 'capsule', radius: 0.36, length: 1.5, at: [0.05, 1.33, 0], tilt: -Math.PI / 2, scale: [1, 1, 0.85], segments: 16 },
      { shape: 'sphere', radius: 0.38, at: [0.72, 1.36, 0], scale: [1, 1, 0.82] },
      { shape: 'sphere', radius: 0.4, at: [-0.68, 1.36, 0], scale: [1, 0.95, 0.88] },
      ...leg(0.72, -0.19), ...leg(0.72, 0.19), ...leg(-0.72, -0.19), ...leg(-0.72, 0.19),
      { shape: 'cylinder', radiusTop: 0.05, radiusBottom: 0.075, length: 0.8, at: [-1.17, 1.2, 0], tilt: -0.22, scale: [1, 1, 0.8], segments: 12, tone: 'dark' },
    ],
    neck: {
      pivot: [0.95, 1.6, 0],
      parts: [
        { shape: 'cylinder', radiusTop: 0.17, radiusBottom: 0.31, length: 1.04, at: [0.31, 0.37, 0], tilt: NECK_TILT, scale: [1, 1, 0.65], segments: 16 },
        { shape: 'box', size: [0.07, 0.86, 0.05], at: [0.15, 0.49, 0], tilt: NECK_TILT, tone: 'dark' },
        { shape: 'sphere', radius: 0.175, at: [POLL[0] + 0.02, POLL[1], 0], scale: [1, 1, 0.95] },
        { shape: 'cylinder', radiusTop: 0.115, radiusBottom: 0.175, length: HEAD_LENGTH, at: [...alongHead(HEAD_LENGTH / 2), 0], tilt: HEAD_TILT, scale: [1, 1, 1.15], segments: 16 },
        { shape: 'sphere', radius: 0.125, at: [...alongHead(HEAD_LENGTH), 0], scale: [1, 0.9, 0.85] },
        // Ears and a noseband mark where the head is; no anatomy is implied.
        // Ears set wide, so they stand out beside the head from above as well.
        { shape: 'cylinder', radiusTop: 0, radiusBottom: 0.055, length: 0.2, at: [0.57, 1.0, -0.16], tilt: -0.15, segments: 8 },
        { shape: 'cylinder', radiusTop: 0, radiusBottom: 0.055, length: 0.2, at: [0.57, 1.0, 0.16], tilt: -0.15, segments: 8 },
        { shape: 'cylinder', radius: 0.155, length: 0.07, at: [...alongHead(0.4), 0], tilt: HEAD_TILT, scale: [1, 1, 1.1], segments: 16, tone: 'halter' },
      ],
    },
  },
  person: {
    parts: [
      { shape: 'cylinder', radiusTop: 0.075, radiusBottom: 0.06, length: 0.86, at: [0, 0.43, -0.095], segments: 12 },
      { shape: 'cylinder', radiusTop: 0.075, radiusBottom: 0.06, length: 0.86, at: [0, 0.43, 0.095], segments: 12 },
      { shape: 'capsule', radius: 0.17, length: 0.38, at: [0, 1.2, 0], scale: [0.75, 1, 1.2], segments: 16 },
      // Arms from the shoulders forward and down. While the rope is held, the right arm, the one next to
      // the horse, is replaced by the arm that reaches towards the halter (`holdsRope`, see ropeArm).
      { shape: 'capsule', radius: 0.05, length: 0.4, at: [0.075, 1.24, -0.25], tilt: 0.3027, segments: 8, plan: 'hand' },
      { shape: 'capsule', radius: 0.05, length: 0.4, at: [0.075, 1.24, 0.25], tilt: 0.3027, segments: 8, plan: 'hand', holdsRope: true },
      { shape: 'sphere', radius: 0.12, at: [0, 1.7, 0] },
      // A cap brim, so the heading stays readable from every view.
      { shape: 'box', size: [0.12, 0.03, 0.16], at: [0.13, 1.76, 0] },
    ],
  },
};

const DEG = Math.PI / 180;

// Half extents of a part in its own frame before tilt.
function halfSize(part) {
  let half;
  if (part.shape === 'box') half = part.size.map((s) => s / 2);
  else if (part.shape === 'sphere') half = [part.radius, part.radius, part.radius];
  else if (part.shape === 'capsule') half = [part.radius, part.length / 2 + part.radius, part.radius];
  else {
    const r = Math.max(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius);
    half = [r, part.length / 2, r];
  }
  const scale = part.scale ?? [1, 1, 1];
  return half.map((h, i) => h * scale[i]);
}

/**
 * Every part of a figure in its local frame for a given neck angle (degrees):
 * centre, total tilt about z and half extents. Neck parts are rotated about
 * the pivot, which is what the WebGL view does with its neck group.
 */
export function placedParts(figure, neck = 0) {
  const def = FIGURES[figure];
  const own = def.parts.map((p) => ({ part: p, centre: p.at, tilt: p.tilt ?? 0 }));
  if (!def.neck) return own;
  const a = neck * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const [px, py, pz] = def.neck.pivot;
  return own.concat(def.neck.parts.map((p) => {
    const [x, y, z] = p.at;
    return { part: p, centre: [px + x * cos - y * sin, py + x * sin + y * cos, pz + z], tilt: (p.tilt ?? 0) + a };
  }));
}

/** Axis-aligned local extent in x and y of a part tilted about z. */
function tiltedHalf(part, tilt) {
  const [hx, hy, hz] = halfSize(part);
  const c = Math.abs(Math.cos(tilt));
  const s = Math.abs(Math.sin(tilt));
  return [hx * c + hy * s, hx * s + hy * c, hz];
}

/**
 * Ground footprints for the 2D top view in the figure's local frame: one
 * rounded rectangle per part (centre x/z, half lengths, corner radius), which
 * is an ellipse for a sphere and a stadium for a lying capsule. The top view
 * sees the tilted part's horizontal reach; `top` lets it draw lower parts first.
 */
export function footprints(figure, neck = 0) {
  return placedParts(figure, neck).map(({ part, centre, tilt }) => {
    const [hx, hy, hz] = tiltedHalf(part, tilt);
    const round = part.shape === 'box' ? 0 : Math.min(hx, hz);
    const print = { x: centre[0], z: centre[2], hx, hz, round, top: centre[1] + hy, tone: part.tone ?? 'body', holdsRope: Boolean(part.holdsRope) };
    // A tapered part lying along the ground is seen from above as a trapezoid between its two ends.
    const r0 = part.radiusBottom ?? part.radius;
    const r1 = part.radiusTop ?? part.radius;
    if (part.shape === 'cylinder' && r0 !== r1 && Math.abs(Math.sin(tilt)) > 0.3) {
      const reach = part.length / 2 * (part.scale?.[1] ?? 1) * -Math.sin(tilt);
      const zs = part.scale?.[2] ?? 1;
      print.taper = { x0: centre[0] - reach, x1: centre[0] + reach, z0: r0 * zs, z1: r1 * zs };
    }
    if (part.plan === 'hand') {
      // Lower end of the part's own axis, which tilt turns from (0, -1) towards +x.
      const reach = halfSize(part)[1] - part.radius;
      print.hand = { x: centre[0] + reach * Math.sin(tilt), z: centre[2], r: part.radius * 1.3 };
    }
    return print;
  });
}

// Local bounding box of placed parts.
function boxOf(placed, box = { x: [Infinity, -Infinity], y: [Infinity, -Infinity], z: [Infinity, -Infinity] }) {
  for (const { part, centre, tilt } of placed) {
    const half = tiltedHalf(part, tilt);
    ['x', 'y', 'z'].forEach((axis, i) => {
      box[axis][0] = Math.min(box[axis][0], centre[i] - half[i]);
      box[axis][1] = Math.max(box[axis][1], centre[i] + half[i]);
    });
  }
  return box;
}

/**
 * Local bounding box of a figure over its whole supported pose range, used to
 * place labels above a figure without measuring the rendered image.
 */
function extentsOf(figure) {
  const neckAngles = FIGURES[figure].neck ? [NECK_RANGE.min, (NECK_RANGE.min + NECK_RANGE.max) / 2, 0, NECK_RANGE.max] : [0];
  const box = boxOf([]);
  for (const neck of neckAngles) boxOf(placedParts(figure, neck), box);
  return box;
}

export const FIGURE_EXTENTS = { horse: extentsOf('horse'), person: extentsOf('person') };

/** The eight world-space corners of a figure's box at the given pose, rotated by its heading about y. */
export function figureCorners(figure, pose) {
  return boxCorners(FIGURE_EXTENTS[figure], pose);
}

/**
 * World corners of the horse's neck and head at its current neck angle. Labels
 * keep clear of them, because a label there hides where the head points.
 */
export function headCorners(horse) {
  return boxCorners(boxOf(placedParts('horse', horse.neck ?? 0).slice(FIGURES.horse.parts.length)), horse);
}

// A long part, such as the neck or the barrel, is cut into pieces of about this length along its axis,
// because one box around it would cover the free space beside it wherever it lies diagonal on screen.
const PIECE_LENGTH = 0.45;
function piecesOf({ part, centre, tilt }) {
  const [, hy] = halfSize(part);
  if (hy < 0.3 || part.shape === 'sphere') return [{ part, centre, tilt }];
  const along = part.shape === 'capsule' ? part.length + 2 * part.radius : part.shape === 'box' ? part.size[1] : part.length;
  const PIECES = Math.max(2, Math.round(2 * hy / PIECE_LENGTH));
  const step = along / PIECES;
  const piece = part.shape === 'box'
    ? { shape: 'box', size: [part.size[0], step, part.size[2]], scale: part.scale }
    : { shape: 'cylinder', radius: Math.max(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius), length: step, scale: part.scale };
  const scaled = step * (part.scale?.[1] ?? 1);
  // Piece centres along the part's own axis, which tilt turns from (0, 1) to (-sin, cos).
  return Array.from({ length: PIECES }, (_, k) => {
    const s = (k - (PIECES - 1) / 2) * scaled;
    return { part: piece, centre: [centre[0] - s * Math.sin(tilt), centre[1] + s * Math.cos(tilt), centre[2]], tilt };
  });
}

/**
 * World corners of the parts of a figure at its pose, one group of eight per
 * box, with long diagonal parts cut into pieces. Labels keep clear of these
 * boxes, which follow the body much closer than one box around the figure.
 */
export function partCorners(figure, pose) {
  return partPieces(figure, pose).flat();
}

/** The same boxes grouped by part, in the order of the part table. */
export function partPieces(figure, pose) {
  return placedParts(figure, pose.neck ?? 0).map((placed) => piecesOf(placed).map((piece) => boxCorners(boxOf([piece]), pose)));
}

function boxCorners({ x: [x0, x1], y: [y0, y1], z: [z0, z1] }, pose) {
  const a = (pose.heading ?? 0) * DEG;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners = [];
  for (const lx of [x0, x1]) {
    for (const lz of [z0, z1]) {
      for (const y of [y0, y1]) corners.push([pose.x + lx * cos + lz * sin, y, pose.z - lx * sin + lz * cos]);
    }
  }
  return corners;
}

/** World point of a local figure point (lx forward, lz right) at the given pose. */
export function toWorld(pose, lx, lz) {
  const a = (pose.heading ?? 0) * DEG;
  return { x: pose.x + lx * Math.cos(a) + lz * Math.sin(a), z: pose.z - lx * Math.sin(a) + lz * Math.cos(a) };
}

/** Local coordinates (forward, right) of a world point relative to a figure pose; the inverse of toWorld. */
export function toLocal(pose, x, z) {
  const a = (pose.heading ?? 0) * DEG;
  const dx = x - pose.x;
  const dz = z - pose.z;
  return { forward: dx * Math.cos(a) - dz * Math.sin(a), right: dx * Math.sin(a) + dz * Math.cos(a) };
}

/** World point of a point given in the figure's own frame (lx forward, y up, lz right). */
function worldPoint(pose, [lx, y, lz]) {
  const w = toWorld(pose, lx, lz);
  return [w.x, y, w.z];
}

// Where the lead rope attaches: the underside of the noseband, relative to the neck pivot.
const HALTER_RING = [0.9, 0.51];

/** World position of the halter ring for a horse pose, following the neck angle. */
export function halterPoint(horse) {
  const [px, py] = FIGURES.horse.neck.pivot;
  const a = (horse.neck ?? 0) * DEG;
  const [x, y] = HALTER_RING;
  return worldPoint(horse, [px + x * Math.cos(a) - y * Math.sin(a), py + x * Math.sin(a) + y * Math.cos(a), 0]);
}

// The arm that holds the rope: its shoulder is the upper end of the right arm's axis, which tilt turns
// from (0, 1) to (-sin, cos). It reaches at most ARM_REACH from the shoulder, a little longer than the
// hanging arm because it is stretched, and stops ROPE_GRIP short of the ring, so the hand never sits in
// the noseband. The halter hangs about 0.7 above the shoulder and 1 ahead of it, so the hand stays about
// 0.75 from the ring; a closer hand would need the person further forward or the head lower.
const ROPE_ARM = FIGURES.person.parts.find((part) => part.holdsRope);
const SHOULDER = [ROPE_ARM.at[0] - ROPE_ARM.length / 2 * Math.sin(ROPE_ARM.tilt), ROPE_ARM.at[1] + ROPE_ARM.length / 2 * Math.cos(ROPE_ARM.tilt), ROPE_ARM.at[2]];
const ARM_REACH = 0.6;
const ROPE_GRIP = 0.2;
// Where the right and left hands rest at the end of the hanging arms, in the person's frame.
const RESTING_HAND = { right: [0.15, 1.0, 0.25], left: [0.15, 1.0, -0.25] };

/**
 * The person's arm while the rope is held: from the right shoulder straight towards the halter ring, so
 * the hand grips the rope near the halter. World points and the arm's radius.
 */
export function ropeArm(horse, person) {
  const ring = halterPoint(horse);
  const shoulder = worldPoint(person, SHOULDER);
  const d = ring.map((v, i) => v - shoulder[i]);
  const length = Math.hypot(...d);
  const reach = Math.max(0, Math.min(ARM_REACH, length - ROPE_GRIP));
  return { shoulder, hand: shoulder.map((v, i) => v + d[i] * reach / length), radius: ROPE_ARM.radius };
}

/**
 * Lead rope as a polyline: from the halter ring with a slight sag to the
 * hand next to the horse, then the loose end hanging in a loop to the left
 * hand. The loop is drawn open because the rule is that the rope is never
 * wrapped around the hand. The views pass the hand of ropeArm; without one the
 * rope ends at the resting right hand, where the film's top-down plan draws it.
 */
export function ropePoints(horse, person, hand = worldPoint(person, RESTING_HAND.right)) {
  const ring = halterPoint(horse);
  const left = worldPoint(person, RESTING_HAND.left);
  const loop = worldPoint(person, [0.3, 0.5, 0]);
  const sag = [(ring[0] + hand[0]) / 2, Math.min(ring[1], hand[1]) - 0.15 * Math.min(1, Math.hypot(...ring.map((v, i) => v - hand[i]))), (ring[2] + hand[2]) / 2];
  return [ring, sag, hand, loop, left];
}

/**
 * Ground zones around the horse in its own frame (forward x, right z, degrees
 * measured from forward towards the right). Their extents are schematic: the
 * sources name the regions (behind the horse, directly in front and behind,
 * at the left shoulder) but give no distances, so no size here is a
 * measured safety distance. `tone` is the zone's one severity in both views,
 * at its name and at the person: the unsafe zones take warning amber and are
 * hatched, so they stay apart from the safe place without colour vision; the
 * kick zone and the blind spots differ by hatch direction, form and name.
 */
export const ZONES = {
  kick: { shape: 'sector', at: [-1.1, 0], radius: 2, direction: 180, spread: 120, tone: 'warn', hatch: 'falling', label: 'Schlagbereich', anchor: [-2.3, 0] },
  'blind-rear': { shape: 'sector', at: [-1.1, 0], radius: 3.4, direction: 180, spread: 16, tone: 'warn', hatch: 'rising', label: 'Toter Winkel hinten', anchor: [-4.1, 0] },
  'blind-front': { shape: 'sector', at: [2.1, 0], radius: 2.6, direction: 0, spread: 24, tone: 'warn', hatch: 'rising', label: 'Toter Winkel vorn', anchor: [4.3, 0] },
  shoulder: { shape: 'rect', x: [0.1, 1.3], z: [-1.3, -0.45], tone: 'safe', label: 'Schulterbereich', anchor: [0.7, -1.55] },
};

/** Whether a zone is drawn hatched: every zone that is not the safe place. */
export const isHatched = (zone) => Boolean(zone.hatch);

/** Outline of a zone in the horse's frame as (forward, right) points; sectors are sampled every 5 degrees. */
export function zoneOutline(zone) {
  if (zone.shape === 'rect') return [[zone.x[0], zone.z[0]], [zone.x[1], zone.z[0]], [zone.x[1], zone.z[1]], [zone.x[0], zone.z[1]]];
  const points = [zone.at];
  for (let a = zone.direction - zone.spread / 2; a <= zone.direction + zone.spread / 2 + 1e-9; a += 5) {
    points.push([zone.at[0] + zone.radius * Math.cos(a * DEG), zone.at[1] + zone.radius * Math.sin(a * DEG)]);
  }
  return points;
}

/**
 * A zone cut into pieces whose screen boxes follow its shape closely: the
 * rectangle whole, a sector in rings from its apex outwards. A label keeps
 * clear of these boxes, which a single box around a thin wedge would overstate.
 */
export function zonePieces(zone, rings = 6) {
  if (zone.shape === 'rect') return [zoneOutline(zone)];
  const angles = [-0.5, 0, 0.5].map((k) => (zone.direction + k * zone.spread) * DEG);
  const at = (r, a) => [zone.at[0] + r * Math.cos(a), zone.at[1] + r * Math.sin(a)];
  return Array.from({ length: rings }, (_, k) => {
    const [r0, r1] = [k, k + 1].map((n) => zone.radius * n / rings);
    return angles.flatMap((a) => [at(r0, a), at(r1, a)]);
  });
}

/** Corners of the box around every zone and zone name in the horse's frame, for framing a step. */
export const ZONE_REACH = (() => {
  const points = Object.values(ZONES).flatMap((zone) => [...zoneOutline(zone), zone.anchor]);
  const f = points.map((p) => p[0]);
  const r = points.map((p) => p[1]);
  const [f0, f1, r0, r1] = [Math.min(...f), Math.max(...f), Math.min(...r), Math.max(...r)];
  return [[f0, r0], [f1, r0], [f1, r1], [f0, r1]];
})();

function inZone(zone, forward, right) {
  if (zone.shape === 'rect') return forward >= zone.x[0] && forward <= zone.x[1] && right >= zone.z[0] && right <= zone.z[1];
  const f = forward - zone.at[0];
  const r = right - zone.at[1];
  if (Math.hypot(f, r) > zone.radius) return false;
  const angle = Math.atan2(r, f) / DEG;
  const diff = Math.abs(((angle - zone.direction) % 360 + 540) % 360 - 180);
  return diff <= zone.spread / 2;
}

/** Ids of every zone that holds a person's position, overlapping zones included. */
export function zonesHolding(horse, person) {
  const { forward, right } = toLocal(horse, person.x, person.z);
  return Object.keys(ZONES).filter((id) => inZone(ZONES[id], forward, right));
}

/**
 * Where a person stands relative to the horse: the left shoulder, beside the
 * body, in the front blind spot, in the kick zone, in the rear blind spot
 * beyond it, or away from all of them. The first matching region wins.
 */
export function zoneOf(horse, person) {
  const { forward, right } = toLocal(horse, person.x, person.z);
  if (inZone(ZONES.shoulder, forward, right)) return 'shoulder';
  if (Math.abs(right) <= 1.3 && forward >= -1.1 && forward <= 1.3) return 'side';
  for (const id of ['blind-front', 'kick', 'blind-rear']) if (inZone(ZONES[id], forward, right)) return id;
  return 'away';
}

/** World position of a local point given in the horse's frame. */
export function zonePoint(horse, [lx, lz]) {
  const w = toWorld(horse, lx, lz);
  return [w.x, 0, w.z];
}

/**
 * Zone strength in both views, as opacities of the zone colour over the
 * ground. The zone a step points to is filled, outlined and, if unsafe,
 * strongly hatched; the others recede to a faint fill and faint stripes
 * without outline. At focus the stripes keep at least 3:1 against the ground.
 */
export const ZONE_STYLE = {
  rest: { fill: 0.04, stripe: 0.14, outline: 0 },
  focus: { fill: 0.2, stripe: 0.9, outline: 1 },
};
