// Scene state as a pure function of sequence time and parameters. No DOM, no
// renderer, so node:test can check poses, step boundaries and transitions directly.
import { NECK_RANGE, ZONES, figureCorners, halterPoint, partCorners, toLocal, toWorld, zoneOf, zoneOutline } from './figures.js';

const POSE_KEYS = {
  horse: ['x', 'z', 'heading', 'neck'],
  person: ['x', 'z', 'heading'],
};

export const PARAMETERS = {
  speed: { values: [0.5, 1, 2], default: 1 },
  view: { default: 'oblique' },
  placement: { default: 'sequence' },
};

// Positions in scene units, y is up. Each preset is a fixed viewing direction
// and distance; the view centres it on the region of the current step (see
// stepFrame), so the camera moves with the lesson but never orbits freely. The
// side view looks at the horse's left side, where the person works. The oblique
// view `follows` the horse: its direction turns with the horse's heading at the
// step's end, so it always looks at the front left of the pose the step ends in,
// from the person's side; it stands far off, so figures at the frame's edge keep
// upright under the perspective.
export const CAMERA_VIEWS = {
  oblique: { label: 'Schrägansicht', short: 'Schräg', position: [4.5, 10.5, -11], target: [1, 0, 0.2], follows: true },
  side: { label: 'Seitenansicht von links', short: 'Seite', position: [1, 2.2, -12.5], target: [1, 1, 0.5] },
  top: { label: 'Draufsicht', short: 'Oben', position: [0.8, 12.5, 1.2], target: [0.8, 0, 1.1] },
};

/**
 * Counter-check positions for the person, in the horse's own frame (forward,
 * right) with a heading relative to the horse. "sequence" keeps the authored
 * path; the others hold the person at that place, so the zone reading can be
 * compared with the rule. `label` is the button text, `text` the place in words.
 */
export const PLACEMENTS = {
  sequence: { label: 'nach der Regel', text: 'nach der Regel' },
  shoulder: { label: 'Schulter', text: 'an der Schulter', at: [0.7, -0.9], face: -90 },
  front: { label: 'vorn', text: 'vor dem Pferd', at: [3, 0], face: 180 },
  behind: { label: 'hinten', text: 'hinter dem Pferd', at: [-2, 0], face: 0 },
};

// Visible wording of each region zoneOf() returns. The tone comes from the
// zone definition in figures.js, so a zone has one severity everywhere.
const ZONE_TEXT = {
  shoulder: 'an der linken Schulter',
  side: 'neben dem Pferd',
  'blind-front': 'im toten Winkel vorn',
  kick: 'im Schlagbereich',
  'blind-rear': 'im toten Winkel hinten',
  away: 'mit Abstand zum Pferd',
};
export const ZONE_INFO = Object.fromEntries(Object.entries(ZONE_TEXT)
  .map(([id, text]) => [id, { text, tone: ZONES[id]?.tone ?? 'neutral' }]));

const UNITS = { duration: 's', position: 'scene unit', heading: 'degree', neck: 'degree' };
const UNIT_NAMES = { duration: 'Dauer', position: 'Position', heading: 'Richtung', neck: 'Halswinkel' };
const OF_FIGURE = { horse: 'des Pferds', person: 'der Person' };
const THE_FIGURE = { horse: 'das Pferd', person: 'die Person' };
const KEY_NAMES = { x: 'x', z: 'z', heading: 'Richtung', neck: 'Halswinkel' };
const keyName = (key) => KEY_NAMES[key] ?? key;
// The interface can only state what these values mean; a new status or
// origin needs a decision about its wording before a sequence may use it.
export const STATUS_LABELS = { unreviewed: 'nicht fachlich geprüft' };
export const ORIGIN_LABELS = { 'source-derived': 'Regeln aus öffentlichen Sicherheitshinweisen abgeleitet', synthetic: 'Synthetische Prüfsequenz' };

// Headings interpolate linearly between the given numbers, so the numeric
// difference fixes direction and amount of a turn. More than half a turn in
// one step would be ambiguous to an author reading the data.
const MAX_TURN_PER_STEP = 180;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const isObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const HTTPS = /^https:\/\/\S+$/;

function validateMeta(seq, errors) {
  if (!isText(seq.title)) errors.push('Die Lektion hat keinen Titel.');
  // A missing value is named as missing, so no raw "undefined" reaches the reader.
  if (seq.status === undefined) errors.push('Die Lektion nennt keinen Prüfstand.');
  else if (!Object.hasOwn(STATUS_LABELS, seq.status)) errors.push(`Der Prüfstand „${seq.status}“ ist nicht vorgesehen.`);
  if (seq.origin === undefined) errors.push('Die Lektion nennt keine Herkunft.');
  else if (!Object.hasOwn(ORIGIN_LABELS, seq.origin)) errors.push(`Die Herkunft „${seq.origin}“ ist nicht vorgesehen.`);
  for (const [key, unit] of Object.entries(UNITS)) {
    if (seq.units?.[key] !== unit) errors.push(`Die Einheit für ${UNIT_NAMES[key]} muss „${unit}“ sein.`);
  }
}

// Sources are shown as links, so only https addresses are accepted.
function validateSources(seq, errors) {
  if (seq.sources === undefined) return;
  if (!isObject(seq.sources)) {
    errors.push('Die Quellen sind kein Objekt.');
    return;
  }
  for (const [id, src] of Object.entries(seq.sources)) {
    if (!ID.test(id)) errors.push(`Die Quelle „${id}“ hat keine gültige Kennung.`);
    if (!isText(src?.label)) errors.push(`Die Quelle ${id} hat keine Bezeichnung.`);
    if (typeof src?.url !== 'string' || !HTTPS.test(src.url)) errors.push(`Die Quelle ${id} hat keine https-Adresse.`);
  }
}

function checkNeck(value, where, errors) {
  if (Number.isFinite(value) && (value < NECK_RANGE.min || value > NECK_RANGE.max)) {
    errors.push(`${where} setzt den Halswinkel außerhalb von ${NECK_RANGE.min} bis ${NECK_RANGE.max} Grad.`);
  }
}

// Teaching fields of a step: the reason, the source passages it rests on, the
// zones it points to, whether the lead rope is held from now on and a short cue
// at the person. A passage names a defined source and where in it the rule
// stands, so a reviewer can compare rule and text.
function validateTeaching(seq, step, n, errors) {
  if (step.why !== undefined && !isText(step.why)) errors.push(`Schritt ${n} hat eine leere Begründung.`);
  if (step.cue !== undefined && !isText(step.cue)) errors.push(`Schritt ${n} hat einen leeren Hinweis.`);
  if (step.rope !== undefined && typeof step.rope !== 'boolean') errors.push(`Schritt ${n} gibt den Führstrick nicht als true oder false an.`);
  if (step.passages !== undefined) {
    if (!Array.isArray(step.passages)) errors.push(`Schritt ${n} führt die Fundstellen nicht als Liste.`);
    else {
      for (const passage of step.passages) {
        if (passage?.source === undefined) errors.push(`Schritt ${n} nennt eine Fundstelle ohne Quelle.`);
        else if (!Object.hasOwn(seq.sources ?? {}, passage.source)) errors.push(`Schritt ${n} nennt die nicht definierte Quelle „${passage.source}“.`);
        else if (!isText(passage.locator)) errors.push(`Schritt ${n} nennt keine Fundstelle in der Quelle ${passage.source}.`);
      }
    }
  }
  if (step.focus !== undefined) {
    if (!Array.isArray(step.focus)) errors.push(`Schritt ${n} führt die Bereiche nicht als Liste.`);
    else for (const id of step.focus) if (!Object.hasOwn(ZONES, id)) errors.push(`Schritt ${n} nennt den nicht vorgesehenen Bereich „${id}“.`);
  }
}

/** Returns a list of German error messages, empty when the sequence is usable. */
export function validateSequence(seq) {
  if (!isObject(seq)) return ['Die Lektionsdatei enthält kein JSON-Objekt.'];
  const errors = [];
  validateMeta(seq, errors);
  validateSources(seq, errors);
  for (const [figure, keys] of Object.entries(POSE_KEYS)) {
    const initial = seq.initial?.[figure];
    for (const key of keys) {
      if (!Number.isFinite(initial?.[key])) errors.push(`Die Ausgangspose ${OF_FIGURE[figure]} hat keinen Zahlenwert für ${keyName(key)}.`);
    }
    for (const key of Object.keys(isObject(initial) ? initial : {})) {
      if (!keys.includes(key)) errors.push(`Die Ausgangspose ${OF_FIGURE[figure]} enthält den unbekannten Wert ${keyName(key)}.`);
    }
  }
  checkNeck(seq.initial?.horse?.neck, 'Die Ausgangspose', errors);
  if (!Array.isArray(seq.steps) || seq.steps.length === 0) {
    errors.push('Die Lektion enthält keine Schritte.');
    return errors;
  }
  const ids = new Set();
  const heading = { horse: seq.initial?.horse?.heading, person: seq.initial?.person?.heading };
  seq.steps.forEach((step, i) => {
    const n = i + 1;
    if (!isObject(step)) {
      errors.push(`Schritt ${n} ist kein Objekt.`);
      return;
    }
    if (typeof step.id !== 'string' || !ID.test(step.id)) errors.push(`Schritt ${n} hat keine gültige Kennung.`);
    else if (ids.has(step.id)) errors.push(`Schritt ${n} wiederholt die Kennung „${step.id}“.`);
    ids.add(step.id);
    if (!isText(step.label)) errors.push(`Schritt ${n} hat keine Regel.`);
    if (!(Number.isFinite(step.duration) && step.duration > 0)) errors.push(`Schritt ${n} hat keine positive Dauer.`);
    for (const [figure, keys] of Object.entries(POSE_KEYS)) {
      const target = step[figure];
      if (target === undefined) continue;
      if (!isObject(target)) {
        errors.push(`Schritt ${n} gibt die Pose ${OF_FIGURE[figure]} nicht als Objekt an.`);
        continue;
      }
      for (const [key, value] of Object.entries(target)) {
        if (!keys.includes(key) || !Number.isFinite(value)) errors.push(`Schritt ${n} enthält für ${THE_FIGURE[figure]} den unbekannten oder nicht numerischen Wert ${keyName(key)}.`);
      }
      if (figure === 'horse') checkNeck(target.neck, `Schritt ${n}`, errors);
      if (Number.isFinite(target.heading) && Number.isFinite(heading[figure])) {
        if (Math.abs(target.heading - heading[figure]) > MAX_TURN_PER_STEP) {
          errors.push(`Schritt ${n} dreht ${THE_FIGURE[figure]} um mehr als ${MAX_TURN_PER_STEP} Grad. Größere Drehungen auf mehrere Schritte verteilen.`);
        }
        heading[figure] = target.heading;
      }
    }
    validateTeaching(seq, step, n, errors);
  });
  return errors;
}

export function totalDuration(seq) {
  return seq.steps.reduce((sum, step) => sum + step.duration, 0);
}

export function stepStarts(seq) {
  const starts = [];
  let start = 0;
  for (const step of seq.steps) {
    starts.push(start);
    start += step.duration;
  }
  return starts;
}

/** Start and end time of step i. */
export function stepBounds(seq, i) {
  const start = stepStarts(seq)[i];
  return { start, end: start + seq.steps[i].duration };
}

// Step i covers [start, end); the last step includes the end of the sequence.
function stepAt(seq, time) {
  const starts = stepStarts(seq);
  let i = starts.length - 1;
  while (i > 0 && starts[i] > time) i--;
  return i;
}

function lerpPose(from, to, f) {
  if (!to) return from;
  const pose = { ...from };
  for (const [key, value] of Object.entries(to)) pose[key] = from[key] + (value - from[key]) * f;
  return pose;
}

/**
 * Zones drawn in focus: those the step points to, and under the counter-check
 * also the zone the held person's label names, so that zone is drawn and not
 * left a faint unnamed arc (independent review 2026-11-06). Its name stays
 * with the person's label.
 */
function heldFocus(focus, heldZone) {
  return heldZone && Object.hasOwn(ZONES, heldZone) && !focus.includes(heldZone) ? [...focus, heldZone] : focus;
}

/** Person pose held at a counter-check placement relative to the horse; null for the authored path. */
export function placePerson(horse, placementKey) {
  const p = PLACEMENTS[placementKey];
  if (!p?.at) return null;
  const w = toWorld(horse, p.at[0], p.at[1]);
  return { x: w.x, z: w.z, heading: horse.heading + p.face };
}

const TRAIL_SAMPLES = 12;
// How far into a turn the following view faces, from the measured search (see stepFrame): a little past
// the end heading, -95 degrees for the lesson's quarter turn.
const TURN_SHARE = 19 / 18;
// Forward distance of the poll from the horse's origin, under which a turn's arc runs.
const UNDER_HEAD = 1.6;
// A straight move's arrow runs this far ahead of the halter ring, in scene units, starting clear of the muzzle.
const AHEAD = { from: 0.45, to: 1.25 };
// Forward distance of the halter ring from the horse's origin, read from its world position.
const ring0 = (pose) => toLocal(pose, halterPoint(pose)[0], halterPoint(pose)[2]).forward;
// Room around the tip of the horse's arrow, on top of the frame's margin, so the arrowhead is never cut.
const TIP_ROOM = 0.25;
// Ground kept free around the person in a step's frame, in scene units.
const PERSON_ROOM = 0.8;

/**
 * The horse's own movement in a step, so a still shows it: `from` and `to`
 * are its poses at the step's start and end, and `trail` ground points (x, z)
 * drawn at `height`. A turn follows the point under the poll through the
 * step's linear interpolation and is drawn on the ground (`ground`), a bow
 * from under the start head to under the end head. A straight move points
 * from the head forward along the end heading at head height, because the
 * path itself would run along the spine. Null when the horse stays.
 */
function horseMotion(from, target) {
  if (!target) return null;
  const to = { ...from, ...target };
  const moves = Math.hypot(to.x - from.x, to.z - from.z) > 0.05;
  const turns = Math.abs(to.heading - from.heading) > 1;
  if (!moves && !turns) return null;
  const ring = halterPoint(to);
  if (!turns) {
    const ahead = [AHEAD.from, (AHEAD.from + AHEAD.to) / 2, AHEAD.to].map((s) => toWorld(to, ring0(to) + s, 0));
    return { from: { ...from }, to, trail: ahead.map((w) => [w.x, w.z]), height: ring[1] };
  }
  // A turn is drawn on the ground under the head, from under the start poll to under the end poll; the
  // halter ring further out would sweep over the place where the person ends at the shoulder.
  const heads = Array.from({ length: TRAIL_SAMPLES + 1 }, (_, k) => toWorld(lerpPose(from, target, k / TRAIL_SAMPLES), UNDER_HEAD, 0));
  return { from: { ...from }, to, trail: heads.map((w) => [w.x, w.z]), height: 0, ground: true };
}

// The path's arrowhead stops this far short of the person's feet, so the figure does not hide it.
const PATH_TIP_GAP = 0.42;

/**
 * Marks of the person's walk on the ground: the start ring and, when the walk
 * is long enough to show a direction, the tip of the arrowhead and the unit
 * direction. Both views draw these, and labels keep clear of them.
 */
export function pathMarks(path) {
  if (!path) return null;
  const { from, to } = path;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const dir = { x: (to.x - from.x) / length, z: (to.z - from.z) / length };
  const reach = length - PATH_TIP_GAP;
  const tip = reach > 0.6 ? { x: from.x + dir.x * reach, z: from.z + dir.z * reach } : null;
  return { from, tip, dir, reach };
}

/** Whether a step offers the counter-check: a step that points to ground zones teaches a place. */
/**
 * The view a step opens in unless a view was chosen: a step that turns the horse opens from above,
 * where the turn away from the person reads at a glance; every other step opens in the default view.
 */
export function recommendedView(seq, index) {
  const { start, end } = stepBounds(seq, index);
  const [h0, h1] = [start, end].map((t) => sceneState(seq, t, { step: index }).horse.heading);
  return Math.abs(h1 - h0) > 1 ? 'top' : PARAMETERS.view.default;
}

export function offersCounterCheck(step) {
  return Array.isArray(step?.focus) && step.focus.length > 0;
}

/**
 * Scene at sequence time t (seconds). Each step interpolates linearly from
 * the pose at its start to its targets; a figure or key a step omits holds its
 * pose. Without `step`, t is clamped to the sequence and selects the step that
 * covers it. With `step`, the scene is bound to that step and t is clamped to
 * its start and end, so the end of a step shows that step and not the next.
 * The rope state holds from the step that sets it. A placement other than
 * "sequence" replaces the person's pose; the rope, the cue and the path belong
 * to the authored path only and are then not shown. `path` is the person's
 * walk through the step, null when the person stays in place.
 */
export function sceneState(seq, t, { placement = PARAMETERS.placement.default, step } = {}) {
  const total = totalDuration(seq);
  const bound = Number.isInteger(step);
  const stepIndex = bound ? clamp(step, 0, seq.steps.length - 1) : stepAt(seq, clamp(t, 0, total));
  const { start, end } = stepBounds(seq, stepIndex);
  const time = bound ? clamp(t, start, end) : clamp(t, 0, total);
  let horse = { ...seq.initial.horse };
  let from = { ...seq.initial.person };
  let rope = false;
  for (let i = 0; i < stepIndex; i++) {
    const done = seq.steps[i];
    if (done.rope !== undefined) rope = done.rope;
    horse = { ...horse, ...done.horse };
    from = { ...from, ...done.person };
  }
  const current = seq.steps[stepIndex];
  if (current.rope !== undefined) rope = current.rope;
  const f = (time - start) / current.duration;
  const motion = horseMotion(horse, current.horse);
  horse = lerpPose(horse, current.horse, f);
  let person = lerpPose(from, current.person, f);
  const to = { ...from, ...current.person };
  const placed = placePerson(horse, placement);
  if (placed) person = placed;
  // Where the horse moves too, the walk is drawn relative to the horse's end
  // pose, so a person who keeps the place beside a moving horse shows no walk.
  if (motion) {
    // The pale start pair: where the person stood beside the horse when the step began.
    motion.person = { x: from.x, z: from.z, heading: from.heading };
    const local = toLocal(motion.from, from.x, from.z);
    const w = toWorld(motion.to, local.forward, local.right);
    from = { ...from, x: w.x, z: w.z };
  }
  const walks = Math.hypot(to.x - from.x, to.z - from.z) > 0.05;
  return {
    time,
    ended: time >= total,
    stepIndex,
    stepCount: seq.steps.length,
    stepId: current.id,
    stepLabel: current.label,
    why: current.why ?? '',
    passages: (current.passages ?? []).map(({ source, locator }) => ({ source, locator, ...seq.sources[source] })),
    focus: heldFocus(current.focus ?? [], placed && zoneOf(horse, person)),
    cue: placed ? '' : current.cue ?? '',
    rope: rope && !placed,
    path: walks && !placed ? { from: { x: from.x, z: from.z }, to: { x: to.x, z: to.z } } : null,
    motion,
    horse,
    person,
    zone: zoneOf(horse, person),
  };
}

/**
 * Ground region a step is about, in world x and z: the horse at the step's
 * start and end, the person where it ends and, with room around it, where it
 * starts, the zones the step points to with their names, and the horse's trail.
 * A counter-check `placement` adds the person held there, with the same room,
 * so a person held behind or in front of the horse stays in the frame.
 * `points` are the same in 3D, the horse's parts and the person's box at their height, for a
 * camera to fit. Zones the step does not name stay outside, so the figures
 * fill the frame.
 */
export function stepFrame(seq, index, margin = 0.3, placement = PARAMETERS.placement.default) {
  const { start, end } = stepBounds(seq, index);
  const points = [];
  const step = seq.steps[index];
  for (const t of [start, end]) {
    const s = sceneState(seq, t, { step: index });
    points.push(...partCorners('horse', s.horse).flat());
    // The scene rests at the step's end; at its start the person's ring marks the ground.
    if (t === end) points.push(...figureCorners('person', s.person));
    // Where the horse moves, the pale start person stands in full; otherwise the start ring marks the ground.
    else if (s.motion) points.push(...figureCorners('person', s.person));
    else points.push(...figureCorners('person', s.person).filter((p) => p[1] === 0));
    // Room around the person on the ground, so a person standing away from the horse is not cut by the frame's edge.
    const room = (person) => [[-1, 0], [1, 0], [0, -1], [0, 1]].map(([dx, dz]) => [person.x + dx * PERSON_ROOM, 0, person.z + dz * PERSON_ROOM]);
    points.push(...room(s.person));
    const held = placePerson(s.horse, placement);
    if (held) points.push(...figureCorners('person', held), ...room(held));
    for (const id of step.focus ?? []) {
      for (const [lx, lz] of [...zoneOutline(ZONES[id]), ZONES[id].anchor]) {
        const w = toWorld(s.horse, lx, lz);
        points.push([w.x, 0, w.z]);
      }
    }
    for (const [x, z] of s.motion?.trail ?? []) points.push([x, s.motion.height, z]);
    // Room around the arrow's tip, so its head is never cut by the frame's edge.
    const tip = s.motion?.trail.at(-1);
    if (tip) for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) points.push([tip[0] + dx * TIP_ROOM, s.motion.height, tip[1] + dz * TIP_ROOM]);
  }
  const xs = points.map((p) => p[0]);
  const zs = points.map((p) => p[2]);
  // The heading a following view faces: the end pose's, or for a turn a little past the end heading,
  // chosen on 2026-10-24 by a search over headings and heights against the turn criteria (see the case
  // design): the end horse broadside, both heads apart, both persons in sight, the head path off the
  // horse and its arrowhead off every figure and away from the person's feet, at 1280, 1024 and 360 px.
  const [h0, h1] = [start, end].map((t) => sceneState(seq, t, { step: index }).horse.heading);
  const turns = Math.abs(h1 - h0) > 1;
  const heading = turns ? h0 + (h1 - h0) * TURN_SHARE : h1;
  return { minX: Math.min(...xs) - margin, maxX: Math.max(...xs) + margin, minZ: Math.min(...zs) - margin, maxZ: Math.max(...zs) + margin, points, heading, turns };
}

/** One region holding every step's region, so a lesson run keeps one frame. */
export function lessonFrame(frames) {
  return {
    minX: Math.min(...frames.map((f) => f.minX)), maxX: Math.max(...frames.map((f) => f.maxX)),
    minZ: Math.min(...frames.map((f) => f.minZ)), maxZ: Math.max(...frames.map((f) => f.maxZ)),
    points: frames.flatMap((f) => f.points),
    // A lesson run keeps the presets' own direction, so the camera does not swing between steps.
    heading: 0,
  };
}

// Playback holds the step the scene is bound to, the time within it, whether
// it plays and whether it runs on through the lesson. A chosen step rests at
// its end, so the scene shows what the rule asks for. Playing a step runs it
// from its start to its end; playing the lesson runs on through every step.

/** A chosen step, paused at its end. */
export function openStep(seq, index) {
  const step = clamp(index, 0, seq.steps.length - 1);
  return { step, time: stepBounds(seq, step).end, playing: false, through: false };
}

/** Plays the bound step from where it rests; from its end it starts again. */
export function playStep(seq, playback) {
  const { start, end } = stepBounds(seq, playback.step);
  return { step: playback.step, time: playback.time >= end ? start : playback.time, playing: true, through: false };
}

/** The whole lesson from the start; without motion the first step rests at its end. */
export function restart(seq, playing = true) {
  return playing ? { step: 0, time: 0, playing: true, through: true } : openStep(seq, 0);
}

/** Continues a paused lesson run, or plays the bound step. */
export function resume(seq, playback) {
  return playback.through ? { ...playback, playing: true } : playStep(seq, playback);
}

export function pause(playback) {
  return { ...playback, playing: false };
}

/**
 * Advances playback by dtSeconds at the given speed. A step run stops at the
 * step's end. A lesson run moves on to the step covering the new time and,
 * at the end of the lesson, rests at the end of the last step.
 */
export function advance(seq, playback, dtSeconds, speed) {
  if (!playback.playing) return playback;
  const time = playback.time + dtSeconds * speed;
  if (!playback.through) {
    const { end } = stepBounds(seq, playback.step);
    return time >= end ? { ...playback, time: end, playing: false } : { ...playback, time };
  }
  if (time >= totalDuration(seq)) return openStep(seq, seq.steps.length - 1);
  return { step: stepAt(seq, time), time, playing: true, through: true };
}

/** Which step actions exist: none before the first step, none after the last. */
export function stepActions(seq, playback) {
  return { previous: playback.step > 0, next: playback.step < seq.steps.length - 1 };
}

/** Share of each step played, from 0 to 1: earlier steps full, later ones empty, the bound step by its time. */
export function segmentFill(seq, playback) {
  const { start } = stepBounds(seq, playback.step);
  return seq.steps.map((step, i) => {
    if (i !== playback.step) return i < playback.step ? 1 : 0;
    return clamp((playback.time - start) / step.duration, 0, 1);
  });
}

// Frame gaps longer than this are interruptions (hidden tab, a blocked main
// thread), not elapsed sequence time; ordinary slow frames keep real time.
const MAX_FRAME_GAP = 0.5;

/** Seconds of sequence time a frame may advance, given the wall-clock gap in ms. */
export function frameDelta(gapMs) {
  const seconds = gapMs / 1000;
  return seconds > 0 && seconds <= MAX_FRAME_GAP ? seconds : 0;
}

/** German error messages for the lesson list, empty when it names at least one lesson by unique id. */
export function validateLessonIndex(index) {
  if (!isObject(index) || !Array.isArray(index.lessons) || index.lessons.length === 0) return ['Die Lektionsliste enthält keine Lektion.'];
  const errors = [];
  index.lessons.forEach((id, i) => {
    if (typeof id !== 'string' || !ID.test(id)) errors.push(`Lektion ${i + 1} hat keine gültige Kennung.`);
    else if (index.lessons.indexOf(id) !== i) errors.push(`Lektion ${id} ist doppelt.`);
  });
  return errors;
}

/**
 * Lesson the address names with ?lesson=, else the first of the list. Only
 * ids from the list are accepted, so the address selects among the prepared
 * lesson files and can never load other data.
 */
export function chooseLesson(index, search) {
  const wanted = new URLSearchParams(search).get('lesson');
  return index.lessons.includes(wanted) ? wanted : index.lessons[0];
}

/** Address of another lesson's overview: view and renderer stay, step and counter-check belong to the old lesson. */
export function lessonAddress(search, id, index) {
  const params = new URLSearchParams(search);
  params.delete('step');
  params.delete('stand');
  params.delete('lesson');
  if (id !== index.lessons[0]) params.set('lesson', id);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Scene state from the address: step (id), view and stand (counter-check).
 * Without a step the address names the lesson overview. Values that do not
 * name a step, a view or a placement are ignored, and a counter-check counts
 * only at a step that offers it, so the address can never load other data or
 * put the scene outside its choices.
 */
export function parseAddress(seq, search) {
  const params = new URLSearchParams(search);
  const out = {};
  const stepIndex = seq.steps.findIndex((s) => s.id === params.get('step'));
  if (stepIndex >= 0) out.stepIndex = stepIndex;
  if (Object.hasOwn(CAMERA_VIEWS, params.get('view'))) out.view = params.get('view');
  if (stepIndex >= 0 && offersCounterCheck(seq.steps[stepIndex]) && Object.hasOwn(PLACEMENTS, params.get('stand'))) out.placement = params.get('stand');
  return out;
}

/**
 * Address search string for a state, keeping unrelated parameters such as renderer.
 * A view is written whenever one is given, because a chosen view must survive a reload
 * even where it equals the default; without one, each step opens in its recommended view.
 */
export function formatAddress(search, { stepId, view, placement }) {
  const params = new URLSearchParams(search);
  for (const key of ['step', 'view', 'stand']) params.delete(key);
  // Fixed order, so the same state always has the same address.
  if (stepId !== undefined) params.append('step', stepId);
  if (view) params.append('view', view);
  if (placement !== PARAMETERS.placement.default) params.append('stand', placement);
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * The passages of a step grouped by source in order of first mention, so a
 * source is named once with all its locators. Locators are joined by commas,
 * or by semicolons when one of them contains a comma itself. A page number
 * keeps its "S." on the same line.
 */
export function groupPassages(passages) {
  const groups = new Map();
  for (const p of passages) {
    if (!groups.has(p.source)) groups.set(p.source, { source: p.source, label: p.label, url: p.url, locators: [] });
    groups.get(p.source).locators.push(p.locator.replace(/\bS\. (?=\d)/g, 'S.\u00a0'));
  }
  return [...groups.values()].map((g) => ({ ...g, locators: g.locators.join(g.locators.some((l) => l.includes(',')) ? '; ' : ', ') }));
}

/** One German sentence for the scene description: where the person stands and whether the rope is held. */
export function describeScene({ zone, rope }) {
  return `Person ${ZONE_INFO[zone].text}${rope ? ', hält den Führstrick' : ''}.`;
}

/** Screen rectangle around projected points; null entries are points the camera cannot see. */
export function boundsOf(projected) {
  const points = projected.filter(Boolean);
  if (points.length === 0) return null;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
}

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
  * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// A label of size (w, h) beside a target box on one side, gap pixels away, kept inside the frame.
function besideBox(box, side, { w, h }, { width, height }, gap) {
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const at = {
    above: [cx - w / 2, box.top - h - gap],
    below: [cx - w / 2, box.bottom + gap],
    right: [box.right + gap, cy - h / 2],
    left: [box.left - w - gap, cy - h / 2],
    'below-right': [box.right + gap, box.bottom + gap],
    'below-left': [box.left - w - gap, box.bottom + gap],
    'above-right': [box.right + gap, box.top - h - gap],
    'above-left': [box.left - w - gap, box.top - h - gap],
  }[side];
  const left = clamp(at[0], 0, Math.max(0, width - w));
  const top = clamp(at[1], 0, Math.max(0, height - h));
  return { left, top, right: left + w, bottom: top + h };
}

// Costs of a label place: a covered pixel of an obstacle outweighs everything else; a pixel of leader
// over a figure costs as much as six pixels of leader on open ground; a pixel of leader costs as much
// as 25 px² of a spared area, so a short leader beats keeping wholly off a zone the step points to.
// `lightly` areas, such as the zone a person's label names, cost a quarter of that.
const WEIGHT = { cover: 1e6, cross: 30, leader: 5, spare: 0.2, lightly: 0.05 };
// How many label heights a label may move away from its target when every closer place is covered.
const LABEL_RINGS = 4;

// Length of the segment from a to b that runs inside the box, shrunk by a pixel so touching does not count (Liang-Barsky).
function inside(a, b, box) {
  const [dx, dy] = [b.x - a.x, b.y - a.y];
  let [t0, t1] = [0, 1];
  for (const [p, q] of [[-dx, a.x - box.left - 1], [dx, box.right - 1 - a.x], [-dy, a.y - box.top - 1], [dy, box.bottom - 1 - a.y]]) {
    if (p === 0) {
      if (q < 0) return 0;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return 0;
    }
  }
  return (t1 - t0) * Math.hypot(dx, dy);
}
// Pixels of a leader that run over the given boxes; overlapping boxes count once per box, which favours open ground.
const over = (a, b, boxes) => boxes.reduce((sum, box) => sum + inside(a, b, box), 0);
const holds = (box, p) => p.x >= box.left && p.x <= box.right && p.y >= box.top && p.y <= box.bottom;

/**
 * Places labels in the given order so that no two cover each other or an
 * obstacle, such as the horse's head. Each item names the projected points of
 * what it labels, its size and the sides it may take in order of preference.
 * The sides are tried next to the target first, then up to three label
 * heights further out. A clear place beats a covered one; among clear places
 * an item with an `anchor`, the point its leader line ends at, weighs how far
 * its leader runs over the `cross` boxes (such as the other figure) and over
 * the `crossOwn` boxes except the one it ends on (the parts of the figure it
 * names), at `crossWeight` per pixel, against the leader's length; otherwise the first
 * clear place in order wins. When none of these is clear, or the best one's
 * leader runs over a figure, a scan of the frame
 * in steps of a quarter label height and an eighth of its width, and flush
 * with the frame's far edges, takes the clear place closest to the target, off the target itself, and
 * only when nothing is clear the least covered place wins, so the result
 * depends only on the input. Returns one rectangle per item, null where nothing of the target is
 * visible. An item marked `inFrame` also gets null when its target lies wholly
 * outside the frame, because a label pushed to the edge would name nothing there.
 * `avoid` lists rectangles only this label keeps clear of, such as the area of
 * the zone it names, `spare` and, weighed less, `lightly` rectangles it covers
 * only where no clear place spares them, weighed by the covered area, and
 * `gap` overrides the distance to the target.
 */
export function arrangeLabels(items, frame, obstacles = [], gap = 4) {
  const taken = [...obstacles];
  return items.map(({ points, size, sides, inFrame, avoid = [], spare = [], lightly = [], gap: own = gap, anchor, cross = [], crossOwn = [], crossWeight = WEIGHT.cross }) => {
    const spared = (rect) => spare.reduce((sum, other) => sum + overlap(rect, other), 0) * WEIGHT.spare
      + lightly.reduce((sum, other) => sum + overlap(rect, other), 0) * WEIGHT.lightly;
    const box = boundsOf(points);
    if (!box) return null;
    if (inFrame && (box.right < 0 || box.left > frame.width || box.bottom < 0 || box.top > frame.height)) return null;
    const crossable = anchor ? [...cross, ...crossOwn.filter((c) => !holds(c, anchor))] : [];
    let best = null;
    for (let ring = 0; ring < LABEL_RINGS; ring++) {
      for (const side of sides) {
        const rect = besideBox(box, side, size, frame, own + ring * size.h);
        const covered = [...taken, ...avoid].reduce((sum, other) => sum + overlap(rect, other), 0);
        let score = covered * WEIGHT.cover + spared(rect);
        let crossing = 0;
        if (anchor) {
          const from = { x: clamp(anchor.x, rect.left, rect.right), y: clamp(anchor.y, rect.top, rect.bottom) };
          crossing = over(from, anchor, crossable);
          score += crossing * crossWeight + Math.hypot(anchor.x - from.x, anchor.y - from.y) * WEIGHT.leader;
        }
        if (!best || score < best.score) best = { rect, score, crossing };
      }
      // Without a leader to weigh, the first clear place in order wins.
      if (!anchor && best.score === 0) break;
    }
    // Nothing near is clear, or its leader runs over a figure: scan the frame for a better clear place before settling.
    if (best.score >= WEIGHT.cover || best.crossing > 0) {
      // A scanned place keeps the label's gap to its target, like the places beside it.
      const near = { left: box.left - own, top: box.top - own, right: box.right + own, bottom: box.bottom + own };
      const centre = anchor ?? { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
      const steps = (span, extent, n) => {
        const out = [];
        for (let v = 0; v + extent <= span; v += extent / n) out.push(v);
        return [...out, Math.max(0, span - extent)];
      };
      for (const top of steps(frame.height, size.h, 4)) {
        for (const left of steps(frame.width, size.w, 8)) {
          const rect = { left, top, right: left + size.w, bottom: top + size.h };
          if ([...taken, ...avoid, near].some((other) => overlap(rect, other) > 0)) continue;
          const from = { x: clamp(centre.x, rect.left, rect.right), y: clamp(centre.y, rect.top, rect.bottom) };
          const score = spared(rect)
            + over(from, centre, crossable) * crossWeight + Math.hypot(centre.x - from.x, centre.y - from.y) * WEIGHT.leader;
          if (score < best.score) best = { rect, score };
        }
      }
    }
    taken.push(best.rect);
    return best.rect;
  });
}

/**
 * Leader line from a label rectangle to the point it names: from the point
 * of the rectangle nearest to the target, so the line stays short. Null when
 * the label already touches the target.
 */
export function leaderLine(rect, target, min = 6) {
  const x1 = clamp(target.x, rect.left, rect.right);
  const y1 = clamp(target.y, rect.top, rect.bottom);
  return Math.hypot(target.x - x1, target.y - y1) < min ? null : { x1, y1, x2: target.x, y2: target.y };
}
