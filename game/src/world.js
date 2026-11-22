// Neon Harbor: the whole simulation — no drawing, no browser in it. The player walks or
// drives around Marlowe Bay, steals cars, dodges or fights the Harbor Police, and works
// six story jobs for Mara Voss. step() advances one fixed step and returns what happened
// as bit flags, so the caller can react (sound, panels) without the world knowing about
// screens. Pools are allocated once at boot; nothing here allocates in the hot loop.
import { BULLET, CAR, FIELD, PED, PLAYER, ROAD, STEP, TRAFFIC_COUNT, PARKED_COUNT, PED_COUNT, WANTED, WATER_Y, WORLD } from './config.js';
import { createCity } from './city.js';

export const EVENT_HIT = 1;
export const EVENT_CASH = 2;
export const EVENT_OVER = 4;
export const EVENT_BUSTED = 8;
export const EVENT_CRASH = 16;
export const EVENT_SHOT = 32;
export const EVENT_WANTED_UP = 64;
export const EVENT_MISSION = 128;
export const EVENT_MISSION_START = 256;
export const EVENT_ENTER_CAR = 512;
export const EVENT_STEAL = 1024;
export const EVENT_ARREST_WARN = 2048;

const TAU = Math.PI * 2;

function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}
function dist2(ax, ay, bx, by) {
  const dx = ax - bx;
  const dy = ay - by;
  return dx * dx + dy * dy;
}
function angleTo(ax, ay, bx, by) {
  return Math.atan2(by - ay, bx - ax);
}
function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Six jobs for Mara Voss. Rook owes her fifty grand; each job pays the debt down. */
export const MISSIONS = [
  {
    id: 'first-gear',
    title: 'Job 1: First Gear',
    reward: 500,
    briefing: [
      'Mara Voss: "Rook. You owe me fifty grand."',
      '"Start small. Take a car — any car — and bring it to my garage."',
      'Steal a car, then drive it to Voss Garage.',
    ],
    steps: [
      { type: 'steal', text: 'Steal a car' },
      { type: 'drive', x: 640, y: 780, radius: 100, text: 'Drive to Voss Garage' },
    ],
  },
  {
    id: 'the-parcel',
    title: 'Job 2: The Parcel',
    reward: 800,
    briefing: [
      'Mara Voss: "A package is waiting at the Docks."',
      '"Pick it up and take it to The Gull Cafe. Ninety seconds."',
      '"The Gulls are watching the docks. Don\'t dawdle."',
    ],
    steps: [
      { type: 'goto', x: 960, y: 2160, radius: 90, text: 'Pick up the package at the Docks' },
      { type: 'deliver', x: 2560, y: 1600, radius: 100, text: 'Deliver the package to The Gull Cafe', timer: 90 },
    ],
  },
  {
    id: 'tail-the-gull',
    title: 'Job 3: Tail the Gull',
    reward: 1200,
    briefing: [
      'Mara Voss: "One of the Gulls is running courier jobs for the Kings."',
      '"Follow his teal sedan. Learn where it goes. Don\'t lose it."',
      'Stay close to the marked car — but don\'t get spotted.',
    ],
    steps: [
      { type: 'follow', need: 15, text: 'Tail the teal courier — stay within sight' },
    ],
  },
  {
    id: 'hot-pursuit',
    title: 'Job 4: Hot Pursuit',
    reward: 1500,
    briefing: [
      'Mara Voss: "Somebody tipped the Harbor Police. They know your face now."',
      '"Three stars, Rook. Lose them, or this ends in a cell."',
      'Get your wanted level down to zero.',
    ],
    steps: [
      { type: 'evade', text: 'Lose the heat — wanted level to zero' },
    ],
  },
  {
    id: 'the-bank-job',
    title: 'Job 5: The Bank Job',
    reward: 5000,
    briefing: [
      'Mara Voss: "The Marlowe Bay Bank. Vault code\'s on the house."',
      '"Get inside, crack the vault, and get out. The whole force will come."',
      'Then lose them and bring the money home.',
    ],
    steps: [
      { type: 'goto', x: 1920, y: 640, radius: 110, text: 'Get to the Marlowe Bay Bank' },
      { type: 'grab', x: 1920, y: 640, radius: 120, hold: 6, text: 'Crack the vault — stay inside' },
      { type: 'drive', x: 640, y: 780, radius: 100, text: 'Escape to Voss Garage' },
    ],
  },
  {
    id: 'the-last-run',
    title: 'Job 6: The Last Run',
    reward: 10000,
    briefing: [
      'Mara Voss: "Last one, Rook. The gold sedan by the garage is yours."',
      '"Drive it to the Old Pier. The buyer\'s boat leaves at dawn."',
      '"Every cop in Marlowe Bay will be on you. Make it count."',
    ],
    steps: [
      { type: 'enterMarked', text: 'Get in the gold getaway car' },
      { type: 'drive', x: 1600, y: 2280, radius: 110, text: 'Reach the Old Pier' },
    ],
  },
];

const CAR_COLORS = ['#c94b4b', '#4b7ac9', '#c9a44b', '#7ac94b', '#c94b9e', '#8a8a8a', '#d8d3c3', '#4bc9b8'];
const PED_COLORS = ['#d8d3c3', '#e8a13a', '#7a9ec9', '#c97a7a', '#8ac97a', '#b07ac9'];

export function createWorld(random) {
  const city = createCity(random);

  // ---- pools (allocated once) ----
  const cars = [];
  for (let i = 0; i < 56; i += 1) {
    cars.push({ active: false, kind: 'traffic', x: 0, y: 0, angle: 0, speed: 0, color: '#888', health: 100, axis: 'h', dir: 1, stopped: 0, driver: true, lose: 0, blind: 0, lastSeenX: 0, lastSeenY: 0, hurt: 0, id: i });
  }
  const peds = [];
  for (let i = 0; i < PED_COUNT + 6; i += 1) {
    peds.push({ active: false, x: 0, y: 0, angle: 0, speed: 0, color: '#ddd', state: 'walk', timer: 0, down: 0 });
  }
  const cops = [];
  for (let i = 0; i < 6; i += 1) {
    cops.push({ active: false, x: 0, y: 0, angle: 0, health: 100, arrest: 0, down: 0 });
  }
  const bullets = [];
  for (let i = 0; i < 24; i += 1) bullets.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0 });
  const particles = [];
  for (let i = 0; i < 220; i += 1) particles.push({ active: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, color: '#fff', size: 3 });
  const skids = [];
  for (let i = 0; i < 140; i += 1) skids.push({ active: false, x: 0, y: 0, angle: 0, life: 0 });
  const pickups = [];
  for (let i = 0; i < 10; i += 1) pickups.push({ active: false, x: 0, y: 0, amount: 100, kind: 'cash' });

  const player = {
    x: city.playerStart.x, y: city.playerStart.y, angle: -Math.PI / 2,
    health: PLAYER.health, onFoot: true, car: null, invulnerable: 0,
    lastDamage: -99, shootCooldown: 0, walkX: 0, walkY: 0,
  };

  const state = {
    city,
    player,
    cars, peds, cops, bullets, particles, skids, pickups,
    wanted: 0, quietTimer: 0, cash: 0, earned: 0,
    time: 0, timeOfDay: 0.32,
    missionIndex: 0, mission: null, missionStep: 0, missionTimer: 0, missionProgress: 0,
    missionDone: false, storyComplete: false,
    camera: { x: 0, y: 0 },
    siren: false, engineSpeed: 0,
    stats: { carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0, arrests: 0 },
    courier: null,
    getaway: null,
  };

  function free(pool) {
    for (let i = 0; i < pool.length; i += 1) if (!pool[i].active) return pool[i];
    return null;
  }

  function spawnParticle(x, y, vx, vy, life, color, size) {
    const p = free(particles);
    if (!p) return;
    p.active = true;
    p.x = x; p.y = y; p.vx = vx; p.vy = vy; p.life = life; p.max = life; p.color = color; p.size = size;
  }

  function burst(x, y, n, color, speed) {
    for (let i = 0; i < n; i += 1) {
      const a = random() * TAU;
      const s = speed * (0.3 + random() * 0.7);
      spawnParticle(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.4 + random() * 0.5, color, 2 + random() * 3);
    }
  }

  function addSkid(x, y, angle) {
    const s = free(skids);
    if (!s) return;
    s.active = true;
    s.x = x; s.y = y; s.angle = angle; s.life = 6;
  }

  function addWanted(amount) {
    const before = Math.floor(state.wanted);
    state.wanted = clamp(state.wanted + amount, 0, WANTED.max);
    state.quietTimer = 0;
    return Math.floor(state.wanted) > before;
  }

  /** Wreck the player's car (if it has one and it is dead): explosion, eject the player. */
  function wreckPlayerCar(events) {
    const car = player.car;
    if (!car || car.kind !== 'player' || car.health > 0) return events;
    burst(car.x, car.y, 26, '#ff7a3c', 260);
    burst(car.x, car.y, 18, '#555', 120);
    car.active = false;
    player.car = null;
    player.onFoot = true;
    // Brief breathing room after the wreck: the chase is still on, but the
    // player should not be rammed to death before they can move again.
    player.invulnerable = 2;
    return events | EVENT_CRASH;
  }

  function spawnTrafficCar() {
    const car = free(cars);
    if (!car) return null;
    const p = city.randomRoadPoint();
    car.active = true;
    car.kind = 'traffic';
    car.x = p.x; car.y = p.y;
    car.axis = p.axis;
    car.dir = random() < 0.5 ? 1 : -1;
    car.angle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
    car.speed = CAR.trafficMin + random() * (CAR.trafficMax - CAR.trafficMin);
    car.cruise = car.speed;
    car.color = CAR_COLORS[Math.floor(random() * CAR_COLORS.length)];
    car.health = CAR.health;
    car.driver = true;
    car.stopped = 0;
    car.hurt = 0;
    return car;
  }

  function spawnParkedCar() {
    const car = free(cars);
    if (!car) return null;
    const p = city.randomRoadPoint();
    const off = (random() < 0.5 ? -1 : 1) * (ROAD.width / 2 - 16);
    car.active = true;
    car.kind = 'parked';
    car.x = p.axis === 'h' ? p.x : p.x + off;
    car.y = p.axis === 'h' ? p.y + off : p.y;
    car.axis = p.axis;
    car.angle = p.axis === 'h' ? (random() < 0.5 ? 0 : Math.PI) : (random() < 0.5 ? Math.PI / 2 : -Math.PI / 2);
    car.speed = 0;
    car.color = CAR_COLORS[Math.floor(random() * CAR_COLORS.length)];
    car.health = CAR.health;
    car.driver = false;
    car.stopped = 0;
    car.hurt = 0;
    return car;
  }

  function spawnPed() {
    const ped = free(peds);
    if (!ped) return null;
    const p = city.randomRoadPoint();
    const pos = city.collide(p.x + (random() - 0.5) * 60, p.y + (random() - 0.5) * 60, PED.radius);
    ped.active = true;
    ped.x = pos.x; ped.y = pos.y;
    ped.angle = random() * TAU;
    ped.speed = PED.walkSpeed * (0.7 + random() * 0.6);
    ped.color = PED_COLORS[Math.floor(random() * PED_COLORS.length)];
    ped.state = 'walk';
    ped.timer = 2 + random() * 4;
    ped.down = 0;
    return ped;
  }

  function spawnPickup() {
    const pk = free(pickups);
    if (!pk) return;
    const p = city.randomRoadPoint();
    pk.active = true;
    pk.x = p.x; pk.y = p.y;
    pk.amount = 100;
    pk.kind = 'cash';
  }

  function spawnPoliceCar() {
    const car = free(cars);
    if (!car) return null;
    // Spawn on a road 500-750px from the player, in a random direction.
    for (let tries = 0; tries < 12; tries += 1) {
      const a = random() * TAU;
      const d = 520 + random() * 220;
      const p = city.nearestRoadPoint(player.x + Math.cos(a) * d, player.y + Math.sin(a) * d);
      if (dist2(p.x, p.y, player.x, player.y) < 420 * 420) continue;
      car.active = true;
      car.kind = 'police';
      car.x = p.x; car.y = p.y;
      car.axis = p.axis;
      car.angle = angleTo(p.x, p.y, player.x, player.y);
      car.speed = 0;
      car.color = '#2b4fd8';
      car.health = CAR.health;
      car.driver = true;
      car.stopped = 0;
      car.hurt = 0;
      car.lose = 0;
      car.blind = 0;
      car.lastSeenX = player.x;
      car.lastSeenY = player.y;
      return car;
    }
    return null;
  }

  function spawnFootCop() {
    const cop = free(cops);
    if (!cop) return null;
    const a = random() * TAU;
    const p = city.collide(player.x + Math.cos(a) * 260, player.y + Math.sin(a) * 260, PED.radius);
    cop.active = true;
    cop.x = p.x; cop.y = p.y;
    cop.angle = angleTo(p.x, p.y, player.x, player.y);
    cop.health = 100;
    cop.arrest = 0;
    cop.down = 0;
    return cop;
  }

  /** True when no building stands between the two points (sampled every 24px). */
  function lineOfSight(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.max(1, Math.floor(d / 24));
    for (let i = 1; i < steps; i += 1) {
      const t = i / steps;
      if (city.hitsBuilding(ax + (bx - ax) * t, ay + (by - ay) * t, 6)) return false;
    }
    return true;
  }

  function currentMissionDef() {
    return state.missionIndex < MISSIONS.length ? MISSIONS[state.missionIndex] : null;
  }

  function startMission(index) {
    const def = MISSIONS[index];
    if (!def) return 0;
    state.missionIndex = index;
    state.mission = def;
    state.missionStep = 0;
    state.missionTimer = 0;
    state.missionProgress = 0;
    state.courier = null;
    state.getaway = null;
    if (def.id === 'tail-the-gull') {
      const car = spawnTrafficCar();
      if (car) {
        car.kind = 'courier';
        car.color = '#2fa8a0';
        car.speed = 150;
        state.courier = car;
      }
    }
    if (def.id === 'the-last-run') {
      const car = spawnParkedCar();
      if (car) {
        car.kind = 'getaway';
        car.color = '#ffd23f';
        car.x = 640; car.y = 700;
        car.angle = Math.PI / 2;
        state.getaway = car;
      }
      addWanted(4);
    }
    if (def.id === 'hot-pursuit') addWanted(3);
    return EVENT_MISSION_START;
  }

  function completeMissionStep() {
    state.missionStep += 1;
    state.missionTimer = 0;
    state.missionProgress = 0;
  }

  function completeMission() {
    const def = state.mission;
    state.cash += def.reward;
    state.earned += def.reward;
    state.stats.missionsDone += 1;
    state.mission = null;
    state.missionIndex += 1;
    if (state.courier) { state.courier.active = false; state.courier = null; }
    if (state.missionIndex >= MISSIONS.length) {
      state.storyComplete = true;
      state.missionDone = true;
    }
    return EVENT_MISSION;
  }

  function failMission() {
    // Forgiving: restart the same mission from its first step.
    const index = state.missionIndex;
    state.mission = null;
    return startMission(index);
  }

  /** The current objective: text + where its marker points (null = no marker). */
  function objective() {
    if (!state.mission) return null;
    const step = state.mission.steps[state.missionStep];
    if (!step) return null;
    if (step.type === 'follow' && state.courier) return { text: step.text, x: state.courier.x, y: state.courier.y };
    if (step.type === 'enterMarked' && state.getaway) return { text: step.text, x: state.getaway.x, y: state.getaway.y };
    if (step.x !== undefined) return { text: step.text, x: step.x, y: step.y };
    return { text: step.text, x: null, y: null };
  }

  function reset(save) {
    for (const c of cars) c.active = false;
    for (const p of peds) p.active = false;
    for (const c of cops) c.active = false;
    for (const b of bullets) b.active = false;
    for (const p of particles) p.active = false;
    for (const s of skids) s.active = false;
    for (const p of pickups) p.active = false;
    player.x = city.playerStart.x;
    player.y = city.playerStart.y;
    player.angle = -Math.PI / 2;
    player.health = PLAYER.health;
    player.onFoot = true;
    player.car = null;
    player.invulnerable = 0;
    player.lastDamage = -99;
    player.shootCooldown = 0;
    state.wanted = 0;
    state.quietTimer = 0;
    state.cash = 0;
    state.earned = 0;
    state.time = 0;
    state.timeOfDay = 0.12;
    state.missionIndex = 0;
    state.mission = null;
    state.missionStep = 0;
    state.missionTimer = 0;
    state.missionProgress = 0;
    state.missionDone = false;
    state.storyComplete = false;
    state.siren = false;
    state.engineSpeed = 0;
    state.stats = { carsStolen: 0, pedsHit: 0, shotsFired: 0, missionsDone: 0, arrests: 0 };
    state.courier = null;
    state.getaway = null;
    for (let i = 0; i < TRAFFIC_COUNT; i += 1) spawnTrafficCar();
    for (let i = 0; i < PARKED_COUNT; i += 1) spawnParkedCar();
    for (let i = 0; i < PED_COUNT; i += 1) spawnPed();
    for (let i = 0; i < 6; i += 1) spawnPickup();
    if (save) {
      state.cash = save.cash || 0;
      state.earned = save.earned || state.cash;
      state.missionIndex = Math.min(save.missionIndex || 0, MISSIONS.length - 1);
    }
  }

  function serialize() {
    return { cash: state.cash, earned: state.earned, missionIndex: state.missionIndex };
  }

  // ---- movement helpers ----
  function moveCircle(x, y, r, dx, dy) {
    return city.collide(x + dx, y + dy, r);
  }

  function carCircles(car) {
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    return [
      { x: car.x + c * 18, y: car.y + s * 18 },
      { x: car.x, y: car.y },
      { x: car.x - c * 18, y: car.y - s * 18 },
    ];
  }

  // Move a car to (nx, ny), sliding along buildings instead of wedging into them.
  // Returns the corrected position and whether it hit; adjusts the car's angle and
  // speed to the slide (the velocity component into the wall is dropped).
  function slideCar(car, nx, ny) {
    let pushX = 0;
    let pushY = 0;
    let crashed = false;
    for (const c of carCircles({ x: nx, y: ny, angle: car.angle })) {
      const fixed = city.collide(c.x, c.y, CAR.halfWidth);
      if (fixed.x !== c.x || fixed.y !== c.y) {
        pushX += fixed.x - c.x;
        pushY += fixed.y - c.y;
        crashed = true;
      }
    }
    if (crashed && (pushX !== 0 || pushY !== 0)) {
      const plen = Math.hypot(pushX, pushY);
      const nxv = pushX / plen;
      const nyv = pushY / plen;
      const vx = Math.cos(car.angle) * car.speed;
      const vy = Math.sin(car.angle) * car.speed;
      const into = vx * nxv + vy * nyv;
      if (into < 0) {
        const sx = vx - nxv * into;
        const sy = vy - nyv * into;
        const ns = Math.hypot(sx, sy);
        if (ns > 1) {
          car.speed = ns * Math.sign(car.speed);
          car.angle = Math.atan2(sy, sx);
        } else {
          car.speed *= 0.45;
        }
      }
    }
    return { x: nx + pushX, y: ny + pushY, crashed };
  }

  function damagePlayer(amount, events) {
    if (player.invulnerable > 0) return events;
    player.health -= amount;
    player.invulnerable = 1.2;
    player.lastDamage = state.time;
    if (player.health <= 0) {
      player.health = 0;
      return events | EVENT_OVER;
    }
    return events | EVENT_HIT;
  }

  function nearestCar(x, y, maxDist, kinds) {
    let best = null;
    let bestD = maxDist * maxDist;
    for (const car of cars) {
      if (!car.active) continue;
      if (kinds && !kinds.includes(car.kind)) continue;
      const d = dist2(x, y, car.x, car.y);
      if (d < bestD) {
        bestD = d;
        best = car;
      }
    }
    return best;
  }

  function enterCar(car, events) {
    player.onFoot = false;
    player.car = car;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    if (car.kind === 'parked' || car.kind === 'traffic') {
      state.stats.carsStolen += 1;
      if (car.driver) {
        // The driver bails and runs.
        const ped = spawnPed();
        if (ped) {
          ped.x = car.x + 30;
          ped.y = car.y + 30;
          ped.state = 'flee';
        }
        car.driver = false;
      }
      car.kind = 'player';
      if (addWanted(WANTED.stealCar)) events |= EVENT_WANTED_UP;
      events |= EVENT_STEAL;
    } else if (car.kind === 'courier' || car.kind === 'getaway') {
      car.kind = 'player';
    }
    car.speed = 0;
    return events | EVENT_ENTER_CAR;
  }

  function exitCar(events) {
    const car = player.car;
    if (!car) return events;
    car.kind = 'parked';
    car.speed = 0;
    const side = city.collide(car.x + Math.cos(car.angle + Math.PI / 2) * 30, car.y + Math.sin(car.angle + Math.PI / 2) * 30, PLAYER.radius);
    player.x = side.x;
    player.y = side.y;
    player.onFoot = true;
    player.car = null;
    return events;
  }

  function shootAt(tx, ty) {
    if (player.shootCooldown > 0 || !player.onFoot) return 0;
    player.shootCooldown = BULLET.cooldown;
    const b = free(bullets);
    if (!b) return 0;
    const a = angleTo(player.x, player.y, tx, ty);
    player.angle = a;
    b.active = true;
    b.x = player.x + Math.cos(a) * 20;
    b.y = player.y + Math.sin(a) * 20;
    b.vx = Math.cos(a) * BULLET.speed;
    b.vy = Math.sin(a) * BULLET.speed;
    b.life = BULLET.range / BULLET.speed;
    state.stats.shotsFired += 1;
    if (addWanted(0)) { /* no-op */ }
    return EVENT_SHOT;
  }

  // ---- the step ----
  function step(dt, input) {
    let events = 0;
    state.time += dt;
    state.timeOfDay = (state.timeOfDay + dt / 240) % 1;

    if (player.invulnerable > 0) player.invulnerable -= dt;
    if (player.shootCooldown > 0) player.shootCooldown -= dt;
    if (state.time - player.lastDamage > PLAYER.regenDelay && player.health < PLAYER.health) {
      player.health = Math.min(PLAYER.health, player.health + PLAYER.regenRate * dt);
    }

    // Wanted decay: only while quiet and no cop close.
    state.quietTimer += dt;
    let copNear = false;
    for (const car of cars) {
      if (car.active && car.kind === 'police' && dist2(car.x, car.y, player.x, player.y) < 320 * 320) { copNear = true; break; }
    }
    if (!copNear) {
      for (const cop of cops) {
        if (cop.active && dist2(cop.x, cop.y, player.x, player.y) < 320 * 320) { copNear = true; break; }
      }
    }
    const decay = state.mission && state.mission.id === 'hot-pursuit' ? WANTED.decayPerSecond * 3 : WANTED.decayPerSecond;
    if (state.quietTimer > WANTED.quietSeconds && !copNear && state.wanted > 0) {
      state.wanted = Math.max(0, state.wanted - decay * dt);
    }

    // ---- player ----
    if (player.onFoot) {
      let mx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      let my = (input.down ? 1 : 0) - (input.up ? 1 : 0);
      if (mx !== 0 || my !== 0) {
        const len = Math.hypot(mx, my);
        mx /= len;
        my /= len;
        player.angle = Math.atan2(my, mx);
        const pos = moveCircle(player.x, player.y, PLAYER.radius, mx * PLAYER.walkSpeed * dt, my * PLAYER.walkSpeed * dt);
        player.x = pos.x;
        player.y = pos.y;
        player.walkX = mx;
        player.walkY = my;
      } else {
        player.walkX = 0;
        player.walkY = 0;
      }
      if (input.enter) {
        const car = nearestCar(player.x, player.y, 56, ['parked', 'traffic', 'courier', 'getaway']);
        if (car && car.kind !== 'police') events |= enterCar(car, events);
      }
      if (input.shoot) events |= shootAt(input.aimX, input.aimY);
      state.engineSpeed = 0;
    } else {
      const car = player.car;
      // Touch joystick drives analog: push the stick a little for a little
      // throttle and steering, all the way for full lock. A held stick used
      // to mean full throttle + full-lock steering (2.9 rad/s), which made
      // the car whip around on a phone. Keyboard stays binary, as before.
      const analog = input.analog && input.analog.active ? input.analog : null;
      const throttle = analog ? clamp(-analog.y, 0, 1) : (input.up ? 1 : 0);
      const reverseAmt = analog ? clamp(analog.y, 0, 1) : (input.down ? 1 : 0);
      const steerRaw = analog ? clamp(analog.x, -1, 1) : ((input.left ? -1 : 0) + (input.right ? 1 : 0));
      if (throttle > 0) car.speed = Math.min(CAR.maxSpeed, car.speed + CAR.accel * throttle * dt);
      else if (reverseAmt > 0) car.speed = Math.max(-CAR.reverseMax, car.speed - CAR.brake * reverseAmt * dt);
      else car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 260 * dt);
      // Less steering authority at speed, so a held stick does not spin the
      // car at full lock while it is doing 540 px/s.
      const steerAuthority = analog ? clamp(1 - 0.45 * (Math.abs(car.speed) / CAR.maxSpeed), 0.55, 1) : 1;
      const steer = steerRaw * steerAuthority;
      // Some steering authority even when slow, so a car nosed into a wall can
      // still turn away instead of sitting wedged.
      const grip = clamp(Math.abs(car.speed) / 120, 0.3, 1);
      car.angle += steer * CAR.turnRate * grip * dt * (car.speed >= 0 ? 1 : -1);
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      // Building collision: slide along walls instead of wedging into them.
      const preSpeed = car.speed;
      const slid = slideCar(car, nx, ny);
      if (slid.crashed && Math.abs(preSpeed) > 220) {
        events |= EVENT_CRASH;
        burst(car.x, car.y, 10, '#d8d3c3', 160);
      }
      car.x = clamp(slid.x, 20, WORLD.width - 20);
      car.y = clamp(slid.y, 20, WATER_Y - 20);
      player.x = car.x;
      player.y = car.y;
      player.angle = car.angle;
      state.engineSpeed = clamp(Math.abs(car.speed) / CAR.maxSpeed, 0, 1);
      if (Math.abs(car.speed) > 300 && steer !== 0) {
        addSkid(car.x - Math.cos(car.angle) * 18, car.y - Math.sin(car.angle) * 18, car.angle);
      }
      if (input.enter) events |= exitCar(events);
    }

    // ---- traffic ----
    for (const car of cars) {
      if (!car.active || (car.kind !== 'traffic' && car.kind !== 'courier')) continue;
      if (car.stopped > 0) {
        car.stopped -= dt;
        continue;
      }
      // Stay on the road centre line; turn at intersections sometimes.
      const road = city.roadAt(car.x, car.y);
      const targetAngle = car.axis === 'h' ? (car.dir > 0 ? 0 : Math.PI) : (car.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
      car.angle += angleDiff(targetAngle, car.angle) * Math.min(1, 6 * dt);
      const onIntersection = road !== null && Math.abs(((car.axis === 'h' ? car.x : car.y) % ROAD.spacing) - ROAD.offset) < 26;
      if (onIntersection && random() < 0.012) {
        car.axis = car.axis === 'h' ? 'v' : 'h';
        car.dir = random() < 0.5 ? 1 : -1;
      }
      // Slow down for the car ahead.
      let slow = false;
      for (const other of cars) {
        if (!other.active || other === car || other.kind === 'parked') continue;
        const ahead = Math.cos(car.angle) * (other.x - car.x) + Math.sin(car.angle) * (other.y - car.y);
        const side = Math.abs(-Math.sin(car.angle) * (other.x - car.x) + Math.cos(car.angle) * (other.y - car.y));
        if (ahead > 0 && ahead < 78 && side < 30) { slow = true; break; }
      }
      const target = slow ? 0 : (car.cruise || car.speed);
      car.speed += (target - car.speed) * Math.min(1, 3 * dt);
      if (car.kind === 'courier') car.speed = Math.max(car.speed, 140);
      car.x += Math.cos(car.angle) * car.speed * dt;
      car.y += Math.sin(car.angle) * car.speed * dt;
      // Turn around at the world edge or the bay.
      if (car.x < 60 || car.x > WORLD.width - 60 || car.y < 60 || car.y > WATER_Y - 60) {
        car.dir = -car.dir;
        car.angle += Math.PI;
        car.x = clamp(car.x, 80, WORLD.width - 80);
        car.y = clamp(car.y, 80, WATER_Y - 80);
      }
      // Keep off buildings (traffic sticks to roads, but turns can clip corners).
      const fixed = city.collide(car.x, car.y, CAR.halfWidth);
      car.x = fixed.x;
      car.y = fixed.y;
    }

    // ---- police ----
    const wantedStars = Math.floor(state.wanted);
    let policeCars = 0;
    let footCops = 0;
    for (const car of cars) if (car.active && car.kind === 'police') policeCars += 1;
    for (const cop of cops) if (cop.active) footCops += 1;
    const wantCars = wantedStars === 0 ? 0 : Math.min(4, 1 + Math.floor(wantedStars / 2));
    const wantFoot = player.onFoot && wantedStars >= 2 ? Math.min(2, wantedStars - 1) : 0;
    if (policeCars < wantCars && random() < 0.05) spawnPoliceCar();
    if (footCops < wantFoot && random() < 0.03) spawnFootCop();
    if (wantedStars === 0) {
      for (const car of cars) if (car.active && car.kind === 'police') car.active = false;
      for (const cop of cops) if (cop.active) cop.active = false;
    }
    // More cars than the current heat calls for: the farthest one peels off.
    if (policeCars > wantCars) {
      let far = null;
      let farD = -1;
      for (const car of cars) {
        if (!car.active || car.kind !== 'police') continue;
        const d = dist2(car.x, car.y, player.x, player.y);
        if (d > farD) {
          farD = d;
          far = car;
        }
      }
      if (far) far.active = false;
    }
    state.siren = policeCars > 0 || footCops > 0;

    for (const car of cars) {
      if (!car.active || car.kind !== 'police') continue;
      // Lose the tail: a cop that cannot close within 420px for 4 seconds gives up.
      const distToPlayer = Math.sqrt(dist2(car.x, car.y, player.x, player.y));
      if (distToPlayer > 420) {
        car.lose += dt;
        if (car.lose > 4) {
          car.active = false;
          continue;
        }
      } else {
        car.lose = 0;
      }
      // Line of sight (and range): a cop that sees you chases hard; one that lost
      // sight drives to where it last saw you, and gives up after 3 blind seconds.
      const seen = distToPlayer < 700 && lineOfSight(car.x, car.y, player.x, player.y);
      let tx = car.lastSeenX;
      let ty = car.lastSeenY;
      let topSpeed = 380;
      if (seen) {
        tx = player.x;
        ty = player.y;
        car.lastSeenX = tx;
        car.lastSeenY = ty;
        car.blind = 0;
        topSpeed = CAR.policeMax;
      } else {
        car.blind += dt;
        if (car.blind > 3) {
          car.active = false;
          continue;
        }
      }
      const target = angleTo(car.x, car.y, tx, ty);
      car.angle += clamp(angleDiff(target, car.angle), -3.2 * dt, 3.2 * dt);
      if (car.speed > topSpeed) car.speed = Math.max(topSpeed, car.speed - 500 * dt);
      else car.speed = Math.min(topSpeed, car.speed + 420 * dt);
      const nx = car.x + Math.cos(car.angle) * car.speed * dt;
      const ny = car.y + Math.sin(car.angle) * car.speed * dt;
      const slid = slideCar(car, nx, ny);
      car.x = clamp(slid.x, 20, WORLD.width - 20);
      car.y = clamp(slid.y, 20, WATER_Y - 20);
      // Ram the player.
      const d = Math.sqrt(dist2(car.x, car.y, player.x, player.y));
      if (d < 46) {
        if (player.onFoot) {
          events |= damagePlayer(6, events);
        } else if (player.car && Math.abs(car.speed) > 120) {
          player.car.health -= 5;
          burst(player.x, player.y, 6, '#ffd23f', 120);
          events |= EVENT_CRASH;
          events |= wreckPlayerCar(events);
        }
        // Bounce off.
        car.angle += Math.PI * 0.5;
        car.speed *= 0.5;
      }
    }

    for (const cop of cops) {
      if (!cop.active) continue;
      if (cop.down > 0) {
        cop.down -= dt;
        if (cop.down <= 0) cop.active = false;
        continue;
      }
      if (player.onFoot) {
        const a = angleTo(cop.x, cop.y, player.x, player.y);
        cop.angle = a;
        const d = Math.sqrt(dist2(cop.x, cop.y, player.x, player.y));
        if (d < 30) {
          cop.arrest += dt;
          if (cop.arrest > 0.4) events |= EVENT_ARREST_WARN;
          if (cop.arrest >= 1.6) {
            state.stats.arrests += 1;
            return events | EVENT_BUSTED;
          }
        } else {
          cop.arrest = Math.max(0, cop.arrest - dt);
          const pos = moveCircle(cop.x, cop.y, PED.radius, Math.cos(a) * 175 * dt, Math.sin(a) * 175 * dt);
          cop.x = pos.x;
          cop.y = pos.y;
        }
      } else {
        // Player in a car: foot cops give up and walk away.
        const a = angleTo(cop.x, cop.y, player.x, player.y) + Math.PI;
        const pos = moveCircle(cop.x, cop.y, PED.radius, Math.cos(a) * 60 * dt, Math.sin(a) * 60 * dt);
        cop.x = pos.x;
        cop.y = pos.y;
      }
    }

    // ---- pedestrians ----
    for (const ped of peds) {
      if (!ped.active) continue;
      if (ped.down > 0) {
        ped.down -= dt;
        if (ped.down <= 0) ped.active = false;
        continue;
      }
      ped.timer -= dt;
      const playerSpeed = player.onFoot ? 0 : Math.abs(player.car ? player.car.speed : 0);
      const pd = Math.sqrt(dist2(ped.x, ped.y, player.x, player.y));
      if (pd < 130 && playerSpeed > 120 && ped.state !== 'flee') {
        ped.state = 'flee';
        ped.timer = 2;
      }
      if (ped.state === 'flee') {
        const a = angleTo(player.x, player.y, ped.x, ped.y);
        const pos = moveCircle(ped.x, ped.y, PED.radius, Math.cos(a) * PED.fleeSpeed * dt, Math.sin(a) * PED.fleeSpeed * dt);
        ped.x = pos.x;
        ped.y = pos.y;
        ped.angle = a;
        if (ped.timer <= 0) ped.state = 'walk';
      } else {
        if (ped.timer <= 0) {
          ped.angle = random() * TAU;
          ped.timer = 2 + random() * 4;
        }
        const pos = moveCircle(ped.x, ped.y, PED.radius, Math.cos(ped.angle) * ped.speed * dt, Math.sin(ped.angle) * ped.speed * dt);
        ped.x = pos.x;
        ped.y = pos.y;
      }
      // Run over by a car.
      if (!player.onFoot && player.car && playerSpeed > 150 && pd < 30) {
        ped.down = 999;
        ped.state = 'walk';
        burst(ped.x, ped.y, 8, '#c94b4b', 100);
        state.stats.pedsHit += 1;
        if (addWanted(WANTED.hitPed)) events |= EVENT_WANTED_UP;
      }
    }

    // ---- bullets ----
    for (const b of bullets) {
      if (!b.active) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) {
        b.active = false;
        continue;
      }
      if (city.hitsBuilding(b.x, b.y, 2)) {
        burst(b.x, b.y, 4, '#ffd23f', 80);
        b.active = false;
        continue;
      }
      let hit = false;
      for (const cop of cops) {
        if (!cop.active || cop.down > 0) continue;
        if (dist2(b.x, b.y, cop.x, cop.y) < 20 * 20) {
          cop.health -= BULLET.damage;
          burst(b.x, b.y, 6, '#3f7cff', 100);
          if (cop.health <= 0) {
            cop.down = 999;
            if (addWanted(WANTED.shootCop)) events |= EVENT_WANTED_UP;
          }
          hit = true;
          break;
        }
      }
      if (hit) { b.active = false; continue; }
      for (const ped of peds) {
        if (!ped.active || ped.down > 0) continue;
        if (dist2(b.x, b.y, ped.x, ped.y) < 16 * 16) {
          ped.down = 999;
          burst(b.x, b.y, 6, '#c94b4b', 100);
          if (addWanted(WANTED.shoot)) events |= EVENT_WANTED_UP;
          hit = true;
          break;
        }
      }
      if (hit) { b.active = false; continue; }
      for (const car of cars) {
        if (!car.active || car.kind === 'player' || car.kind === 'parked') continue;
        if (dist2(b.x, b.y, car.x, car.y) < 26 * 26) {
          car.health -= 12;
          burst(b.x, b.y, 5, '#ffd23f', 90);
          if (car.health <= 0) {
            car.active = false;
            burst(car.x, car.y, 20, '#ff7a3c', 220);
          }
          hit = true;
          break;
        }
      }
      if (hit) b.active = false;
    }

    // ---- car vs car ----
    for (const car of cars) if (car.active && car.hurt > 0) car.hurt -= dt;
    for (let i = 0; i < cars.length; i += 1) {
      const a = cars[i];
      if (!a.active) continue;
      for (let j = i + 1; j < cars.length; j += 1) {
        const b = cars[j];
        if (!b.active) continue;
        const d2 = dist2(a.x, a.y, b.x, b.y);
        if (d2 < 50 * 50 && d2 > 0.01) {
          const d = Math.sqrt(d2);
          const push = (50 - d) / 2;
          const nx = (b.x - a.x) / d;
          const ny = (b.y - a.y) / d;
          a.x -= nx * push;
          a.y -= ny * push;
          b.x += nx * push;
          b.y += ny * push;
          const rel = Math.abs(a.speed - b.speed);
          if (rel > 250) {
            // A real impact: noise, a small dent to the player's car (with a
            // short immunity so one crash cannot shred it), and both cars lose
            // speed. A gentle touch only pushes the cars apart, so a chase
            // never deadlocks into a shoving match where neither car can
            // accelerate away.
            events |= EVENT_CRASH;
            burst((a.x + b.x) / 2, (a.y + b.y) / 2, 6, '#ffd23f', 110);
            if (a.hurt <= 0) {
              a.hurt = 0.8;
              if (a.kind === 'player') {
                a.health -= 3;
                events |= wreckPlayerCar(events);
              }
            }
            if (b.hurt <= 0) {
              b.hurt = 0.8;
              if (b.kind === 'player') {
                b.health -= 3;
                events |= wreckPlayerCar(events);
              }
            }
            a.speed *= 0.7;
            b.speed *= 0.7;
          }
          if (a.kind === 'traffic') a.stopped = 1.2;
          if (b.kind === 'traffic') b.stopped = 1.2;
        }
      }
    }

    // ---- pickups ----
    for (const pk of pickups) {
      if (!pk.active) continue;
      if (dist2(pk.x, pk.y, player.x, player.y) < 34 * 34) {
        pk.active = false;
        state.cash += pk.amount;
        state.earned += pk.amount;
        events |= EVENT_CASH;
        if (random() < 0.6) spawnPickup();
      }
    }

    // ---- particles / skids ----
    for (const p of particles) {
      if (!p.active) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) p.active = false;
    }
    for (const s of skids) {
      if (!s.active) continue;
      s.life -= dt;
      if (s.life <= 0) s.active = false;
    }

    // ---- missions ----
    if (state.mission) {
      const def = state.mission;
      const stepDef = def.steps[state.missionStep];
      if (stepDef) {
        if (stepDef.timer !== undefined) {
          state.missionTimer += dt;
          if (state.missionTimer > stepDef.timer) {
            events |= failMission();
          }
        }
        const px = player.x;
        const py = player.y;
        if (stepDef.type === 'steal') {
          if (!player.onFoot) completeMissionStep();
        } else if (stepDef.type === 'enterMarked') {
          if (!player.onFoot && player.car && player.car.kind === 'player' && state.getaway && player.car === state.getaway) completeMissionStep();
        } else if (stepDef.type === 'goto' || stepDef.type === 'deliver' || stepDef.type === 'drive') {
          if (dist2(px, py, stepDef.x, stepDef.y) < stepDef.radius * stepDef.radius) {
            if (stepDef.type === 'deliver' || stepDef.type === 'drive') {
              if (stepDef.type === 'deliver' || !player.onFoot) completeMissionStep();
            } else completeMissionStep();
          }
        } else if (stepDef.type === 'grab') {
          if (dist2(px, py, stepDef.x, stepDef.y) < stepDef.radius * stepDef.radius) {
            state.missionProgress += dt;
            if (state.missionProgress >= stepDef.hold) {
              completeMissionStep();
              if (def.id === 'the-bank-job') addWanted(4);
            }
          } else {
            state.missionProgress = Math.max(0, state.missionProgress - dt * 2);
          }
        } else if (stepDef.type === 'follow') {
          if (state.courier && state.courier.active) {
            const d = Math.sqrt(dist2(px, py, state.courier.x, state.courier.y));
            if (d < 330) {
              state.missionProgress += dt;
              if (state.missionProgress >= stepDef.need) completeMissionStep();
            } else if (d > 520) {
              state.missionProgress = Math.max(0, state.missionProgress - dt * 2);
              if (state.missionTimer > 45 && state.missionProgress <= 0) events |= failMission();
            }
            state.missionTimer += dt;
          } else {
            events |= failMission();
          }
        } else if (stepDef.type === 'evade') {
          if (Math.floor(state.wanted) === 0) completeMissionStep();
        }
        if (state.mission && state.missionStep >= def.steps.length) {
          events |= completeMission();
        }
      }
    }

    // ---- camera ----
    const cx = clamp(player.x - FIELD.width / 2, 0, WORLD.width - FIELD.width);
    const cy = clamp(player.y - FIELD.height / 2, 0, WATER_Y + (WORLD.height - WATER_Y) - FIELD.height);
    state.camera.x = cx;
    state.camera.y = Math.min(cy, WORLD.height - FIELD.height);

    return events;
  }

  reset();
  return { state, reset, step, startMission, objective, serialize, currentMissionDef };
}
