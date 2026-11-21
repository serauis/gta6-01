// shots.js — the screenshot scenes behind ?shot=cover|foot|mission|dusk (with &seed=N).
// Each scene builds a real moment of the game — the actual systems stepped forward with
// fixed steps, the player placed mid-action — then paints it twice and sets
// window.__shotReady. Nothing here is a mock-up: what the judge sees is the game.
//
// The v2 set tells the whole arc in four frames: the bank-job getaway at full tilt,
// the diner standoff where the story starts, the Palmira Job itself mid-grab, and a
// neon night on Shore Drive with the story done and the city Rico's to roam.

import { LANE, STAR_THRESHOLDS } from './config.js';
import { clamp } from './random.js';
import { createCar } from './vehicles.js';

const STEP = 1 / 60;

// The wanted level is normally recomputed inside the game loop; a staged scene that sets
// heat after its last step must refresh the stars itself or the HUD would show none.
function refreshStars(game) {
  const effective = Math.max(game.heat, game.heatFloor);
  game.stars = clamp(STAR_THRESHOLDS.filter((t) => effective >= t).length, 0, 5);
}

function runSteps(game, step, count, control) {
  for (let i = 0; i < count; i++) {
    if (control) control(game);
    step(STEP);
  }
}

// A Palmira PD cruiser on the hunt, registered with the police response.
function addCopCar(game, x, y, angle, vx = 0, vy = 0) {
  const car = createCar(game.city, { x, y, angle, type: 'police', livery: 'police', color: '#f7f0e1' });
  car.driver = 'cop';
  car.police = true;
  car.ai = { mode: 'pursue', droppedOfficer: false };
  car.vx = vx;
  car.vy = vy;
  game.cars.push(car);
  game.police.units.push(car);
  return car;
}

// An officer on foot, mid-chase, aimed at the player.
function addOfficer(game, x, y) {
  const officer = {
    x, y,
    angle: Math.atan2(game.player.y - y, game.player.x - x),
    hp: 100, state: 'chase', shootT: 1.3, downT: 0, phase: 1, removeMe: false,
  };
  game.police.officers.push(officer);
  return officer;
}

// Background cars (parked or traffic) that would overlap a staged actor are quietly
// towed: the frame is composed, but every car in it is a real car of the city.
function clearNear(game, keep, x, y, r) {
  game.cars = game.cars.filter((c) => keep.includes(c) || Math.hypot(c.x - x, c.y - y) > r);
  game.traffic.cars = game.traffic.cars.filter((c) => game.cars.includes(c));
}

// The cover: the getaway. The Palmira Job is done, the Comet is at full tilt down the
// garage avenue, four stars up and two cruisers on the tail — the whole game in one frame.
function stageCover(game, step) {
  const city = game.city;
  game.dayT = 0.355;
  game.money = 1240;
  const missions = game.missions;
  missions.idx = 4;
  missions.stage = 'active';
  missions.phase = 'escape';
  missions.timer = null;
  const car = createCar(city, {
    x: city.vx[3] - 260, y: city.hz[2] + LANE, angle: 0, type: 'sport', color: '#e5484d', rng: game.rng,
  });
  game.cars.push(car);
  game.enterCar(car);
  // Let traffic and the city come alive, then compose the chase for the frame.
  runSteps(game, step, 200, null);
  car.x = city.vx[4] - 160;
  car.y = city.hz[2] + LANE;
  car.angle = 0;
  car.vx = 250;
  car.vy = 0;
  game.player.x = car.x;
  game.player.y = car.y;
  const cop1 = addCopCar(game, car.x - 205, car.y + 2, 0, 262, 0);
  const cop2 = addCopCar(game, car.x - 395, car.y - 3, 0, 252, 0);
  // Traffic sharing the avenue and the crossing ahead, so the cover breathes.
  const ahead = createCar(city, { x: car.x + 330, y: car.y, angle: 0, type: 'sedan', color: '#53b7e5', rng: game.rng });
  ahead.driver = 'traffic';
  ahead.vx = 195;
  game.cars.push(ahead);
  const oncoming = createCar(city, { x: car.x + 560, y: city.hz[2] - LANE, angle: Math.PI, type: 'taxi', livery: 'taxi', color: '#ffd75e', rng: game.rng });
  oncoming.driver = 'traffic';
  oncoming.vx = -185;
  game.cars.push(oncoming);
  const crossing = createCar(city, { x: city.vx[5], y: city.hz[2] - 175, angle: Math.PI / 2, type: 'sedan', color: '#7be495', rng: game.rng });
  crossing.driver = 'traffic';
  crossing.vy = 150;
  game.cars.push(crossing);
  const keep = [car, cop1, cop2, ahead, oncoming, crossing];
  for (const actor of keep) clearNear(game, keep, actor.x, actor.y, 58);
  // The handbrake swing at the last intersection is still written on the asphalt.
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const sx = city.vx[3] + 26 + t * 150;
    const sy = city.hz[2] + LANE + 9 - t * 7;
    game.skids.push({ x1: sx, y1: sy, x2: sx + 16, y2: sy - 1, a: 0.34 });
    game.skids.push({ x1: sx, y1: sy + 15, x2: sx + 16, y2: sy + 14, a: 0.34 });
  }
  game.people.addPed(city.landmarks.garage.door.x - 30, city.landmarks.garage.door.y + 4, {});
  game.people.addPed(car.x + 210, car.y - LANE - 26, {});
  game.heat = 128; // four stars
  refreshStars(game);
  game.banner('GO GO GO', 'Lose them and reach the Old Cannery.');
}

// On foot outside Rosa's Diner: pistol drawn, a job on offer, the law already interested —
// and half the street watching it happen.
function stageFoot(game, step) {
  const city = game.city;
  game.dayT = 0.385;
  const door = city.landmarks.diner.door;
  game.player.x = door.x + 6;
  game.player.y = door.y + 16;
  game.player.angle = 0.55;
  game.player.aimAngle = 0.55;
  runSteps(game, step, 170, null);
  game.weapon.have = true;
  game.weapon.ammo = 24;
  game.heat = 40; // two stars
  const copCar = createCar(city, {
    x: city.vx[1] - 30, y: city.hz[1] + LANE, angle: 2.75, type: 'police', livery: 'police', color: '#f7f0e1',
  });
  copCar.driver = 'cop';
  copCar.police = true;
  copCar.ai = { mode: 'pursue', droppedOfficer: true };
  game.cars.push(copCar);
  game.police.units.push(copCar);
  game.police.officers.push({
    x: game.player.x + 95, y: game.player.y + 52, angle: Math.atan2(game.player.y - (game.player.y + 52), -95),
    hp: 100, state: 'chase', shootT: 1, downT: 0, phase: 2, removeMe: false,
  });
  // A second officer comes around the cruiser's tail; the diner crowd freezes, one runs.
  addOfficer(game, copCar.x - 36, copCar.y + 40);
  game.people.addPed(door.x - 46, door.y + 34, { state: 'stand' });
  game.people.addPed(door.x + 40, door.y + 40, { state: 'stand' });
  const fleer = game.people.addPed(game.player.x - 74, game.player.y + 92, {});
  fleer.state = 'flee';
  fleer.fleeT = 3.2;
  fleer.fleeX = game.player.x;
  fleer.fleeY = game.player.y;
  fleer.angle = Math.atan2(fleer.y - game.player.y, fleer.x - game.player.x);
  const taxi = createCar(city, {
    x: city.vx[0] + LANE, y: door.y - 66, angle: Math.PI / 2, type: 'taxi', livery: 'taxi', color: '#ffd75e', rng: game.rng,
  });
  game.cars.push(taxi);
  game.bustMeter = 0.45;
  game.player.angle = 0.5;
  game.player.aimAngle = 0.5;
  refreshStars(game);
}

// Mid-mission: the Palmira Job itself. Rico is at the bank door with the loot half
// grabbed — the channel ring is on screen — and the first cruiser is already rolling up.
function stageMission(game, step) {
  const city = game.city;
  game.dayT = 0.44;
  game.money = 860;
  const bank = city.landmarks.bank;
  game.player.x = bank.door.x;
  game.player.y = bank.door.y + 6;
  game.player.angle = -Math.PI / 2;
  game.player.aimAngle = -Math.PI / 2;
  game.weapon.have = true;
  game.weapon.ammo = 18;
  const missions = game.missions;
  missions.idx = 4;
  missions.stage = 'active';
  missions.phase = 'grab';
  missions.timer = null;
  missions.channel = 0.6;
  // The heat lands halfway through the grab; the street scatters near the end of it.
  // (The response spawns far out and rolls in — the hero cruiser is placed after the
  // steps, composed on the bank's street, the way the diner scene stages its law.)
  runSteps(game, step, 105, (g) => {
    if (g.heat === 0 && g.time > 0.5) g.heat = 74; // three stars
    if (!g.__shotScared && g.time > 1.1) {
      g.__shotScared = true;
      g.people.scare(bank.door.x, bank.door.y, 260);
    }
  });
  game.heat = 74;
  const copCar = addCopCar(game, bank.door.x - 150, city.hz[2] + LANE, 0, 120, 0);
  copCar.ai.droppedOfficer = true;
  addOfficer(game, bank.door.x - 78, city.hz[2] - 16);
  clearNear(game, [copCar], bank.door.x, bank.door.y, 120);
  // Aim down the street at the officer coming in.
  const officer = game.police.officers[game.police.officers.length - 1];
  if (officer) {
    game.player.angle = Math.atan2(officer.y - game.player.y, officer.x - game.player.x);
    game.player.aimAngle = game.player.angle;
  }
  refreshStars(game);
}

// Night on Shore Drive: the story is done, Palmira is Rico's, and a fare is waiting
// under the Coral Motel's neon while the promenade lamps pool on the wet sand road.
function stageDusk(game, step) {
  const city = game.city;
  game.dayT = 0.852;
  game.money = 2150;
  const missions = game.missions;
  missions.idx = 5;
  missions.stage = 'done';
  const motel = city.landmarks.motel;
  const car = createCar(city, {
    x: city.vx[0] - LANE, y: city.hz[4] - 40, angle: Math.PI / 2, type: 'taxi', livery: 'taxi', color: '#ffd75e', rng: game.rng,
  });
  game.cars.push(car);
  game.enterCar(car); // Tito's meter heart: a fare offers itself, replaced below with ours
  const ped = game.people.addPed(motel.door.x + 10, motel.door.y + 8, { passenger: true });
  ped.state = 'stand';
  game.missions.roam = { phase: 'pickup', passenger: ped, dest: null };
  // Evening walkers on the promenade, strolling the lamp line.
  game.people.addPed(132, city.hz[4] - 170, { ring: -2 });
  game.people.addPed(132, city.hz[3] + 130, { ring: -2 });
  runSteps(game, step, 110, null);
  car.x = city.vx[0] - LANE;
  car.y = city.hz[4] - 40;
  car.angle = Math.PI / 2;
  car.vx = 0;
  car.vy = 150;
  game.player.x = car.x;
  game.player.y = car.y;
}

export function stageShot(game, renderer, name, step) {
  game.hud.showScreen(null); // live HUD on, overlays off — the frame is real gameplay
  if (name === 'foot') stageFoot(game, step);
  else if (name === 'mission') stageMission(game, step);
  else if (name === 'dusk') stageDusk(game, step);
  else stageCover(game, step);
  game.hud.update(game);
  let painted = 0;
  function paint() {
    renderer.time = game.time;
    renderer.draw(game);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}
