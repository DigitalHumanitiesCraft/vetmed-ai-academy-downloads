// Canvas 2D top view for browsers without WebGL 2, or when chosen with
// ?renderer=2d, and for the step pictures of the lesson overview. Draws the
// same scene state from the same figure parts and ground zones as the WebGL
// view, seen from above; only the camera choice is lost.
import { ZONES, ZONE_STYLE, footprints, isHatched, ropeArm, ropePoints, zoneOutline } from './figures.js';
import { pathMarks } from './scene-state.js';

// Region shown when no step frame is given, in scene units: x to the right,
// z downwards. It covers the zones and figures over the whole sequence.
const BOUNDS = { minX: -4.8, maxX: 6.4, minZ: -4, maxZ: 6 };
const DEG = Math.PI / 180;
// Hatching of the unsafe zones and the dashes of the person's path, in scene units.
const HATCH = { spacing: 0.28, width: 0.1 };
const OUTLINE = 0.05;
const DASH = [0.2, 0.14];

export function createFlatView(canvas, colors) {
  const ctx = canvas.getContext('2d');
  const c = colors;
  let width = 0;
  let height = 0;
  let map = { scale: 1, left: 0, top: 0, bounds: BOUNDS };

  // Heading follows the 3D convention (positive about the up axis), which in a
  // top view with z pointing down is a negative canvas rotation.
  function inFrameOf(pose, draw) {
    ctx.save();
    ctx.translate(pose.x, pose.z);
    ctx.rotate(-pose.heading * DEG);
    draw();
    ctx.restore();
  }

  // Parts from the lowest top upwards, so the back covers the legs as seen
  // from above, over a light outline of the whole figure that sets it off the ground.
  // `holding` leaves out the resting arm that the arm holding the rope replaces.
  // Returns the parts drawn.
  function figure(name, pose, tones, outline = true, holding = false) {
    const prints = footprints(name, pose.neck ?? 0).filter((f) => !(holding && f.holdsRope)).sort((a, b) => a.top - b.top);
    const shape = (f) => {
      ctx.beginPath();
      if (f.hand) ctx.arc(f.hand.x, f.hand.z, f.hand.r, 0, Math.PI * 2);
      else if (f.taper) {
        const { x0, x1, z0, z1 } = f.taper;
        ctx.moveTo(x0, f.z - z0);
        ctx.lineTo(x1, f.z - z1);
        ctx.lineTo(x1, f.z + z1);
        ctx.lineTo(x0, f.z + z0);
        ctx.closePath();
      } else ctx.roundRect(f.x - f.hx, f.z - f.hz, 2 * f.hx, 2 * f.hz, f.round);
    };
    inFrameOf(pose, () => {
      if (outline) {
        ctx.strokeStyle = 'rgb(255 255 255 / 0.9)';
        ctx.lineWidth = 3 / map.scale;
        for (const f of prints) {
          shape(f);
          ctx.stroke();
        }
      }
      for (const f of prints) {
        ctx.fillStyle = tones[f.tone] ?? tones.body;
        shape(f);
        ctx.fill();
      }
    });
    return prints;
  }

  function zones(state) {
    inFrameOf(state.horse, () => {
      for (const [id, zone] of Object.entries(ZONES)) {
        const style = state.focus.includes(id) ? ZONE_STYLE.focus : ZONE_STYLE.rest;
        ctx.beginPath();
        zoneOutline(zone).forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
        ctx.closePath();
        ctx.fillStyle = c[zone.tone].css;
        ctx.globalAlpha = style.fill;
        ctx.fill();
        if (style.outline) {
          ctx.globalAlpha = style.outline;
          ctx.strokeStyle = c[zone.tone].css;
          ctx.lineWidth = OUTLINE;
          ctx.stroke();
        }
        if (isHatched(zone)) {
          // Diagonal stripes clipped to the zone, so an unsafe zone reads without its colour.
          ctx.save();
          ctx.clip();
          ctx.globalAlpha = style.stripe;
          ctx.strokeStyle = c[zone.tone].css;
          ctx.lineWidth = HATCH.width;
          ctx.beginPath();
          // Rising and falling stripes tell the blind spots from the kick zone.
          const slope = zone.hatch === 'rising' ? -1 : 1;
          for (let d = -10; d <= 10; d += HATCH.spacing) {
            ctx.moveTo(d - 6, -6 * slope);
            ctx.lineTo(d + 6, 6 * slope);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // An arrowhead with its tip at (x, z), pointing along the unit direction (dx, dz).
  function arrowhead(x, z, dx, dz, length) {
    ctx.beginPath();
    ctx.moveTo(x, z);
    ctx.lineTo(x - dx * length - dz * length * 0.45, z - dz * length + dx * length * 0.45);
    ctx.lineTo(x - dx * length + dz * length * 0.45, z - dz * length - dx * length * 0.45);
    ctx.closePath();
    ctx.fill();
  }

  // The person's walk through the step: a ring where it starts and a dashed line to an arrowhead short of the person.
  function path(state, scale) {
    // A step of a few centimetres shows no direction and is not drawn.
    const marks = pathMarks(state.path);
    if (!marks?.tip) return;
    const { from, tip, dir, reach } = marks;
    ctx.save();
    ctx.strokeStyle = c.person.css;
    ctx.fillStyle = c.person.css;
    ctx.lineWidth = Math.max(0.05, 2 / scale);
    ctx.setLineDash(DASH);
    ctx.beginPath();
    ctx.moveTo(from.x, from.z);
    ctx.lineTo(from.x + dir.x * (reach - 0.25), from.z + dir.z * (reach - 0.25));
    ctx.stroke();
    ctx.setLineDash([]);
    arrowhead(tip.x, tip.z, dir.x, dir.z, 0.3);
    ctx.beginPath();
    ctx.arc(from.x, from.z, 0.18, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  // Where the horse and the person began the step: a pale pair under the others.
  function ghost(state) {
    if (!state.motion) return;
    figure('horse', state.motion.from, { body: c.ghost.css }, false);
    if (state.motion.person) figure('person', state.motion.person, { body: c.personGhost.css }, false);
  }

  // The head's path through a turn: a solid line in the horse's grey, lighter than the person's dashed
  // walk and without its ring, ending in an arrowhead under the end head; drawn last, over the rope.
  function groundTurn(t, scale) {
    const [ex, ez] = t[t.length - 1];
    const [px, pz] = t[t.length - 3];
    const d = Math.hypot(ex - px, ez - pz);
    const [ux, uz] = [(ex - px) / d, (ez - pz) / d];
    ctx.save();
    // A light halo first, so the grey path stands off the grey horse where it ends beside the head.
    for (const [color, width, head] of [['#fff', 6, 0.46], [c.horse.css, 2.5, 0.32]]) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(width * 0.025, width / scale);
      ctx.beginPath();
      t.slice(0, -1).forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.lineTo(ex - ux * 0.25, ez - uz * 0.25);
      ctx.stroke();
      arrowhead(ex, ez, ux, uz, head);
    }
    ctx.restore();
  }

  // The horse's arrow: the ground turn, or for a straight move an arrow ahead of the head with a light halo, over the figures.
  function trail(state, scale) {
    const t = state.motion?.trail;
    if (!t) return;
    if (state.motion.ground) {
      groundTurn(t, scale);
      return;
    }
    const [ex, ez] = t[t.length - 1];
    const [px, pz] = t[t.length - 3];
    const d = Math.hypot(ex - px, ez - pz);
    ctx.save();
    for (const [color, width, head] of [['#fff', 6, 0.46], [c.halter.css, 2.5, 0.34]]) {
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = Math.max(width * 0.025, width / scale);
      ctx.beginPath();
      t.slice(0, -1).forEach(([x, z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
      ctx.stroke();
      arrowhead(ex, ez, (ex - px) / d, (ez - pz) / d, head);
    }
    ctx.restore();
  }

  // The arm that holds the rope, seen from above from the shoulder to the hand near the halter, then the rope.
  // `held` keeps what was drawn last for the browser check.
  let held = null;
  function rope(state, scale, restingArm) {
    held = null;
    if (!state.rope) return;
    const { shoulder, hand, radius } = ropeArm(state.horse, state.person);
    held = { rope: ropePoints(state.horse, state.person, hand), arm: [shoulder, hand], restingArm };
    ctx.beginPath();
    ctx.moveTo(shoulder[0], shoulder[2]);
    ctx.lineTo(hand[0], hand[2]);
    ctx.lineCap = 'round';
    ctx.lineWidth = 2 * radius;
    ctx.strokeStyle = c.person.css;
    ctx.stroke();
    ctx.lineCap = 'butt';
    ctx.beginPath();
    held.rope.forEach(([x, , z], i) => (i ? ctx.lineTo(x, z) : ctx.moveTo(x, z)));
    ctx.lineWidth = 2.5 / scale;
    ctx.strokeStyle = c.halter.css;
    ctx.stroke();
  }

  return {
    kind: '2d',
    resize(w, h) {
      const dpr = Math.min(window.devicePixelRatio, 2);
      width = w;
      height = h;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    /**
     * Draws the state; `frame` is the ground region to fit, by default the
     * whole sequence, and `insets` the bands at the top and bottom that
     * controls cover, which the region keeps clear of.
     */
    render(state, _view, frame = BOUNDS, insets = { top: 0, bottom: 0 }) {
      // Before the first resize the canvas has no size; a zero scale would make the grid loop endless.
      if (!width || !height) return;
      ctx.save();
      ctx.fillStyle = c.ground.css;
      ctx.fillRect(0, 0, width, height);
      const spanX = frame.maxX - frame.minX;
      const spanZ = frame.maxZ - frame.minZ;
      const free = Math.max(1, height - insets.top - insets.bottom);
      const scale = Math.min(width / spanX, free / spanZ);
      map = { scale, left: (width - spanX * scale) / 2, top: insets.top + (free - spanZ * scale) / 2, bounds: frame };
      ctx.translate(map.left, map.top);
      ctx.scale(scale, scale);
      ctx.translate(-frame.minX, -frame.minZ);

      // Grid over the whole frame, not only the required region.
      const x0 = Math.floor(frame.minX - map.left / scale);
      const x1 = Math.ceil(frame.minX + (width - map.left) / scale);
      const z0 = Math.floor(frame.minZ - map.top / scale);
      const z1 = Math.ceil(frame.minZ + (height - map.top) / scale);
      ctx.strokeStyle = c.grid.css;
      ctx.lineWidth = 1 / scale;
      ctx.beginPath();
      for (let x = x0; x <= x1; x++) { ctx.moveTo(x, z0); ctx.lineTo(x, z1); }
      for (let z = z0; z <= z1; z++) { ctx.moveTo(x0, z); ctx.lineTo(x1, z); }
      ctx.stroke();
      // The grid fades out towards the frame's edge, as on the 3D ground.
      const cx = (frame.minX + frame.maxX) / 2;
      const cz = (frame.minZ + frame.maxZ) / 2;
      const reach = Math.hypot(x1 - x0, z1 - z0) / 2;
      const fade = ctx.createRadialGradient(cx, cz, reach * 0.3, cx, cz, reach * 0.85);
      fade.addColorStop(0, `rgb(${c.ground.r} ${c.ground.g} ${c.ground.b} / 0)`);
      fade.addColorStop(1, c.ground.css);
      ctx.fillStyle = fade;
      ctx.fillRect(x0, z0, x1 - x0, z1 - z0);

      zones(state);
      ghost(state);
      path(state, scale);
      figure('horse', state.horse, { body: c.horse.css, halter: c.halter.css, dark: c.horseDark.css });
      const person = figure('person', state.person, { body: c.person.css }, true, state.rope);
      rope(state, scale, person.some((f) => f.holdsRope));
      trail(state, scale);
      ctx.restore();
    },
    camera: () => null,
    target: () => null,
    held: () => held,
    // CSS pixels within the canvas for a world point; the top view ignores height.
    project([x, , z]) {
      return { x: map.left + (x - map.bounds.minX) * map.scale, y: map.top + (z - map.bounds.minZ) * map.scale };
    },
  };
}
