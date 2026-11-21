// Boot and the one loop: input is read every frame, the world advances in fixed 1/60 s
// steps (several in a slow frame, none in a fast one), and the renderer paints what is
// there. The game moves between title, briefing, play, paused, mission-done, wasted,
// busted and story screens. Progress (cash + next job) saves to localStorage whenever a
// job is done or the run ends badly, and the title offers to continue it.
//
// ?seed=N fixes the city and the traffic. ?shot=start|play|chase|mission (with &seed=N)
// stages that scene instead of running the loop, paints it twice and sets
// window.__shotReady for a screenshot.
import { BEST_KEY, GAME_TITLE, SAVE_KEY, STEP } from './config.js';
import { createRandom } from './random.js';
import {
  createWorld,
  EVENT_BUSTED,
  EVENT_CASH,
  EVENT_CRASH,
  EVENT_ENTER_CAR,
  EVENT_MISSION,
  EVENT_OVER,
  EVENT_SHOT,
  EVENT_STEAL,
  MISSIONS,
} from './world.js';
import { ACTION_CONFIRM, ACTION_ENTER, ACTION_PAUSE, ACTION_SHOOT, createInput } from './input.js';
import { createAudio } from './audio.js';
import {
  createRenderer,
  SCREEN_BRIEFING,
  SCREEN_BUSTED,
  SCREEN_MISSION_DONE,
  SCREEN_OVER,
  SCREEN_PAUSED,
  SCREEN_PLAY,
  SCREEN_STORY,
  SCREEN_TITLE,
} from './render.js';
import { stageShot } from './shots.js';

/** The longest frame the loop catches up on; a longer stall (a hidden tab) is dropped, not replayed. */
const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const audio = createAudio();

function readBest() {
  try {
    return Number.parseInt(window.localStorage.getItem(BEST_KEY) ?? '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest(value) {
  try {
    window.localStorage.setItem(BEST_KEY, String(value));
  } catch {
    // Storage can be off (private windows): the best score then lasts this visit only.
  }
}

function readSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const save = JSON.parse(raw);
    if (typeof save.cash !== 'number' || typeof save.missionIndex !== 'number') return null;
    return save;
  } catch {
    return null;
  }
}

function writeSave() {
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(world.serialize()));
  } catch {
    // Storage can be off: the run still plays, it just does not persist.
  }
}

/** The HUD data for the current frame: objective text, mission title, transient message. */
function uiFor(state, best, message) {
  const ui = { best, message: message || null, objectiveText: null, missionTitle: null, briefingLines: null, reward: 0, nextTitle: null };
  const obj = world.objective();
  if (obj) {
    ui.objectiveText = obj.text;
    if (state.mission) {
      ui.missionTitle = state.mission.title;
      const step = state.mission.steps[state.missionStep];
      if (step) {
        if (step.timer !== undefined) {
          const left = Math.max(0, Math.ceil(step.timer - state.missionTimer));
          ui.objectiveText += `\n${left}s left`;
        } else if (step.type === 'grab') {
          ui.objectiveText += `\nCracking… ${Math.min(99, Math.floor((state.missionProgress / step.hold) * 100))}%`;
        } else if (step.type === 'follow') {
          ui.objectiveText += `\n${Math.floor(state.missionProgress)}s / ${step.need}s`;
        }
      }
    }
  }
  return ui;
}

function runShot(name) {
  const scene = stageShot(name, world);
  const ui = uiFor(world.state, scene.best, null);
  let painted = 0;
  function paint() {
    renderer.draw(world.state, scene.screen, ui);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

function runGame() {
  const input = createInput(canvas);
  let screen = SCREEN_TITLE;
  let best = readBest();
  let save = readSave();
  let accumulator = 0;
  let last = performance.now();
  let message = null;
  let messageUntil = 0;
  let lastReward = 0;
  let nextTitle = null;

  // Screen readers (and anyone watching the page's text) hear the screen changes.
  function announce(text) {
    status.textContent = text;
  }

  function showMessage(text, seconds) {
    message = text;
    messageUntil = world.state.time + seconds;
  }

  function beginMission(index) {
    world.startMission(index);
    screen = SCREEN_BRIEFING;
    announce(`${world.state.mission.title}. Press Enter to take the job.`);
  }

  function startNewGame() {
    save = null;
    try {
      window.localStorage.removeItem(SAVE_KEY);
    } catch {
      // Ignore.
    }
    world.reset();
    audio.unlock();
    audio.music(true);
    beginMission(0);
  }

  function continueGame() {
    const loaded = readSave();
    world.reset(loaded || undefined);
    audio.unlock();
    audio.music(true);
    if (world.state.missionIndex >= 6) {
      screen = SCREEN_PLAY;
      announce('Back in Marlowe Bay. Free roam.');
    } else {
      beginMission(world.state.missionIndex);
    }
  }

  function respawnAfterTrouble() {
    // Lose 10% of the cash, restart the current job at the garage.
    world.state.cash = Math.floor(world.state.cash * 0.9);
    const keep = world.serialize();
    writeSave();
    world.reset(keep);
    if (world.state.missionIndex >= 6) {
      screen = SCREEN_PLAY;
    } else {
      beginMission(world.state.missionIndex);
    }
  }

  function endGame(busted) {
    if (world.state.earned > best) {
      best = world.state.earned;
      saveBest(best);
    }
    writeSave();
    screen = busted ? SCREEN_BUSTED : SCREEN_OVER;
    announce(busted ? 'Busted by the Harbor Police.' : 'Wasted. Game over.');
  }

  function handleActions() {
    const actions = input.takeActions();
    if (screen === SCREEN_TITLE) {
      if (actions & ACTION_CONFIRM) {
        if (save) continueGame();
        else startNewGame();
      }
      return;
    }
    if (screen === SCREEN_BRIEFING) {
      if (actions & ACTION_CONFIRM) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (screen === SCREEN_MISSION_DONE) {
      if (actions & ACTION_CONFIRM) {
        if (world.state.storyComplete) {
          screen = SCREEN_STORY;
        } else {
          beginMission(world.state.missionIndex);
        }
      }
      return;
    }
    if (screen === SCREEN_STORY) {
      if (actions & ACTION_CONFIRM) screen = SCREEN_PLAY;
      return;
    }
    if (screen === SCREEN_OVER || screen === SCREEN_BUSTED) {
      if (actions & ACTION_CONFIRM) respawnAfterTrouble();
      return;
    }
    if (screen === SCREEN_PAUSED) {
      if (actions & (ACTION_PAUSE | ACTION_CONFIRM)) {
        screen = SCREEN_PLAY;
        announce('Playing.');
      }
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    if (actions & ACTION_PAUSE) {
      screen = SCREEN_PAUSED;
      audio.setEngine(false, 0);
      audio.siren(false);
      announce('Paused.');
    }
  }

  /** Build the step input from held keys and one-shot presses. */
  function stepInput(actions) {
    const mouse = input.mouse();
    let aimX = world.state.player.x + Math.cos(world.state.player.angle) * 200;
    let aimY = world.state.player.y + Math.sin(world.state.player.angle) * 200;
    if (actions & ACTION_SHOOT && mouse.down) {
      // Aim at the mouse: convert CSS pixels to world pixels through the camera.
      const scale = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
      const ox = (window.innerWidth - 1280 * scale) / 2;
      const oy = (window.innerHeight - 720 * scale) / 2;
      aimX = world.state.camera.x + (mouse.x - ox) / scale;
      aimY = world.state.camera.y + (mouse.y - oy) / scale;
    }
    return {
      up: input.up(),
      down: input.down(),
      left: input.left(),
      right: input.right(),
      enter: Boolean(actions & ACTION_ENTER),
      shoot: Boolean(actions & ACTION_SHOOT),
      aimX,
      aimY,
    };
  }

  function step() {
    if (screen === SCREEN_TITLE) {
      world.step(STEP, { up: false, down: false, left: false, right: false, enter: false, shoot: false, aimX: 0, aimY: 0 });
      return;
    }
    if (screen !== SCREEN_PLAY) return;
    const actions = input.takeActions();
    const events = world.step(STEP, stepInput(actions));
    if (events & EVENT_SHOT) audio.shot();
    if (events & EVENT_CRASH) audio.crash();
    if (events & EVENT_CASH) {
      audio.cash();
      showMessage('+$100', 1.5);
    }
    if (events & EVENT_ENTER_CAR) audio.click();
    if (events & EVENT_STEAL) showMessage('Car stolen — the cops noticed', 2.5);
    if (events & EVENT_MISSION) {
      // completeMission() already cleared state.mission and advanced missionIndex;
      // the finished job is the one just before it.
      const doneIndex = world.state.missionIndex - 1;
      lastReward = doneIndex >= 0 ? MISSIONS[doneIndex].reward : 0;
      nextTitle = doneIndex + 1 < MISSIONS.length ? MISSIONS[doneIndex + 1].title : null;
      audio.missionDone();
      writeSave();
      screen = SCREEN_MISSION_DONE;
      announce('Job done.');
    }
    if (events & EVENT_OVER) {
      audio.wasted();
      audio.setEngine(false, 0);
      audio.siren(false);
      endGame(false);
    } else if (events & EVENT_BUSTED) {
      audio.busted();
      audio.setEngine(false, 0);
      audio.siren(false);
      endGame(true);
    }
    if (screen === SCREEN_PLAY) {
      audio.setEngine(!world.state.player.onFoot, world.state.engineSpeed);
      audio.siren(world.state.siren);
    }
    if (message && world.state.time > messageUntil) message = null;
  }

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;
    handleActions();
    if (screen === SCREEN_TITLE || screen === SCREEN_PLAY) {
      while (accumulator >= STEP && (screen === SCREEN_TITLE || screen === SCREEN_PLAY)) {
        step();
        accumulator -= STEP;
      }
    } else {
      accumulator = 0;
    }
    const ui = uiFor(world.state, best, message);
    if (screen === SCREEN_BRIEFING && world.state.mission) {
      ui.missionTitle = world.state.mission.title;
      ui.briefingLines = world.state.mission.briefing;
    }
    if (screen === SCREEN_MISSION_DONE) {
      ui.reward = lastReward;
      ui.nextTitle = nextTitle;
    }
    renderer.draw(world.state, screen, ui);
  }

  // Leaving the tab pauses a running game rather than letting the city run unseen.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSED;
      audio.setEngine(false, 0);
      audio.siren(false);
      announce('Paused.');
    }
  });
  // Any first gesture unlocks audio.
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true });
  window.addEventListener('keydown', () => audio.unlock(), { once: true });

  announce(`${GAME_TITLE}. Press Enter to start.`);
  requestAnimationFrame(frame);
}

if (shot) runShot(shot);
else runGame();
