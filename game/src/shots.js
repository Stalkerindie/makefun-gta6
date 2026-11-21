// The screenshot scenes behind ?shot=start|play|chase|mission. Each one plays the real
// rules forward from a fresh world for a fixed number of steps, steered by a simple
// autopilot (walk to the nearest car, steal it, then drive along the roads toward a
// target), so the frame is what a short game really looks like and the same seed always
// gives the same frame.
import { STEP } from './config.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const TAU = Math.PI * 2;

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function noInput() {
  return { up: false, down: false, left: false, right: false, enter: false, shoot: false, aimX: 0, aimY: 0 };
}

/** Steer toward a point, as held keys. */
function steerToward(state, tx, ty) {
  const p = state.player;
  const want = Math.atan2(ty - p.y, tx - p.x);
  const diff = angleDiff(want, p.angle);
  return {
    up: true, down: false,
    left: diff < -0.06, right: diff > 0.06,
    enter: false, shoot: false, aimX: tx, aimY: ty,
  };
}

/** Drive along the roads toward a target point (snapped to the nearest road). */
function driveInput(state, tx, ty) {
  const p = state.player;
  const city = state.city;
  if (tx === undefined) {
    // No target: keep going along the road ahead.
    const ahead = 260;
    const snap = city.nearestRoadPoint(p.x + Math.cos(p.angle) * ahead, p.y + Math.sin(p.angle) * ahead);
    return steerToward(state, snap.x, snap.y);
  }
  const snap = city.nearestRoadPoint(tx, ty);
  // If the target is close, aim at it directly; else aim at the road point ahead that
  // leads toward it.
  const d = Math.hypot(snap.x - p.x, snap.y - p.y);
  if (d < 220) return steerToward(state, tx, ty);
  const ahead = 260;
  const probe = city.nearestRoadPoint(p.x + Math.cos(p.angle) * ahead, p.y + Math.sin(p.angle) * ahead);
  const toTarget = Math.atan2(ty - p.y, tx - p.x);
  const toProbe = Math.atan2(probe.y - p.y, probe.x - p.x);
  if (Math.abs(angleDiff(toTarget, toProbe)) > 1.2) {
    // The road ahead leads away: aim at the snapped target instead and let the car's
    // road-following carry it there.
    return steerToward(state, snap.x, snap.y);
  }
  return steerToward(state, probe.x, probe.y);
}

/** Walk toward a point, as held keys. */
function walkInput(state, tx, ty) {
  const p = state.player;
  const dx = tx - p.x;
  const dy = ty - p.y;
  return {
    up: dy < -10, down: dy > 10,
    left: dx < -10, right: dx > 10,
    enter: false, shoot: false, aimX: tx, aimY: ty,
  };
}

function nearestParked(state) {
  let best = null;
  let bestD = Infinity;
  for (const car of state.cars) {
    if (!car.active || (car.kind !== 'parked' && car.kind !== 'traffic')) continue;
    const d = (car.x - state.player.x) ** 2 + (car.y - state.player.y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
}

/** Steal the nearest car: walk to it, press E, then drive. Returns true once driving. */
function stealAndDrive(world, seconds, target) {
  const state = world.state;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    let input;
    if (state.player.onFoot) {
      const car = nearestParked(state);
      if (!car) return false;
      const d = Math.hypot(car.x - state.player.x, car.y - state.player.y);
      if (d < 50) {
        input = noInput();
        input.enter = true;
      } else {
        input = walkInput(state, car.x, car.y);
      }
    } else {
      input = target ? driveInput(state, target.x, target.y) : driveInput(state);
    }
    world.step(STEP, input);
    if (state.player.car && state.player.car.health <= 0) return false;
  }
  return !state.player.onFoot;
}

/**
 * Set `world` to the named scene (start, play, chase or mission; any other name is start)
 * and return the screen to draw over it and the best score to show.
 */
export function stageShot(name, world) {
  const state = world.state;
  world.reset();
  state.objectiveMarker = null;

  if (name !== 'play' && name !== 'chase' && name !== 'mission') {
    // Title over a living city: traffic and pedestrians move, nobody drives.
    for (let i = 0; i < 5 / STEP; i += 1) world.step(STEP, noInput());
    return { screen: SCREEN_TITLE, best: 0 };
  }

  if (name === 'mission') {
    // The bank job: steal a car and drive toward the Marlowe Bay Bank, beacon visible.
    world.startMission(4);
    stealAndDrive(world, 16, { x: 1920, y: 640 });
    state.objectiveMarker = world.objective();
    return { screen: SCREEN_PLAY, best: state.cash };
  }

  const driving = stealAndDrive(world, 20);
  if (!driving) {
    // Fallback: put the player in a car directly so the frame still shows driving.
    const car = nearestParked(state);
    if (car) {
      state.player.onFoot = false;
      state.player.car = car;
      car.kind = 'player';
      state.player.x = car.x;
      state.player.y = car.y;
      for (let i = 0; i < 6 / STEP; i += 1) world.step(STEP, driveInput(state));
    }
  }
  if (name === 'chase') {
    state.wanted = 3.5;
    state.quietTimer = 0;
    for (let i = 0; i < 12 / STEP; i += 1) world.step(STEP, driveInput(state));
    if (state.player.onFoot) {
      // The chase may have wrecked the car: put Rook back behind the wheel of
      // the nearest parked car so the frame still shows a driving chase.
      const car = nearestParked(state);
      if (car) {
        state.player.onFoot = false;
        state.player.car = car;
        car.kind = 'player';
        car.health = 100;
        state.player.x = car.x;
        state.player.y = car.y;
        for (let i = 0; i < 3 / STEP; i += 1) world.step(STEP, driveInput(state));
      }
    }
  }
  state.objectiveMarker = world.objective();
  return { screen: SCREEN_PLAY, best: state.cash };
}
