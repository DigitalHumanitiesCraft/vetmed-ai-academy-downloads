import {
  PARAMETERS, CAMERA_VIEWS, PLACEMENTS, ZONE_INFO, STATUS_LABELS, ORIGIN_LABELS, validateSequence,
  sceneState, stepBounds, stepFrame, lessonFrame, offersCounterCheck, recommendedView, groupPassages, leaderLine, pathMarks,
  openStep, playStep, restart, resume, pause, advance, stepActions, segmentFill, frameDelta,
  parseAddress, formatAddress, describeScene, arrangeLabels, boundsOf,
  validateLessonIndex, chooseLesson, lessonAddress,
} from './scene-state.js';
import { FIGURES, ZONES, figureCorners, halterPoint, headCorners, partCorners, partPieces, toWorld, zonePieces, zonePoint, zonesHolding } from './figures.js';
import { createFlatView } from './flat-view.js';
import { icon } from '../../shared/icon.js';

const $ = (id) => document.getElementById(id);
const canvas = $('scene');
const num = (value, digits = 1) => value.toLocaleString('de-AT', { minimumFractionDigits: digits, maximumFractionDigits: digits });

// Figures are data marks in neutral greys, the person in its own dark token;
// zones carry their severity, amber for unsafe and green for the safe place.
// The accent stays with the controls.
const COLOR_TOKENS = {
  ground: '--c-surface',
  grid: '--c-border',
  horse: '--c-data',
  horseDark: '--c-horse-dark',
  ghost: '--c-horse-ghost',
  personGhost: '--c-person-ghost',
  halter: '--c-text',
  person: '--c-person',
  safe: '--c-ok',
  warn: '--c-warn',
};

// Symbol at the person: the safe place and the unsafe zones are marked, a neutral place is not.
const TONE_ICON = { safe: 'circle-check', warn: 'alert-triangle' };

// Where the person's leader line ends: the chest.
const chestOf = (person) => [person.x, 1.3, person.z];
const toWorld3 = (pose, [lx, y, lz]) => {
  const w = toWorld(pose, lx, lz);
  return [w.x, y, w.z];
};
// Cost per pixel of the person's leader over the horse, against 5 per pixel of leader length (see arrangeLabels).
const PERSON_CROSS = 80;
// The person's name keeps this distance from the figure, so the leader line shows.
const FIGURE_GAP = 12;

// Preferred sides of a label, in order: the person's name above the figure, zone
// names below the zone's anchor, then the other sides and the corners.
const CORNERS = ['below-right', 'below-left', 'above-right', 'above-left'];
const FIGURE_SIDES = ['above', 'below', 'right', 'left', ...CORNERS];
const ZONE_SIDES = ['below', 'above', 'right', 'left', ...CORNERS];

// Tokens are oklch; a 2D canvas resolves them to sRGB bytes, which both views
// can consume. The page is light only, so this runs once.
function readColors() {
  const probe = document.createElement('span');
  probe.hidden = true;
  document.body.append(probe);
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 })
    .getContext('2d', { willReadFrequently: true });
  const colors = {};
  for (const [key, token] of Object.entries(COLOR_TOKENS)) {
    probe.style.color = `var(${token})`;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
    colors[key] = { r, g, b, css: `rgb(${r} ${g} ${b})` };
  }
  probe.remove();
  return colors;
}

// One sentence names what failed; several reasons follow as a list, so a data author can work through them.
function showError({ message, reasons = [] }) {
  const box = $('load-error');
  box.replaceChildren(Object.assign(document.createElement('p'), { textContent: message }));
  if (reasons.length) {
    const list = document.createElement('ul');
    list.append(...reasons.map((reason) => Object.assign(document.createElement('li'), { textContent: reason })));
    box.append(list);
  }
  box.hidden = false;
  // Without a sequence there is nothing to show or operate.
  $('lesson-head').hidden = true;
  $('overview').hidden = true;
  $('detail').hidden = true;
}

const invalid = (message, reasons) => Object.assign(new Error(message), { reasons });

const LESSONS = '../data/lessons/';

async function fetchJson(url, name) {
  let response;
  try {
    response = await fetch(url, { cache: 'no-cache' });
  } catch {
    throw new Error(`${name} konnte nicht abgerufen werden.`);
  }
  if (!response.ok) throw new Error(`${name} konnte nicht geladen werden (HTTP ${response.status}).`);
  try {
    return await response.json();
  } catch {
    throw new Error(`${name} ist kein gültiges JSON.`);
  }
}

// The lesson list names the prepared lesson files; the address chooses among them.
async function loadLesson() {
  const index = await fetchJson(`${LESSONS}index.json`, 'Die Lektionsliste');
  const indexErrors = validateLessonIndex(index);
  if (indexErrors.length) throw invalid('Die Lektionsliste ist ungültig.', indexErrors);
  const id = chooseLesson(index, location.search);
  const seq = await fetchJson(`${LESSONS}${id}.json`, 'Die Lektionsdatei');
  const errors = validateSequence(seq);
  if (errors.length === 0 && seq.id !== id) errors.push(`Die Lektion ${id} trägt die Kennung „${seq.id}“.`);
  if (errors.length) throw invalid('Die Lektion ist ungültig.', errors);
  return { index, id, seq };
}

// The other lessons are linked by title on the overview; a single lesson needs no choice.
// A lesson whose file cannot be read is left out rather than linked to an error.
async function showLessons(index, id) {
  const others = index.lessons.filter((other) => other !== id);
  const titles = await Promise.all(others.map((other) => fetchJson(`${LESSONS}${other}.json`, other).then((s) => s?.title, () => null)));
  const items = others.map((other, i) => {
    if (typeof titles[i] !== 'string' || !titles[i].trim()) return null;
    const link = Object.assign(document.createElement('a'), { textContent: titles[i] });
    link.dataset.lesson = other;
    return link;
  }).filter(Boolean);
  if (items.length === 0) return;
  $('lesson-list').append(...items.flatMap((link, i) => (i ? [', ', link] : [link])));
  $('lesson-nav').hidden = false;
  linkLessons(index);
}

// Links to the other lessons carry the current view, so they follow the address.
function linkLessons(index) {
  for (const link of $('lesson-list').querySelectorAll('a')) link.href = `${location.pathname}${lessonAddress(location.search, link.dataset.lesson, index)}`;
}

// The way back from a chosen 2D view keeps the scene address, without the renderer choice.
function linkTo3d() {
  const params = new URLSearchParams(location.search);
  params.delete('renderer');
  $('view-3d').href = `${location.pathname}${params.size ? `?${params}` : ''}`;
}

// ?renderer=2d forces the fallback so it can be checked on WebGL-capable machines.
async function createView(colors, contextEvents) {
  const forced2d = new URLSearchParams(location.search).get('renderer') === '2d';
  if (!forced2d) {
    try {
      const { createThreeView } = await import('./three-view.js');
      return createThreeView(canvas, colors, contextEvents);
    } catch (err) {
      console.warn('WebGL view unavailable, using 2D fallback', err);
    }
  }
  // A chosen 2D view is a neutral mode with a way back; a missing WebGL is a limitation.
  $('fallback-text').textContent = forced2d ? '2D-Draufsicht' : '2D-Draufsicht, WebGL nicht verfügbar';
  $('fallback-mark').classList.toggle('warn', !forced2d);
  $('fallback-mark').hidden = false;
  $('view-3d').hidden = !forced2d;
  linkTo3d();
  // The top view has no camera to choose, so the camera controls are not offered at all.
  $('camera-controls').hidden = true;
  return createFlatView(canvas, colors);
}

function segmentedButtons(container, entries, onChoose) {
  return entries.map(([key, text, name]) => {
    const button = Object.assign(document.createElement('button'), { type: 'button', textContent: text });
    button.dataset.value = key;
    if (name) button.setAttribute('aria-label', name);
    button.addEventListener('click', () => onChoose(key));
    container.append(button);
    return button;
  });
}

// A button group is one tab stop; arrow keys, Home and End move within it and Enter or Space chooses.
function roving(container) {
  container.addEventListener('keydown', (e) => {
    const items = [...container.querySelectorAll('button')];
    const i = items.indexOf(document.activeElement);
    const moves = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 };
    if (i < 0 || !(e.key in moves)) return;
    e.preventDefault();
    const target = items[(moves[e.key] + items.length) % items.length];
    setTabStop(items, target);
    target.focus();
  });
}

function setTabStop(items, active) {
  for (const item of items) item.tabIndex = item === active ? 0 : -1;
}

async function start() {
  let lesson;
  try {
    lesson = await loadLesson();
  } catch (err) {
    showError(err);
    return;
  }
  const { seq } = lesson;
  const count = seq.steps.length;
  const address = parseAddress(seq, location.search);
  const params = {
    speed: PARAMETERS.speed.default,
    view: address.view ?? PARAMETERS.view.default,
    placement: address.placement ?? PARAMETERS.placement.default,
  };
  // A view named in the address or chosen by the person is kept; until then each step opens in its recommended view.
  let viewChosen = Boolean(address.view);
  // A lesson run keeps the default view throughout, so the camera does not switch between steps.
  const openView = (pb) => {
    if (!viewChosen) params.view = pb.through ? PARAMETERS.view.default : recommendedView(seq, pb.step);
  };
  // Only a chosen view goes into the address, so a copied link reopens each step in its recommended view.
  const addressView = () => (viewChosen ? params.view : undefined);

  $('origin-line').textContent = ORIGIN_LABELS[seq.origin];
  $('origin-line').hidden = false;
  $('lesson-name').textContent = seq.title;
  $('to-overview').textContent = seq.title;
  for (const el of document.querySelectorAll('.review-text')) el.textContent = STATUS_LABELS[seq.status];
  await showLessons(lesson.index, lesson.id);

  for (const value of PARAMETERS.speed.values) {
    $('speed').append(Object.assign(document.createElement('option'), { value: String(value), textContent: `${num(value, value % 1 ? 1 : 0)}×`, selected: value === params.speed }));
  }

  // The step bar: one numbered segment per step, proportional to its duration, filled as played.
  const segments = seq.steps.map((step, i) => {
    const seg = Object.assign(document.createElement('button'), { type: 'button', className: 'segment', textContent: String(i + 1) });
    seg.style.flexGrow = String(step.duration);
    seg.setAttribute('aria-label', `Schritt ${i + 1}, ${step.label}`);
    seg.addEventListener('click', () => choose(openStep(seq, i)));
    $('track').append(seg);
    return seg;
  });
  roving($('track'));

  const rules = seq.steps.map((_, i) => {
    const item = document.createElement('li');
    // A rule link opens its step in place, like a segment of the step bar.
    item.addEventListener('click', (e) => {
      if (!e.target.closest('a.link-text')) return;
      e.preventDefault();
      choose(openStep(seq, i));
    });
    $('rules').append(item);
    return item;
  });

  const viewButtons = segmentedButtons($('view'), Object.entries(CAMERA_VIEWS).map(([k, v]) => [k, v.short, v.label]), (key) => setView(key));
  roving($('view'));
  // The counter-check holds the person at a place while it is pressed; pressing it again returns to the rule.
  const placementButtons = segmentedButtons($('placement'), Object.entries(PLACEMENTS).filter(([k]) => k !== 'sequence')
    .map(([k, p]) => [k, p.label, `Person ${p.text}`]), (key) => setPlacement(params.placement === key ? 'sequence' : key));
  roving($('placement'));

  const zoneLabels = new Map(Object.entries(ZONES).map(([id, zone]) => {
    const el = Object.assign(document.createElement('span'), { className: `scene-label zone-label tone-${zone.tone}`, textContent: zone.label, hidden: true });
    el.dataset.zone = id;
    $('zone-labels').append(el);
    return [id, el];
  }));

  // Each step's region, and their union for a run through the whole lesson.
  const frames = seq.steps.map((_, i) => stepFrame(seq, i));
  const runFrame = lessonFrame(frames);

  // Read at each use, so a preference changed during the session applies to the next start.
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const colors = readColors();

  // Overview tiles: each step's end as a small top view, its number and its rule.
  const tiles = seq.steps.map((step, i) => {
    const item = document.createElement('li');
    const link = Object.assign(document.createElement('a'), { className: 'tile' });
    link.dataset.step = String(i);
    const picture = Object.assign(document.createElement('canvas'), { className: 'tile-scene' });
    picture.setAttribute('aria-hidden', 'true');
    link.append(picture,
      Object.assign(document.createElement('span'), { className: 'tile-number', textContent: String(i + 1) }),
      Object.assign(document.createElement('span'), { className: 'tile-rule link-text', textContent: step.label }));
    link.addEventListener('click', (e) => {
      e.preventDefault();
      history.pushState(null, '', addressFor(i));
      showDetail(i);
      $('play-toggle').focus();
    });
    item.append(link);
    $('step-tiles').append(item);
    const flat = createFlatView(picture, colors);
    const endState = sceneState(seq, stepBounds(seq, i).end, { step: i });
    new ResizeObserver(([entry]) => {
      const { inlineSize, blockSize } = entry.contentBoxSize[0];
      if (inlineSize < 1 || blockSize < 1) return;
      flat.resize(Math.round(inlineSize), Math.round(blockSize));
      flat.render(endState, null, frames[i]);
    }).observe(picture);
    return link;
  });

  let contextLost = false;
  const view = await createView(colors, {
    onLost() {
      contextLost = true;
      if (playback.playing) playback = pause(playback);
      const target = new URLSearchParams(formatAddress(location.search, addressState()));
      target.set('renderer', '2d');
      $('context-2d').href = `?${target}`;
      $('context-notice').hidden = false;
      announce('3D-Darstellung unterbrochen');
      renderScene();
      syncControls();
    },
    onRestored() {
      contextLost = false;
      $('context-notice').hidden = true;
      announce('3D-Darstellung wiederhergestellt');
      renderScene();
      syncControls();
    },
  });

  let mode = 'overview';
  let playback = openStep(seq, address.stepIndex ?? 0);
  let state = null;
  let shown = { step: -1, playing: null, through: null, zone: null, cue: null };
  let rafId = null;
  let lastFrame = null;

  const personLabel = $('label-person');

  function announce(text) {
    $('announce').textContent = text;
  }

  function addressFor(stepIndex) {
    const atStep = stepIndex !== null && stepIndex !== undefined;
    return `${location.pathname}${formatAddress(location.search, {
      stepId: atStep ? seq.steps[stepIndex].id : undefined,
      view: addressView(),
      placement: atStep ? params.placement : PARAMETERS.placement.default,
    })}`;
  }

  // Another step opens with the person on the rule's path, so its link carries no counter-check.
  function stepHref(stepIndex) {
    return `${location.pathname}${formatAddress(location.search, { stepId: seq.steps[stepIndex].id, view: addressView(), placement: PARAMETERS.placement.default })}`;
  }

  function addressState() {
    return { stepId: mode === 'step' ? state.stepId : undefined, view: addressView(), placement: params.placement };
  }

  const project = (points) => points.map((p) => view.project(p));
  let obstacles = [];
  // Projected areas of the named zones and of the horse, for the snapshot.
  let zoneAreas = {};
  let horseBox = null;
  // Projected boxes of the horse's parts, which no label covers, and the leader lines drawn.
  let horseParts = [];
  let leaders = [];
  let motionMarks = [];
  let walkLine = [];
  let ghostParts = [];
  let labelInput = null;
  let standsIn = [];

  // Bands at the top and bottom of the canvas that controls cover, so the views fit the step into the rest.
  function frameInsets() {
    const frame = canvas.getBoundingClientRect();
    const gap = 6;
    let top = 0;
    let bottom = 0;
    for (const el of document.querySelectorAll('.scene-frame .frame-control')) {
      if (el.hidden || !el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.top - frame.top < frame.height / 2) top = Math.max(top, r.bottom - frame.top + gap);
      else bottom = Math.max(bottom, frame.bottom - r.top + gap);
    }
    return { top, bottom };
  }

  // Canvas rectangles of the controls laid over the scene; no label may hide under them.
  function controlRects() {
    const frame = canvas.getBoundingClientRect();
    return [...document.querySelectorAll('.scene-frame .frame-control')].filter((el) => !el.hidden && el.getClientRects().length).map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left - frame.left, top: r.top - frame.top, right: r.right - frame.left, bottom: r.bottom - frame.top };
    });
  }

  // Labels are placed one after another so that none covers another label, the
  // horse's body, the person or a control in the frame: the person first, then
  // the zones the step points to. Other zones stay unnamed, and the horse needs
  // no name. A short leader line runs from each label to what it names.
  function placeLabels() {
    zoneAreas = {};
    leaders = [];
    for (const el of [personLabel, ...zoneLabels.values()]) el.hidden = contextLost;
    $('leaders').replaceChildren();
    if (contextLost) return;
    const pieces = partPieces('horse', state.horse).map((part) => part.map((c) => boundsOf(project(c))).filter(Boolean));
    horseParts = pieces.flat();
    horseBox = boundsOf(horseParts.flatMap((r) => [{ x: r.left, y: r.top }, { x: r.right, y: r.bottom }]));
    const zoneItems = [];
    for (const [id, el] of zoneLabels) {
      // The person's own label already names the zone the person stands in.
      el.hidden = !state.focus.includes(id) || id === state.zone;
      // A zone's name keeps clear of the zone's own area, so it never hides what it names.
      if (!el.hidden) {
        const area = zonePieces(ZONES[id]).map((piece) => boundsOf(project(piece.map((p) => zonePoint(state.horse, p))))).filter(Boolean);
        zoneAreas[id] = area;
        const anchor = zonePoint(state.horse, ZONES[id].anchor);
        zoneItems.push({ el, points: project([anchor]), anchor, sides: ZONE_SIDES, inFrame: true, avoid: area, tone: ZONES[id].tone });
      }
    }
    // The person's label names the zone the person stands in, so it may lie on that zone where a free place costs a longer leader.
    // Every zone the person stands in counts, also where zones overlap, such as the kick zone over the rear blind spot.
    standsIn = zonesHolding(state.horse, state.person).filter((id) => state.focus.includes(id));
    const personZones = Object.entries(zoneAreas).filter(([id]) => !standsIn.includes(id)).flatMap(([, area]) => area);
    const ownZone = standsIn.flatMap((id) => zonePieces(ZONES[id]).map((piece) => boundsOf(project(piece.map((p) => zonePoint(state.horse, p))))).filter(Boolean));
    const items = [
      // The person's name keeps off the other zones the step is about, unless a crowded frame leaves no other place.
      { el: personLabel, points: project(figureCorners('person', state.person)), anchor: chestOf(state.person), sides: FIGURE_SIDES, gap: FIGURE_GAP, tone: 'figure', spare: personZones, lightly: ownZone },
      ...zoneItems,
    ];
    // Fractional sizes, so a label clamped to the frame's edge stays inside it.
    for (const item of items) {
      const { width, height } = item.el.getBoundingClientRect();
      item.size = { w: width, h: height };
    }
    obstacles = [
      ...[headCorners(state.horse), figureCorners('person', state.person)].map((c) => boundsOf(project(c))).filter(Boolean),
      ...controlRects(),
    ];
    // The ring, the dashes and the arrowhead of the walk and the head of the horse's arrow show the movement; no label hides them.
    const around = (x, y, z, r) => boundsOf(project([[x - r, y, z - r], [x + r, y, z - r], [x - r, y, z + r], [x + r, y, z + r]]));
    const walk = pathMarks(state.path);
    const trailEnd = state.motion?.trail.at(-1);
    motionMarks = [walk?.tip && around(walk.from.x, 0, walk.from.z, 0.25), walk?.tip && around(walk.tip.x, 0, walk.tip.z, 0.3),
      trailEnd && around(trailEnd[0], state.motion.height, trailEnd[1], 0.3)].filter(Boolean);
    // The pale start horse is spared where a clear place exists, but a crowded frame may lay a name on it.
    ghostParts = state.motion ? partCorners('horse', state.motion.from).map((c) => boundsOf(project(c))).filter(Boolean) : [];
    walkLine = [];
    if (walk?.tip) {
      for (let s = 0; s <= walk.reach; s += 0.35) walkLine.push(around(walk.from.x + walk.dir.x * s, 0, walk.from.z + walk.dir.z * s, 0.08));
    }
    // The horse's arrow, sampled along its path, counts like the walk line.
    for (const [x, z] of state.motion?.trail ?? []) walkLine.push(around(x, state.motion.height, z, 0.1));
    walkLine = walkLine.filter(Boolean);
    const personBox = obstacles[1];
    for (const item of items) {
      item.spare = [...(item.spare ?? []), ...ghostParts];
      item.anchor = view.project(item.anchor);
      // A leader line should run across neither figure. The person's leader across the horse reads as pointing at the horse, so it weighs most.
      if (item.el === personLabel) Object.assign(item, { cross: horseParts, crossWeight: PERSON_CROSS });
      else item.cross = [...horseParts, personBox];
    }
    const rects = arrangeLabels(items, { width: canvas.clientWidth, height: canvas.clientHeight }, [...obstacles, ...horseParts, ...motionMarks, ...walkLine]);
    // The placement's input without the elements, so a check can recompute or inspect a placement.
    labelInput = { items: items.map(({ el, ...rest }) => ({ ...rest, id: el.dataset.zone ?? el.id })), frame: { width: canvas.clientWidth, height: canvas.clientHeight }, obstacles: [...obstacles, ...horseParts, ...motionMarks, ...walkLine] };
    items.forEach(({ el, anchor, tone }, i) => {
      el.hidden = !rects[i];
      if (!rects[i]) return;
      Object.assign(el.style, { left: `${rects[i].left}px`, top: `${rects[i].top}px` });
      const line = anchor && leaderLine(rects[i], anchor);
      if (line) drawLeader(el.dataset.zone ?? el.id, line, tone);
    });
  }

  function drawLeader(label, line, tone) {
    leaders.push({ label, ...line });
    const svg = (name, attrs) => {
      const node = document.createElementNS('http://www.w3.org/2000/svg', name);
      for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, typeof v === 'number' ? v.toFixed(1) : v);
      return node;
    };
    $('leaders').append(
      svg('line', { x1: line.x1, y1: line.y1, x2: line.x2, y2: line.y2, class: `leader tone-${tone}` }),
      svg('circle', { cx: line.x2, cy: line.y2, r: 2.5, class: `leader-end tone-${tone}` }),
    );
  }

  // The person label carries the zone reading: a symbol for the safe place and unsafe zones, and the place in words.
  function showZone() {
    const info = ZONE_INFO[state.zone];
    $('label-person').dataset.tone = info.tone;
    $('person-mark').innerHTML = TONE_ICON[info.tone] ? icon(TONE_ICON[info.tone]) : '';
    $('person-zone').textContent = info.text;
    $('person-cue').textContent = state.cue;
    $('person-cue').hidden = !state.cue;
  }

  // A lesson run keeps one frame for the whole lesson, so the camera does not jump at each step.
  // A counter-check widens the step's frame by the person held there, computed once per step and place.
  const heldFrames = new Map();
  const frameFor = (pb) => {
    if (pb.through) return runFrame;
    if (params.placement === PARAMETERS.placement.default) return frames[pb.step];
    const key = `${pb.step} ${params.placement}`;
    if (!heldFrames.has(key)) heldFrames.set(key, stepFrame(seq, pb.step, undefined, params.placement));
    return heldFrames.get(key);
  };

  // Every frame: the picture, the labels that follow it and the step bar.
  function renderScene() {
    state = sceneState(seq, playback.time, { placement: params.placement, step: playback.step });
    if (mode !== 'step') return;
    // Controls first: the view keeps the figures out of the bands they cover, and the labels keep clear of them.
    // A lesson run moves the person across the frame, so the counter-check, which ends with the step anyway, is hidden.
    const counter = !contextLost && !playback.through && offersCounterCheck(seq.steps[state.stepIndex]);
    if ($('counter-check').hidden === counter) $('counter-check').hidden = $('zone-note').hidden = !counter;
    const views = !contextLost && view.kind === 'webgl';
    if ($('camera-controls').hidden === views) $('camera-controls').hidden = !views;
    view.render(state, params.view, frameFor(playback), frameInsets());
    if (state.zone !== shown.zone || state.cue !== shown.cue) {
      showZone();
      shown.zone = state.zone;
      shown.cue = state.cue;
    }
    placeLabels();
    segmentFill(seq, playback).forEach((f, i) => segments[i].style.setProperty('--fill', String(f)));
  }

  // The rule list: every other rule is a link to its step, the current one is plain text
  // followed by its reason and, in one quiet line, its sources with the passages.
  function showCaption() {
    const hadFocus = $('rules').contains(document.activeElement);
    rules.forEach((item, i) => {
      if (i !== state.stepIndex) {
        item.removeAttribute('aria-current');
        const link = Object.assign(document.createElement('a'), { className: 'link-text', href: stepHref(i), textContent: seq.steps[i].label });
        link.dataset.step = String(i);
        item.replaceChildren(link);
        return;
      }
      item.setAttribute('aria-current', 'step');
      item.replaceChildren(Object.assign(document.createElement('span'), { id: 'step-rule', className: 'rule', textContent: state.stepLabel, tabIndex: -1 }));
      if (state.why) item.append(Object.assign(document.createElement('p'), { className: 'why', textContent: state.why }));
      // Each source with the passage the rule rests on, so rule and text can be compared.
      if (state.passages.length) {
        const sources = Object.assign(document.createElement('p'), { className: 'sources' });
        sources.append(...groupPassages(state.passages).flatMap(({ label, url, locators }, i) => [
          ...(i ? [', '] : []),
          Object.assign(document.createElement('a'), { href: url, textContent: label, target: '_blank', rel: 'noopener' }),
          ` (${locators})`,
        ]));
        item.append(sources);
      }
    });
    // A rule chosen from the list gives way to plain text, so the focus moves onto it instead of being lost.
    if (hadFocus) $('step-rule').focus();
    $('step-text').textContent = `Schritt ${state.stepIndex + 1} von ${count}. ${state.stepLabel}. ${state.why}`;
  }

  // Runs on deliberate changes; during playback only when step or playing state changes, so the DOM is not rewritten per frame.
  function syncControls(writeAddress = true) {
    const stepChanged = state.stepIndex !== shown.step;
    if (stepChanged) {
      // All segments, because opening a step from the overview starts without a shown step.
      for (const seg of segments) seg.removeAttribute('aria-current');
      shown.step = state.stepIndex;
      segments[shown.step].setAttribute('aria-current', 'step');
      setTabStop(segments, segments[shown.step]);
      showCaption();
    }
    if (playback.playing !== shown.playing || playback.through !== shown.through) {
      const text = playback.playing ? 'Anhalten' : playback.through ? 'Fortsetzen' : 'Schritt abspielen';
      $('play-toggle').innerHTML = `${icon(playback.playing ? 'pause' : 'play')}<span>${text}</span>`;
    }
    const stateChanged = stepChanged || playback.playing !== shown.playing;
    shown = { ...shown, playing: playback.playing, through: playback.through };
    // The place is described when the step changes and when playback rests, never per frame.
    if (stateChanged || !playback.playing) $('scene-text').textContent = describeScene(state);
    // No renderer draws after a lost context: playback waits, the rule and the way to the 2D view stay.
    for (const id of ['play-toggle', 'restart', 'prev-step', 'next-step', 'speed']) $(id).disabled = contextLost;
    const actions = stepActions(seq, playback);
    $('prev-step').setAttribute('aria-disabled', String(!actions.previous));
    $('next-step').setAttribute('aria-disabled', String(!actions.next));
    for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.value === params.view));
    setTabStop(viewButtons, viewButtons.find((b) => b.dataset.value === params.view));
    for (const button of placementButtons) button.setAttribute('aria-pressed', String(button.dataset.value === params.placement));
    setTabStop(placementButtons, placementButtons.find((b) => b.dataset.value === params.placement) ?? placementButtons[0]);
    if (writeAddress && !playback.playing && mode === 'step') {
      history.replaceState(null, '', addressFor(playback.step));
      linkTo3d();
      linkLessons(lesson.index);
      for (const link of $('rules').querySelectorAll('a.link-text')) link.href = stepHref(Number(link.dataset.step));
    }
  }

  // The counter-check belongs to one step and is released when the step changes.
  function enterStep(next) {
    if (next.step !== playback.step) params.placement = PARAMETERS.placement.default;
  }

  function frame(now) {
    if (lastFrame !== null) {
      const next = advance(seq, playback, frameDelta(now - lastFrame), params.speed);
      enterStep(next);
      playback = next;
    }
    lastFrame = now;
    const wasPlaying = shown.playing;
    renderScene();
    if (state.stepIndex !== shown.step || playback.playing !== shown.playing || playback.through !== shown.through) syncControls();
    if (wasPlaying && !playback.playing) {
      announce(`${state.ended ? 'Ende der Lektion' : `Schritt ${state.stepIndex + 1} abgespielt`}. ${$('scene-text').textContent}`);
    }
    rafId = playback.playing ? requestAnimationFrame(frame) : null;
    if (!rafId) lastFrame = null;
  }

  function update(next, writeAddress = true) {
    enterStep(next);
    if (next.step !== playback.step || next.through !== playback.through) openView(next);
    playback = next;
    if (playback.playing && rafId === null) {
      lastFrame = null;
      rafId = requestAnimationFrame(frame);
    }
    renderScene();
    if (mode === 'step') syncControls(writeAddress);
  }

  // A deliberate change of step: rest at its end and say which rule is shown and where the person stands.
  function choose(next) {
    update(next);
    announce(`Schritt ${state.stepIndex + 1} von ${count}. ${state.stepLabel}. ${state.why} ${$('scene-text').textContent}`);
  }

  function setView(key) {
    viewChosen = true;
    params.view = key;
    renderScene();
    syncControls();
  }

  function setPlacement(key) {
    params.placement = key;
    renderScene();
    syncControls();
    announce(`${key === 'sequence' ? 'Person nach der Regel' : `Gegenprobe, Person ${PLACEMENTS[key].text}`}. ${describeScene(state)}`);
  }

  // The lesson line names the lesson on the overview and leads back to it from a step.
  function showLessonHead(atStep) {
    $('lesson-head').hidden = false;
    $('lesson-name').hidden = atStep;
    $('to-overview').hidden = !atStep;
    $('play-lesson').hidden = atStep;
  }

  function showOverview(focusStep) {
    if (playback.playing) playback = pause(playback);
    mode = 'overview';
    showLessonHead(false);
    $('detail').hidden = true;
    $('overview').hidden = false;
    linkLessons(lesson.index);
    // The tile of the step just left keeps the focus, so the way back keeps the place.
    if (focusStep !== undefined) tiles[focusStep]?.focus();
  }

  function showDetail(index, { placement = PARAMETERS.placement.default, next = openStep(seq, index) } = {}) {
    mode = 'step';
    showLessonHead(true);
    $('overview').hidden = true;
    $('detail').hidden = false;
    params.placement = offersCounterCheck(seq.steps[index]) ? placement : PARAMETERS.placement.default;
    shown = { ...shown, step: -1, playing: null, through: null, zone: null };
    playback = next;
    openView(playback);
    if (playback.playing && rafId === null) {
      lastFrame = null;
      rafId = requestAnimationFrame(frame);
    }
    renderScene();
    syncControls();
    announce(`Schritt ${state.stepIndex + 1} von ${count}. ${state.stepLabel}. ${state.why} ${$('scene-text').textContent}`);
  }

  // The address decides the view: no step is the overview, a step its detail.
  function route() {
    const at = parseAddress(seq, location.search);
    params.view = at.view ?? PARAMETERS.view.default;
    viewChosen = Boolean(at.view);
    if (at.stepIndex === undefined) showOverview(mode === 'step' ? playback.step : undefined);
    else showDetail(at.stepIndex, { placement: at.placement });
  }
  addEventListener('popstate', route);

  for (const link of tiles) link.href = addressFor(Number(link.dataset.step));
  $('to-overview').href = addressFor(null);
  $('to-overview').addEventListener('click', (e) => {
    e.preventDefault();
    const left = playback.step;
    history.pushState(null, '', addressFor(null));
    showOverview(left);
  });
  $('play-lesson').addEventListener('click', () => {
    history.pushState(null, '', addressFor(0));
    showDetail(0, { next: restart(seq, !reducedMotion.matches) });
    announce(playback.playing ? 'Lektion wird abgespielt' : `${$('step-text').textContent} ${$('scene-text').textContent}`);
    $('play-toggle').focus();
  });

  $('play-toggle').addEventListener('click', () => {
    if (playback.playing) {
      update(pause(playback));
      announce(`Angehalten in Schritt ${state.stepIndex + 1}. ${$('scene-text').textContent}`);
    } else {
      update(resume(seq, playback));
      announce(playback.through ? 'Lektion wird abgespielt' : 'Schritt wird abgespielt');
    }
  });
  $('restart').addEventListener('click', () => {
    update(restart(seq, !reducedMotion.matches));
    announce(playback.playing ? 'Lektion von vorn, Wiedergabe läuft' : `Zurück zu Schritt 1. ${$('scene-text').textContent}`);
  });
  // aria-disabled keeps the focused button focused at an edge; the click is then ignored.
  $('prev-step').addEventListener('click', () => {
    if (stepActions(seq, playback).previous) choose(openStep(seq, playback.step - 1));
  });
  $('next-step').addEventListener('click', () => {
    if (stepActions(seq, playback).next) choose(openStep(seq, playback.step + 1));
  });
  $('speed').addEventListener('change', (e) => {
    params.speed = Number(e.target.value);
  });

  // A hidden tab stops frames; the first frame after it must not count the gap.
  document.addEventListener('visibilitychange', () => { lastFrame = null; });

  new ResizeObserver(([entry]) => {
    const { inlineSize, blockSize } = entry.contentBoxSize[0];
    if (inlineSize < 1 || blockSize < 1) return;
    view.resize(Math.round(inlineSize), Math.round(blockSize));
    renderScene();
  }).observe(canvas);

  // How a turn reads in the current view: the neck's steepness on screen, how far apart the two heads
  // project, whether each person is seen past the horses, how much of the arc lies off the horse,
  // whether the arrowhead lies on a figure and how far it stands from the person's feet. A point counts as hidden behind a horse when it falls into a
  // piece's screen box and the piece's centre is nearer the camera.
  function turnReading() {
    const eye = view.camera();
    const horses = [state.horse, state.motion.from].flatMap((pose) => partPieces('horse', pose).flat())
      .map((c) => ({ box: boundsOf(project(c)), centre: [0, 1, 2].map((i) => c.reduce((s, p) => s + p[i], 0) / c.length) }));
    const distance = (p) => (eye ? Math.hypot(p[0] - eye[0], p[1] - eye[1], p[2] - eye[2]) : 0);
    const hidden = (p) => {
      const q = view.project(p);
      if (!q || !eye) return false;
      return horses.some(({ box, centre }) => box && q.x > box.left && q.x < box.right && q.y > box.top && q.y < box.bottom && distance(centre) < distance(p) - 0.2);
    };
    const seen = (pose) => [0.8, 1.2, 1.7].filter((y) => !hidden([pose.x, y, pose.z])).length >= 2;
    const [pivot, ring] = [view.project(toWorld3(state.horse, FIGURES.horse.neck.pivot)), view.project(halterPoint(state.horse))];
    const angle = Math.abs(Math.atan2(ring.y - pivot.y, ring.x - pivot.x) * 180 / Math.PI);
    const [h0, h1] = [view.project(halterPoint(state.motion.from)), view.project(halterPoint(state.horse))];
    const trail = state.motion.trail.map(([x, z]) => view.project([x, 0, z]));
    const inside = (p, r) => r && p.x > r.left && p.x < r.right && p.y > r.top && p.y < r.bottom;
    const figures = [...horses.map((h) => h.box), boundsOf(project(figureCorners('person', state.person))), boundsOf(project(figureCorners('person', state.motion.person)))];
    const tip = trail.at(-1);
    return {
      neckSlope: Math.min(angle, 180 - angle),
      headsApart: Math.hypot(h1.x - h0.x, h1.y - h0.y),
      personSeen: seen(state.person),
      startPersonSeen: seen(state.motion.person),
      arcOff: trail.filter((p) => !horseParts.some((r) => inside(p, r))).length / trail.length,
      tipOnFigure: figures.some((r) => inside(tip, r)),
      // How far the arrowhead stands from the solid person's feet, so it does not read as the person's walk.
      tipToFeet: (() => { const f = view.project([state.person.x, 0, state.person.z]); return Math.hypot(tip.x - f.x, tip.y - f.y); })(),
    };
  }

  // Read-only snapshot for automated browser checks.
  window.equineScene = {
    snapshot: () => structuredClone({
      renderer: view.kind,
      lesson: lesson.id,
      mode,
      playback,
      params,
      contextLost,
      stepIndex: state.stepIndex,
      stepId: state.stepId,
      stepLabel: state.stepLabel,
      zone: state.zone,
      rope: state.rope,
      focus: state.focus,
      path: state.path,
      // Canvas point where the person's path starts, to check it stays in view.
      pathStart: state.path ? view.project([state.path.from.x, 0, state.path.from.z]) : null,
      canvasSize: [canvas.clientWidth, canvas.clientHeight],
      horse: state.horse,
      person: state.person,
      camera: view.camera(),
      cameraTarget: view.target(),
      // Canvas rectangles the labels keep clear of: the horse's head, the person and the controls in the frame.
      labelObstacles: obstacles,
      zoneAreas,
      horseBox,
      horseParts,
      leaders,
      motionMarks,
      walkLine,
      ghostParts,
      labelInput,
      // The zones the step points to that hold the person, which the person's label may lie on.
      standsIn,
      motion: state.motion,
      // Canvas points of the neck, from its pivot to the halter ring, and of the horse's movement arrow.
      neckLine: [view.project(toWorld3(state.horse, FIGURES.horse.neck.pivot)), view.project(halterPoint(state.horse))],
      trailScreen: (state.motion?.trail ?? []).map(([x, z]) => view.project([x, state.motion.height, z])),
      // Canvas points of the halter ring where the step began and where it ends.
      heads: state.motion ? [view.project(halterPoint(state.motion.from)), view.project(halterPoint(state.horse))] : null,
      // The readings a turn's still is chosen and checked by (see turnReading).
      turn: state.motion?.ground ? turnReading() : null,
      // The rope and the arm holding it as the view drew them, with the resting arm's visibility.
      held: view.held(),
      // The 3D scene clears to the ground colour, so the ground never ends inside the frame.
      sceneBackground: colors.ground.css,
    }),
  };

  // Enabled only now that every handler is bound and the view exists.
  for (const el of document.querySelectorAll('main :is(button, input, select)')) el.disabled = false;
  state = sceneState(seq, playback.time, { step: playback.step });
  if (address.stepIndex === undefined) showOverview();
  else showDetail(address.stepIndex, { placement: address.placement });
}

start();
