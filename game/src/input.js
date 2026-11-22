// Keyboard and pointer input for Neon Harbor. Held keys give movement and steering;
// one-shot presses (confirm, pause, enter/exit car, shoot) are queued as bit flags and
// taken once by the loop, so a press between two frames is never lost and never counted
// twice. The mouse position is tracked for aiming on foot.

export const ACTION_CONFIRM = 1;
export const ACTION_PAUSE = 2;
export const ACTION_ENTER = 4;
export const ACTION_SHOOT = 8;

const UP = new Set(['ArrowUp', 'KeyW']);
const DOWN = new Set(['ArrowDown', 'KeyS']);
const LEFT = new Set(['ArrowLeft', 'KeyA']);
const RIGHT = new Set(['ArrowRight', 'KeyD']);
const CONFIRM = new Set(['Enter']);
const PAUSE = new Set(['KeyP', 'Escape']);
const ENTER = new Set(['KeyE']);
const SHOOT = new Set(['Space']);

export function createInput(target) {
  let up = false;
  let down = false;
  let left = false;
  let right = false;
  let actions = 0;
  let mouseX = 0;
  let mouseY = 0;
  let mouseDown = false;
  // Holding Space fires again and again (the world's shoot cooldown paces
  // it), so a held trigger is an autofire trigger. The key-repeat events
  // queue the shot each time; a single press still fires exactly once.
  let shootHeld = false;
  // Touch controls (see touch.js): a joystick vector in [-1, 1] and one-shot
  // presses queued the same way as keys, so both paths share one input.
  let touchX = 0;
  let touchY = 0;

  window.addEventListener('keydown', (event) => {
    if (UP.has(event.code)) up = true;
    else if (DOWN.has(event.code)) down = true;
    else if (LEFT.has(event.code)) left = true;
    else if (RIGHT.has(event.code)) right = true;
    else if (CONFIRM.has(event.code)) {
      if (!event.repeat) actions |= ACTION_CONFIRM;
    } else if (PAUSE.has(event.code)) {
      if (!event.repeat) actions |= ACTION_PAUSE;
    } else if (ENTER.has(event.code)) {
      if (!event.repeat) actions |= ACTION_ENTER;
    } else if (SHOOT.has(event.code)) {
      shootHeld = true;
      actions |= ACTION_SHOOT;
    } else return;
    event.preventDefault();
  });
  window.addEventListener('keyup', (event) => {
    if (UP.has(event.code)) up = false;
    else if (DOWN.has(event.code)) down = false;
    else if (LEFT.has(event.code)) left = false;
    else if (RIGHT.has(event.code)) right = false;
    else if (SHOOT.has(event.code)) shootHeld = false;
  });
  // A key released while the tab is hidden never sends keyup: let go of everything on blur.
  window.addEventListener('blur', () => {
    up = false;
    down = false;
    left = false;
    right = false;
    mouseDown = false;
    shootHeld = false;
    touchX = 0;
    touchY = 0;
  });
  target.addEventListener('pointermove', (event) => {
    const rect = target.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
  });
  target.addEventListener('pointerdown', (event) => {
    const rect = target.getBoundingClientRect();
    mouseX = event.clientX - rect.left;
    mouseY = event.clientY - rect.top;
    mouseDown = true;
    actions |= ACTION_SHOOT;
  });
  target.addEventListener('pointerup', () => {
    mouseDown = false;
  });

  return {
    up: () => up || touchY < -0.25,
    down: () => down || touchY > 0.25,
    left: () => left || touchX < -0.25,
    right: () => right || touchX > 0.25,
    mouse: () => ({ x: mouseX, y: mouseY, down: mouseDown }),
    /** True while the shoot key is held down (autofire; the world paces it). */
    shootHeld: () => shootHeld,
    /** The one-shot presses since the last call, as ACTION_* flags. */
    takeActions() {
      const taken = actions;
      actions = 0;
      return taken;
    },
    /** Touch joystick vector, each component in [-1, 1]; (0, 0) releases it. */
    setTouchVector(x, y) {
      touchX = Math.max(-1, Math.min(1, x));
      touchY = Math.max(-1, Math.min(1, y));
    },
    /** Raw joystick vector for analog driving: { x, y, active }. Small dead
        zone so a resting thumb does not creep the car. Keyboard input
        leaves this inactive, so keyboard driving stays exactly as before. */
    analog() {
      const dz = 0.12;
      const ax = Math.abs(touchX) < dz ? 0 : touchX;
      const ay = Math.abs(touchY) < dz ? 0 : touchY;
      return { x: ax, y: ay, active: ax !== 0 || ay !== 0 };
    },
    /** Queue a one-shot press from a touch button, exactly like a key press. */
    queueTouchAction(flag) {
      actions |= flag;
    },
    /** Put flags back for a later takeActions(). The frame loop's action
        handler takes every queued press each frame, so presses the current
        screen did not use (enter car, shoot while playing) must be handed
        back here instead of being dropped silently. */
    requeue(flags) {
      actions |= flags;
    },
  };
}
