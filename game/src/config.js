// config.js — every shared constant of Palmira Heat in one place: world geometry, tuning
// numbers the gameplay modules share, and the sun-soaked palette the renderer paints with.
// Gameplay files import from here instead of sprinkling magic numbers through the code.

export const VIEW_W = 1280; // canvas pixels the game is composed for
export const VIEW_H = 720;

export const BLOCK = 280; // city block pitch: distance between road centrelines
export const ROAD_W = 76; // road width, curb to curb
export const LANE = 19; // lane centre offset from a road's centreline
export const SIDEWALK = 13; // sidewalk width around each block
export const COLS = 10; // avenues, west to east
export const ROWS = 7; // streets, north to south
export const BEACH_W = 210; // sand + water strip along the west edge

// World size in pixels: avenues start one block in from the beach.
export const WORLD_W = BEACH_W + COLS * BLOCK + 120;
export const WORLD_H = ROWS * BLOCK + 240;

export const TUNE = {
  walkSpeed: 168,
  sprintSpeed: 258,
  playerRadius: 11,
  playerHealth: 100,
  enterCarRange: 46,
  dayLength: 300, // seconds for a full day cycle
  heatDecay: 2.2, // heat points lost per second while no officer sees the player
  heatSightGrace: 4, // seconds unseen before decay starts
  bustTime: 1.7, // seconds an officer must stay close to a slow player to bust them
  copSightRange: 430,
  shotHearRange: 340,
  packageCount: 10,
  packageReward: 50,
  sprayCost: 100,
  farePerMeter: 0.055,
};

// Heat points per star: reaching a threshold raises the wanted level.
export const STAR_THRESHOLDS = [1, 30, 70, 120, 180, 250];

export const PALETTE = {
  water: '#1fa8a0',
  waterDeep: '#178a94',
  sand: '#eed9a0',
  sandDark: '#e3c88d',
  grass: '#8fce6e',
  park: '#7cc464',
  asphalt: '#43464d',
  asphaltDark: '#3a3d44',
  laneMark: '#f5d76e',
  curb: '#9aa0a3',
  sidewalk: '#cbbfa9',
  plaza: '#d9c9a8',
  roofShadow: 'rgba(60, 30, 10, 0.28)',
  palmTrunk: '#8a6b46',
  palmLeaf: '#3f9e4d',
  palmLeafDark: '#2f7d3c',
};

// Building roof colours: pastel, sun-bleached, deliberately varied per block.
export const ROOF_COLORS = [
  '#f2a65a', '#e8836b', '#f7d08a', '#a8d5ba', '#7fb5b5', '#f4e1c1',
  '#e5a9bc', '#c9d97b', '#f0b27a', '#93c6e7', '#d98cb3', '#efe3cc',
];

// Car paint jobs for civilian vehicles (police and taxis use their own liveries).
export const CAR_COLORS = [
  '#e5484d', '#f2a65a', '#ffd75e', '#53b7e5', '#7be495', '#f7f0e1',
  '#b388eb', '#e8836b', '#5c6b73', '#2ec4b6', '#ef6aa5', '#8d99ae',
];

export const CAR_TYPES = {
  sedan: { w: 44, h: 21, accel: 235, topSpeed: 305, grip: 8.5, turn: 3.1, health: 100 },
  taxi: { w: 44, h: 21, accel: 225, topSpeed: 295, grip: 8.5, turn: 3.1, health: 100 },
  sport: { w: 46, h: 20, accel: 330, topSpeed: 415, grip: 9.5, turn: 3.5, health: 90 },
  truck: { w: 58, h: 26, accel: 165, topSpeed: 235, grip: 7.5, turn: 2.4, health: 170 },
  police: { w: 45, h: 21, accel: 305, topSpeed: 385, grip: 9.2, turn: 3.4, health: 130 },
};
