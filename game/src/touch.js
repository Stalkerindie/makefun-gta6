// On-screen touch controls for Neon Harbor (phones and tablets).
// The game is keyboard-driven (WASD + E + Space), which does not exist on a
// phone, so this builds a virtual joystick (left thumb: move / steer) and
// four large buttons (right thumb: enter-exit car, shoot, pause, confirm).
// Everything drives the same input object as the keyboard, so no game rule
// changes: the joystick feeds setTouchVector, the buttons queue one-shot
// actions exactly like key presses.
//
// The controls only appear on touch devices (coarse pointer or touch
// points); `?touch=1` forces them on for testing on a desktop.
import {
  ACTION_CONFIRM,
  ACTION_ENTER,
  ACTION_PAUSE,
  ACTION_SHOOT,
} from './input.js';

const STICK_RADIUS = 36;

export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;
  const points =
    typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0;
  const forced = /[?&]touch=1/.test(window.location.search);
  return coarse || points || forced;
}

function makeButton(document, label, ariaLabel, action) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'touch-btn';
  button.textContent = label;
  button.setAttribute('aria-label', ariaLabel);
  button.dataset.action = String(action);
  return button;
}

/** Build the touch UI and wire it to `input`. Returns null when not a touch device. */
export function attachTouchControls(input) {
  if (!isTouchDevice()) return null;
  const document = window.document;

  const root = document.createElement('div');
  root.id = 'touch-ui';

  const stick = document.createElement('div');
  stick.id = 'stick-base';
  stick.setAttribute('aria-label', 'Joystick: move and steer');
  const knob = document.createElement('div');
  knob.id = 'stick-knob';
  stick.appendChild(knob);
  root.appendChild(stick);

  const buttons = document.createElement('div');
  buttons.id = 'touch-buttons';
  const enter = makeButton(document, '🚗', 'Enter or exit car (E)', ACTION_ENTER);
  const shoot = makeButton(document, '🔫', 'Shoot (Space)', ACTION_SHOOT);
  const pause = makeButton(document, '⏸', 'Pause (P)', ACTION_PAUSE);
  const confirm = makeButton(document, '▶', 'Confirm (Enter)', ACTION_CONFIRM);
  confirm.classList.add('touch-btn-wide');
  buttons.append(enter, shoot, pause, confirm);
  root.appendChild(buttons);

  document.body.appendChild(root);

  // Joystick: drag from the base centre; the knob follows, clamped to the
  // base radius, and the vector steers the player or the car.
  let stickPointer = null;
  function stickVector(event) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = event.clientX - cx;
    let dy = event.clientY - cy;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) {
      dx = (dx / len) * STICK_RADIUS;
      dy = (dy / len) * STICK_RADIUS;
    }
    return { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS, dx, dy };
  }
  stick.addEventListener('pointerdown', (event) => {
    stickPointer = event.pointerId;
    if (typeof stick.setPointerCapture === 'function') {
      try { stick.setPointerCapture(event.pointerId); } catch { /* ignore */ }
    }
    const v = stickVector(event);
    knob.style.transform = `translate(${v.dx}px, ${v.dy}px)`;
    input.setTouchVector(v.x, v.y);
    event.preventDefault();
  });
  stick.addEventListener('pointermove', (event) => {
    if (stickPointer !== event.pointerId) return;
    const v = stickVector(event);
    knob.style.transform = `translate(${v.dx}px, ${v.dy}px)`;
    input.setTouchVector(v.x, v.y);
    event.preventDefault();
  });
  function stickEnd(event) {
    if (stickPointer !== event.pointerId) return;
    stickPointer = null;
    knob.style.transform = '';
    input.setTouchVector(0, 0);
  }
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);

  // Buttons queue one-shot actions, exactly like their keys. The gun button
  // fires again while it is held (the world's shoot cooldown paces it), so a
  // thumb held on it is autofire. Every button shows a pressed state while
  // held, so a tap that lands always reads as one.
  let shootTimer = null;
  function stopShooting() {
    if (shootTimer !== null) {
      clearInterval(shootTimer);
      shootTimer = null;
    }
  }
  for (const [button, action] of [
    [enter, ACTION_ENTER],
    [shoot, ACTION_SHOOT],
    [pause, ACTION_PAUSE],
    [confirm, ACTION_CONFIRM],
  ]) {
    button.addEventListener('pointerdown', (event) => {
      button.classList.add('pressed');
      input.queueTouchAction(action);
      if (button === shoot) {
        stopShooting();
        shootTimer = setInterval(() => input.queueTouchAction(ACTION_SHOOT), 150);
      }
      event.preventDefault();
    });
    const release = () => {
      button.classList.remove('pressed');
      if (button === shoot) stopShooting();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('pointerleave', release);
  }

  return { root, stick, knob, buttons: { enter, shoot, pause, confirm } };
}
