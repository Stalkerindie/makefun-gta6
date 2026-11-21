// Marlowe Bay: a deterministic city. Roads form a grid; the blocks between them hold
// buildings, parks and parking lots; the bay runs along the south edge with a pier.
// Everything is placed from the seeded random, so the same seed builds the same city.
// This module is pure data and queries: no drawing, no browser.
import { ROAD, WATER_Y, WORLD } from './config.js';

const BUILDING_COLORS = ['#5a4a6e', '#4a6e6a', '#6e5a4a', '#54627a', '#6e4a5a', '#4a5a6e'];

function roadLines() {
  const vertical = [];
  const horizontal = [];
  for (let x = ROAD.offset; x < WORLD.width; x += ROAD.spacing) vertical.push(x);
  for (let y = ROAD.offset; y < WATER_Y - ROAD.spacing; y += ROAD.spacing) horizontal.push(y);
  return { vertical, horizontal };
}

/** The road a point sits on, or null: 'v' with the road's x, or 'h' with the road's y. */
function roadAt(lines, x, y) {
  const half = ROAD.width / 2;
  let best = null;
  let bestDist = Infinity;
  for (const rx of lines.vertical) {
    const d = Math.abs(x - rx);
    if (d < half && d < bestDist) {
      best = { axis: 'v', at: rx, dist: d };
      bestDist = d;
    }
  }
  for (const ry of lines.horizontal) {
    const d = Math.abs(y - ry);
    if (d < half && d < bestDist) {
      best = { axis: 'h', at: ry, dist: d };
      bestDist = d;
    }
  }
  return best;
}

export function createCity(random) {
  const lines = roadLines();
  const buildings = [];
  const parks = [];
  const parkingLots = [];

  // Landmark blocks (column, row) get a named building instead of random ones.
  // Blocks: column i spans roads i and i+1, row j spans roads j and j+1.
  const landmarkBlock = new Map([
    ['1,1', 'garage'],
    ['5,1', 'bank'],
    ['2,4', 'hospital'],
    ['7,4', 'cafe'],
  ]);
  const parkBlock = new Set(['4,3', '8,1']);

  const landmarks = {
    garage: { id: 'garage', name: 'Voss Garage', x: 640, y: 640, w: 150, h: 96, color: '#8a6d2f' },
    bank: { id: 'bank', name: 'Marlowe Bay Bank', x: 1920, y: 640, w: 170, h: 110, color: '#7a6a9e' },
    hospital: { id: 'hospital', name: 'St. Anselm Hospital', x: 960, y: 1600, w: 160, h: 100, color: '#9e9a8a' },
    cafe: { id: 'cafe', name: 'The Gull Cafe', x: 2560, y: 1600, w: 110, h: 80, color: '#a86a4a' },
    docks: { id: 'docks', name: 'The Docks', x: 960, y: 2160, w: 0, h: 0, color: '#4a6e6a' },
    pier: { id: 'pier', name: 'The Old Pier', x: 1600, y: 2280, w: 0, h: 0, color: '#8a6d2f' },
  };

  function blockRect(i, j) {
    const x0 = ROAD.offset + ROAD.spacing * i + ROAD.width / 2;
    const y0 = ROAD.offset + ROAD.spacing * j + ROAD.width / 2;
    const x1 = ROAD.offset + ROAD.spacing * (i + 1) - ROAD.width / 2;
    const y1 = ROAD.offset + ROAD.spacing * (j + 1) - ROAD.width / 2;
    return { x0, y0, x1, y1 };
  }

  // Blocks: 9 columns (roads 0..9) x 7 rows (roads 0..6) of full blocks, plus the
  // southern strip between the last road (y=2080) and the water, which holds the docks.
  for (let i = 0; i < 9; i += 1) {
    for (let j = 0; j < 7; j += 1) {
      const key = `${i},${j}`;
      const r = blockRect(i, j);
      if (landmarkBlock.has(key)) {
        const lm = landmarks[landmarkBlock.get(key)];
        buildings.push({ x: lm.x - lm.w / 2, y: lm.y - lm.h / 2, w: lm.w, h: lm.h, color: lm.color, name: lm.name });
        continue;
      }
      if (parkBlock.has(key)) {
        parks.push({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
        continue;
      }
      const roll = random();
      if (roll < 0.12) {
        parkingLots.push({ x: r.x0, y: r.y0, w: r.x1 - r.x0, h: r.y1 - r.y0 });
        continue;
      }
      // One or two buildings: split the block along its longer side.
      const vertical = random() < 0.5;
      const mid = vertical ? (r.x0 + r.x1) / 2 : (r.y0 + r.y1) / 2;
      const halves = vertical
        ? [{ x0: r.x0, y0: r.y0, x1: mid, y1: r.y1 }, { x0: mid, y0: r.y0, x1: r.x1, y1: r.y1 }]
        : [{ x0: r.x0, y0: r.y0, x1: r.x1, y1: mid }, { x0: r.x0, y0: mid, x1: r.x1, y1: r.y1 }];
      const count = random() < 0.55 ? 1 : 2;
      for (let h = 0; h < count; h += 1) {
        const half = halves[h];
        const inset = 14 + random() * 10;
        const bw = half.x1 - half.x0 - inset * 2;
        const bh = half.y1 - half.y0 - inset * 2;
        const w = bw * (0.55 + random() * 0.4);
        const hgt = bh * (0.55 + random() * 0.4);
        buildings.push({
          x: half.x0 + inset + (bw - w) / 2,
          y: half.y0 + inset + (bh - hgt) / 2,
          w,
          h: hgt,
          color: BUILDING_COLORS[Math.floor(random() * BUILDING_COLORS.length)],
          name: null,
        });
      }
    }
  }

  // The docks: shipping containers in the southern strip, between the last road and the bay.
  const containers = [];
  for (let k = 0; k < 10; k += 1) {
    const cx = 560 + (k % 5) * 190 + random() * 40;
    const cy = 2140 + Math.floor(k / 5) * 70 + random() * 14;
    containers.push({ x: cx, y: cy, w: 130 + random() * 30, h: 34, color: k % 2 ? '#a86a3a' : '#3a7a5a' });
  }
  for (const c of containers) buildings.push({ ...c, name: null });

  // Trees inside parks, placed deterministically.
  for (const park of parks) {
    park.trees = [];
    const n = 5 + Math.floor(random() * 4);
    for (let t = 0; t < n; t += 1) {
      park.trees.push({
        x: park.x + 24 + random() * (park.w - 48),
        y: park.y + 24 + random() * (park.h - 48),
        r: 12 + random() * 8,
      });
    }
  }

  function isRoad(x, y) {
    if (x < 0 || x > WORLD.width || y < 0 || y >= WATER_Y) return false;
    return roadAt(lines, x, y) !== null;
  }

  function nearestRoadPoint(x, y) {
    let bx = lines.vertical[0];
    let bd = Math.abs(x - bx);
    for (const rx of lines.vertical) {
      const d = Math.abs(x - rx);
      if (d < bd) {
        bd = d;
        bx = rx;
      }
    }
    let by = lines.horizontal[0];
    bd = Math.abs(y - by);
    for (const ry of lines.horizontal) {
      const d = Math.abs(y - ry);
      if (d < bd) {
        bd = d;
        by = ry;
      }
    }
    // Snap to the nearer road axis.
    if (Math.abs(x - bx) < Math.abs(y - by)) return { x: bx, y: Math.min(Math.max(y, 0), WATER_Y - 4), axis: 'v' };
    return { x: Math.min(Math.max(x, 0), WORLD.width), y: by, axis: 'h' };
  }

  function randomRoadPoint() {
    const vertical = random() < 0.5;
    if (vertical) {
      return {
        x: lines.vertical[Math.floor(random() * lines.vertical.length)],
        y: 80 + random() * (WATER_Y - 160),
        axis: 'v',
      };
    }
    return {
      x: 80 + random() * (WORLD.width - 160),
      y: lines.horizontal[Math.floor(random() * lines.horizontal.length)],
      axis: 'h',
    };
  }

  /** Push a circle out of buildings, trees, the water and the world edge; returns the corrected point. */
  function collide(x, y, r) {
    let px = Math.min(Math.max(x, r), WORLD.width - r);
    let py = Math.min(Math.max(y, r), WATER_Y - r);
    for (const b of buildings) {
      const cx = Math.min(Math.max(px, b.x), b.x + b.w);
      const cy = Math.min(Math.max(py, b.y), b.y + b.h);
      const dx = px - cx;
      const dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r) {
        if (d2 === 0) {
          // Dead centre: push out along the shorter side.
          const left = px - b.x;
          const right = b.x + b.w - px;
          const top = py - b.y;
          const bottom = b.y + b.h - py;
          const m = Math.min(left, right, top, bottom);
          if (m === left) px = b.x - r;
          else if (m === right) px = b.x + b.w + r;
          else if (m === top) py = b.y - r;
          else py = b.y + b.h + r;
        } else {
          const d = Math.sqrt(d2);
          px = cx + (dx / d) * r;
          py = cy + (dy / d) * r;
        }
      }
    }
    for (const park of parks) {
      for (const t of park.trees) {
        const dx = px - t.x;
        const dy = py - t.y;
        const rr = r + t.r * 0.6;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0) {
          const d = Math.sqrt(d2);
          px = t.x + (dx / d) * rr;
          py = t.y + (dy / d) * rr;
        }
      }
    }
    return { x: px, y: py };
  }

  /** True when the circle overlaps any building (used for spawn validation). */
  function hitsBuilding(x, y, r) {
    for (const b of buildings) {
      if (x + r > b.x && x - r < b.x + b.w && y + r > b.y && y - r < b.y + b.h) return true;
    }
    return false;
  }

  return {
    lines,
    buildings,
    parks,
    parkingLots,
    containers,
    landmarks,
    isRoad,
    roadAt: (x, y) => roadAt(lines, x, y),
    nearestRoadPoint,
    randomRoadPoint,
    collide,
    hitsBuilding,
    playerStart: { x: 2080, y: 1760 },
  };
}
