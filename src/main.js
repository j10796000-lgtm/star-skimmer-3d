import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.min.js";

const canvas = document.querySelector("#game");
const scoreEl = document.querySelector("#score");
const highScoreEl = document.querySelector("#highScore");
const comboEl = document.querySelector("#combo");
const speedEl = document.querySelector("#speed");
const shieldEl = document.querySelector("#shield");
const shipNameEl = document.querySelector("#shipName");
const startPanel = document.querySelector("#startPanel");
const gameOverPanel = document.querySelector("#gameOverPanel");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");
const changeShipButton = document.querySelector("#changeShipButton");
const controlsEl = document.querySelector(".controls");
const shipCards = document.querySelectorAll(".ship-card");
const finalScore = document.querySelector("#finalScore");
const finalMessage = document.querySelector("#finalMessage");
const boostEl = document.querySelector("#boost");
const pausePanel = document.querySelector("#pausePanel");
const resumeButton = document.querySelector("#resumeButton");
const shareButton = document.querySelector("#shareButton");
const calloutEl = document.querySelector("#callout");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07110f, 0.042);

const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 240);
camera.position.set(0, 6.4, 12.5);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: window.devicePixelRatio < 1.75, // multisampling is wasted work on high-density screens
  powerPreference: "high-performance",
});
// Render resolution adapts to the device: it steps down when frames run slow and
// creeps back up when there is headroom (see updateQuality).
const quality = {
  current: Math.min(window.devicePixelRatio || 1, 2),
  ceiling: Math.min(window.devicePixelRatio || 1, 2),
  floor: 0.75,
  smoothed: 1 / 60,
  sinceCheck: 0,
  goodChecks: 0,
  elapsed: 0,
  lastRaise: -Infinity,
};
renderer.setPixelRatio(quality.current);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const clock = new THREE.Clock();
const input = { left: false, right: false, boost: false, pointerX: null };
const lanes = [-4.8, -2.4, 0, 2.4, 4.8];
const activeObjects = [];
const particles = [];
const startingSpeed = 18;
const maxCruiseSpeed = 30;
const boostSpeedMultiplier = 1.6;

// Gameplay and performance tuning.
const BOOST_DRAIN = 26; // boost meter lost per second while boosting (about 3.8s from full)
const BOOST_REGEN = 14; // boost meter regained per second while not boosting
const BOOST_REARM = 30; // after running dry, boost stays off until the meter refills this far (stops rapid on/off flicker)
const SHIELD_REGEN = 3; // shield regained per second
const CLOSE_CALL_WINDOW = 0.8; // passing an obstacle by less than this (beyond its hit radius) counts
const CLOSE_CALL_POINTS = 60; // times your combo
const CULL_Z = -80; // objects farther away than this are fully lost in the fog, so skip drawing them
const MAX_PARTICLES = 600;
const HUM_UPDATE_INTERVAL = 0.08; // seconds between engine-sound updates
const SHARE_URL = "https://star-skimmer-3d.vercel.app/";

// SPAWN-TUNING-BEGIN
// Obstacle layout fairness. Everything the layout audit and the wave spacing use lives here.
const OBSTACLE_RADIUS = 1.25; // hit distance of a spinner (see createObstacle)
const SAFE_ROW_SPACING = 14; // z-units between wall rows in the hardest patterns (~0.4s at max speed)
const MIN_WAVE_SEPARATION = 16; // z-units between one wave's last hazard and the next wave's first
const SPAWN_Z = -96;
const FIELD_HALF_WIDTH = 5.7; // ship is clamped to +/- this
const AUDIT_SPEED = maxCruiseSpeed + 4; // max cruise plus the surge from a boost ring
const REACTION_ALLOWANCE = 0.12; // seconds a player needs before the ship starts to move
const REACH_MARGIN = 0.8; // only trust 80% of the ship's theoretical sideways travel
const MIN_USABLE_GAP = 0.6; // a gap narrower than this is not a real gap
const ROW_GROUP_TOLERANCE = OBSTACLE_RADIUS * 2; // obstacles this close in z count as one row
// SPAWN-TUNING-END
const highScoreStorageKey = "starSkimmerHighScore";
const audioState = {
  context: null,
  masterGain: null,
  engineOscillators: [],
  engineLayerGains: [],
  engineFilter: null,
  engineGain: null,
  engineLfo: null,
  engineLfoGain: null,
  muteButton: null,
  muted: false,
  humTimer: 0,
};
let selectedShip = "comet";
let highScore = readHighScore();
let lastSpawnPatternId = null;
let pendingPattern = null;
let patternRecorder = null; // when set, createX() only records obstacle positions (used by the layout audit)

const state = {
  running: false,
  score: 0,
  combo: 1,
  speed: 18,
  distance: 0,
  shield: 100,
  invincible: 0,
  spawnTimer: 0,
  sparkTimer: 0,
  boost: 100,
  boostLocked: false,
  paused: false,
};

const shipModels = {
  comet: {
    name: "Comet",
    accent: 0x36f1ff,
    flame: 0xff4f8b,
    agility: 1,
    shield: 1,
  },
  raptor: {
    name: "Raptor",
    accent: 0xff4f8b,
    flame: 0xffef5c,
    agility: 1.18,
    shield: 0.9,
  },
  nebula: {
    name: "Nebula",
    accent: 0x77ff74,
    flame: 0x36f1ff,
    agility: 0.88,
    shield: 1.18,
  },
};

function readHighScore() {
  try {
    const storedScore = Number(window.localStorage.getItem(highScoreStorageKey));
    return Number.isFinite(storedScore) && storedScore > 0 ? storedScore : 0;
  } catch {
    return 0;
  }
}

function saveHighScore(score) {
  highScore = score;
  try {
    window.localStorage.setItem(highScoreStorageKey, String(score));
  } catch {
    // Keep the best score in memory when browser storage is unavailable.
  }
}

function getAudioContext() {
  if (audioState.context) return audioState.context;
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  audioState.context = new AudioContextClass();
  audioState.masterGain = audioState.context.createGain();
  audioState.masterGain.gain.value = audioState.muted ? 0 : 0.46;
  audioState.masterGain.connect(audioState.context.destination);
  return audioState.context;
}

function setMuted(muted) {
  audioState.muted = muted;
  updateMuteButton();
  if (muted) stopEngineHum();
  else if (state.running) resumeAudio();
  if (audioState.masterGain && audioState.context) {
    audioState.masterGain.gain.setTargetAtTime(
      muted ? 0 : 0.46,
      audioState.context.currentTime,
      0.025,
    );
  }
}

function createMuteButton() {
  if (!controlsEl) return;
  const muteButton = document.createElement("button");
  muteButton.type = "button";
  muteButton.setAttribute("aria-label", "Toggle sound");
  muteButton.style.minHeight = "28px";
  muteButton.style.marginTop = "0";
  muteButton.style.border = "1px solid rgba(255, 255, 255, 0.2)";
  muteButton.style.borderRadius = "6px";
  muteButton.style.padding = "0 9px";
  muteButton.style.background = "rgba(255, 255, 255, 0.11)";
  muteButton.style.color = "#fff";
  muteButton.style.boxShadow = "none";
  muteButton.style.fontSize = "0.78rem";
  muteButton.style.pointerEvents = "auto";
  muteButton.addEventListener("click", () => setMuted(!audioState.muted));
  controlsEl.append(muteButton);
  audioState.muteButton = muteButton;
  updateMuteButton();
}

function updateMuteButton() {
  if (!audioState.muteButton) return;
  audioState.muteButton.textContent = audioState.muted ? "Sound Off" : "Sound On";
  audioState.muteButton.setAttribute("aria-pressed", String(audioState.muted));
}

async function resumeAudio() {
  const audioContext = getAudioContext();
  if (!audioContext) return;
  if (audioContext.state === "suspended") await audioContext.resume();
  startEngineHum();
}

function startEngineHum() {
  const audioContext = getAudioContext();
  if (!audioContext || audioState.muted || audioState.engineOscillators.length) return;

  const oscillator1 = audioContext.createOscillator();
  const oscillator2 = audioContext.createOscillator();
  const oscillator3 = audioContext.createOscillator();
  const layer1Gain = audioContext.createGain();
  const layer2Gain = audioContext.createGain();
  const layer3Gain = audioContext.createGain();
  const filter = audioContext.createBiquadFilter();
  const engineGain = audioContext.createGain();
  const lfo = audioContext.createOscillator();
  const lfoGain = audioContext.createGain();

  oscillator1.type = "sine";
  oscillator2.type = "triangle";
  oscillator3.type = "sine";
  oscillator1.frequency.value = 55;
  oscillator2.frequency.value = 58;
  oscillator3.frequency.value = 110;
  layer1Gain.gain.value = 1;
  layer2Gain.gain.value = 0.9;
  layer3Gain.gain.value = 0.23;
  filter.type = "lowpass";
  filter.frequency.value = 400;
  filter.Q.value = 0.7;
  engineGain.gain.value = 0;
  lfo.type = "sine";
  lfo.frequency.value = 7.4;
  lfoGain.gain.value = 0;

  oscillator1.connect(layer1Gain);
  oscillator2.connect(layer2Gain);
  oscillator3.connect(layer3Gain);
  layer1Gain.connect(filter);
  layer2Gain.connect(filter);
  layer3Gain.connect(filter);
  filter.connect(engineGain);
  lfo.connect(lfoGain);
  lfoGain.connect(engineGain.gain);
  engineGain.connect(audioState.masterGain);

  oscillator1.start();
  oscillator2.start();
  oscillator3.start();
  lfo.start();

  audioState.engineOscillators = [oscillator1, oscillator2, oscillator3];
  audioState.engineLayerGains = [layer1Gain, layer2Gain, layer3Gain];
  audioState.engineFilter = filter;
  audioState.engineGain = engineGain;
  audioState.engineLfo = lfo;
  audioState.engineLfoGain = lfoGain;
  updateEngineHum();
}

function stopEngineHum() {
  const audioContext = audioState.context;
  if (!audioContext || !audioState.engineOscillators.length) return;

  const stopAt = audioContext.currentTime + 0.04;
  if (audioState.engineGain) {
    audioState.engineGain.gain.cancelScheduledValues(audioContext.currentTime);
    audioState.engineGain.gain.setTargetAtTime(0.0001, audioContext.currentTime, 0.015);
  }

  [...audioState.engineOscillators, audioState.engineLfo].filter(Boolean).forEach((oscillator) => {
    oscillator.stop(stopAt);
    oscillator.addEventListener("ended", () => oscillator.disconnect(), { once: true });
  });
  [
    ...audioState.engineLayerGains,
    audioState.engineFilter,
    audioState.engineGain,
    audioState.engineLfoGain,
  ].filter(Boolean).forEach((node) => {
    window.setTimeout(() => node.disconnect(), 90);
  });

  audioState.engineOscillators = [];
  audioState.engineLayerGains = [];
  audioState.engineFilter = null;
  audioState.engineGain = null;
  audioState.engineLfo = null;
  audioState.engineLfoGain = null;
}

function updateEngineHum() {
  const audioContext = audioState.context;
  if (
    !audioContext ||
    !audioState.engineOscillators.length ||
    !audioState.engineGain ||
    !audioState.engineFilter ||
    !audioState.engineLfoGain
  ) return;

  const boosted = isBoosting();
  const speedProgress = THREE.MathUtils.clamp(
    (state.speed - startingSpeed) / (maxCruiseSpeed - startingSpeed),
    0,
    1,
  );
  const baseFrequency = THREE.MathUtils.lerp(55, 90, speedProgress);
  const detuneGap = boosted ? THREE.MathUtils.lerp(5, 6, speedProgress) : 3;
  const cutoff = boosted ? 4000 : THREE.MathUtils.lerp(400, 2800, speedProgress);
  const baseGain = state.running ? 0.034 * (boosted ? 1.36 : 1) : 0.0001;
  const now = audioContext.currentTime;
  const [oscillator1, oscillator2, oscillator3] = audioState.engineOscillators;

  oscillator1.frequency.setTargetAtTime(baseFrequency, now, 0.045);
  oscillator2.frequency.setTargetAtTime(baseFrequency + detuneGap, now, 0.045);
  oscillator3.frequency.setTargetAtTime(baseFrequency * 2, now, 0.045);
  audioState.engineFilter.frequency.setTargetAtTime(cutoff, now, 0.055);
  audioState.engineGain.gain.setTargetAtTime(baseGain, now, 0.075);
  audioState.engineLfoGain.gain.setTargetAtTime(baseGain * 0.05, now, 0.075);
}

function playTone({ type = "sine", startFrequency, endFrequency, duration, volume }) {
  const audioContext = getAudioContext();
  if (!audioContext || audioState.muted) return;

  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  const now = audioContext.currentTime;
  const stopAt = now + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, now);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, stopAt);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume, now + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gain);
  gain.connect(audioState.masterGain);
  oscillator.start(now);
  oscillator.stop(stopAt + 0.02);
  oscillator.addEventListener("ended", () => {
    oscillator.disconnect();
    gain.disconnect();
  }, { once: true });
}

function playStarChime() {
  playTone({
    type: "triangle",
    startFrequency: 920,
    endFrequency: 1560,
    duration: 0.12,
    volume: 0.18,
  });
}

function playBoostWhoosh() {
  playTone({
    type: "sawtooth",
    startFrequency: 120,
    endFrequency: 680,
    duration: 0.32,
    volume: 0.16,
  });
}

function playHitAlarm() {
  playTone({
    type: "square",
    startFrequency: 230,
    endFrequency: 150,
    duration: 0.22,
    volume: 0.2,
  });
  playTone({
    type: "square",
    startFrequency: 310,
    endFrequency: 190,
    duration: 0.2,
    volume: 0.12,
  });
}

const palette = {
  mint: 0x77ff74,
  cyan: 0x36f1ff,
  yellow: 0xffef5c,
  pink: 0xff4f8b,
  ink: 0x07110f,
};

const hemiLight = new THREE.HemisphereLight(0xb9fff1, 0x17102a, 2.8);
scene.add(hemiLight);

const sun = new THREE.DirectionalLight(0xfff0a8, 3.2);
sun.position.set(-8, 13, 8);
scene.add(sun);

const rim = new THREE.PointLight(palette.cyan, 34, 45);
rim.position.set(6, 4, 6);
scene.add(rim);

// ── Shared resources ─────────────────────────────────────────────────────────
// Every star, spinner and ring reuses these geometries and materials, so nothing is
// allocated (or leaked) while the game runs and the GPU can batch similar draws.
function mergeGeometries(geometries) {
  const positions = [];
  const normals = [];
  const indices = [];
  let offset = 0;
  geometries.forEach((geometry) => {
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    for (let i = 0; i < position.count; i++) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      normals.push(normal.getX(i), normal.getY(i), normal.getZ(i));
    }
    for (let i = 0; i < geometry.index.count; i++) indices.push(geometry.index.getX(i) + offset);
    offset += position.count;
    geometry.dispose();
  });
  const merged = new THREE.BufferGeometry();
  merged.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  merged.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  merged.setIndex(indices);
  return merged;
}

const assets = {
  starCoreGeo: new THREE.IcosahedronGeometry(0.48, 1),
  starCoreMat: new THREE.MeshStandardMaterial({
    color: palette.yellow,
    emissive: palette.yellow,
    emissiveIntensity: 1.25,
    roughness: 0.2,
    metalness: 0.2,
  }),
  starRingGeo: new THREE.TorusGeometry(0.72, 0.045, 8, 36).rotateX(Math.PI / 2),
  starRingMat: new THREE.MeshBasicMaterial({ color: palette.mint }),
  // The two bars and the core of a spinner are one merged mesh: one draw call instead of three.
  spinnerGeo: mergeGeometries([
    new THREE.BoxGeometry(2.1, 0.28, 0.28),
    new THREE.BoxGeometry(0.28, 2.1, 0.28),
    new THREE.SphereGeometry(0.36, 16, 10),
  ]),
  spinnerMat: new THREE.MeshStandardMaterial({
    color: palette.pink,
    emissive: palette.pink,
    emissiveIntensity: 0.65,
    roughness: 0.28,
    metalness: 0.32,
  }),
  boostRingGeo: new THREE.TorusGeometry(1.1, 0.09, 12, 48),
  boostRingMat: new THREE.MeshStandardMaterial({
    color: palette.cyan,
    emissive: palette.cyan,
    emissiveIntensity: 1.1,
    roughness: 0.2,
    metalness: 0.3,
  }),
};

// All sparks and bursts are one instanced mesh fed from typed arrays (one draw call, no per-spark objects).
const particlePool = {
  count: 0,
  px: new Float32Array(MAX_PARTICLES),
  py: new Float32Array(MAX_PARTICLES),
  pz: new Float32Array(MAX_PARTICLES),
  vx: new Float32Array(MAX_PARTICLES),
  vy: new Float32Array(MAX_PARTICLES),
  vz: new Float32Array(MAX_PARTICLES),
  life: new Float32Array(MAX_PARTICLES),
  r: new Float32Array(MAX_PARTICLES),
  g: new Float32Array(MAX_PARTICLES),
  b: new Float32Array(MAX_PARTICLES),
};
const particleMesh = new THREE.InstancedMesh(
  new THREE.SphereGeometry(0.055, 6, 4),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthWrite: false }),
  MAX_PARTICLES,
);
particleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
particleMesh.setColorAt(0, new THREE.Color(1, 1, 1)); // allocates the per-instance colour buffer
particleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
particleMesh.frustumCulled = false;
particleMesh.count = 0;
scene.add(particleMesh);

function disposeObject(root) {
  root.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    const materials = child.material ? (Array.isArray(child.material) ? child.material : [child.material]) : [];
    materials.forEach((material) => material.dispose());
  });
}

let ship = createShip(selectedShip);
scene.add(ship);

const track = createTrack();
scene.add(track);

const starField = createStarField();
scene.add(starField);

function createShip(modelId = "comet") {
  const model = shipModels[modelId];
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf6fff5,
    roughness: 0.32,
    metalness: 0.58,
    emissive: 0x102a27,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: model.accent,
    emissive: model.accent,
    emissiveIntensity: 0.85,
    roughness: 0.25,
    metalness: 0.34,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: palette.yellow,
    emissive: palette.yellow,
    emissiveIntensity: 0.48,
    roughness: 0.12,
    metalness: 0.16,
  });
  const flameMat = new THREE.MeshBasicMaterial({
    color: model.flame,
    transparent: true,
    opacity: 0.88,
  });

  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.74, 2.9, 5), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1.08, 0.58, 1);
  group.add(nose);

  if (modelId === "raptor") {
    addWing(group, trimMat, -1, 1.85, 0.12, 1.32, 0.24);
    addWing(group, trimMat, 1, 1.85, 0.12, 1.32, -0.24);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.1, 3), trimMat);
    fin.position.set(0, 0.62, 0.9);
    fin.rotation.x = Math.PI / 2;
    fin.scale.set(0.75, 1, 1.2);
    group.add(fin);
  } else if (modelId === "nebula") {
    const wingGeo = new THREE.BoxGeometry(3.65, 0.13, 0.9);
    const wing = new THREE.Mesh(wingGeo, trimMat);
    wing.position.z = 0.42;
    wing.scale.x = 1.04;
    group.add(wing);
    addPod(group, trimMat, -1.45, 0.1, 0.94);
    addPod(group, trimMat, 1.45, 0.1, 0.94);
  } else {
    const wingGeo = new THREE.BoxGeometry(3, 0.12, 0.76);
    const wing = new THREE.Mesh(wingGeo, trimMat);
    wing.position.z = 0.52;
    group.add(wing);
    addWing(group, trimMat, -1, 1.2, 0.08, 0.8, 0.1);
    addWing(group, trimMat, 1, 1.2, 0.08, 0.8, -0.1);
  }

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 18, 10),
    glassMat,
  );
  cockpit.position.set(0, 0.32, -0.2);
  cockpit.scale.set(1, 0.55, 1.4);
  group.add(cockpit);

  const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.5, 0.48, 18), trimMat);
  engine.rotation.x = Math.PI / 2;
  engine.position.z = 1.18;
  group.add(engine);

  const flameGroup = new THREE.Group();
  flameGroup.name = "flame";
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.2, 16),
    flameMat,
  );
  flame.position.z = 0.42;
  flame.rotation.x = -Math.PI / 2;
  flameGroup.position.z = 1.42;
  flameGroup.add(flame);
  group.add(flameGroup);

  const shieldHalo = new THREE.Mesh(
    new THREE.TorusGeometry(1.36, 0.018, 8, 56),
    new THREE.MeshBasicMaterial({
      color: model.accent,
      transparent: true,
      opacity: 0.38,
    }),
  );
  shieldHalo.rotation.x = Math.PI / 2;
  shieldHalo.position.y = -0.08;
  shieldHalo.name = "shieldHalo";
  group.add(shieldHalo);

  group.position.set(0, 1.05, 4);
  group.userData.flame = flameGroup;
  group.userData.halo = shieldHalo;
  group.userData.modelId = modelId;
  group.userData.velocity = 0;
  return group;
}

function addWing(group, mat, side, width, height, depth, twist) {
  const wing = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), mat);
  wing.position.set(side * 0.92, -0.05, 0.56);
  wing.rotation.z = side * -0.2;
  wing.rotation.y = twist;
  group.add(wing);
}

function addPod(group, mat, x, y, z) {
  const pod = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.76, 6, 12), mat);
  pod.position.set(x, y, z);
  pod.rotation.x = Math.PI / 2;
  group.add(pod);
}

function setShipModel(modelId) {
  selectedShip = modelId;
  const oldShip = ship;
  ship = createShip(modelId);
  if (oldShip) {
    ship.position.copy(oldShip.position);
    ship.rotation.copy(oldShip.rotation);
    scene.remove(oldShip);
    disposeObject(oldShip);
  }
  scene.add(ship);
  shipNameEl.textContent = shipModels[modelId].name;
  shipCards.forEach((card) => card.classList.toggle("active", card.dataset.ship === modelId));
}

function createTrack() {
  const group = new THREE.Group();
  const gridMat = new THREE.MeshBasicMaterial({
    color: palette.cyan,
    transparent: true,
    opacity: 0.18,
  });
  const matrix = new THREE.Matrix4();

  const lineZs = [];
  for (let z = -130; z < 26; z += 6) lineZs.push(z);
  const lines = new THREE.InstancedMesh(new THREE.BoxGeometry(13, 0.035, 0.035), gridMat, lineZs.length);
  lineZs.forEach((z, i) => lines.setMatrixAt(i, matrix.makeTranslation(0, 0, z)));
  lines.frustumCulled = false;
  group.add(lines);

  const railXs = [-6.2, -3.1, 0, 3.1, 6.2];
  const rails = new THREE.InstancedMesh(new THREE.BoxGeometry(0.055, 0.035, 170), gridMat, railXs.length);
  railXs.forEach((x, i) => rails.setMatrixAt(i, matrix.makeTranslation(x, 0.02, -52)));
  rails.frustumCulled = false;
  group.add(rails);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(15, 180),
    new THREE.MeshStandardMaterial({
      color: 0x0b1618,
      roughness: 0.8,
      metalness: 0.08,
      transparent: true,
      opacity: 0.7,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.z = -54;
  group.add(floor);
  return group;
}

function createStarField() {
  const vertices = [];
  const colors = [];
  const colorChoices = [palette.cyan, palette.yellow, palette.mint, palette.pink];
  for (let i = 0; i < 900; i++) {
    vertices.push((Math.random() - 0.5) * 120, Math.random() * 55 + 5, -Math.random() * 180);
    const color = new THREE.Color(colorChoices[i % colorChoices.length]);
    colors.push(color.r, color.g, color.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 0.84,
  });
  return new THREE.Points(geo, mat);
}

function createCollectible(x, z) {
  if (patternRecorder) return;
  const group = new THREE.Group();
  group.add(new THREE.Mesh(assets.starCoreGeo, assets.starCoreMat), new THREE.Mesh(assets.starRingGeo, assets.starRingMat));
  group.position.set(x, 1.18, z);
  group.userData = { type: "star", radius: 0.9 };
  scene.add(group);
  activeObjects.push(group);
}

function createObstacle(x, z) {
  if (patternRecorder) {
    patternRecorder.push({ x, z });
    return;
  }
  const spinner = new THREE.Mesh(assets.spinnerGeo, assets.spinnerMat);
  spinner.position.set(x, 1.28, z);
  spinner.userData = { type: "spinner", radius: OBSTACLE_RADIUS, spin: Math.random() > 0.5 ? 1 : -1, passed: false };
  scene.add(spinner);
  activeObjects.push(spinner);
}

function createBoostRing(x, z) {
  if (patternRecorder) return;
  const ring = new THREE.Mesh(assets.boostRingGeo, assets.boostRingMat);
  ring.rotation.y = Math.PI / 2;
  ring.position.set(x, 1.25, z);
  ring.userData = { type: "boost", radius: 1.15 };
  scene.add(ring);
  activeObjects.push(ring);
}

const spawnPatterns = [
  {
    id: "star-drift",
    minDistance: 0,
    run(z, shuffled) {
      shuffled.slice(0, 3).forEach((x, index) => createCollectible(x, z - index * 3.6));
      createObstacle(shuffled[4], z - 2);
    },
  },
  {
    id: "boost-thread",
    minDistance: 0,
    run(z, shuffled) {
      createBoostRing(shuffled[0], z - 4);
      createObstacle(shuffled[1], z - 10);
      createCollectible(shuffled[2], z - 16);
      createCollectible(shuffled[3], z - 20);
    },
  },
  {
    id: "split-lanes",
    minDistance: 0,
    run(z, shuffled) {
      shuffled.slice(0, 2).forEach((x) => createObstacle(x, z));
      shuffled.slice(2, 5).forEach((x, index) => createCollectible(x, z - 5 - index * 4));
    },
  },
  {
    id: "outer-pins",
    minDistance: 420,
    run(z) {
      createObstacle(lanes[0], z);
      createObstacle(lanes[4], z - 1.8);
      [lanes[1], lanes[2], lanes[3]].forEach((x, index) => createCollectible(x, z - 6 - index * 3.3));
    },
  },
  {
    id: "center-weave",
    minDistance: 760,
    run(z) {
      [lanes[1], lanes[3], lanes[1], lanes[3]].forEach((x, index) => createCollectible(x, z - index * 4));
      createObstacle(lanes[2], z - 2);
      createObstacle(lanes[0], z - 10);
      createObstacle(lanes[4], z - 16);
    },
  },
  {
    id: "reward-cluster",
    minDistance: 980,
    run(z) {
      [lanes[1], lanes[2], lanes[3], lanes[0], lanes[4]].forEach((x, index) => createCollectible(x, z - index * 2.6));
      createBoostRing(lanes[2], z - 15);
    },
  },
  {
    id: "switchback-gates",
    minDistance: 1320,
    run(z) {
      // Three walls, spaced out so the ship has time to slide to each gap.
      [0, 1].forEach((i) => createObstacle(lanes[i], z));
      createCollectible(lanes[2], z - SAFE_ROW_SPACING / 2);
      [3, 4].forEach((i) => createObstacle(lanes[i], z - SAFE_ROW_SPACING));
      createCollectible(lanes[1], z - SAFE_ROW_SPACING * 1.5);
      [0, 2].forEach((i) => createObstacle(lanes[i], z - SAFE_ROW_SPACING * 2));
      createBoostRing(lanes[3], z - SAFE_ROW_SPACING * 2 - 4);
    },
  },
  {
    id: "mirror-squeeze",
    minDistance: 1700,
    run(z) {
      [lanes[0], lanes[4]].forEach((x) => createObstacle(x, z));
      [lanes[1], lanes[3]].forEach((x) => createCollectible(x, z - 4));
      [lanes[1], lanes[3]].forEach((x) => createObstacle(x, z - 9));
      createCollectible(lanes[2], z - 12);
    },
  },
  {
    id: "boost-trap",
    minDistance: 2150,
    run(z, shuffled) {
      createObstacle(shuffled[0], z);
      createObstacle(shuffled[1], z - 2);
      createBoostRing(shuffled[2], z - 8);
      createObstacle(shuffled[3], z - 13);
      createCollectible(shuffled[4], z - 17);
    },
  },
  {
    id: "late-gauntlet",
    minDistance: 2700,
    run(z) {
      // A staircase of three walls. Each wall leaves a two-lane gap that overlaps the
      // previous wall's gap, so the player slides across the track instead of having to
      // snap from one side to the other. Mirrored at random. Stars mark the safe line.
      const flip = Math.random() < 0.5;
      const lane = (i) => lanes[flip ? 4 - i : i];
      [0, 1, 4].forEach((i) => createObstacle(lane(i), z));
      createCollectible(lane(2), z - SAFE_ROW_SPACING / 2);
      [0, 3, 4].forEach((i) => createObstacle(lane(i), z - SAFE_ROW_SPACING));
      createCollectible(lane(1), z - SAFE_ROW_SPACING * 1.5);
      [2, 3, 4].forEach((i) => createObstacle(lane(i), z - SAFE_ROW_SPACING * 2));
      createCollectible(lane(0), z - SAFE_ROW_SPACING * 2.4);
    },
  },
];

function shuffledLanes() {
  const order = [...lanes];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// SPAWN-AUDIT-BEGIN
// How far the slowest ship can slide sideways in `seconds`. Mirrors updateShip():
// top speed is 11 * agility and velocity eases in at a rate of 1 - 0.001^dt.
function slowestShipReach(seconds) {
  const topSpeed = 11 * Math.min(...Object.values(shipModels).map((model) => model.agility));
  const easeTime = 1 / Math.log(1000);
  const t = Math.max(0, seconds - REACTION_ALLOWANCE);
  return REACH_MARGIN * topSpeed * (t - easeTime * (1 - Math.exp(-t / easeTime)));
}

// x-ranges the ship can occupy while crossing a row of obstacles.
function freeIntervals(xs) {
  const blocked = xs.map((x) => [x - OBSTACLE_RADIUS, x + OBSTACLE_RADIUS]).sort((a, b) => a[0] - b[0]);
  const free = [];
  let cursor = -FIELD_HALF_WIDTH;
  for (const [low, high] of blocked) {
    if (low > cursor) free.push([cursor, Math.min(low, FIELD_HALF_WIDTH)]);
    cursor = Math.max(cursor, high);
  }
  if (cursor < FIELD_HALF_WIDTH) free.push([cursor, FIELD_HALF_WIDTH]);
  return free.filter(([low, high]) => high - low > 0.001);
}

function intersectIntervals(a, b) {
  const out = [];
  for (const [aLow, aHigh] of a) {
    for (const [bLow, bHigh] of b) {
      const low = Math.max(aLow, bLow);
      const high = Math.min(aHigh, bHigh);
      if (high - low > 0.001) out.push([low, high]);
    }
  }
  return out;
}

function recordPattern(pattern) {
  const recorded = [];
  patternRecorder = recorded;
  try {
    pattern.run(0, shuffledLanes());
  } finally {
    patternRecorder = null;
  }
  return recorded.map((obstacle) => ({ x: obstacle.x, offset: -obstacle.z }));
}

function groupObstacleRows(obstacles) {
  const rows = [];
  [...obstacles]
    .sort((a, b) => a.offset - b.offset)
    .forEach((obstacle) => {
      const row = rows[rows.length - 1];
      if (row && obstacle.offset - row.last <= ROW_GROUP_TOLERANCE) {
        row.xs.push(obstacle.x);
        row.last = obstacle.offset;
      } else {
        rows.push({ first: obstacle.offset, last: obstacle.offset, xs: [obstacle.x] });
      }
    });
  return rows.map((row) => ({ ...row, free: freeIntervals(row.xs) }));
}

// Can the slowest ship get through every row, starting anywhere in the first gap?
function rowsAreBeatable(rows) {
  if (!rows.length) return true;
  const usable = (intervals) => intervals.filter(([low, high]) => high - low >= MIN_USABLE_GAP);
  let reach = usable(rows[0].free);
  for (let i = 1; i < rows.length && reach.length; i++) {
    const slide = slowestShipReach((rows[i].first - rows[i - 1].last) / AUDIT_SPEED);
    const grown = reach.map(([low, high]) => [low - slide, high + slide]);
    reach = usable(intersectIntervals(grown, rows[i].free));
  }
  return reach.length > 0;
}

const AUDIT_SAMPLES = 60;
function auditSpawnPatterns() {
  spawnPatterns.forEach((pattern) => {
    let beatable = true;
    for (let i = 0; i < AUDIT_SAMPLES && beatable; i++) {
      const obstacles = recordPattern(pattern);
      if (i === 0) pattern.headOffset = obstacles.length ? Math.min(...obstacles.map((o) => o.offset)) : null;
      beatable = rowsAreBeatable(groupObstacleRows(obstacles));
    }
    if (!beatable) {
      console.warn(`[spawn audit] "${pattern.id}" can leave the slowest ship no way through. Widen its gaps or space its rows further apart.`);
    }
  });
}
// SPAWN-AUDIT-END

auditSpawnPatterns();

// z of the farthest-away hazard still on the track (Infinity when there are none).
function hazardTailZ() {
  let tail = Infinity;
  activeObjects.forEach((object) => {
    if (object.userData.type === "spinner") tail = Math.min(tail, object.position.z);
  });
  return tail;
}

// Returns false (and keeps the chosen pattern waiting) until there is room for it.
function spawnWave() {
  if (!pendingPattern) {
    const availablePatterns = spawnPatterns.filter((pattern) => pattern.minDistance <= state.distance);
    const repeatSafePatterns =
      availablePatterns.length > 1
        ? availablePatterns.filter((pattern) => pattern.id !== lastSpawnPatternId)
        : availablePatterns;
    pendingPattern = repeatSafePatterns[Math.floor(Math.random() * repeatSafePatterns.length)];
  }

  const pattern = pendingPattern;
  if (pattern.headOffset !== null && pattern.headOffset !== undefined) {
    const headZ = SPAWN_Z - pattern.headOffset;
    if (hazardTailZ() < headZ + MIN_WAVE_SEPARATION) return false;
  }

  pendingPattern = null;
  lastSpawnPatternId = pattern.id;
  pattern.run(SPAWN_Z, shuffledLanes());
  return true;
}

const burstColor = new THREE.Color();

function spawnBurst(color, origin, count = 16) {
  const p = particlePool;
  burstColor.set(color);
  for (let i = 0; i < count && p.count < MAX_PARTICLES; i++) {
    const n = p.count++;
    p.px[n] = origin.x;
    p.py[n] = origin.y;
    p.pz[n] = origin.z;
    p.vx[n] = (Math.random() - 0.5) * 9;
    p.vy[n] = Math.random() * 5;
    p.vz[n] = (Math.random() - 0.5) * 9;
    p.life[n] = 0.7 + Math.random() * 0.4;
    p.r[n] = burstColor.r;
    p.g[n] = burstColor.g;
    p.b[n] = burstColor.b;
  }
}

function clearParticles() {
  particlePool.count = 0;
  particleMesh.count = 0;
}

function updateParticles(dt) {
  const p = particlePool;
  let i = 0;
  while (i < p.count) {
    p.life[i] -= dt;
    if (p.life[i] <= 0) {
      const last = --p.count; // swap the last live particle into this slot
      if (i !== last) {
        p.px[i] = p.px[last];
        p.py[i] = p.py[last];
        p.pz[i] = p.pz[last];
        p.vx[i] = p.vx[last];
        p.vy[i] = p.vy[last];
        p.vz[i] = p.vz[last];
        p.life[i] = p.life[last];
        p.r[i] = p.r[last];
        p.g[i] = p.g[last];
        p.b[i] = p.b[last];
      }
      continue;
    }
    p.px[i] += p.vx[i] * dt;
    p.py[i] += p.vy[i] * dt;
    p.pz[i] += p.vz[i] * dt;
    p.vy[i] -= 7 * dt;
    i++;
  }

  // Write straight into the GPU buffers: scale and colour both fade as a spark ages.
  const matrices = particleMesh.instanceMatrix.array;
  const colors = particleMesh.instanceColor.array;
  for (let j = 0; j < p.count; j++) {
    const fade = Math.min(p.life[j], 1);
    const scale = 0.4 + 0.6 * fade;
    const m = j * 16;
    matrices[m] = scale;
    matrices[m + 5] = scale;
    matrices[m + 10] = scale;
    matrices[m + 12] = p.px[j];
    matrices[m + 13] = p.py[j];
    matrices[m + 14] = p.pz[j];
    matrices[m + 15] = 1;
    colors[j * 3] = p.r[j] * fade;
    colors[j * 3 + 1] = p.g[j] * fade;
    colors[j * 3 + 2] = p.b[j] * fade;
  }
  if (p.count || particleMesh.count) {
    particleMesh.count = p.count;
    particleMesh.instanceMatrix.needsUpdate = true;
    particleMesh.instanceColor.needsUpdate = true;
  }
}

function isBoosting() {
  return input.boost && state.boost > 0 && !state.boostLocked;
}

function maxShield() {
  return 100 * shipModels[selectedShip].shield;
}

let lastRun = { score: 0, ship: "Comet" };
let shareLabelTimer = 0;

function showCallout(text) {
  calloutEl.textContent = text;
  calloutEl.classList.remove("show");
  void calloutEl.offsetWidth; // restart the animation
  calloutEl.classList.add("show");
}

function awardCloseCall() {
  const bonus = CLOSE_CALL_POINTS * state.combo;
  state.score += bonus;
  showCallout(`CLOSE CALL +${bonus}`);
  playTone({ type: "sine", startFrequency: 520, endFrequency: 900, duration: 0.1, volume: 0.1 });
}

function resetInput() {
  input.left = false;
  input.right = false;
  input.boost = false;
  input.pointerX = null;
}

function setPaused(paused) {
  if (paused === state.paused || (paused && !state.running)) return;
  state.paused = paused;
  pausePanel.classList.toggle("hidden", !paused);
  resetInput();
  if (paused) stopEngineHum();
  else resumeAudio();
}

function resetGame() {
  resumeAudio();
  activeObjects.splice(0).forEach((object) => scene.remove(object));
  clearParticles();
  lastSpawnPatternId = null;
  pendingPattern = null;
  Object.assign(state, {
    running: true,
    paused: false,
    score: 0,
    combo: 1,
    speed: 18,
    distance: 0,
    shield: maxShield(),
    boost: 100,
    boostLocked: false,
    invincible: 1,
    spawnTimer: 0,
    sparkTimer: 0,
  });
  ship.position.set(0, 1.05, 4);
  ship.rotation.set(0, 0, 0);
  ship.userData.velocity = 0;
  finalMessage.classList.remove("new-best");
  gameOverPanel.classList.add("hidden");
  startPanel.classList.add("hidden");
  pausePanel.classList.add("hidden");
  calloutEl.classList.remove("show");
  updateHud();
}

function finishGame() {
  state.running = false;
  stopEngineHum();
  const runScore = Math.floor(state.score);
  const previousHighScore = highScore;
  const isNewHighScore = runScore > previousHighScore;
  lastRun = { score: runScore, ship: shipModels[selectedShip].name };
  shareButton.textContent = "Share Score";

  finalMessage.classList.toggle("new-best", isNewHighScore);
  if (isNewHighScore) {
    saveHighScore(runScore);
    finalScore.textContent = `Score ${runScore.toLocaleString()}`;
    finalMessage.textContent = `NEW BEST! ${shipModels[selectedShip].name} set the bar at ${highScore.toLocaleString()}.`;
  } else {
    finalScore.textContent = `Score ${runScore.toLocaleString()} - Best ${highScore.toLocaleString()}`;
    finalMessage.textContent =
      state.score > 3000
        ? `${shipModels[selectedShip].name} left a comet trail through the scoreboard.`
        : state.score > 1200
          ? `${shipModels[selectedShip].name} handled the storm cleanly.`
          : "Tiny sparks still count. Pick a ship and run it back.";
  }
  updateHud();
  gameOverPanel.classList.remove("hidden");
}

async function shareScore() {
  const text = `I scored ${lastRun.score.toLocaleString()} in Star Skimmer 3D flying the ${lastRun.ship}. Can you beat it?`;
  const flash = (label) => {
    shareButton.textContent = label;
    window.clearTimeout(shareLabelTimer);
    shareLabelTimer = window.setTimeout(() => {
      shareButton.textContent = "Share Score";
    }, 1800);
  };
  try {
    // Phones get the native share sheet; desktops just get the text copied.
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title: "Star Skimmer 3D", text, url: SHARE_URL });
      return;
    }
    await navigator.clipboard.writeText(`${text} ${SHARE_URL}`);
    flash("Copied!");
  } catch (error) {
    if (error && error.name === "AbortError") return; // the player closed the share sheet
    window.prompt("Copy this to share your score:", `${text} ${SHARE_URL}`);
  }
}

function updateShip(dt) {
  const keyboardSteer = Number(input.right) - Number(input.left);
  const pointerSteer =
    input.pointerX === null
      ? 0
      : THREE.MathUtils.clamp((input.pointerX / window.innerWidth - 0.5) * 2.3, -1, 1);
  const steer = pointerSteer || keyboardSteer;
  const targetVelocity = steer * 11 * shipModels[selectedShip].agility;
  ship.userData.velocity = THREE.MathUtils.lerp(ship.userData.velocity || 0, targetVelocity, 1 - Math.pow(0.001, dt));
  ship.position.x += ship.userData.velocity * dt;
  ship.position.x = THREE.MathUtils.clamp(ship.position.x, -5.7, 5.7);
  ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -steer * 0.42, 1 - Math.pow(0.0008, dt));
  ship.rotation.y = THREE.MathUtils.lerp(ship.rotation.y, steer * 0.22, 1 - Math.pow(0.002, dt));
  ship.position.y = 1.05 + Math.sin(clock.elapsedTime * 6.2) * 0.12;

  ship.userData.flame.scale.setScalar(isBoosting() ? 1.7 : 1);
  ship.userData.halo.material.opacity = state.invincible > 0 ? 0.75 : 0.28 + Math.sin(clock.elapsedTime * 5) * 0.08;
}

function updateObjects(dt) {
  for (let i = activeObjects.length - 1; i >= 0; i--) {
    const object = activeObjects[i];
    const data = object.userData;
    object.position.z += state.speed * dt;
    object.rotation.x += dt * 2;
    object.rotation.y += dt * (data.spin || 1.4);
    object.visible = object.position.z > CULL_Z;

    const dx = object.position.x - ship.position.x;
    const dz = object.position.z - ship.position.z;
    const hit = Math.hypot(dx, dz) < data.radius;

    if (hit) {
      if (data.type === "star") {
        state.score += 120 * state.combo;
        const previousCombo = state.combo;
        state.combo = Math.min(previousCombo + 1, 9);
        if (state.combo === 9 && previousCombo < 9) showCallout("MAX COMBO x9");
        playStarChime();
        spawnBurst(palette.yellow, object.position, 18);
        removeActive(i);
      } else if (data.type === "boost") {
        state.score += 220 * state.combo;
        state.speed += 4;
        state.invincible = 0.65;
        playBoostWhoosh();
        spawnBurst(palette.cyan, object.position, 28);
        removeActive(i);
      } else if (state.invincible <= 0) {
        state.shield -= 34;
        state.combo = 1;
        state.invincible = 1.1;
        playHitAlarm();
        spawnBurst(palette.pink, ship.position, 34);
        removeActive(i);
        if (state.shield <= 0) finishGame();
      }
    } else if (object.position.z > 18) {
      removeActive(i);
    } else if (data.type === "spinner" && !data.passed && object.position.z >= ship.position.z) {
      // The spinner just drew level with the ship without hitting it: a close call if it was tight.
      data.passed = true;
      const gap = Math.abs(dx) - data.radius;
      if (gap >= 0 && gap < CLOSE_CALL_WINDOW) awardCloseCall();
    }
  }
}

function removeActive(index) {
  scene.remove(activeObjects[index]); // geometry and materials are shared, so nothing to dispose
  activeObjects.splice(index, 1);
}

// Only touch the page when a number actually changed.
const hudCache = { score: -1, best: -1, combo: "", speed: "", shield: -1, boost: -1 };

function updateHud() {
  const score = Math.floor(state.score);
  if (score !== hudCache.score) {
    hudCache.score = score;
    scoreEl.textContent = score.toLocaleString();
  }
  const best = Math.floor(highScore);
  if (best !== hudCache.best) {
    hudCache.best = best;
    highScoreEl.textContent = best.toLocaleString();
  }
  const combo = `x${state.combo}`;
  if (combo !== hudCache.combo) {
    hudCache.combo = combo;
    comboEl.textContent = combo;
  }
  const speed = (state.speed / startingSpeed).toFixed(1);
  if (speed !== hudCache.speed) {
    hudCache.speed = speed;
    speedEl.textContent = speed;
  }
  const shield = Math.round((Math.max(state.shield, 0) / maxShield()) * 200) / 200;
  if (shield !== hudCache.shield) {
    hudCache.shield = shield;
    shieldEl.style.transform = `scaleX(${shield})`;
  }
  const boost = Math.round(Math.max(state.boost, 0) * 2) / 200;
  if (boost !== hudCache.boost) {
    hudCache.boost = boost;
    boostEl.style.transform = `scaleX(${boost})`;
  }
}

function updateCamera(dt) {
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, ship.position.x * 0.28, 1 - Math.pow(0.003, dt));
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 6.2 + Math.sin(clock.elapsedTime * 2) * 0.2, 0.04);
  camera.lookAt(ship.position.x * 0.24, 1.2, -10);
}

// Drops render resolution when frames run slow, and wins it back when there is headroom.
function updateQuality(rawDt) {
  if (rawDt > 0.25) return; // a tab switch or hiccup, not a slow frame
  quality.smoothed += (rawDt - quality.smoothed) * 0.05;
  quality.sinceCheck += rawDt;
  quality.elapsed += rawDt;
  if (quality.sinceCheck < 1.5) return;
  quality.sinceCheck = 0;

  let next = quality.current;
  if (quality.smoothed > 1 / 40 && quality.current > quality.floor) {
    next = Math.max(quality.floor, quality.current - 0.25);
    // Went slow soon after stepping up: that level is too much for this device.
    if (quality.elapsed - quality.lastRaise < 8) quality.ceiling = next;
    quality.goodChecks = 0;
  } else if (quality.smoothed < 1 / 52 && quality.current < quality.ceiling) {
    quality.goodChecks += 1;
    if (quality.goodChecks >= 3) {
      next = Math.min(quality.ceiling, quality.current + 0.25);
      quality.lastRaise = quality.elapsed;
      quality.goodChecks = 0;
    }
  } else {
    quality.goodChecks = 0;
  }

  if (next !== quality.current) {
    quality.current = next;
    renderer.setPixelRatio(next);
    resize();
  }
}

function animate() {
  const rawDt = clock.getDelta();
  const dt = Math.min(rawDt, 0.04);
  requestAnimationFrame(animate);
  if (state.paused) return; // nothing moves, nothing renders, the GPU rests

  updateQuality(rawDt);
  starField.rotation.y += dt * 0.012;
  track.position.z = (track.position.z + state.speed * dt) % 6;

  if (state.running) {
    const boosted = isBoosting();
    const cruiseSpeed = Math.min(startingSpeed + state.distance * 0.012, maxCruiseSpeed);
    const targetSpeed = boosted ? cruiseSpeed * boostSpeedMultiplier : cruiseSpeed;
    state.speed = THREE.MathUtils.lerp(state.speed, targetSpeed, 0.018);
    if (boosted) {
      state.boost = Math.max(0, state.boost - dt * BOOST_DRAIN);
      if (state.boost <= 0) state.boostLocked = true;
    } else {
      state.boost = Math.min(100, state.boost + dt * BOOST_REGEN);
      if (state.boostLocked && state.boost >= BOOST_REARM) state.boostLocked = false;
    }
    state.shield = Math.min(maxShield(), state.shield + dt * SHIELD_REGEN);

    state.distance += state.speed * dt;
    state.score += dt * state.speed * 2.4 * state.combo;
    state.spawnTimer -= dt;
    state.invincible -= dt;
    state.sparkTimer -= dt;

    if (state.spawnTimer <= 0 && spawnWave()) {
      state.spawnTimer = Math.max(0.74, 1.24 - state.distance * 0.0009);
    }
    if (state.sparkTimer <= 0) {
      spawnBurst(boosted ? palette.cyan : palette.mint, ship.position, boosted ? 8 : 3);
      state.sparkTimer = boosted ? 0.08 : 0.2;
    }

    updateShip(dt);
    updateObjects(dt);
    updateParticles(dt);
    updateHud();
  } else {
    state.invincible -= dt;
    ship.rotation.y += dt * 0.35;
    ship.position.y = 1.05 + Math.sin(clock.elapsedTime * 2.5) * 0.18;
    updateParticles(dt);
  }

  audioState.humTimer -= dt;
  if (audioState.humTimer <= 0) {
    audioState.humTimer = HUM_UPDATE_INTERVAL;
    updateEngineHum();
  }

  ship.visible = state.invincible <= 0 || Math.sin(clock.elapsedTime * 42) > -0.25;
  updateCamera(dt);
  renderer.render(scene, camera);
}

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}

// Compile every shader up front so the first star or spinner of a run never causes a hitch.
function prewarmShaders() {
  createCollectible(0, 400);
  createObstacle(0, 400);
  createBoostRing(0, 400);
  renderer.compile(scene, camera);
  while (activeObjects.length) removeActive(activeObjects.length - 1);
}

window.addEventListener("resize", resize);
window.addEventListener("blur", resetInput);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) setPaused(true);
});
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = true;
  if (event.code === "ArrowRight" || event.code === "KeyD") input.right = true;
  if (event.code === "KeyM" && !event.repeat) setMuted(!audioState.muted);
  if ((event.code === "KeyP" || event.code === "Escape") && !event.repeat && state.running) {
    setPaused(!state.paused);
  }
  if (event.code === "Space") {
    input.boost = true;
    if (!state.running && !startPanel.classList.contains("hidden")) resetGame();
  }
});
window.addEventListener("keyup", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = false;
  if (event.code === "ArrowRight" || event.code === "KeyD") input.right = false;
  if (event.code === "Space") input.boost = false;
});
window.addEventListener("pointerdown", (event) => {
  input.pointerX = event.clientX;
  input.boost = true;
});
window.addEventListener("pointermove", (event) => {
  if (event.buttons > 0) input.pointerX = event.clientX;
});
window.addEventListener("pointerup", () => {
  input.pointerX = null;
  input.boost = false;
});
window.addEventListener("pointercancel", () => {
  input.pointerX = null;
  input.boost = false;
});

startButton.addEventListener("click", resetGame);
restartButton.addEventListener("click", resetGame);
resumeButton.addEventListener("click", () => setPaused(false));
shareButton.addEventListener("click", shareScore);
changeShipButton.addEventListener("click", () => {
  state.running = false;
  gameOverPanel.classList.add("hidden");
  startPanel.classList.remove("hidden");
});
shipCards.forEach((card) => {
  card.addEventListener("click", () => setShipModel(card.dataset.ship));
});

createMuteButton();
setShipModel(selectedShip);
resize();
updateHud();
prewarmShaders();

// Test hook: the automated checks set this flag before loading the page. Inert for players.
if (window.__SKIMMER_DEBUG__) {
  window.__skimmer = { state, input, activeObjects, particlePool, quality, getShip: () => ship, spawnBurst, setPaused, createObstacle, createCollectible, resetGame };
}

animate();
