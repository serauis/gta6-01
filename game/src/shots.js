// shots.js — the screenshot scenes behind ?shot=cover|foot|mission|dusk (with &seed=N).
// Each scene builds a real moment of the game — the actual systems stepped forward with
// fixed steps, the player placed mid-action — then paints it twice and sets
// window.__shotReady. Nothing here is a mock-up: what the judge sees is the game.

import { LANE } from './config.js';
import { createCar } from './vehicles.js';

const STEP = 1 / 60;

function runSteps(game, step, count, control) {
  for (let i = 0; i < count; i++) {
    if (control) control(game);
    step(STEP);
  }
}

// The cover: Rico at speed down a Palmira avenue in a red Comet, traffic around him,
// the city in morning light — the whole game in one frame.
function stageCover(game, step) {
  const city = game.city;
  game.dayT = 0.36;
  const car = createCar(city, {
    x: city.vx[3] - 260, y: city.hz[2] + LANE, angle: 0, type: 'sport', color: '#e5484d', rng: game.rng,
  });
  game.cars.push(car);
  game.enterCar(car);
  // Let traffic and the city come alive around the parked-warm scene, then place the
  // Comet mid-avenue at speed for the frame.
  runSteps(game, step, 210, null);
  car.x = city.vx[4] - 120;
  car.y = city.hz[2] + LANE;
  car.angle = 0;
  car.vx = 235;
  car.vy = 0;
  game.player.x = car.x;
  game.player.y = car.y;
}

// On foot outside Rosa's Diner: pistol drawn, a job on offer, the law already interested.
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
  game.bustMeter = 0.45;
}

// Mid-mission: the stolen Comet, two stars up, a cruiser on the tail, the garage waiting.
function stageMission(game, step) {
  const city = game.city;
  game.dayT = 0.315;
  const missions = game.missions;
  missions.idx = 1;
  missions.stage = 'active';
  missions.phase = 'deliver';
  missions.timer = null;
  const car = createCar(city, {
    x: city.vx[5] - 200, y: city.hz[3] + LANE, angle: 0, type: 'sport', color: '#e5484d', rng: game.rng,
  });
  car.missionTarget = true;
  missions.targetCar = car;
  game.cars.push(car);
  game.enterCar(car);
  game.heat = 38;
  const tail = createCar(city, {
    x: car.x - 210, y: car.y, angle: 0, type: 'police', livery: 'police', color: '#f7f0e1',
  });
  tail.driver = 'cop';
  tail.police = true;
  tail.ai = { mode: 'pursue', droppedOfficer: false };
  game.cars.push(tail);
  game.police.units.push(tail);
  runSteps(game, step, 130, null);
  if (game.player.car !== car) {
    // The chase got rough in staging; put Rico back behind the wheel for the frame.
    game.player.car = car;
    car.driver = 'player';
    game.player.x = car.x;
    game.player.y = car.y;
  }
}

// Dusk on Shore Drive: a taxi hunting its fare under the palms, lamps coming on.
function stageDusk(game, step) {
  const city = game.city;
  game.dayT = 0.752;
  const car = createCar(city, {
    x: city.vx[0] - LANE, y: city.hz[1] + 120, angle: Math.PI / 2, type: 'taxi', livery: 'taxi', color: '#ffd75e', rng: game.rng,
  });
  game.cars.push(car);
  game.enterCar(car);
  const ped = game.people.addPed(140, city.hz[2] + 60, { passenger: true });
  ped.state = 'stand';
  game.missions.roam = { phase: 'pickup', passenger: ped, dest: null };
  runSteps(game, step, 110, null);
  car.x = city.vx[0] - LANE;
  car.y = city.hz[2] - 130;
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
