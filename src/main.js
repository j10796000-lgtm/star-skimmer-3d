import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#game");
const scoreEl = document.querySelector("#score");
const comboEl = document.querySelector("#combo");
const speedEl = document.querySelector("#speed");
const shieldEl = document.querySelector("#shield");
const shipNameEl = document.querySelector("#shipName");
const startPanel = document.querySelector("#startPanel");
const gameOverPanel = document.querySelector("#gameOverPanel");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");
const changeShipButton = document.querySelector("#changeShipButton");
const shipCards = document.querySelectorAll(".ship-card");
const finalScore = document.querySelector("#finalScore");
const finalMessage = document.querySelector("#finalMessage");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07110f, 0.042);

const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 240);
camera.position.set(0, 6.4, 12.5);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const clock = new THREE.Clock();
const input = { left: false, right: false, boost: false, pointerX: null };
const lanes = [-4.8, -2.4, 0, 2.4, 4.8];
const activeObjects = [];
const particles = [];
let selectedShip = "comet";

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
  for (let z = -130; z < 26; z += 6) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(13, 0.035, 0.035), gridMat);
    line.position.set(0, 0, z);
    group.add(line);
  }
  for (const x of [-6.2, -3.1, 0, 3.1, 6.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 170), gridMat);
    rail.position.set(x, 0.02, -52);
    group.add(rail);
  }
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
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.48, 1),
    new THREE.MeshStandardMaterial({
      color: palette.yellow,
      emissive: palette.yellow,
      emissiveIntensity: 1.25,
      roughness: 0.2,
      metalness: 0.2,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.045, 8, 36),
    new THREE.MeshBasicMaterial({ color: palette.mint }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(core, ring);
  group.position.set(x, 1.18, z);
  group.userData = { type: "star", radius: 0.9 };
  scene.add(group);
  activeObjects.push(group);
}

function createObstacle(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: palette.pink,
    emissive: palette.pink,
    emissiveIntensity: 0.65,
    roughness: 0.28,
    metalness: 0.32,
  });
  const barA = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 0.28), mat);
  const barB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.1, 0.28), mat);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), mat);
  group.add(barA, barB, core);
  group.position.set(x, 1.28, z);
  group.userData = { type: "spinner", radius: 1.25, spin: Math.random() > 0.5 ? 1 : -1 };
  scene.add(group);
  activeObjects.push(group);
}

function createBoostRing(x, z) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.09, 12, 48),
    new THREE.MeshStandardMaterial({
      color: palette.cyan,
      emissive: palette.cyan,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.3,
    }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.position.set(x, 1.25, z);
  ring.userData = { type: "boost", radius: 1.15 };
  scene.add(ring);
  activeObjects.push(ring);
}

function spawnWave() {
  const z = -96;
  const pattern = Math.random();
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);

  if (pattern < 0.38) {
    shuffled.slice(0, 3).forEach((x, index) => createCollectible(x, z - index * 3.6));
    createObstacle(shuffled[4], z - 2);
  } else if (pattern < 0.72) {
    createBoostRing(shuffled[0], z - 4);
    createObstacle(shuffled[1], z - 10);
    createCollectible(shuffled[2], z - 16);
    createCollectible(shuffled[3], z - 20);
  } else {
    shuffled.slice(0, 2).forEach((x) => createObstacle(x, z));
    shuffled.slice(2, 5).forEach((x, index) => createCollectible(x, z - 5 - index * 4));
  }
}

function spawnBurst(color, origin, count = 16) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  for (let i = 0; i < count; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat.clone());
    dot.position.copy(origin);
    dot.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      Math.random() * 5,
      (Math.random() - 0.5) * 9,
    );
    dot.userData.life = 0.7 + Math.random() * 0.4;
    particles.push(dot);
    scene.add(dot);
  }
}

function resetGame() {
  activeObjects.splice(0).forEach((object) => scene.remove(object));
  particles.splice(0).forEach((object) => scene.remove(object));
  Object.assign(state, {
    running: true,
    score: 0,
    combo: 1,
    speed: 18,
    distance: 0,
    shield: 100 * shipModels[selectedShip].shield,
    invincible: 1,
    spawnTimer: 0,
    sparkTimer: 0,
  });
  ship.position.set(0, 1.05, 4);
  ship.rotation.set(0, 0, 0);
  ship.userData.velocity = 0;
  gameOverPanel.classList.add("hidden");
  startPanel.classList.add("hidden");
  updateHud();
}

function finishGame() {
  state.running = false;
  finalScore.textContent = `Score ${Math.floor(state.score).toLocaleString()}`;
  finalMessage.textContent =
    state.score > 3000
      ? `${shipModels[selectedShip].name} left a comet trail through the scoreboard.`
      : state.score > 1200
        ? `${shipModels[selectedShip].name} handled the storm cleanly.`
        : "Tiny sparks still count. Pick a ship and run it back.";
  gameOverPanel.classList.remove("hidden");
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

  const flame = ship.getObjectByName("flame");
  flame.scale.setScalar(input.boost && state.shield > 0 ? 1.7 : 1);
  const shieldHalo = ship.getObjectByName("shieldHalo");
  shieldHalo.material.opacity = state.invincible > 0 ? 0.75 : 0.28 + Math.sin(clock.elapsedTime * 5) * 0.08;
}

function updateObjects(dt) {
  for (let i = activeObjects.length - 1; i >= 0; i--) {
    const object = activeObjects[i];
    object.position.z += state.speed * dt;
    object.rotation.x += dt * 2;
    object.rotation.y += dt * (object.userData.spin || 1.4);

    const dx = object.position.x - ship.position.x;
    const dz = object.position.z - ship.position.z;
    const hit = Math.hypot(dx, dz) < object.userData.radius;

    if (hit) {
      if (object.userData.type === "star") {
        state.score += 120 * state.combo;
        state.combo = Math.min(state.combo + 1, 9);
        spawnBurst(palette.yellow, object.position, 18);
        removeActive(i);
      } else if (object.userData.type === "boost") {
        state.score += 220 * state.combo;
        state.speed += 4;
        state.invincible = 0.65;
        spawnBurst(palette.cyan, object.position, 28);
        removeActive(i);
      } else if (state.invincible <= 0) {
        state.shield -= 34;
        state.combo = 1;
        state.invincible = 1.1;
        spawnBurst(palette.pink, ship.position, 34);
        removeActive(i);
        if (state.shield <= 0) finishGame();
      }
    } else if (object.position.z > 18) {
      removeActive(i);
    }
  }
}

function removeActive(index) {
  scene.remove(activeObjects[index]);
  activeObjects.splice(index, 1);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const dot = particles[i];
    dot.userData.life -= dt;
    dot.position.addScaledVector(dot.userData.velocity, dt);
    dot.userData.velocity.y -= 7 * dt;
    dot.material.opacity = Math.max(dot.userData.life, 0);
    if (dot.userData.life <= 0) {
      scene.remove(dot);
      particles.splice(i, 1);
    }
  }
}

function updateHud() {
  scoreEl.textContent = Math.floor(state.score).toLocaleString();
  comboEl.textContent = `x${state.combo}`;
  speedEl.textContent = (state.speed / 18).toFixed(1);
  shieldEl.style.transform = `scaleX(${Math.max(state.shield, 0) / (100 * shipModels[selectedShip].shield)})`;
}

function updateCamera(dt) {
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, ship.position.x * 0.28, 1 - Math.pow(0.003, dt));
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 6.2 + Math.sin(clock.elapsedTime * 2) * 0.2, 0.04);
  camera.lookAt(ship.position.x * 0.24, 1.2, -10);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  requestAnimationFrame(animate);

  starField.rotation.y += dt * 0.012;
  track.position.z = (track.position.z + state.speed * dt) % 6;

  if (state.running) {
    const boosted = input.boost && state.shield > 0;
    state.speed = THREE.MathUtils.lerp(state.speed, boosted ? 32 : 18 + state.distance * 0.012, 0.018);
    if (boosted) state.shield = Math.max(0, state.shield - dt * 16);
    else state.shield = Math.min(100, state.shield + dt * 4);

    state.distance += state.speed * dt;
    state.score += dt * state.speed * 2.4 * state.combo;
    state.spawnTimer -= dt;
    state.invincible -= dt;
    state.sparkTimer -= dt;

    if (state.spawnTimer <= 0) {
      spawnWave();
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

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = true;
  if (event.code === "ArrowRight" || event.code === "KeyD") input.right = true;
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
changeShipButton.addEventListener("click", () => {
  state.running = false;
  gameOverPanel.classList.add("hidden");
  startPanel.classList.remove("hidden");
});
shipCards.forEach((card) => {
  card.addEventListener("click", () => setShipModel(card.dataset.ship));
});

setShipModel(selectedShip);
resize();
animate();
import * as THREE from "https://unpkg.com/three@0.164.1/build/three.module.js";

const canvas = document.querySelector("#game");
const scoreEl = document.querySelector("#score");
const comboEl = document.querySelector("#combo");
const speedEl = document.querySelector("#speed");
const shieldEl = document.querySelector("#shield");
const startPanel = document.querySelector("#startPanel");
const gameOverPanel = document.querySelector("#gameOverPanel");
const startButton = document.querySelector("#startButton");
const restartButton = document.querySelector("#restartButton");
const finalScore = document.querySelector("#finalScore");
const finalMessage = document.querySelector("#finalMessage");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x07110f, 0.042);

const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 240);
camera.position.set(0, 6.4, 12.5);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

const clock = new THREE.Clock();
const input = { left: false, right: false, boost: false, pointerX: null };
const lanes = [-4.8, -2.4, 0, 2.4, 4.8];
const activeObjects = [];
const particles = [];

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
};

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

const ship = createShip();
scene.add(ship);

const track = createTrack();
scene.add(track);

const starField = createStarField();
scene.add(starField);

function createShip() {
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xf6fff5,
    roughness: 0.32,
    metalness: 0.42,
    emissive: 0x102a27,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: palette.cyan,
    emissive: palette.cyan,
    emissiveIntensity: 0.8,
    roughness: 0.25,
    metalness: 0.2,
  });
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.8, 2.5, 4), bodyMat);
  nose.rotation.x = Math.PI / 2;
  nose.scale.set(1.1, 0.62, 1);
  group.add(nose);

  const wingGeo = new THREE.BoxGeometry(2.9, 0.12, 0.76);
  const wing = new THREE.Mesh(wingGeo, trimMat);
  wing.position.z = 0.52;
  group.add(wing);

  const cockpit = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 18, 10),
    new THREE.MeshStandardMaterial({
      color: palette.yellow,
      emissive: palette.yellow,
      emissiveIntensity: 0.45,
      roughness: 0.18,
      metalness: 0.1,
    }),
  );
  cockpit.position.set(0, 0.32, -0.2);
  cockpit.scale.set(1, 0.55, 1.4);
  group.add(cockpit);

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.34, 1.2, 16),
    new THREE.MeshBasicMaterial({ color: palette.pink, transparent: true, opacity: 0.85 }),
  );
  flame.position.z = 1.62;
  flame.rotation.x = -Math.PI / 2;
  flame.name = "flame";
  group.add(flame);

  group.position.set(0, 1.05, 4);
  return group;
}

function createTrack() {
  const group = new THREE.Group();
  const gridMat = new THREE.MeshBasicMaterial({
    color: palette.cyan,
    transparent: true,
    opacity: 0.18,
  });
  for (let z = -130; z < 26; z += 6) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(13, 0.035, 0.035), gridMat);
    line.position.set(0, 0, z);
    group.add(line);
  }
  for (const x of [-6.2, -3.1, 0, 3.1, 6.2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.035, 170), gridMat);
    rail.position.set(x, 0.02, -52);
    group.add(rail);
  }
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
  const group = new THREE.Group();
  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.48, 1),
    new THREE.MeshStandardMaterial({
      color: palette.yellow,
      emissive: palette.yellow,
      emissiveIntensity: 1.25,
      roughness: 0.2,
      metalness: 0.2,
    }),
  );
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.045, 8, 36),
    new THREE.MeshBasicMaterial({ color: palette.mint }),
  );
  ring.rotation.x = Math.PI / 2;
  group.add(core, ring);
  group.position.set(x, 1.18, z);
  group.userData = { type: "star", radius: 0.9 };
  scene.add(group);
  activeObjects.push(group);
}

function createObstacle(x, z) {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({
    color: palette.pink,
    emissive: palette.pink,
    emissiveIntensity: 0.65,
    roughness: 0.28,
    metalness: 0.32,
  });
  const barA = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.28, 0.28), mat);
  const barB = new THREE.Mesh(new THREE.BoxGeometry(0.28, 2.1, 0.28), mat);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.36, 16, 10), mat);
  group.add(barA, barB, core);
  group.position.set(x, 1.28, z);
  group.userData = { type: "spinner", radius: 1.25, spin: Math.random() > 0.5 ? 1 : -1 };
  scene.add(group);
  activeObjects.push(group);
}

function createBoostRing(x, z) {
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(1.1, 0.09, 12, 48),
    new THREE.MeshStandardMaterial({
      color: palette.cyan,
      emissive: palette.cyan,
      emissiveIntensity: 1.1,
      roughness: 0.2,
      metalness: 0.3,
    }),
  );
  ring.rotation.y = Math.PI / 2;
  ring.position.set(x, 1.25, z);
  ring.userData = { type: "boost", radius: 1.15 };
  scene.add(ring);
  activeObjects.push(ring);
}

function spawnWave() {
  const z = -96;
  const pattern = Math.random();
  const shuffled = [...lanes].sort(() => Math.random() - 0.5);

  if (pattern < 0.38) {
    shuffled.slice(0, 3).forEach((x, index) => createCollectible(x, z - index * 3.6));
    createObstacle(shuffled[4], z - 2);
  } else if (pattern < 0.72) {
    createBoostRing(shuffled[0], z - 4);
    createObstacle(shuffled[1], z - 10);
    createCollectible(shuffled[2], z - 16);
    createCollectible(shuffled[3], z - 20);
  } else {
    shuffled.slice(0, 2).forEach((x) => createObstacle(x, z));
    shuffled.slice(2, 5).forEach((x, index) => createCollectible(x, z - 5 - index * 4));
  }
}

function spawnBurst(color, origin, count = 16) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
  for (let i = 0; i < count; i++) {
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), mat.clone());
    dot.position.copy(origin);
    dot.userData.velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 9,
      Math.random() * 5,
      (Math.random() - 0.5) * 9,
    );
    dot.userData.life = 0.7 + Math.random() * 0.4;
    particles.push(dot);
    scene.add(dot);
  }
}

function resetGame() {
  activeObjects.splice(0).forEach((object) => scene.remove(object));
  particles.splice(0).forEach((object) => scene.remove(object));
  Object.assign(state, {
    running: true,
    score: 0,
    combo: 1,
    speed: 18,
    distance: 0,
    shield: 100,
    invincible: 1,
    spawnTimer: 0,
    sparkTimer: 0,
  });
  ship.position.set(0, 1.05, 4);
  gameOverPanel.classList.add("hidden");
  startPanel.classList.add("hidden");
  updateHud();
}

function finishGame() {
  state.running = false;
  finalScore.textContent = `Score ${Math.floor(state.score).toLocaleString()}`;
  finalMessage.textContent =
    state.score > 3000
      ? "That run had fireworks in its shoes."
      : state.score > 1200
        ? "Clean skimming. The storm noticed."
        : "Tiny sparks still count. Again.";
  gameOverPanel.classList.remove("hidden");
}

function updateShip(dt) {
  const keyboardSteer = Number(input.right) - Number(input.left);
  const pointerSteer =
    input.pointerX === null
      ? 0
      : THREE.MathUtils.clamp((input.pointerX / window.innerWidth - 0.5) * 2.3, -1, 1);
  const steer = pointerSteer || keyboardSteer;
  const targetVelocity = steer * 11;
  ship.userData.velocity = THREE.MathUtils.lerp(ship.userData.velocity || 0, targetVelocity, 1 - Math.pow(0.001, dt));
  ship.position.x += ship.userData.velocity * dt;
  ship.position.x = THREE.MathUtils.clamp(ship.position.x, -5.7, 5.7);
  ship.rotation.z = THREE.MathUtils.lerp(ship.rotation.z, -steer * 0.42, 1 - Math.pow(0.0008, dt));
  ship.rotation.y = THREE.MathUtils.lerp(ship.rotation.y, steer * 0.22, 1 - Math.pow(0.002, dt));
  ship.position.y = 1.05 + Math.sin(clock.elapsedTime * 6.2) * 0.12;

  const flame = ship.getObjectByName("flame");
  flame.scale.setScalar(input.boost && state.shield > 0 ? 1.7 : 1);
}

function updateObjects(dt) {
  for (let i = activeObjects.length - 1; i >= 0; i--) {
    const object = activeObjects[i];
    object.position.z += state.speed * dt;
    object.rotation.x += dt * 2;
    object.rotation.y += dt * (object.userData.spin || 1.4);

    const dx = object.position.x - ship.position.x;
    const dz = object.position.z - ship.position.z;
    const hit = Math.hypot(dx, dz) < object.userData.radius;

    if (hit) {
      if (object.userData.type === "star") {
        state.score += 120 * state.combo;
        state.combo = Math.min(state.combo + 1, 9);
        spawnBurst(palette.yellow, object.position, 18);
        removeActive(i);
      } else if (object.userData.type === "boost") {
        state.score += 220 * state.combo;
        state.speed += 4;
        state.invincible = 0.65;
        spawnBurst(palette.cyan, object.position, 28);
        removeActive(i);
      } else if (state.invincible <= 0) {
        state.shield -= 34;
        state.combo = 1;
        state.invincible = 1.1;
        spawnBurst(palette.pink, ship.position, 34);
        removeActive(i);
        if (state.shield <= 0) finishGame();
      }
    } else if (object.position.z > 18) {
      removeActive(i);
    }
  }
}

function removeActive(index) {
  scene.remove(activeObjects[index]);
  activeObjects.splice(index, 1);
}

function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const dot = particles[i];
    dot.userData.life -= dt;
    dot.position.addScaledVector(dot.userData.velocity, dt);
    dot.userData.velocity.y -= 7 * dt;
    dot.material.opacity = Math.max(dot.userData.life, 0);
    if (dot.userData.life <= 0) {
      scene.remove(dot);
      particles.splice(i, 1);
    }
  }
}

function updateHud() {
  scoreEl.textContent = Math.floor(state.score).toLocaleString();
  comboEl.textContent = `x${state.combo}`;
  speedEl.textContent = (state.speed / 18).toFixed(1);
  shieldEl.style.transform = `scaleX(${Math.max(state.shield, 0) / 100})`;
}

function updateCamera(dt) {
  camera.position.x = THREE.MathUtils.lerp(camera.position.x, ship.position.x * 0.28, 1 - Math.pow(0.003, dt));
  camera.position.y = THREE.MathUtils.lerp(camera.position.y, 6.2 + Math.sin(clock.elapsedTime * 2) * 0.2, 0.04);
  camera.lookAt(ship.position.x * 0.24, 1.2, -10);
}

function animate() {
  const dt = Math.min(clock.getDelta(), 0.04);
  requestAnimationFrame(animate);

  starField.rotation.y += dt * 0.012;
  track.position.z = (track.position.z + state.speed * dt) % 6;

  if (state.running) {
    const boosted = input.boost && state.shield > 0;
    state.speed = THREE.MathUtils.lerp(state.speed, boosted ? 32 : 18 + state.distance * 0.012, 0.018);
    if (boosted) state.shield = Math.max(0, state.shield - dt * 16);
    else state.shield = Math.min(100, state.shield + dt * 4);

    state.distance += state.speed * dt;
    state.score += dt * state.speed * 2.4 * state.combo;
    state.spawnTimer -= dt;
    state.invincible -= dt;
    state.sparkTimer -= dt;

    if (state.spawnTimer <= 0) {
      spawnWave();
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

window.addEventListener("resize", resize);
window.addEventListener("keydown", (event) => {
  if (event.code === "ArrowLeft" || event.code === "KeyA") input.left = true;
  if (event.code === "ArrowRight" || event.code === "KeyD") input.right = true;
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

resize();
animate();
