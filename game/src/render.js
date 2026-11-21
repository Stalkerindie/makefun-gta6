// Drawing only: the world's state and the current screen in, pixels out. A camera follows
// the player through Marlowe Bay; the 1280x720 view is scaled to fit the window and centred.
// Flat shapes and canvas text: roads and lane dashes, buildings with roofs, parks and trees,
// the bay and the pier, cars, pedestrians, cops, particles, skid marks, a pulsing objective
// beacon, and the HUD — health, cash, wanted stars and a live minimap. A day/night tint
// washes over the world as time passes.
import { CAR, FIELD, FONT, PALETTE, PED, PLAYER, ROAD, WATER_Y, WORLD } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';
export const SCREEN_BUSTED = 'busted';
export const SCREEN_BRIEFING = 'briefing';
export const SCREEN_MISSION_DONE = 'mission-done';
export const SCREEN_STORY = 'story';

const PANEL = { width: 640, top: 150, line: 32, bottom: 76 };
const MINIMAP = { x: FIELD.width - 224, y: 16, w: 208, h: 156 };

function cachedLabel(prefix) {
  let value = null;
  let text = '';
  return function label(next) {
    if (next !== value) {
      value = next;
      text = prefix + next;
    }
    return text;
  };
}

export function createRenderer(canvas) {
  const context = canvas.getContext('2d');
  const view = { scale: 1, x: 0, y: 0 };
  const cashLabel = cachedLabel('$');
  const bestLabel = cachedLabel('Best haul $');

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * ratio);
    const height = Math.round(window.innerHeight * ratio);
    canvas.width = width;
    canvas.height = height;
    view.scale = Math.min(width / FIELD.width, height / FIELD.height);
    view.x = (width - FIELD.width * view.scale) / 2;
    view.y = (height - FIELD.height * view.scale) / 2;
  }

  const fonts = new Map();
  function text(value, x, y, size, color, align, baseline) {
    if (!fonts.has(size)) fonts.set(size, `${size}px ${FONT}`);
    context.font = fonts.get(size);
    context.fillStyle = color;
    context.textAlign = align || 'left';
    context.textBaseline = baseline || 'alphabetic';
    context.fillText(value, x, y);
  }

  function circle(x, y, r) {
    context.beginPath();
    context.arc(x, y, r, 0, Math.PI * 2);
    context.fill();
  }

  function drawCity(state) {
    const city = state.city;
    // Ground: grass everywhere, then the bay at the south edge.
    context.fillStyle = PALETTE.grassDark;
    context.fillRect(0, 0, WORLD.width, WORLD.height);
    context.fillStyle = PALETTE.waterDeep;
    context.fillRect(0, WATER_Y, WORLD.width, WORLD.height - WATER_Y);
    context.fillStyle = PALETTE.water;
    context.fillRect(0, WATER_Y, WORLD.width, 26);
    context.fillStyle = PALETTE.sand;
    context.fillRect(0, WATER_Y - 10, WORLD.width, 10);

    // Roads: asphalt strips with sidewalks and dashed centre lines.
    for (const rx of city.lines.vertical) {
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(rx - ROAD.width / 2, 0, ROAD.width, WATER_Y);
      context.fillStyle = PALETTE.asphalt;
      context.fillRect(rx - ROAD.width / 2 + 8, 0, ROAD.width - 16, WATER_Y);
      context.fillStyle = PALETTE.lane;
      for (let y = 8; y < WATER_Y - 8; y += 44) context.fillRect(rx - 2, y, 4, 22);
    }
    for (const ry of city.lines.horizontal) {
      context.fillStyle = PALETTE.sidewalk;
      context.fillRect(0, ry - ROAD.width / 2, WORLD.width, ROAD.width);
      context.fillStyle = PALETTE.asphalt;
      context.fillRect(0, ry - ROAD.width / 2 + 8, WORLD.width, ROAD.width - 16);
      context.fillStyle = PALETTE.lane;
      for (let x = 8; x < WORLD.width - 8; x += 44) context.fillRect(x, ry - 2, 22, 4);
    }

    // Parks.
    for (const park of city.parks) {
      context.fillStyle = PALETTE.grass;
      context.fillRect(park.x, park.y, park.w, park.h);
      for (const t of park.trees) {
        context.fillStyle = PALETTE.parkTree;
        circle(t.x, t.y, t.r);
        context.fillStyle = '#3f9a55';
        circle(t.x - 3, t.y - 3, t.r * 0.55);
      }
    }

    // Parking lots.
    for (const lot of city.parkingLots) {
      context.fillStyle = PALETTE.asphaltDark;
      context.fillRect(lot.x, lot.y, lot.w, lot.h);
      context.strokeStyle = PALETTE.muted;
      context.lineWidth = 2;
      for (let x = lot.x + 20; x < lot.x + lot.w - 20; x += 34) {
        context.beginPath();
        context.moveTo(x, lot.y + 8);
        context.lineTo(x, lot.y + 34);
        context.stroke();
      }
    }

    // Buildings with roofs.
    for (const b of city.buildings) {
      context.fillStyle = '#00000055';
      context.fillRect(b.x + 4, b.y + 5, b.w, b.h);
      context.fillStyle = b.color;
      context.fillRect(b.x, b.y, b.w, b.h);
      context.fillStyle = 'rgba(255,255,255,0.14)';
      context.fillRect(b.x + 6, b.y + 6, b.w - 12, b.h - 12);
      context.fillStyle = 'rgba(0,0,0,0.25)';
      context.fillRect(b.x + b.w / 2 - 8, b.y + b.h / 2 - 6, 16, 12);
      if (b.name) {
        text(b.name, b.x + b.w / 2, b.y - 8, 15, PALETTE.text, 'center');
      }
    }

    // The pier: planks out into the bay.
    context.fillStyle = '#6a4a2a';
    context.fillRect(1600 - 26, WATER_Y - 8, 52, WORLD.height - WATER_Y + 8);
    context.fillStyle = '#8a6d2f';
    for (let y = WATER_Y; y < WORLD.height; y += 18) context.fillRect(1600 - 26, y, 52, 3);
  }

  function drawCar(car, time) {
    context.save();
    context.translate(car.x, car.y);
    context.rotate(car.angle);
    const l = CAR.halfLength;
    const w = CAR.halfWidth;
    // Wheels.
    context.fillStyle = '#111';
    context.fillRect(-l + 4, -w - 3, 12, 5);
    context.fillRect(-l + 4, w - 2, 12, 5);
    context.fillRect(l - 16, -w - 3, 12, 5);
    context.fillRect(l - 16, w - 2, 12, 5);
    // Body.
    context.fillStyle = car.color;
    context.beginPath();
    context.roundRect(-l, -w, l * 2, w * 2, 7);
    context.fill();
    // Windshield and rear window.
    context.fillStyle = 'rgba(180,220,255,0.75)';
    context.fillRect(l - 14, -w + 3, 8, w * 2 - 6);
    context.fillRect(-l + 5, -w + 3, 6, w * 2 - 6);
    // Headlights.
    context.fillStyle = '#ffe9a3';
    context.fillRect(l - 2, -w + 4, 3, 5);
    context.fillRect(l - 2, w - 9, 3, 5);
    if (car.kind === 'police') {
      context.fillStyle = '#e8e8e8';
      context.fillRect(-6, -w + 2, 14, w * 2 - 4);
      // Flashing light bar.
      const flash = Math.floor(time * 4) % 2 === 0;
      context.fillStyle = flash ? '#ff3b30' : '#3b82ff';
      context.fillRect(-4, -w - 1, 8, 6);
      context.fillStyle = flash ? '#3b82ff' : '#ff3b30';
      context.fillRect(-4, w - 5, 8, 6);
      text('PD', 0, 4, 11, '#111', 'center', 'middle');
    }
    if (car.kind === 'courier') {
      text('GULL', 0, 4, 10, '#fff', 'center', 'middle');
    }
    if (car.health < 55) {
      context.fillStyle = PALETTE.smoke;
      circle(-l + 8, 0, 8 + Math.random() * 4);
    }
    context.restore();
  }

  function drawWorld(state, time) {
    drawCity(state);
    // Skid marks.
    context.strokeStyle = 'rgba(10,10,14,0.5)';
    context.lineWidth = 4;
    for (const s of state.skids) {
      if (!s.active) continue;
      context.globalAlpha = Math.min(1, s.life / 6) * 0.7;
      context.beginPath();
      context.moveTo(s.x - Math.cos(s.angle) * 10, s.y - Math.sin(s.angle) * 10);
      context.lineTo(s.x + Math.cos(s.angle) * 10, s.y + Math.sin(s.angle) * 10);
      context.stroke();
    }
    context.globalAlpha = 1;
    // Cash pickups.
    for (const pk of state.pickups) {
      if (!pk.active) continue;
      const bob = Math.sin(time * 3 + pk.x) * 2;
      context.fillStyle = PALETTE.cash;
      context.fillRect(pk.x - 9, pk.y - 7 + bob, 18, 14);
      text('$', pk.x, pk.y + 4 + bob, 13, '#12351c', 'center', 'middle');
    }
    // Objective beacon.
    const obj = state.objectiveMarker;
    if (obj && obj.x !== null && obj.x !== undefined) {
      const pulse = 1 + Math.sin(time * 5) * 0.15;
      context.strokeStyle = PALETTE.beacon;
      context.lineWidth = 3;
      context.beginPath();
      context.arc(obj.x, obj.y, 26 * pulse, 0, Math.PI * 2);
      context.stroke();
      context.fillStyle = PALETTE.beacon;
      circle(obj.x, obj.y, 6);
      context.globalAlpha = 0.18;
      context.fillStyle = PALETTE.beacon;
      context.fillRect(obj.x - 3, obj.y - 90, 6, 90);
      context.globalAlpha = 1;
    }
    // Cars.
    for (const car of state.cars) if (car.active) drawCar(car, time);
    // Pedestrians.
    for (const ped of state.peds) {
      if (!ped.active) continue;
      if (ped.down > 0) {
        context.fillStyle = ped.color;
        context.beginPath();
        context.ellipse(ped.x, ped.y, 12, 6, ped.angle, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.fillStyle = ped.color;
      circle(ped.x, ped.y, PED.radius);
      context.fillStyle = '#222';
      circle(ped.x + Math.cos(ped.angle) * 4, ped.y + Math.sin(ped.angle) * 4, 4);
    }
    // Foot cops.
    for (const cop of state.cops) {
      if (!cop.active) continue;
      if (cop.down > 0) {
        context.fillStyle = PALETTE.cop;
        context.beginPath();
        context.ellipse(cop.x, cop.y, 12, 6, cop.angle, 0, Math.PI * 2);
        context.fill();
        continue;
      }
      context.fillStyle = PALETTE.cop;
      circle(cop.x, cop.y, PED.radius + 2);
      context.fillStyle = '#dbeafe';
      circle(cop.x, cop.y - 2, 5);
      if (cop.arrest > 0) {
        context.fillStyle = '#fff';
        context.fillRect(cop.x - 12, cop.y - 26, 24, 5);
        context.fillStyle = '#ef4444';
        context.fillRect(cop.x - 12, cop.y - 26, 24 * (cop.arrest / 1.6), 5);
      }
    }
    // Player.
    const p = state.player;
    if (p.invulnerable === 0 || Math.floor(p.invulnerable * 10) % 2 === 1) {
      if (p.onFoot) {
        context.fillStyle = PALETTE.player;
        circle(p.x, p.y, PLAYER.radius);
        context.fillStyle = '#222';
        circle(p.x + Math.cos(p.angle) * 5, p.y + Math.sin(p.angle) * 5, 5);
        context.strokeStyle = '#333';
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(p.x + Math.cos(p.angle) * 10, p.y + Math.sin(p.angle) * 10);
        context.lineTo(p.x + Math.cos(p.angle) * 22, p.y + Math.sin(p.angle) * 22);
        context.stroke();
      }
    }
    // Bullets.
    context.fillStyle = '#ffe066';
    for (const b of state.bullets) {
      if (!b.active) continue;
      circle(b.x, b.y, 3);
    }
    // Particles.
    for (const pt of state.particles) {
      if (!pt.active) continue;
      context.globalAlpha = Math.max(0, pt.life / pt.max);
      context.fillStyle = pt.color;
      circle(pt.x, pt.y, pt.size);
    }
    context.globalAlpha = 1;
    // Day / night tint.
    const tod = state.timeOfDay;
    const night = Math.max(0, Math.sin((tod - 0.25) * Math.PI * 2)) * 0.34;
    const dusk = Math.max(0, Math.sin((tod - 0.1) * Math.PI * 2)) * 0.10;
    if (night > 0.01) {
      context.fillStyle = `rgba(8, 12, 38, ${night.toFixed(3)})`;
      context.fillRect(state.camera.x - 40, state.camera.y - 40, FIELD.width + 80, FIELD.height + 80);
    }
    if (dusk > 0.01 && night < 0.2) {
      context.fillStyle = `rgba(255, 120, 60, ${dusk.toFixed(3)})`;
      context.fillRect(state.camera.x - 40, state.camera.y - 40, FIELD.width + 80, FIELD.height + 80);
    }
  }

  function drawMinimap(state) {
    const sx = MINIMAP.w / WORLD.width;
    const sy = MINIMAP.h / WORLD.height;
    context.fillStyle = 'rgba(10, 14, 22, 0.85)';
    context.fillRect(MINIMAP.x - 4, MINIMAP.y - 4, MINIMAP.w + 8, MINIMAP.h + 8);
    context.fillStyle = '#1d2b1d';
    context.fillRect(MINIMAP.x, MINIMAP.y, MINIMAP.w, MINIMAP.h);
    context.fillStyle = PALETTE.water;
    context.fillRect(MINIMAP.x, MINIMAP.y + WATER_Y * sy, MINIMAP.w, MINIMAP.h - WATER_Y * sy);
    context.strokeStyle = '#565d6e';
    context.lineWidth = 1;
    for (const rx of state.city.lines.vertical) {
      context.beginPath();
      context.moveTo(MINIMAP.x + rx * sx, MINIMAP.y);
      context.lineTo(MINIMAP.x + rx * sx, MINIMAP.y + WATER_Y * sy);
      context.stroke();
    }
    for (const ry of state.city.lines.horizontal) {
      context.beginPath();
      context.moveTo(MINIMAP.x, MINIMAP.y + ry * sy);
      context.lineTo(MINIMAP.x + WORLD.width * sx, MINIMAP.y + ry * sy);
      context.stroke();
    }
    const obj = state.objectiveMarker;
    if (obj && obj.x !== null && obj.x !== undefined) {
      context.fillStyle = PALETTE.beacon;
      circle(MINIMAP.x + obj.x * sx, MINIMAP.y + obj.y * sy, 5);
    }
    for (const car of state.cars) {
      if (!car.active || car.kind !== 'police') continue;
      context.fillStyle = '#5b8cff';
      circle(MINIMAP.x + car.x * sx, MINIMAP.y + car.y * sy, 3);
    }
    context.fillStyle = '#fff';
    circle(MINIMAP.x + state.player.x * sx, MINIMAP.y + state.player.y * sy, 4);
    context.strokeStyle = '#fff';
    context.lineWidth = 1;
    context.strokeRect(MINIMAP.x - 4, MINIMAP.y - 4, MINIMAP.w + 8, MINIMAP.h + 8);
    text('MARLOWE BAY', MINIMAP.x + MINIMAP.w / 2, MINIMAP.y + MINIMAP.h + 16, 12, PALETTE.muted, 'center');
  }

  function drawHud(state, ui) {
    context.textBaseline = 'top';
    // Cash.
    text(cashLabel(state.cash), 24, 18, 30, PALETTE.cash, 'left');
    // Health bar.
    const hw = 220;
    const hx = 24;
    const hy = 56;
    context.fillStyle = 'rgba(0,0,0,0.55)';
    context.fillRect(hx - 4, hy - 4, hw + 8, 22);
    context.fillStyle = '#333';
    context.fillRect(hx, hy, hw, 14);
    context.fillStyle = state.player.health > 30 ? PALETTE.health : PALETTE.healthLow;
    context.fillRect(hx, hy, hw * (state.player.health / PLAYER.health), 14);
    text('HEALTH', hx + hw + 10, hy - 2, 15, PALETTE.text, 'left');
    // Wanted stars, top centre.
    const stars = Math.floor(state.wanted);
    const total = 5;
    const sw = 30;
    const sx0 = FIELD.width / 2 - (total * sw) / 2;
    for (let i = 0; i < total; i += 1) {
      text('★', sx0 + i * sw + sw / 2, 14, 30, i < stars ? PALETTE.star : 'rgba(255,255,255,0.25)', 'center');
    }
    if (stars > 0) text('WANTED', FIELD.width / 2, 48, 13, PALETTE.star, 'center');
    drawMinimap(state);
    // Mission objective, bottom left.
    if (ui.objectiveText) {
      context.fillStyle = 'rgba(0,0,0,0.55)';
      const lines = ui.objectiveText.split('\n');
      const boxH = 12 + lines.length * 24 + 12;
      context.fillRect(16, FIELD.height - boxH - 16, 520, boxH);
      text(ui.missionTitle || '', 28, FIELD.height - boxH - 4, 16, PALETTE.beacon, 'left');
      for (let i = 0; i < lines.length; i += 1) {
        text(lines[i], 28, FIELD.height - boxH + 22 + i * 24, 19, PALETTE.text, 'left');
      }
    }
    // Speed, bottom right.
    if (!state.player.onFoot && state.player.car) {
      const mph = Math.round(Math.abs(state.player.car.speed) * 0.12);
      text(`${mph} mph`, FIELD.width - 24, FIELD.height - 44, 28, PALETTE.text, 'right');
      const carHealth = Math.max(0, Math.round(state.player.car.health));
      text(`CAR ${carHealth}%`, FIELD.width - 24, FIELD.height - 76, 15, carHealth > 30 ? PALETTE.muted : PALETTE.healthLow, 'right');
    } else {
      text('WASD move · E steal car · Space shoot · P pause', FIELD.width - 24, FIELD.height - 40, 15, PALETTE.muted, 'right');
    }
    if (ui.message) {
      text(ui.message, FIELD.width / 2, 84, 24, PALETTE.marker, 'center');
    }
  }

  function drawPanel(title, lines, prompt) {
    const height = PANEL.top + lines.length * PANEL.line + PANEL.bottom;
    const x = (FIELD.width - PANEL.width) / 2;
    const y = (FIELD.height - height) / 2;
    context.fillStyle = 'rgba(10, 12, 20, 0.55)';
    context.fillRect(0, 0, FIELD.width, FIELD.height);
    context.fillStyle = PALETTE.panel;
    context.fillRect(x, y, PANEL.width, height);
    context.strokeStyle = PALETTE.beacon;
    context.lineWidth = 2;
    context.strokeRect(x, y, PANEL.width, height);
    context.textBaseline = 'alphabetic';
    text(title, FIELD.width / 2, y + 78, 46, PALETTE.text, 'center');
    for (let index = 0; index < lines.length; index += 1) {
      text(lines[index], FIELD.width / 2, y + PANEL.top + index * PANEL.line, 21, PALETTE.muted, 'center');
    }
    text(prompt, FIELD.width / 2, y + height - 38, 23, PALETTE.cash, 'center');
  }

  /** Paint one frame: the world through the camera, then the HUD or a panel. */
  function draw(state, screen, ui) {
    const time = state.time;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = PALETTE.backdrop;
    context.fillRect(0, 0, canvas.width, canvas.height);
    // World transform: scale the 1280x720 view, then shift by the camera.
    context.setTransform(view.scale, 0, 0, view.scale, view.x - state.camera.x * view.scale, view.y - state.camera.y * view.scale);
    drawWorld(state, time);
    // Screen-space transform for HUD and panels.
    context.setTransform(view.scale, 0, 0, view.scale, view.x, view.y);
    if (screen === SCREEN_TITLE) {
      drawPanel('NEON HARBOR', [
        'Marlowe Bay. One driver. Fifty grand of debt.',
        'Steal cars. Outrun the Harbor Police. Work six jobs for Mara Voss.',
        'WASD / arrows move and drive · E steal or leave a car',
        'Space or click shoots · P pauses · Missions pay cash',
        '',
        bestLabel(ui.best || 0),
      ], ui.saveExists ? 'Press Enter — continue your run' : 'Press Enter to start');
      return;
    }
    drawHud(state, ui);
    if (screen === SCREEN_PAUSED) {
      drawPanel('Paused', ['The city waits for no one. Except now.'], 'Press P to resume');
    } else if (screen === SCREEN_OVER) {
      drawPanel('WASTED', [`You went down in Marlowe Bay.`, `Cash kept: $${state.cash} · Best haul: $${ui.best || 0}`], 'Press Enter to get back up');
    } else if (screen === SCREEN_BUSTED) {
      drawPanel('BUSTED', ['The Harbor Police caught you.', `They took 10% of your cash. $${state.cash} left.`], 'Press Enter to walk free');
    } else if (screen === SCREEN_BRIEFING) {
      drawPanel(ui.missionTitle || 'New job', ui.briefingLines || [], 'Press Enter to take the job');
    } else if (screen === SCREEN_MISSION_DONE) {
      drawPanel('Job done', [`Mara Voss paid you $${ui.reward || 0}.`, `Total cash: $${state.cash}`, ui.nextTitle ? `Next: ${ui.nextTitle}` : 'That was the last job.'], 'Press Enter to keep driving');
    } else if (screen === SCREEN_STORY) {
      drawPanel('DEBT PAID', [
        'The boat pulls away from the Old Pier. Fifty grand, cleared.',
        'Rook Calloway is free — and Marlowe Bay is still his.',
        `Final haul: $${state.cash}`,
      ], 'Press Enter to keep driving the city');
    }
  }

  resize();
  window.addEventListener('resize', resize);
  return { draw };
}
