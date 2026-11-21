// city.js — Palmira itself: the road grid, the blocks between the roads and everything fixed
// in them (buildings, parks, parking lots, palms, the named landmarks), plus the spatial
// helpers the gameplay modules share — circle-vs-building collision, line of sight and
// road tests. Built once from a seeded stream, so a seed always raises the same city.

import {
  BEACH_W, BLOCK, COLS, LANE, PALETTE, ROOF_COLORS, ROAD_W, ROWS, SIDEWALK, WORLD_H, WORLD_W,
} from './config.js';
import { clamp } from './random.js';

const CELL_INSET = ROAD_W / 2 + SIDEWALK; // block interior starts this far from a centreline
const CELL_SIZE = BLOCK - ROAD_W - SIDEWALK * 2; // buildable square inside one block

// Named places the story visits, by block column/row between the roads.
const LANDMARK_CELLS = {
  diner: { c: 0, r: 0, label: "ROSA'S DINER", roof: '#e5484d' },
  motel: { c: 0, r: 4, label: 'CORAL MOTEL', roof: '#ef6aa5' },
  bank: { c: 4, r: 1, label: 'PALMIRA TRUST BANK', roof: '#efe3cc' },
  garage: { c: 3, r: 2, label: "TITO'S GARAGE", roof: '#53b7e5' },
  hospital: { c: 7, r: 0, label: 'PALMIRA GENERAL', roof: '#f7f0e1' },
  police: { c: 7, r: 4, label: 'PALMIRA PD', roof: '#5c6b73' },
};

export function buildCity(rng) {
  const vx = [];
  for (let i = 0; i < COLS; i++) vx.push(190 + i * BLOCK);
  const hz = [];
  for (let j = 0; j < ROWS; j++) hz.push(150 + j * BLOCK);

  const buildings = [];
  const cells = [];
  const props = [];
  const pickups = [];
  const parkedSpawns = [];
  const landmarks = {};

  const cellX = (c) => vx[c] + CELL_INSET;
  const cellY = (r) => hz[r] + CELL_INSET;

  function addBuilding(x, y, w, h, roof, storeys, kind, label) {
    const building = {
      x, y, w, h, roof, storeys, kind: kind || 'block', label: label || '',
      door: { x: x + w / 2, y: y + h + 20 },
    };
    buildings.push(building);
    return building;
  }

  function addPalm(x, y) {
    props.push({ x, y, kind: 'palm', r: 5, sway: rng.range(0, Math.PI * 2) });
  }

  // --- the blocks between the roads -------------------------------------------
  for (let c = 0; c < COLS - 1; c++) {
    for (let r = 0; r < ROWS - 1; r++) {
      const x = cellX(c);
      const y = cellY(r);
      const key = `${c},${r}`;
      const landmarkKey = Object.keys(LANDMARK_CELLS).find((k) => LANDMARK_CELLS[k].c === c && LANDMARK_CELLS[k].r === r);
      if (landmarkKey) {
        const spec = LANDMARK_CELLS[landmarkKey];
        const b = addBuilding(x + 10, y + 10, CELL_SIZE - 20, CELL_SIZE - 20, spec.roof, 2, 'landmark', spec.label);
        landmarks[landmarkKey] = b;
        cells.push({ x, y, w: CELL_SIZE, h: CELL_SIZE, kind: 'landmark' });
        continue;
      }
      const roll = rng.next();
      if (roll < 0.14) {
        cells.push({ x, y, w: CELL_SIZE, h: CELL_SIZE, kind: 'park' });
        const palms = rng.int(4, 8);
        for (let i = 0; i < palms; i++) addPalm(x + rng.range(18, CELL_SIZE - 18), y + rng.range(18, CELL_SIZE - 18));
      } else if (roll < 0.28) {
        cells.push({ x, y, w: CELL_SIZE, h: CELL_SIZE, kind: 'parking' });
        const spots = rng.int(2, 4);
        for (let i = 0; i < spots; i++) {
          parkedSpawns.push({
            x: x + 30 + i * 48, y: y + CELL_SIZE / 2, angle: Math.PI / 2,
            type: rng.pick(['sedan', 'sedan', 'taxi', 'truck']),
          });
        }
      } else if (roll < 0.4) {
        cells.push({ x, y, w: CELL_SIZE, h: CELL_SIZE, kind: 'plaza' });
        const crates = rng.int(2, 5);
        for (let i = 0; i < crates; i++) {
          props.push({ x: x + rng.range(20, CELL_SIZE - 20), y: y + rng.range(20, CELL_SIZE - 20), kind: 'crate', r: 9 });
        }
        if (rng.chance(0.7)) addPalm(x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      } else {
        cells.push({ x, y, w: CELL_SIZE, h: CELL_SIZE, kind: 'built' });
        const central = c >= 3 && c <= 5 && r >= 2 && r <= 3 ? 3 : 0;
        const layout = rng.int(1, 3);
        if (layout === 1) {
          addBuilding(x + 12, y + 12, CELL_SIZE - 24, CELL_SIZE - 24, rng.pick(ROOF_COLORS), rng.int(2, 4) + central, 'block');
        } else if (layout === 2) {
          const w = (CELL_SIZE - 34) / 2;
          addBuilding(x + 10, y + 12, w, CELL_SIZE - 24, rng.pick(ROOF_COLORS), rng.int(1, 3) + central, 'block');
          addBuilding(x + 24 + w, y + 12, w, CELL_SIZE - 24, rng.pick(ROOF_COLORS), rng.int(1, 3) + central, 'block');
        } else {
          const w = (CELL_SIZE - 36) / 2;
          const h = (CELL_SIZE - 36) / 2;
          for (const [ox, oy] of [[10, 10], [26 + w, 10], [10, 26 + h], [26 + w, 26 + h]]) {
            if (rng.chance(0.85)) addBuilding(x + ox, y + oy, w, h, rng.pick(ROOF_COLORS), rng.int(1, 3) + central, 'block');
          }
        }
      }
      void key;
    }
  }

  // --- east strip: the old cannery (the finale's hideout) ----------------------
  const cannery = addBuilding(WORLD_W - 128, hz[5] + 60, 104, 190, '#b08968', 2, 'landmark', 'OLD CANNERY');
  landmarks.hideout = cannery;

  // --- south strip: the docks — warehouses and container stacks ----------------
  const dockBuildings = [];
  for (let i = 0; i < 4; i++) {
    dockBuildings.push(addBuilding(420 + i * 560, WORLD_H - 168, 300, 120, '#7fb5b5', 1, 'warehouse', i === 1 ? 'PALMIRA DOCKS' : ''));
  }
  landmarks.docks = dockBuildings[1];
  for (let i = 0; i < 14; i++) {
    props.push({ x: rng.range(320, WORLD_W - 200), y: rng.range(WORLD_H - 260, WORLD_H - 190), kind: 'container', r: 16 });
  }

  // --- beach palms along the promenade -----------------------------------------
  for (let y = 90; y < WORLD_H - 60; y += rng.range(85, 130)) addPalm(rng.range(112, 138), y);

  // --- street lamps at alternating intersections --------------------------------
  for (let i = 0; i < COLS; i += 2) {
    for (let j = 0; j < ROWS; j += 2) {
      props.push({ x: vx[i] + ROAD_W / 2 + 7, y: hz[j] + ROAD_W / 2 + 7, kind: 'lamp', r: 3 });
    }
  }

  // --- pickups ------------------------------------------------------------------
  const packageCells = rng.shuffled(cells.filter((cell) => cell.kind === 'built' || cell.kind === 'plaza')).slice(0, 10);
  packageCells.forEach((cell, i) => {
    pickups.push({ id: `pkg${i}`, x: cell.x - 6, y: cell.y - 6, kind: 'package', taken: false });
  });
  pickups.push({ id: 'hp-diner', x: landmarks.diner.door.x, y: landmarks.diner.door.y + 8, kind: 'health', taken: false });
  pickups.push({ id: 'hp-hospital', x: landmarks.hospital.door.x, y: landmarks.hospital.door.y + 8, kind: 'health', taken: false });
  const plaza = cells.find((cell) => cell.kind === 'plaza');
  if (plaza) pickups.push({ id: 'wpn', x: plaza.x + plaza.w / 2, y: plaza.y + plaza.h / 2, kind: 'weapon', taken: false });
  pickups.push({ id: 'ammo', x: landmarks.police.x - 16, y: landmarks.police.y + landmarks.police.h + 26, kind: 'ammo', taken: false });

  // The pay'n'spray bay is the garage's forecourt.
  landmarks.spray = { x: landmarks.garage.door.x, y: landmarks.garage.door.y + 26 };

  // --- cars parked along the curbs ----------------------------------------------
  for (let i = 0; i < 30; i++) {
    const vertical = rng.chance(0.5);
    if (vertical) {
      const roadX = rng.pick(vx);
      parkedSpawns.push({
        x: roadX + (rng.chance(0.5) ? -1 : 1) * (ROAD_W / 2 - 13),
        y: rng.range(120, WORLD_H - 120), angle: Math.PI / 2, type: rng.pick(['sedan', 'sedan', 'sport', 'taxi']),
      });
    } else {
      const roadY = rng.pick(hz);
      parkedSpawns.push({
        x: rng.range(BEACH_W + 80, WORLD_W - 120),
        y: roadY + (rng.chance(0.5) ? -1 : 1) * (ROAD_W / 2 - 13), angle: 0, type: rng.pick(['sedan', 'sedan', 'sport', 'taxi']),
      });
    }
  }

  // --- spatial index over buildings ----------------------------------------------
  const grid = new Map();
  const gridKey = (x, y) => `${Math.floor(x / BLOCK)},${Math.floor(y / BLOCK)}`;
  for (const b of buildings) {
    const k = gridKey(b.x + b.w / 2, b.y + b.h / 2);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(b);
  }
  function buildingsNear(x, y) {
    const out = [];
    const cx = Math.floor(x / BLOCK);
    const cy = Math.floor(y / BLOCK);
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        const list = grid.get(`${cx + i},${cy + j}`);
        if (list) out.push(...list);
      }
    }
    return out;
  }

  const city = {
    W: WORLD_W,
    H: WORLD_H,
    vx,
    hz,
    buildings,
    cells,
    props,
    pickups,
    parkedSpawns,
    landmarks,
    beachX: BEACH_W - 60,

    pointInBuilding(x, y, pad = 0) {
      for (const b of buildingsNear(x, y)) {
        if (x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad) return b;
      }
      return null;
    },

    // Push a circle out of every building it overlaps; reports whether it hit anything.
    collideCircle(x, y, r) {
      let hit = false;
      for (const b of buildingsNear(x, y)) {
        const nx = clamp(x, b.x, b.x + b.w);
        const ny = clamp(y, b.y, b.y + b.h);
        const dx = x - nx;
        const dy = y - ny;
        const d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        hit = true;
        if (d2 > 0.0001) {
          const d = Math.sqrt(d2);
          x = nx + (dx / d) * r;
          y = ny + (dy / d) * r;
        } else {
          // Centre inside the box: leave by the shallowest side.
          const left = x - b.x;
          const right = b.x + b.w - x;
          const top = y - b.y;
          const bottom = b.y + b.h - y;
          const min = Math.min(left, right, top, bottom);
          if (min === left) x = b.x - r;
          else if (min === right) x = b.x + b.w + r;
          else if (min === top) y = b.y - r;
          else y = b.y + b.h + r;
        }
      }
      return { x, y, hit };
    },

    // Clear line of sight: no building (shrunk a touch, so hugging a wall still counts) blocks it.
    losClear(x1, y1, x2, y2) {
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) / 22));
      for (let i = 1; i < steps; i++) {
        const t = i / steps;
        if (this.pointInBuilding(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, -5)) return false;
      }
      return true;
    },

    onRoad(x, y) {
      if (x < 60 || x > WORLD_W - 30 || y < 30 || y > WORLD_H - 30) return false;
      for (const rx of vx) if (Math.abs(x - rx) <= ROAD_W / 2 + 5) return true;
      for (const ry of hz) if (Math.abs(y - ry) <= ROAD_W / 2 + 5) return true;
      return false;
    },

    // The lane centre a driver heading (hx, hy) along the road through (x, y) should aim for:
    // right-hand traffic, offset to the driver's right of the centreline.
    lanePoint(x, y, hx, hy) {
      const rightX = -hy;
      const rightY = hx;
      if (Math.abs(hx) > Math.abs(hy)) {
        let best = hz[0];
        for (const ry of hz) if (Math.abs(y - ry) < Math.abs(y - best)) best = ry;
        return { x: x + hx * 60, y: best + rightY * LANE };
      }
      let best = vx[0];
      for (const rx of vx) if (Math.abs(x - rx) < Math.abs(x - best)) best = rx;
      return { x: best + rightX * LANE, y: y + hy * 60 };
    },
  };
  return city;
}
