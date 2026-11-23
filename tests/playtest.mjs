// Playtest harness for Neon Harbor: plays missions 1..6 end to end with a
// road-following autopilot, chaining through the real mission flow exactly as
// main.js does (startMission -> EVENT_MISSION -> next mission). Reports per
// mission whether it completes, how long it takes, and any busted/wasted/
// restart. Also covers save/load round-trips at each mission boundary —
// including the story-complete save (missionIndex 6 must survive a reset,
// so "continue your run" reaches free roam instead of replaying mission 5).
//
// Regression cover: mission 4 (Hot Pursuit) used to be unbeatable — the
// cops stayed glued to the bumper, the car was rammed to death, and every
// forced steal re-added a wanted star. The chase tuning (cop speed, spawn
// distance/angle/throttle, ram cooldown + damage, line-of-sight decay) is
// what this chain proves: before it, the run died at mission 4 (busted
// after ~790s); after it, the whole story completes.
//
//   node tests/playtest.mjs [seed ...]
import { createRandom } from '../game/src/random.js';
import {
  createWorld, EVENT_MISSION, EVENT_BUSTED, EVENT_OVER, MISSIONS,
} from '../game/src/world.js';
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
    if (d < bestD) { bestD = d; best = car; }
  }
  return best;
}

// Walk (8-dir) toward a point; returns an input object.
function walkTo(state, tx, ty) {
  const input = noInput();
  const dx = tx - state.player.x;
  const dy = ty - state.player.y;
  if (Math.abs(dx) > 8) input[dx > 0 ? 'right' : 'left'] = true;
  if (Math.abs(dy) > 8) input[dy > 0 ? 'down' : 'up'] = true;
  return input;
}

function playChain(seed) {
  const world = createWorld(createRandom(seed));
  const state = world.state;
  const log = [];
  let restarts = 0;
  let busted = 0;
  let wasted = 0;
  let lastMissionIdx = -1;
  let lastStep = -1;

  const banned = new Set();
  let route = null;
  let leg = 0;
  let replanIn = 0;
  let lastX = state.player.x;
  let lastY = state.player.y;
  let stuckFor = 0;
  let unstickFor = 0;
  let lastDistToTarget = Infinity;
  let noProgressFor = 0;
  let lastLogAt = -10;
  const evadeWaypoints = [
    { x: 160, y: 160 }, { x: 3040, y: 160 }, { x: 3040, y: 2080 }, { x: 160, y: 2080 },
  ];
  let evadeWp = 0;

  function decide() {
    const step = state.mission.steps[state.missionStep];
    const obj = world.objective();
    if (!step) return noInput();
    const px = state.player.x;
    const py = state.player.y;

    // --- on foot: steal a car first, except for enterMarked (walk to gold car) ---
    if (state.player.onFoot) {
      if (step.type === 'enterMarked' && state.getaway) {
        const gx = state.getaway.x;
        const gy = state.getaway.y;
        const d = Math.hypot(gx - px, gy - py);
        if (d < 50) {
          const input = noInput();
          input.enter = true;
          return input;
        }
        // Approach from the far side of the old car, so Enter grabs the gold
        // car instead of re-entering the car we just left.
        const old = state.cars.find((c) => c.active && c.kind === 'parked'
          && Math.hypot(c.x - px, c.y - py) < 120);
        if (old) {
          const ax = gx - old.x;
          const ay = gy - old.y;
          const al = Math.hypot(ax, ay) || 1;
          return walkTo(state, gx + (ax / al) * 45, gy + (ay / al) * 45);
        }
        return walkTo(state, gx, gy);
      }
      if (step.type === 'grab') {
        // Crack the vault on foot: walk the road route, then straight in.
        if (!route || replanIn <= 0) { route = planRoute(state, step.x, step.y); leg = 0; replanIn = 240; }
        replanIn -= 1;
        const target = route[Math.min(leg, route.length - 1)];
        if (Math.hypot(target.x - px, target.y - py) < 60 && leg < route.length - 1) leg += 1;
        const d = Math.hypot(step.x - px, step.y - py);
        if (d < step.radius * 0.9) return noInput();
        return walkTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
      }
      // steal / goto / deliver / drive / follow / evade: get a car.
      // Dodge a foot cop that is about to arrest us first.
      let nearCop = null;
      let nearD = 60;
      for (const cop of state.cops) {
        if (!cop.active || cop.down > 0) continue;
        const d = Math.hypot(cop.x - px, cop.y - py);
        if (d < nearD) { nearD = d; nearCop = cop; }
      }
      if (nearCop) {
        const input = noInput();
        const dx = px - nearCop.x;
        const dy = py - nearCop.y;
        if (Math.abs(dx) > 8) input[dx > 0 ? 'right' : 'left'] = true;
        if (Math.abs(dy) > 8) input[dy > 0 ? 'down' : 'up'] = true;
        return input;
      }
      const car = nearestStealable(state, banned);
      if (!car) return noInput();
      const d = Math.hypot(car.x - px, car.y - py);
      if (d < 50) {
        const input = noInput();
        input.enter = true;
        return input;
      }
      if (Math.hypot(px - lastX, py - lastY) < 2) {
        stuckFor += 1;
        if (stuckFor > 300) { banned.add(car); stuckFor = 0; }
      } else stuckFor = 0;
      return walkTo(state, car.x, car.y);
    }

    // --- in a car ---
    // enterMarked: we are in the wrong car — get out (Enter) so the on-foot
    // branch can walk to the gold car.
    if (step.type === 'enterMarked') {
      const input = noInput();
      input.enter = true;
      return input;
    }
    if (step.type === 'steal') return noInput(); // step completes on its own
    if (step.type === 'grab') {
      const d = Math.hypot(step.x - px, step.y - py);
      if (d < step.radius * 0.85) return noInput();
      // Static target: plan once (re-planning every few seconds resets the
      // leg counter and makes the car orbit the block instead of parking
      // at the wall). Unstick / mission change clears the route.
      if (!route) { route = planRoute(state, step.x, step.y); leg = 0; }
      const target = route[Math.min(leg, route.length - 1)];
      if (Math.hypot(target.x - px, target.y - py) < 70 && leg < route.length - 1) leg += 1;
      return steerTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
    }
    if (step.type === 'follow' && state.courier) {
      const c = state.courier;
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < 130) {
        // Coast: do not ram the courier flat, keep the tail instead.
        const input = noInput();
        const want = Math.atan2(c.y - py, c.x - px);
        const diff = wrapAngle(want - state.player.angle);
        input.left = diff < -0.06;
        input.right = diff > 0.06;
        return input;
      }
      if (!route || replanIn <= 0) { route = planRoute(state, c.x, c.y); leg = 0; replanIn = 30; }
      replanIn -= 1;
      const target = route[Math.min(leg, route.length - 1)];
      if (Math.hypot(target.x - px, target.y - py) < 70 && leg < route.length - 1) leg += 1;
      return steerTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
    }
    if (step.type === 'evade') {
      // Flee-road evasion (proven 5/5 seeds): re-route every 2s to the map
      // point farthest from all cops, use repair toolboxes when hurt, and
      // brake early for peds/traffic instead of ramming through them.
      const car = state.player.car;
      const hx = Math.cos(car.angle);
      const hy = Math.sin(car.angle);
      const fleePoints = [
        { x: 160, y: 160 }, { x: 1600, y: 160 }, { x: 3040, y: 160 },
        { x: 160, y: 1120 }, { x: 3040, y: 1120 },
        { x: 160, y: 2080 }, { x: 1600, y: 2080 }, { x: 3040, y: 2080 },
      ];
      let repairTarget = null;
      if (car.health < 55) {
        let bd = Infinity;
        for (const pk of state.pickups) {
          if (!pk.active || pk.kind !== 'repair') continue;
          const dd = (pk.x - px) ** 2 + (pk.y - py) ** 2;
          if (dd < bd) { bd = dd; repairTarget = pk; }
        }
      }
      if (repairTarget) {
        if (!route || replanIn <= 0) { route = planRoute(state, repairTarget.x, repairTarget.y); leg = 0; replanIn = 60; }
        replanIn -= 1;
      } else if (!route || replanIn <= 0) {
        let bestPt = fleePoints[0];
        let bestScore = -Infinity;
        for (const pt of fleePoints) {
          let minD = Infinity;
          for (const c of state.cars) {
            if (c.active && c.kind === 'police') {
              const d = Math.hypot(pt.x - c.x, pt.y - c.y);
              if (d < minD) minD = d;
            }
          }
          for (const c of state.cops) {
            if (c.active) {
              const d = Math.hypot(pt.x - c.x, pt.y - c.y);
              if (d < minD) minD = d;
            }
          }
          const dSelf = Math.hypot(pt.x - px, pt.y - py);
          const score = Math.min(minD, 900) + (dSelf > 400 ? 100 : 0);
          if (score > bestScore) { bestScore = score; bestPt = pt; }
        }
        route = planRoute(state, bestPt.x, bestPt.y);
        leg = 0;
        replanIn = 120;
      }
      replanIn -= 1;
      const pt = route[Math.min(leg, route.length - 1)];
      if (Math.hypot(pt.x - px, pt.y - py) < 70 && leg < route.length - 1) leg += 1;
      const input = steerTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
      for (const ped of state.peds) {
        if (!ped.active || ped.down > 0) continue;
        const dx = ped.x - px;
        const dy = ped.y - py;
        const d = Math.hypot(dx, dy);
        if (d < 300 && (dx * hx + dy * hy) / d > 0.5) { input.up = false; input.down = true; break; }
      }
      for (const other of state.cars) {
        if (!other.active || other === car || other.kind === 'parked' || other.kind === 'player') continue;
        const dx = other.x - px;
        const dy = other.y - py;
        const d = Math.hypot(dx, dy);
        if (d < 300 && (dx * hx + dy * hy) / d > 0.6) { input.up = false; input.down = true; break; }
      }
      return input;
    }
    // goto / deliver / drive: static target, plan once (see grab note).
    const tx = step.x;
    const ty = step.y;
    if (!route) { route = planRoute(state, tx, ty); leg = 0; }
    const target = route[Math.min(leg, route.length - 1)];
    if (Math.hypot(target.x - px, target.y - py) < 70 && leg < route.length - 1) leg += 1;
    return steerTo(state, route[Math.min(leg, route.length - 1)].x, route[Math.min(leg, route.length - 1)].y);
  }

  const results = [];
  const maxTotalSteps = Math.round(1500 / STEP);
  let missionStartStep = 0;
  let missionStartCash = 0;
  let saveMismatch = false;
  world.startMission(0);
  missionStartStep = 0;
  missionStartCash = 0;

  for (let stepNo = 0; stepNo < maxTotalSteps; stepNo += 1) {
    const t = stepNo * STEP;
    if (state.mission && (state.missionIndex !== lastMissionIdx || state.missionStep !== lastStep)) {
      if (state.missionIndex !== lastMissionIdx) {
        if (lastMissionIdx >= 0) {
          // mission changed without EVENT_MISSION: a restart (failMission).
          restarts += 1;
          log.push(`  [${t.toFixed(0)}s] mission ${lastMissionIdx + 1} RESTARTED (fail -> step 0)`);
        }
        missionStartStep = stepNo;
        missionStartCash = state.cash;
      }
      lastMissionIdx = state.missionIndex;
      lastStep = state.missionStep;
    }
    const input = state.mission ? decide() : noInput();

    // Stuck detection while driving: barely moved in 3s -> reverse out, replan.
    if (stepNo % 180 === 0) {
      const moved = Math.hypot(state.player.x - lastX, state.player.y - lastY);
      if (state.mission && !state.player.onFoot && moved < 20 && unstickFor <= 0) {
        unstickFor = 60;
        route = null;
      }
      lastX = state.player.x;
      lastY = state.player.y;
    }
    let useInput = input;
    if (unstickFor > 0) {
      unstickFor -= 1;
      useInput = { up: false, down: true, left: true, right: false, enter: false, shoot: false, aimX: 0, aimY: 0 };
    }

    const events = world.step(STEP, useInput);
    if (events & EVENT_BUSTED) {
      busted += 1;
      log.push(`  [${t.toFixed(0)}s] BUSTED during mission ${state.missionIndex + 1} step ${state.missionStep}`);
      break;
    }
    if (events & EVENT_OVER) {
      wasted += 1;
      log.push(`  [${t.toFixed(0)}s] WASTED during mission ${state.missionIndex + 1} step ${state.missionStep}`);
      break;
    }
    if (events & EVENT_MISSION) {
      const idx = state.missionIndex - 1;
      const dur = (stepNo - missionStartStep) * STEP;
      results.push({
        mission: idx + 1, id: MISSIONS[idx].id, seconds: +dur.toFixed(1),
        cash: state.cash, wanted: +state.wanted.toFixed(2),
        health: Math.round(state.player.health),
        carHealth: state.player.car ? Math.round(state.player.car.health) : null,
      });
      log.push(`  mission ${idx + 1} (${MISSIONS[idx].id}) DONE in ${dur.toFixed(1)}s, cash $${state.cash}, wanted ${state.wanted.toFixed(2)}`);
      // Save/load round-trip at the boundary, exactly like main.js does.
      const save = world.serialize();
      const w2 = createWorld(createRandom(seed + 999));
      w2.reset(save);
      if (w2.state.missionIndex !== state.missionIndex || w2.state.cash !== state.cash) {
        saveMismatch = true;
        log.push(`  !! SAVE/LOAD MISMATCH after mission ${idx + 1}: save=${JSON.stringify(save)} loaded idx=${w2.state.missionIndex} cash=${w2.state.cash}`);
      }
      route = null;
      leg = 0;
      replanIn = 0;
      banned.clear();
      if (state.storyComplete) break;
      world.startMission(state.missionIndex);
      missionStartStep = stepNo + 1;
      missionStartCash = state.cash;
      lastMissionIdx = -1;
      lastStep = -1;
      continue;
    }
    if (t - lastLogAt >= 20 && state.mission) {
      lastLogAt = t;
      const obj = world.objective();
      log.push(`  [${t.toFixed(0)}s] m${state.missionIndex + 1}.${state.missionStep} ${obj ? obj.text : '-'} dist=${obj && obj.distance !== null ? obj.distance + 'm' : '?'} prog=${state.missionProgress.toFixed(1)} timer=${state.missionTimer.toFixed(0)} wanted=${state.wanted.toFixed(2)} hp=${Math.round(state.player.health)} carHp=${state.player.car ? Math.round(state.player.car.health) : '-'} onFoot=${state.player.onFoot} pos=(${Math.round(state.player.x)},${Math.round(state.player.y)})`);
    }
  }

  return { seed, results, restarts, busted, wasted, storyComplete: state.storyComplete, cash: state.cash, saveMismatch, log };
}

const seeds = process.argv.slice(2).map(Number).filter((n) => Number.isFinite(n));
const runSeeds = seeds.length ? seeds : [1];
let allOk = true;
for (const seed of runSeeds) {
  const r = playChain(seed);
  console.log(`\n=== seed ${seed}: storyComplete=${r.storyComplete} cash=$${r.cash} restarts=${r.restarts} busted=${r.busted} wasted=${r.wasted} saveMismatch=${r.saveMismatch} ===`);
  for (const m of r.results) {
    console.log(`  mission ${m.mission} (${m.id}): ${m.seconds}s, cash $${m.cash}, wanted ${m.wanted}, hp ${m.health}, carHp ${m.carHealth}`);
  }
  if (!r.storyComplete || r.busted || r.wasted || r.saveMismatch) {
    allOk = false;
    console.log('  --- trace ---');
    for (const line of r.log) console.log(line);
  } else {
    // Print the trace tail anyway (last 12 lines) for the interesting missions.
    console.log('  --- trace (last 14 lines) ---');
    for (const line of r.log.slice(-14)) console.log(line);
  }
}
console.log(allOk ? '\nALL CHAINS COMPLETE' : '\nCHAIN(S) FAILED');
process.exit(allOk ? 0 : 1);
