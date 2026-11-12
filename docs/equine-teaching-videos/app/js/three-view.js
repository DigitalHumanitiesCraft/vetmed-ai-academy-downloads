// WebGL view of the scene state. Figures are stylised from capsules, tapered
// cylinders and spheres, readable as horse and person without reading as an
// anatomical model; their parts and the ground zones come from figures.js,
// which the 2D view shares.
import * as THREE from 'three';
import { CAMERA_VIEWS, pathMarks } from './scene-state.js';
import { FIGURES, ZONES, ZONE_STYLE, isHatched, ropeArm, ropePoints, zoneOutline } from './figures.js';

const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
// Height factor of the following view in a turning step, about 30 degrees down instead of 42.
const TURN_LIFT = 0.64;

function toColor({ r, g, b }) {
  return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
}

function geometryOf(part) {
  if (part.shape === 'box') return new THREE.BoxGeometry(...part.size);
  if (part.shape === 'sphere') return new THREE.SphereGeometry(part.radius, 24, 16);
  if (part.shape === 'capsule') return new THREE.CapsuleGeometry(part.radius, part.length, 6, part.segments);
  return new THREE.CylinderGeometry(part.radiusTop ?? part.radius, part.radiusBottom ?? part.radius, part.length, part.segments);
}

function meshes(parts, materials) {
  return parts.map((part) => {
    const m = new THREE.Mesh(geometryOf(part), materials[part.tone ?? 'body'] ?? materials.body);
    m.position.set(...part.at);
    m.rotation.z = part.tilt ?? 0;
    if (part.scale) m.scale.set(...part.scale);
    m.castShadow = true;
    m.userData.holdsRope = Boolean(part.holdsRope);
    return m;
  });
}

/**
 * A figure as a three.js group with one mesh per part of figures.js; the
 * horse's neck parts hang from a pivot group. `materials` maps a part tone to
 * its material, and a tone without one takes the body material.
 */
export function buildFigure(name, material, materials = {}) {
  const def = FIGURES[name];
  const all = { ...materials, body: material };
  const root = new THREE.Group();
  root.add(...meshes(def.parts, all));
  let neck = null;
  if (def.neck) {
    neck = new THREE.Group();
    neck.position.set(...def.neck.pivot);
    neck.add(...meshes(def.neck.parts, all));
    root.add(neck);
  }
  return { root, neck };
}

function canvasTexture(size, draw) {
  const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size });
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Diagonal stripes on a clear ground, tinted by the zone colour; rising and
// falling stripes tell the blind spots from the kick zone.
function hatchTexture(direction) {
  const texture = canvasTexture(64, (g, size) => {
    g.strokeStyle = '#fff';
    g.lineWidth = size * 0.3;
    g.beginPath();
    for (const k of [-size, 0, size]) {
      if (direction === 'rising') {
        g.moveTo(k, size);
        g.lineTo(k + size, 0);
      } else {
        g.moveTo(k, 0);
        g.lineTo(k + size, size);
      }
    }
    g.stroke();
  });
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

// A soft dark blot that grounds a figure where it touches the floor.
function contactTexture() {
  return canvasTexture(128, (g, size) => {
    const gradient = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, 'rgb(0 0 0 / 0.38)');
    gradient.addColorStop(0.55, 'rgb(0 0 0 / 0.16)');
    gradient.addColorStop(1, 'rgb(0 0 0 / 0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  });
}

// Hatch period in scene units; plane and circle UVs span the zone's box and the circle's diameter.
const HATCH_PERIOD = 0.4;
function hatchFor(zone, base, anisotropy) {
  const texture = base.clone();
  const [w, h] = zone.shape === 'rect' ? [zone.x[1] - zone.x[0], zone.z[1] - zone.z[0]] : [2 * zone.radius, 2 * zone.radius];
  texture.repeat.set(w / HATCH_PERIOD, h / HATCH_PERIOD);
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

// A flat ground shape in the horse's frame. Rotating the xy-plane by +90
// degrees about x maps its +y onto +z, the horse's right, so sector angles
// run from forward towards the right as in figures.js.
function zoneGeometry(zone) {
  if (zone.shape === 'rect') {
    const geometry = new THREE.PlaneGeometry(zone.x[1] - zone.x[0], zone.z[1] - zone.z[0]);
    return geometry.translate((zone.x[0] + zone.x[1]) / 2, (zone.z[0] + zone.z[1]) / 2, 0);
  }
  return new THREE.CircleGeometry(zone.radius, 48, (zone.direction - zone.spread / 2) * DEG, zone.spread * DEG).translate(zone.at[0], zone.at[1], 0);
}

/**
 * A flat band of the given width along a polyline in the xy-plane, each
 * segment lengthened by half the width so the corners close. `closed` joins
 * the last point to the first.
 */
function ribbonGeometry(points, width, closed = false) {
  const positions = [];
  const count = closed ? points.length : points.length - 1;
  for (let i = 0; i < count; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[(i + 1) % points.length];
    const length = Math.hypot(bx - ax, by - ay);
    if (length < 1e-6) continue;
    const [ux, uy] = [(bx - ax) / length, (by - ay) / length];
    const [nx, ny] = [-uy * width / 2, ux * width / 2];
    const [px, py, qx, qy] = [ax - ux * width / 2, ay - uy * width / 2, bx + ux * width / 2, by + uy * width / 2];
    positions.push(px + nx, py + ny, 0, px - nx, py - ny, 0, qx + nx, qy + ny, 0, qx + nx, qy + ny, 0, px - nx, py - ny, 0, qx - nx, qy - ny, 0);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

// Triangle of an arrowhead whose tip lies at `tip`, pointing along `dir`, in the xy-plane.
function arrowheadGeometry([tx, ty], [dx, dy], length, width) {
  const [bx, by] = [tx - dx * length, ty - dy * length];
  const [nx, ny] = [-dy * width / 2, dx * width / 2];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([tx, ty, 0, bx + nx, by + ny, 0, bx - nx, by - ny, 0], 3));
  return geometry;
}

// A ground arrow along world points (x, z): a band ending in a head at the last point.
function groundArrow(points, material, { width = 0.07, head = 0.34, lift = 0.03 } = {}) {
  const [ex, ez] = points[points.length - 1];
  let k = points.length - 2;
  while (k > 0 && Math.hypot(ex - points[k][0], ez - points[k][1]) < head) k--;
  const [px, pz] = points[k];
  const length = Math.hypot(ex - px, ez - pz) || 1;
  const dir = [(ex - px) / length, (ez - pz) / length];
  const base = [ex - dir[0] * head * 0.9, ez - dir[1] * head * 0.9];
  const group = new THREE.Group();
  for (const geometry of [ribbonGeometry([...points.slice(0, k + 1), base], width), arrowheadGeometry([ex, ez], dir, head, head * 0.9)]) {
    const mesh = new THREE.Mesh(geometry, material);
    // The xy-plane laid on the ground with y onto z, as for the zones.
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = lift;
    mesh.renderOrder = 6;
    group.add(mesh);
  }
  return group;
}

// An arrow in space along points: a tube that ends in a cone at the last point.
function tubeArrow(points, material, radius, headRadius, order, headLength = headRadius * 2.6) {
  const end = points[points.length - 1];
  const dir = end.clone().sub(points[points.length - 2]).normalize();
  const base = end.clone().addScaledVector(dir, -headLength);
  const body = [...points.slice(0, -1).filter((p) => p.distanceTo(end) > headLength), base];
  const group = new THREE.Group();
  const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(body), 48, radius, 8, false), material);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(headRadius, headLength, 16), material);
  cone.position.copy(base).addScaledVector(dir, headLength / 2);
  cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
  for (const mesh of [tube, cone]) {
    mesh.renderOrder = order;
    group.add(mesh);
  }
  return group;
}

function disposeGroup(group) {
  group?.traverse((o) => o.geometry?.dispose());
}

// Grid lines a unit apart that fade out around the region in view, so the
// ground reads as a floor without dominating the frame.
const GRID = { reach: 16, near: 0.45, alpha: 0.6 };
function fadingGrid(color) {
  const positions = [];
  for (let a = -GRID.reach; a <= GRID.reach; a++) {
    for (let b = -GRID.reach; b < GRID.reach; b++) positions.push(a, 0, b, a, 0, b + 1, b, 0, a, b + 1, 0, a);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 4), 4));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }));
  lines.renderOrder = 1;
  let key = '';
  // Fully drawn within `near` of the radius, gone at the radius; centred on a whole unit so lines stay on the world grid.
  lines.fade = (centre, radius) => {
    const cx = Math.round(centre[0]);
    const cz = Math.round(centre[2]);
    const next = `${cx} ${cz} ${radius.toFixed(2)}`;
    if (next === key) return;
    key = next;
    lines.position.set(cx, 0.002, cz);
    const colours = geometry.getAttribute('color');
    const pos = geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const d = Math.hypot(pos.getX(i) + cx - centre[0], pos.getZ(i) + cz - centre[2]);
      const alpha = GRID.alpha * Math.min(1, Math.max(0, (radius - d) / (radius * (1 - GRID.near))));
      colours.setXYZW(i, color.r, color.g, color.b, alpha);
    }
    colours.needsUpdate = true;
  };
  return lines;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {object} colors resolved colour tokens
 * @param {{ onLost: () => void, onRestored: () => void }} events context loss callbacks
 */
export function createThreeView(canvas, colors, { onLost, onRestored }) {
  // Throws when the browser cannot create a WebGL 2 context; the caller then uses the 2D view.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const anisotropy = renderer.capabilities.getMaxAnisotropy();
  // three.js prevents the default on loss so the context can come back, and
  // re-initialises its state on restore; the page only has to say so and redraw.
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 16 / 9, 0.1, 120);
  const projected = new THREE.Vector3();
  let size = { width: 0, height: 0 };
  let target = null;

  const shaded = (token, roughness = 0.85) => new THREE.MeshStandardMaterial({ color: toColor(colors[token]), roughness, metalness: 0 });
  const horseMaterial = shaded('horse');
  const halterMaterial = shaded('halter', 0.6);
  const darkMaterial = shaded('horseDark');
  const personMaterial = shaded('person', 0.7);

  // Colours are set once: the page is light only and never switches scheme.
  // The unlit ground has exactly the clear colour, so the floor meets the sky
  // without a horizon line; a shadow layer above it takes the cast shadows.
  const groundColor = toColor(colors.ground);
  scene.background = groundColor;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: groundColor }));
  ground.rotation.x = -Math.PI / 2;
  const shadowFloor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.14 }));
  shadowFloor.rotation.x = -Math.PI / 2;
  shadowFloor.position.y = 0.001;
  shadowFloor.receiveShadow = true;
  const grid = fadingGrid(toColor(colors.grid));
  scene.add(ground, shadowFloor, grid);

  // A soft sky and ground fill and one sun from above the horse's front left,
  // so the cast shadows fall to its right, away from the handler's side.
  const hemi = new THREE.HemisphereLight(0xffffff, toColor(colors.ground).multiplyScalar(0.8), 2.1);
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  const SUN_OFFSET = [2.5, 11, -4.5];
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.radius = 4;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  scene.add(hemi, sun, sun.target);

  const horse = buildFigure('horse', horseMaterial, { halter: halterMaterial, dark: darkMaterial });
  const person = buildFigure('person', personMaterial);
  scene.add(horse.root, person.root);

  // Where the horse stood when the step began: a pale figure that casts no shadow.
  // Where the horse stood when the step began: one translucent pale layer. A
  // depth pass after the opaque figures keeps only the ghost's front surface,
  // so its parts do not darken each other and the horse shows through it.
  const ghostLayer = (material, order, name = 'horse') => {
    const figure = buildFigure(name, material);
    figure.root.traverse((o) => { o.castShadow = false; o.renderOrder = order; });
    figure.root.visible = false;
    scene.add(figure.root);
    return figure;
  };
  const paleLayer = (token) => new THREE.MeshStandardMaterial({ color: toColor(colors[token]), roughness: 1, transparent: true, opacity: 0.6, depthWrite: false, depthFunc: THREE.EqualDepth });
  // The pale start pair: the horse and the person where the step began.
  const ghosts = [
    ghostLayer(new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true }), 20),
    ghostLayer(paleLayer('ghost'), 21),
  ];
  const personGhosts = [
    ghostLayer(new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true }), 20, 'person'),
    ghostLayer(paleLayer('personGhost'), 21, 'person'),
  ];

  const contact = contactTexture();
  const blot = (w, d, x) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: contact, transparent: true, depthWrite: false }));
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, 0.012, 0);
    mesh.renderOrder = 5;
    return mesh;
  };
  horse.root.add(blot(3.1, 1.25, -0.02));
  person.root.add(blot(0.8, 0.8, 0));

  // Zones ride on the horse group, so they turn and move with the horse: a
  // fill, the stripes of an unsafe zone and an outline, each in the zone colour.
  const hatches = { rising: hatchTexture('rising'), falling: hatchTexture('falling') };
  const layer = (geometry, material, lift, order) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = lift;
    mesh.renderOrder = order;
    horse.root.add(mesh);
    return mesh;
  };
  const zones = new Map(Object.entries(ZONES).map(([id, zone], i) => {
    const color = toColor(colors[zone.tone]);
    const basic = (extra = {}) => new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...extra });
    const lift = 0.004 + i * 0.002;
    const shape = zoneGeometry(zone);
    const fill = layer(shape, basic(), lift, 2);
    const stripes = isHatched(zone) ? layer(shape, basic({ map: hatchFor(zone, hatches[zone.hatch], anisotropy) }), lift + 0.0005, 3) : null;
    const outline = layer(ribbonGeometry(zoneOutline(zone), 0.05, true), basic(), lift + 0.001, 4);
    return [id, { fill, stripes, outline }];
  }));

  // The person's walk through the step: a ring where it starts and flat dashes to an arrowhead where it ends.
  const pathMaterial = new THREE.MeshBasicMaterial({ color: toColor(colors.person), side: THREE.DoubleSide });
  const dashGeometry = new THREE.BoxGeometry(0.2, 0.01, 0.05);
  const ringGeometry = new THREE.RingGeometry(0.14, 0.2, 24);
  let path = null;
  let pathKey = '';
  function drawPath(state) {
    const key = state.path ? JSON.stringify(state.path) : '';
    if (key === pathKey) return;
    pathKey = key;
    disposeGroup(path);
    if (path) scene.remove(path);
    path = null;
    // A step of a few centimetres shows no direction and is not drawn.
    const marks = pathMarks(state.path);
    if (!marks?.tip) return;
    const { from, tip, dir, reach } = marks;
    path = new THREE.Group();
    for (let s = 0.25; s + 0.2 <= reach - 0.3; s += 0.34) {
      const dash = new THREE.Mesh(dashGeometry, pathMaterial);
      dash.position.set(from.x + dir.x * (s + 0.1), 0.02, from.z + dir.z * (s + 0.1));
      dash.rotation.y = -Math.atan2(dir.z, dir.x);
      path.add(dash);
    }
    path.add(groundArrow([[tip.x - dir.x * 0.32, tip.z - dir.z * 0.32], [tip.x, tip.z]], pathMaterial, { width: 0.05, head: 0.3, lift: 0.02 }));
    const ring = new THREE.Mesh(ringGeometry, pathMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(from.x, 0.02, from.z);
    path.add(ring);
    scene.add(path);
  }

  // The horse's movement in the step: an arrow along the path of its head, a bow for a turn, from
  // where the pale horse's head was to the head now. A tube reads from every view; it is drawn over
  // the figures, because the moving horse itself can hide it, with a light halo for the dark horse.
  const overlay = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });
  const trailMaterial = overlay(toColor(colors.halter), 0.9);
  const haloMaterial = overlay(new THREE.Color(0xffffff), 0.85);
  let trail = null;
  let trailKey = '';
  function drawMotion(state) {
    const motion = state.motion;
    for (const ghost of ghosts) {
      ghost.root.visible = Boolean(motion);
      if (!motion) continue;
      ghost.root.position.set(motion.from.x, 0, motion.from.z);
      ghost.root.rotation.y = motion.from.heading * DEG;
      ghost.neck.rotation.z = motion.from.neck * DEG;
    }
    for (const ghost of personGhosts) {
      ghost.root.visible = Boolean(motion?.person);
      if (!motion?.person) continue;
      ghost.root.position.set(motion.person.x, 0, motion.person.z);
      ghost.root.rotation.y = motion.person.heading * DEG;
    }
    const key = motion?.trail ? JSON.stringify(motion.trail) : '';
    if (key === trailKey) return;
    trailKey = key;
    disposeGroup(trail);
    if (trail) scene.remove(trail);
    trail = null;
    if (!key) return;
    trail = new THREE.Group();
    if (motion.ground) trail.add(headPath(motion.trail));
    else {
      const points = motion.trail.map(([x, z]) => new THREE.Vector3(x, motion.height, z));
      trail.add(tubeArrow(points, haloMaterial, 0.075, 0.19, 10, 0.4), tubeArrow(points, trailMaterial, 0.035, 0.13, 11, 0.34));
    }
    scene.add(trail);
  }

  // The head's path through a turn, on the ground: a solid line in the horse's grey, lighter than the
  // person's dashed walk and without its ring, ending in an arrowhead under the end head. The arrowhead
  // is drawn over the lead rope, which hangs above it in the top view.
  const turnMaterial = new THREE.MeshBasicMaterial({ color: toColor(colors.horse), side: THREE.DoubleSide });
  const turnHeadMaterial = new THREE.MeshBasicMaterial({ color: toColor(colors.horse), side: THREE.DoubleSide, depthTest: false, transparent: true });
  // A light halo sets the grey path off the grey horse where the arrowhead ends beside the head.
  const turnHaloMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.9 });
  function headPath(points) {
    const group = new THREE.Group();
    const [ex, ez] = points[points.length - 1];
    let k = points.length - 2;
    while (k > 0 && Math.hypot(ex - points[k][0], ez - points[k][1]) < 0.3) k--;
    const line = new THREE.Mesh(ribbonGeometry(points.slice(0, k + 1), 0.06), turnMaterial);
    // The xy-plane laid on the ground with y onto z, as for the zones.
    line.rotation.x = Math.PI / 2;
    line.position.y = 0.025;
    const head = groundArrow([points[k], [ex, ez]], turnHeadMaterial, { width: 0.06, head: 0.32, lift: 0.025 });
    const halo = groundArrow([points[k], [ex, ez]], turnHaloMaterial, { width: 0.14, head: 0.46, lift: 0.024 });
    halo.traverse((o) => { o.renderOrder = 11; });
    head.traverse((o) => { o.renderOrder = 12; });
    const lineHalo = new THREE.Mesh(ribbonGeometry(points.slice(0, k + 1), 0.13), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
    lineHalo.rotation.x = Math.PI / 2;
    lineHalo.position.y = 0.022;
    group.add(lineHalo, line, halo, head);
    return group;
  }

  // While the rope is held, the person's right arm reaches towards the halter: the resting arm is hidden
  // and an arm from the shoulder to the hand that grips the rope takes its place.
  const restingArm = person.root.children.find((o) => o.userData.holdsRope);
  let rope = null;
  let arm = null;
  // What drawRope drew last, for the browser check: the rope's points and the arm from shoulder to hand.
  let held = null;
  function drawRope(state) {
    for (const mesh of [rope, arm]) {
      if (!mesh) continue;
      scene.remove(mesh);
      mesh.geometry.dispose();
    }
    rope = null;
    arm = null;
    restingArm.visible = !state.rope;
    held = null;
    if (!state.rope) return;
    const { shoulder, hand, radius } = ropeArm(state.horse, state.person);
    held = { rope: ropePoints(state.horse, state.person, hand), arm: [shoulder, hand] };
    const [from, to] = [shoulder, hand].map((p) => new THREE.Vector3(...p));
    arm = new THREE.Mesh(new THREE.CapsuleGeometry(radius, from.distanceTo(to), 6, 8), personMaterial);
    arm.position.copy(from).add(to).multiplyScalar(0.5);
    arm.quaternion.setFromUnitVectors(UP, to.clone().sub(from).normalize());
    arm.castShadow = true;
    const curve = new THREE.CatmullRomCurve3(held.rope.map((p) => new THREE.Vector3(...p)));
    rope = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.025, 6, false), halterMaterial);
    rope.castShadow = true;
    scene.add(arm, rope);
  }

  // Zoom scales the projection about the canvas centre and the view offset
  // shifts it, so the box of the region's points lands centred in the free band.
  // A narrow frame keeps more room around the region, so the labels find a place beside the figures.
  const FIT = { margin: 0.94, narrowMargin: 0.72, narrow: 480, minZoom: 0.3, maxZoom: 4 };
  function fitLens(frame, { top, bottom }) {
    camera.zoom = 1;
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    const { width, height } = size;
    if (!frame || !width || !height) return;
    const xs = [];
    const ys = [];
    for (const [x, y, z] of frame.points) {
      projected.set(x, y, z).project(camera);
      xs.push(projected.x * width / 2);
      ys.push(-projected.y * height / 2);
    }
    const free = Math.max(1, height - top - bottom);
    const boxW = Math.max(...xs) - Math.min(...xs);
    const boxH = Math.max(...ys) - Math.min(...ys);
    const zoom = Math.min(FIT.maxZoom, Math.max(FIT.minZoom, (width < FIT.narrow ? FIT.narrowMargin : FIT.margin) * Math.min(width / boxW, free / boxH)));
    const cx = (Math.max(...xs) + Math.min(...xs)) / 2;
    const cy = (Math.max(...ys) + Math.min(...ys)) / 2;
    camera.zoom = zoom;
    camera.setViewOffset(width, height, zoom * cx, zoom * cy - (top - bottom) / 2, width, height);
    camera.updateProjectionMatrix();
  }

  // The sun and its shadow camera follow the region in view, so the shadow map stays sharp where the figures are.
  function placeSun(centre, radius) {
    sun.target.position.set(...centre);
    sun.position.set(centre[0] + SUN_OFFSET[0], SUN_OFFSET[1], centre[2] + SUN_OFFSET[2]);
    const cam = sun.shadow.camera;
    const reach = radius + 2;
    if (cam.right !== reach) {
      Object.assign(cam, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 30 });
      cam.updateProjectionMatrix();
    }
  }

  return {
    kind: 'webgl',
    resize(width, height) {
      renderer.setSize(width, height, false);
      size = { width, height };
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    // The preset keeps its direction and distance and is centred on the step's
    // ground region; the lens then fits that region's figures, zones and
    // trail into the part of the canvas no control covers.
    render(state, viewKey, frame, insets = { top: 0, bottom: 0 }) {
      const view = CAMERA_VIEWS[viewKey];
      const centre = frame ? [(frame.minX + frame.maxX) / 2, view.target[1], (frame.minZ + frame.maxZ) / 2] : view.target;
      const radius = frame ? Math.hypot(frame.maxX - frame.minX, frame.maxZ - frame.minZ) / 2 : 6;
      target = centre;
      const offset = new THREE.Vector3(...view.position.map((v, i) => v - view.target[i]));
      if (view.follows && frame?.heading) offset.applyAxisAngle(UP, frame.heading * DEG);
      // A turning step's following view stands lower, from the same measured search as its heading.
      if (view.follows && frame?.turns) offset.y *= TURN_LIFT;
      camera.position.copy(offset).add(new THREE.Vector3(...centre));
      camera.lookAt(...centre);
      fitLens(frame, insets);
      grid.fade(centre, radius + 1.5);
      placeSun([centre[0], 0, centre[2]], radius);
      horse.root.position.set(state.horse.x, 0, state.horse.z);
      horse.root.rotation.y = state.horse.heading * DEG;
      horse.neck.rotation.z = state.horse.neck * DEG;
      person.root.position.set(state.person.x, 0, state.person.z);
      person.root.rotation.y = state.person.heading * DEG;
      for (const [id, { fill, stripes, outline }] of zones) {
        const style = state.focus.includes(id) ? ZONE_STYLE.focus : ZONE_STYLE.rest;
        fill.material.opacity = style.fill;
        if (stripes) stripes.material.opacity = style.stripe;
        outline.visible = style.outline > 0;
        outline.material.opacity = style.outline;
      }
      drawRope(state);
      drawPath(state);
      drawMotion(state);
      renderer.render(scene, camera);
    },
    camera: () => camera.position.toArray(),
    target: () => (target ? [...target] : null),
    held: () => (held ? { ...held, restingArm: restingArm.visible } : null),
    // CSS pixels within the canvas for a world point, valid after render(); null outside the view volume.
    project([x, y, z]) {
      projected.set(x, y, z).project(camera);
      if (Math.abs(projected.z) > 1) return null;
      return { x: (projected.x + 1) / 2 * size.width, y: (1 - projected.y) / 2 * size.height };
    },
  };
}
