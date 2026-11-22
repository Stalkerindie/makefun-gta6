// Headless simulation test for Neon Harbor (Node 22, no browser needed).
// It boots the real game loop behind DOM stubs, plays mission 1 through
// with a road-following autopilot, hammers the world with random inputs,
// and checks the rules hold: no crash, no NaN, numbers in range, rewards paid.
//
//   node tests/sim.mjs
import assert from 'node:assert/strict';
import { createRandom } from '../game/src/random.js';
import { createWorld, EVENT_CASH, EVENT_MISSION, EVENT_REPAIR, MISSIONS } from '../game/src/world.js';
import { ROAD, STEP, WATER_Y } from '../game/src/config.js';

const TAU = Math.PI * 2;

function wrapAngle(d) {
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function noInput() {
  return { up: false, down: false, left: false, right: false, enter: false, shoot: false, aimX: 0, aimY: 0 };
}

// ---------------------------------------------------------------------------
// Road route planner (test-only): roads sit at ROAD.offset + k * ROAD.spacing.
// A route from the player to a target is: along the current road to the
// horizontal road nearest the target, across it, then down the target's road.
// Every leg lies on a road, so the autopilot never has to cut through blocks.
// ---------------------------------------------------------------------------
function planRoute(state, tx, ty) {
  const verticals = [];
  for (let x = ROAD.offset; x < 3200; x += ROAD.spacing) verticals.push(x);
  const horizontals = [];
  for (let y = ROAD.offset; y < WATER_Y; y += ROAD.spacing) horizontals.push(y);
  const nearest = (list, v) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
  const start = state.city.nearestRoadPoint(state.player.x, state.player.y);
  const goalX = nearest(verticals, tx);
  const goalY = nearest(horizontals, ty);
  const legs = [];
  if (start.axis === 'v') {
    legs.push({ x: start.x, y: goalY });
    legs.push({ x: goalX, y: goalY });
  } else {
    legs.push({ x: goalX, y: start.y });
    legs.push({ x: goalX, y: goalY });
  }
  legs.push({ x: tx, y: ty });
  return legs;
}

function steerTo(state, tx, ty) {
  const p = state.player;
  const want = Math.atan2(ty - p.y, tx - p.x);
  const diff = wrapAngle(want - p.angle);
  return {
    up: true, down: false,
    left: diff < -0.06, right: diff > 0.06,
    enter: false, shoot: false, aimX: tx, aimY: ty,
  };
}

function nearestStealable(state, banned) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (!car.active || (car.kind !== 'parked' && car.kind !== 'traffic')) continue;
    if (banned.has(car)) continue;
    const d = (car.x - state.player.x) ** 2 + (car.y - state.player.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// 1. Mission 1 end to end: walk to a car, steal it, drive the route to the
//    garage, and check the job pays out.
// ---------------------------------------------------------------------------
function testMissionOne() {
  const world = createWorld(createRandom(1234));
  world.startMission(0);
  const obj = world.objective();
  assert.equal(obj.text, 'Steal a car');
  assert.ok(Number.isFinite(obj.distance) && obj.distance > 0, 'objective reports a distance');

  const state = world.state;
  const banned = new Set();
  let route = null;
  let leg = 0;
  let lastX = state.player.x;
  let lastY = state.player.y;
  let stuckFor = 0;
  let missionDone = false;
  let steps = 0;
  const maxSteps = Math.round(240 / STEP);
  for (; steps < maxSteps; steps += 1) {
    let input;
    if (state.player.onFoot) {
      const car = nearestStealable(state, banned);
      assert.ok(car, 'a stealable car exists');
      const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
      if (d < 50) {
        input = noInput();
        input.enter = true;
      } else {
        input = noInput();
        if (car.y < state.player.y - 10) input.up = true;
        if (car.y > state.player.y + 10) input.down = true;
        if (car.x < state.player.x - 10) input.left = true;
        if (car.x > state.player.x + 10) input.right = true;
      }
      // Stuck against a building for 5 seconds: try another car.
      if (Math.hypot(state.player.x - lastX, state.player.y - lastY) < 2) {
        stuckFor += 1;
        if (stuckFor > 300) {
          banned.add(car);
          stuckFor = 0;
        }
      } else stuckFor = 0;
      lastX = state.player.x;
      lastY = state.player.y;
    } else {
      if (!route) {
        route = planRoute(state, 640, 780);
        leg = 0;
      }
      const target = route[Math.min(leg, route.length - 1)];
      if (Math.hypot(target.x - state.player.x, target.y - state.player.y) < 70 && leg < route.length - 1) leg += 1;
      input = steerTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
    }
    const events = world.step(STEP, input);
    if (events & EVENT_MISSION) {
      missionDone = true;
      break;
    }
    assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y), 'player position stays finite');
  }
  assert.ok(missionDone, `mission 1 completes (stopped after ${steps} steps)`);
  assert.equal(state.missionIndex, 1);
  assert.equal(state.cash, MISSIONS[0].reward);
  assert.equal(state.stats.carsStolen, 1);
  console.log(`ok mission 1: done in ${(steps * STEP).toFixed(1)}s, cash $${state.cash}`);
}

// ---------------------------------------------------------------------------
// 2. Repair pickups: a damaged car driven over a toolbox heals, and the
//    world reports the repair.
// ---------------------------------------------------------------------------
function testRepair() {
  const world = createWorld(createRandom(99));
  const state = world.state;
  const car = state.cars.find((c) => c.active && c.kind === 'parked');
  assert.ok(car, 'a parked car exists');
  state.player.onFoot = false;
  state.player.car = car;
  car.kind = 'player';
  car.health = 40;
  state.player.x = car.x;
  state.player.y = car.y;
  const box = state.pickups.find((p) => !p.active);
  box.active = true;
  box.kind = 'repair';
  box.x = car.x;
  box.y = car.y;
  const events = world.step(STEP, noInput());
  assert.ok(events & EVENT_REPAIR, 'repair event fires');
  assert.equal(car.health, 85, 'car heals by 45');
  console.log('ok repair pickup: 40 -> 85 health, EVENT_REPAIR raised');
}

// ---------------------------------------------------------------------------
// 3. Chaos: random inputs for 90 sim-seconds across 3 seeds. Nothing may
//    crash, go NaN, or leave its range.
// ---------------------------------------------------------------------------
function testChaos() {
  for (const seed of [7, 42, 2026]) {
    const random = createRandom(seed);
    const world = createWorld(createRandom(seed * 13 + 1));
    const state = world.state;
    world.startMission(3); // hot pursuit: police + wanted decay under load
    for (let i = 0; i < Math.round(90 / STEP); i += 1) {
      const input = {
        up: random() < 0.5, down: random() < 0.2,
        left: random() < 0.3, right: random() < 0.3,
        enter: random() < 0.02, shoot: random() < 0.05,
        aimX: state.player.x + (random() - 0.5) * 400,
        aimY: state.player.y + (random() - 0.5) * 400,
      };
      world.step(STEP, input);
      assert.ok(Number.isFinite(state.player.x) && Number.isFinite(state.player.y), `seed ${seed}: finite position`);
      assert.ok(state.player.health >= 0 && state.player.health <= 100, `seed ${seed}: health in range`);
      assert.ok(state.wanted >= 0 && state.wanted <= 5, `seed ${seed}: wanted in range`);
      assert.ok(state.cash >= 0, `seed ${seed}: cash never negative`);
      for (const c of state.cars) {
        if (c.active) assert.ok(Number.isFinite(c.x) && Number.isFinite(c.y), `seed ${seed}: finite car`);
      }
    }
    console.log(`ok chaos seed ${seed}: 90s random play, wanted ${state.wanted.toFixed(2)}, cash $${state.cash}`);
  }
}

// ---------------------------------------------------------------------------
// 4. Boot the real game loop behind DOM stubs: title screen, Enter to start,
//    briefing, play — and the title offers "continue your run" when a save
//    exists (the saveExists wiring the HUD used to miss).
// ---------------------------------------------------------------------------
function makeDomStubs() {
  const listeners = { window: {}, document: {} };
  const fillTexts = [];
  let nowMs = 0;
  let rafQueue = [];
  const store = new Map();
  const canvas = {
    width: 0, height: 0,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    addEventListener: () => {},
  };
  const ctx = new Proxy({}, {
    get(_t, k) {
      if (k === 'fillText') return (v) => { fillTexts.push(String(v)); };
      if (k === 'canvas') return canvas;
      return () => {};
    },
    set: () => true,
  });
  const statusEl = { textContent: '' };
  const windowStub = {
    location: { search: '' },
    innerWidth: 1280, innerHeight: 720, devicePixelRatio: 1,
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: (k) => { store.delete(k); },
    },
    matchMedia: () => ({ matches: false }),
    addEventListener: (type, fn) => { (listeners.window[type] ??= []).push(fn); },
  };
  const documentStub = {
    hidden: false,
    getElementById: (id) => (id === 'game' ? canvas : statusEl),
    addEventListener: (type, fn) => { (listeners.document[type] ??= []).push(fn); },
    createElement: () => ({
      style: {}, classList: { add() {}, remove() {} },
      setAttribute() {}, appendChild() {}, addEventListener() {},
    }),
    body: { appendChild() {} },
  };
  return {
    listeners, fillTexts, store,
    install() {
      globalThis.window = windowStub;
      globalThis.document = documentStub;
      // Node 24 exposes navigator and performance as getter-only globals.
      Object.defineProperty(globalThis, 'navigator', { value: { maxTouchPoints: 0 }, configurable: true });
      Object.defineProperty(globalThis, 'performance', { value: { now: () => nowMs }, configurable: true });
      globalThis.requestAnimationFrame = (fn) => { rafQueue.push(fn); };
    },
    dispatchKey(code) {
      const event = { code, repeat: false, preventDefault() {} };
      for (const fn of listeners.window.keydown ?? []) fn(event);
    },
    runFrames(n) {
      for (let i = 0; i < n; i += 1) {
        const fn = rafQueue.shift();
        if (!fn) return;
        nowMs += 16.7;
        fn(nowMs);
      }
    },
  };
}

async function testBoot() {
  // Boot 1: no save — the title must offer a fresh start.
  const dom1 = makeDomStubs();
  dom1.install();
  await import('../game/src/main.js?boot=1');
  dom1.runFrames(30);
  assert.ok(dom1.fillTexts.some((t) => t.includes('NEON HARBOR')), 'title screen draws');
  assert.ok(dom1.fillTexts.some((t) => t.includes('Press Enter to start')), 'fresh start offered without a save');
  dom1.dispatchKey('Enter'); // title -> start new game -> briefing
  dom1.runFrames(5);
  assert.ok(dom1.fillTexts.some((t) => t.includes('Job 1: First Gear')), 'briefing shows mission 1');
  dom1.dispatchKey('Enter'); // briefing -> play
  dom1.runFrames(600); // 10 seconds of play
  assert.ok(dom1.fillTexts.some((t) => t.includes('Steal a car')), 'objective HUD shows during play');
  console.log('ok boot 1: title -> briefing -> 10s of play, no errors');

  // Boot 2: a save exists — the title must offer to continue the run.
  const dom2 = makeDomStubs();
  dom2.install();
  dom2.store.set('neon-harbor.save.v1', JSON.stringify({ cash: 1300, earned: 1300, missionIndex: 2 }));
  await import('../game/src/main.js?boot=2');
  dom2.runFrames(30);
  assert.ok(
    dom2.fillTexts.some((t) => t.includes('continue your run')),
    'title offers to continue when a save exists',
  );
  console.log('ok boot 2: save detected, "continue your run" offered');
}

testMissionOne();
testRepair();
testChaos();
await testBoot();
console.log('all sim tests passed');
