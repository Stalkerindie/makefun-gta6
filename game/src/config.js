// Every tuning number and colour for Neon Harbor, in one place. The camera shows a
// 1280x720 logical view of a 3200x2400 city; the renderer scales the view to the window,
// so no rule below depends on the screen size.

export const GAME_TITLE = 'Neon Harbor';
export const CITY_NAME = 'Marlowe Bay';

export const FIELD = { width: 1280, height: 720 };

/** The whole city, in world pixels. */
export const WORLD = { width: 3200, height: 2400 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

/** The road grid: roads run every `spacing` pixels, centred on `offset` multiples. */
export const ROAD = { spacing: 320, width: 96, offset: 160 };
/** The bay: everything below this y is water (the pier juts into it). */
export const WATER_Y = 2320;

export const PLAYER = {
  radius: 13,
  walkSpeed: 210,
  health: 100,
  regenDelay: 3,
  regenRate: 8,
};

export const CAR = {
  /** Half-length / half-width of a car body, in pixels. */
  halfLength: 26,
  halfWidth: 13,
  /** Player car tuning. */
  accel: 460,
  brake: 700,
  reverseMax: 180,
  maxSpeed: 540,
  turnRate: 2.9,
  /** Traffic tuning. */
  trafficMin: 120,
  trafficMax: 190,
  /** Below the player's 540 top speed on purpose: a clean getaway at full
      throttle pulls away from a chasing cop instead of the cop staying glued
      to the bumper (500 used to be too close to 540 to ever lose them). */
  policeMax: 440,
  health: 100,
};

export const PED = { radius: 9, walkSpeed: 55, fleeSpeed: 110 };

/** Wanted stars, 0..5. Crimes add heat; it cools when no crime is committed and no cop sees you. */
export const WANTED = {
  max: 5,
  stealCar: 1,
  hitPed: 1,
  shoot: 1,
  ramCop: 1,
  shootCop: 2,
  decayPerSecond: 0.05,
  quietSeconds: 8,
};

export const BULLET = { speed: 950, range: 460, damage: 34, cooldown: 0.22 };

/** Repair pickups (green crosses on the road): a busted-up car is a dead car,
    so the city leaves toolboxes around. Driving over one patches the car up;
    on foot it patches Rook up instead. */
export const REPAIR = {
  carHeal: 45,
  footHeal: 25,
  /** One spawns this often, at most this many at once. */
  spawnEverySeconds: 26,
  maxActive: 3,
};

/** The offscreen objective arrow: when the beacon is outside the camera's
    view, an arrow hugs the screen edge and points at it. */
export const ARROW = {
  /** How far from the view edge the arrow sits, in view pixels. */
  edgeMargin: 46,
  /** Arrowhead size, in view pixels. */
  size: 17,
};

/** Night headlights: once it is dark enough, the player's car throws a beam. */
export const HEADLIGHT = {
  /** Below this night factor the beam stays off. */
  minDark: 0.18,
  beamLength: 300,
  /** Half-angle of the beam cone, in radians. */
  beamHalfAngle: 0.42,
};

/** Minimap dot sizes, in minimap pixels. */
export const MINIMAP_DOTS = { player: 4, police: 3, pickup: 3, repair: 4, marked: 5 };

export const TRAFFIC_COUNT = 26;
export const PARKED_COUNT = 18;
export const PED_COUNT = 30;

export const PALETTE = {
  backdrop: '#0b0e16',
  water: '#123049',
  waterDeep: '#0d2438',
  sand: '#3d3a2c',
  grass: '#27513a',
  grassDark: '#1e402e',
  asphalt: '#24272f',
  asphaltDark: '#1e2129',
  lane: '#d8c56a',
  sidewalk: '#3a3f4c',
  curb: '#4a5060',
  building: '#5a4a6e',
  buildingRoof: '#6e5a86',
  building2: '#4a6e6a',
  building3: '#6e5a4a',
  building4: '#54627a',
  parkTree: '#2f7a44',
  player: '#ffd23f',
  playerJacket: '#e8a13a',
  cop: '#3f7cff',
  copCar: '#2b4fd8',
  trafficCar: '#c94b4b',
  ped: '#d8d3c3',
  text: '#eef1f5',
  muted: '#9aa3b2',
  panel: '#181d29',
  cash: '#7ee787',
  star: '#ffd23f',
  health: '#4ade80',
  healthLow: '#ef4444',
  beacon: '#ff5fa2',
  marker: '#ffd23f',
  repair: '#4ade80',
  repairCross: '#eafff0',
  headlight: 'rgba(255, 233, 163, 0.13)',
  night: 'rgba(8, 12, 38, 0.34)',
  dusk: 'rgba(255, 120, 60, 0.10)',
  smoke: 'rgba(160, 160, 160, 0.5)',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Where the best cash haul is kept between visits (this browser only). */
export const BEST_KEY = 'neon-harbor.best';
/** Where the campaign save lives (cash + next mission). */
export const SAVE_KEY = 'neon-harbor.save.v1';
