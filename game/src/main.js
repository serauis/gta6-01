// main.js — Palmira Heat's conductor. It builds the world and every system, owns the game
// state (money, heat, health, weapon, save file), runs the fixed-step loop, and wires the
// player controls: walking and aiming on foot, driving, entering and stealing cars,
// shooting, the pay'n'spray, being busted and being wasted.
//
// ?seed=N fixes the city and every random stream. ?shot=cover|foot|mission|dusk (with
// &seed=N) stages a screenshot scene instead of starting the game (see shots.js).

import { STAR_THRESHOLDS, TUNE, VIEW_H, VIEW_W } from './config.js';
import { clamp, dist, makeRandom } from './random.js';
import {
  bindInput, endFrameInput, handbrakeHeld, keys, mouse, moveAxes, pressed, sprintHeld,
} from './input.js';
import { SoundBank } from './audio.js';
import { buildCity } from './city.js';
import { collideCars, createCar, damageCar, stepCar } from './vehicles.js';
import { People } from './people.js';
import { Traffic } from './traffic.js';
import { Police } from './police.js';
import { Combat } from './combat.js';
import { Missions } from './missions.js';
import { Hud } from './hud.js';
import { Renderer } from './render.js';
import { stageShot } from './shots.js';

const STEP = 1 / 60;
const SAVE_KEY = 'palmira-heat.save.v1';

const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : 20261121;
const shotName = params.get('shot');

const canvas = document.getElementById('game');
canvas.width = VIEW_W;
canvas.height = VIEW_H;
const minimapCanvas = document.getElementById('minimap');
const rng = makeRandom(seed);
const city = buildCity(makeRandom(seed * 31 + 7));

const game = {
  city,
  rng,
  audio: new SoundBank(),
  hud: new Hud(),
  mode: shotName ? 'play' : 'title',
  time: 0,
  dayT: 0.335, // about 8 AM
  money: 60,
  heat: 0,
  heatFloor: 0,
  stars: 0,
  unseenT: 0,
  bustMeter: 0,
  channel: null,
  promptText: '',
  weapon: { have: false, ammo: 0 },
  fireCooldown: 0,
  hurtT: 0,
  sprayCooldown: 0,
  stats: { earned: 0, fares: 0, packages: 0, busted: 0, wasted: 0 },
  player: null,
  cars: [],
  fx: [],
  skids: [],
  camera: { x: 0, y: 0 },
  people: null,
  traffic: null,
  police: null,
  combat: null,
  missions: null,
  storyDone: false,
  respawnKind: 'wasted',
};

// --- world population ----------------------------------------------------------
const dinerDoor = city.landmarks.diner.door;
game.player = {
  x: dinerDoor.x - 26, y: dinerDoor.y + 44,
  angle: -Math.PI / 2, hp: 100, car: null, walkPhase: 0, speedNow: 0, aimAngle: 0,
};
for (const spawn of city.parkedSpawns) {
  const car = createCar(city, {
    x: spawn.x, y: spawn.y, angle: spawn.angle, type: spawn.type,
    livery: spawn.type === 'taxi' ? 'taxi' : 'civil', rng,
  });
  game.cars.push(car);
}
game.people = new People(city, makeRandom(seed * 17 + 3));
game.traffic = new Traffic(city, makeRandom(seed * 23 + 5));
game.police = new Police(city, makeRandom(seed * 29 + 11));
game.combat = new Combat(makeRandom(seed * 37 + 13));
game.missions = new Missions(city, makeRandom(seed * 41 + 19));
const renderer = new Renderer(canvas, minimapCanvas);
window.__game = game; // play-test hook: the headless driver inspects state through here

// --- effects -------------------------------------------------------------------
game.addFx = (kind, x, y, extra = {}) => {
  const life = { flash: 0.18, spark: 0.25, smoke: 1.15, boom: 0.55, text: 1.15 }[kind] || 0.4;
  game.fx.push({ kind, x, y, t: 0, life, seed: rng.range(0, Math.PI * 2), ...extra });
};

// --- economy & heat --------------------------------------------------------------
game.notify = (title, sub = '') => game.hud.notify(title, sub);
game.banner = (title, sub = '') => game.hud.banner(title, sub);

game.earn = (amount) => {
  game.money += amount;
  game.stats.earned += amount;
  game.audio.cash();
  const focus = game.player.car || game.player;
  game.addFx('text', focus.x, focus.y - 26, { str: `+$${amount}`, color: '#7be495' });
};

game.addHeat = (points, x, y, force = false) => {
  let witnessed = force || game.police.anySees(game);
  if (!witnessed) {
    for (const ped of game.people.peds) {
      if (ped.state !== 'down' && dist(ped.x, ped.y, x, y) < 150) {
        witnessed = true;
        break;
      }
    }
  }
  if (!witnessed) return;
  game.heat = Math.min(300, game.heat + points);
  game.unseenT = 0;
};

game.damagePlayer = (amount, sx, sy) => {
  if (game.mode !== 'play' || game.player.hp <= 0) return;
  game.player.hp -= amount;
  game.hurtT = 0.7;
  game.audio.hitFlesh();
  game.addFx('spark', game.player.x, game.player.y);
  if (game.player.hp <= 0) game.onWasted();
  void sx;
  void sy;
};

// --- event hooks used by the systems ----------------------------------------------
game.onPedDown = (ped) => {
  game.addHeat(55, ped.x, ped.y);
  if (game.missions.passenger === ped) game.missions.fail(game, 'Your passenger is down.');
  if (game.missions.roam && game.missions.roam.passenger === ped) game.missions.roam = null;
};

game.onOfficerDown = (officer, byPlayer) => {
  if (byPlayer) game.addHeat(85, officer.x, officer.y, true);
};

game.onCarWrecked = (car, byPlayer) => {
  game.missions.onCarWrecked(game, car);
  if (byPlayer && car.police) game.addHeat(60, car.x, car.y, true);
  if (car === game.player.car) {
    game.exitCar(true);
    game.damagePlayer(8, car.x, car.y);
  }
};

game.onPassengerBoarded = (ped) => {
  game.audio.pickup();
  game.missions.onPassengerBoarded(game, ped);
};

game.onBusted = () => {
  if (game.mode !== 'play') return;
  const fine = Math.min(game.money, Math.max(40, Math.round(game.money * 0.12)));
  game.money -= fine;
  game.stats.busted += 1;
  game.respawnKind = 'busted';
  game.mode = 'over';
  document.getElementById('overTitle').textContent = 'BUSTED';
  document.getElementById('overText').textContent = `The Palmira PD take $${fine} in fines. You walk out of the station with a clean record and a lighter wallet.`;
  game.hud.showScreen('over');
  game.audio.sting(false);
};

game.onWasted = () => {
  if (game.mode !== 'play') return;
  const bill = Math.min(game.money, Math.max(30, Math.round(game.money * 0.08)));
  game.money -= bill;
  game.stats.wasted += 1;
  game.respawnKind = 'wasted';
  game.mode = 'over';
  document.getElementById('overTitle').textContent = 'WASTED';
  document.getElementById('overText').textContent = `Palmira General patches you up for $${bill}. The city kept spinning without you.`;
  game.hud.showScreen('over');
  game.audio.sting(false);
};

game.onStoryComplete = () => {
  game.storyDone = true;
  game.mode = 'end';
  document.getElementById('endText').textContent =
    `The last job paid out, the bank backed off, and Tito's garage stays in the family. Palmira is still out there — ` +
    `you earned $${game.stats.earned}, found ${game.stats.packages}/10 packages, were busted ${game.stats.busted}× and wasted ${game.stats.wasted}× getting here.`;
  game.hud.showScreen('end');
  game.saveGame();
};

// --- cars ---------------------------------------------------------------------------
game.stepCarFor = (car, control, dt) => {
  const px = car.x;
  const py = car.y;
  const impact = stepCar(car, dt, control, city);
  const speed = Math.hypot(car.vx, car.vy);
  // Skid marks while drifting or sliding hard.
  const vl = -car.vx * Math.sin(car.angle) + car.vy * Math.cos(car.angle);
  if (speed > 110 && (Math.abs(vl) > 52 || (control.handbrake && speed > 130))) {
    for (const side of [-1, 1]) {
      const ox = -Math.cos(car.angle) * car.spec.w * 0.3 + Math.cos(car.angle + Math.PI / 2) * side * car.spec.h * 0.42;
      const oy = -Math.sin(car.angle) * car.spec.w * 0.3 + Math.sin(car.angle + Math.PI / 2) * side * car.spec.h * 0.42;
      const pox = -Math.cos(car.angle) * car.spec.w * 0.3 + Math.cos(car.angle + Math.PI / 2) * side * car.spec.h * 0.42;
      const poy = -Math.sin(car.angle) * car.spec.w * 0.3 + Math.sin(car.angle + Math.PI / 2) * side * car.spec.h * 0.42;
      game.skids.push({ x1: px + pox, y1: py + poy, x2: car.x + ox, y2: car.y + oy, a: 0.4 });
    }
    if (game.skids.length > 420) game.skids.splice(0, game.skids.length - 420);
  }
  if (impact > 150) {
    game.audio.crash(clamp((impact - 140) / 320, 0.15, 1));
    game.addFx('spark', car.x, car.y);
    if (car.driver === 'player') {
      game.people.scare(car.x, car.y, 130);
      if (impact > 215) game.addHeat(7, car.x, car.y);
      if (impact > 300) game.damagePlayer((impact - 300) * 0.04, car.x, car.y);
    }
  }
  return impact;
};

game.nearestCar = (x, y, maxDist) => {
  let best = null;
  let bestD = maxDist;
  for (const car of game.cars) {
    const d = dist(x, y, car.x, car.y);
    if (d < bestD) {
      bestD = d;
      best = car;
    }
  }
  return best;
};

game.enterCar = (car) => {
  if (car.driver === 'traffic') game.traffic.abandon(game, car);
  if (car.driver === 'cop') return;
  car.driver = 'player';
  game.player.car = car;
  game.player.x = car.x;
  game.player.y = car.y;
  game.audio.door();
  game.missions.onPlayerEnterCar(game, car);
  if (car.livery === 'police') game.addHeat(35, car.x, car.y);
};

game.exitCar = (forced = false) => {
  const car = game.player.car;
  if (!car) return;
  car.driver = 'none';
  game.player.car = null;
  const side = car.angle + Math.PI / 2;
  const spot = city.collideCircle(car.x + Math.cos(side) * 26, car.y + Math.sin(side) * 26, 11);
  game.player.x = spot.x;
  game.player.y = spot.y;
  if (!forced) game.audio.door();
};

// --- save / load -----------------------------------------------------------------------
game.saveGame = () => {
  try {
    const data = {
      v: 1,
      money: game.money,
      idx: game.missions.idx,
      storyDone: game.storyDone,
      packages: city.pickups.filter((p) => p.kind === 'package' && p.taken).map((p) => p.id),
      weapon: game.weapon,
      stats: game.stats,
    };
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage off: the run lasts this visit only.
  }
};

function loadSave() {
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data || data.v !== 1) return false;
    game.money = data.money ?? 60;
    game.storyDone = !!data.storyDone;
    game.missions.idx = clamp(data.idx ?? 0, 0, 5);
    game.missions.stage = game.storyDone ? 'done' : 'giver';
    game.weapon = data.weapon || { have: false, ammo: 0 };
    game.stats = data.stats || game.stats;
    for (const pickup of city.pickups) {
      if (pickup.kind === 'package' && (data.packages || []).includes(pickup.id)) pickup.taken = true;
    }
    game.stats.packages = (data.packages || []).length;
    return true;
  } catch {
    return false;
  }
}

function newGame() {
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch { /* ignore */ }
  game.money = 60;
  game.storyDone = false;
  game.missions.idx = 0;
  game.missions.stage = 'giver';
  game.missions.cleanup(game);
  game.weapon = { have: false, ammo: 0 };
  game.stats = { earned: 0, fares: 0, packages: 0, busted: 0, wasted: 0 };
  game.heat = 0;
  game.player.hp = 100;
  game.player.car = null;
  game.player.x = dinerDoor.x - 26;
  game.player.y = dinerDoor.y + 44;
  for (const pickup of city.pickups) pickup.taken = false;
  game.police.standDown(game);
  game.saveGame();
}

// --- per-step update -----------------------------------------------------------------------
function updatePlayer(dt) {
  const player = game.player;
  player.speedNow = 0;
  if (player.car) {
    const car = player.car;
    const throttle = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const steer = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    game.stepCarFor(car, { throttle, steer, handbrake: handbrakeHeld() }, dt);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    player.speedNow = Math.hypot(car.vx, car.vy);
    if (pressed.has('KeyF')) game.exitCar();
    // Pay'n'spray
    game.sprayCooldown -= dt;
    const spray = city.landmarks.spray;
    if (dist(car.x, car.y, spray.x, spray.y) < 48 && player.speedNow < 32 && game.sprayCooldown <= 0) {
      if (game.stars > 0 || car.health < car.spec.health - 1 || car.wrecked) {
        if (game.money >= TUNE.sprayCost) {
          game.money -= TUNE.sprayCost;
          car.health = car.spec.health;
          car.wrecked = false;
          game.heat = 0;
          game.police.standDown(game);
          game.sprayCooldown = 4;
          game.audio.cash();
          game.hud.notify('Pay \'n\' Spray', `Fresh paint, clean record. -$${TUNE.sprayCost}`);
          game.saveGame();
        }
      }
    }
    return;
  }

  // On foot
  const axes = moveAxes();
  const moving = axes.x !== 0 || axes.y !== 0;
  const sprint = sprintHeld();
  const speed = sprint ? TUNE.sprintSpeed : TUNE.walkSpeed;
  if (moving) {
    const len = Math.hypot(axes.x, axes.y);
    player.x += (axes.x / len) * speed * dt;
    player.y += (axes.y / len) * speed * dt;
    player.walkPhase += dt * (sprint ? 12 : 8.5);
    player.speedNow = speed;
    if (!game.weapon.have) player.angle = Math.atan2(axes.y, axes.x);
  }
  const resolved = city.collideCircle(player.x, player.y, TUNE.playerRadius);
  player.x = clamp(resolved.x, 20, city.W - 20);
  player.y = clamp(resolved.y, 20, city.H - 20);
  // Cars are solid on foot too.
  for (const car of game.cars) {
    const rr = car.spec.w * 0.42 + TUNE.playerRadius;
    const d = dist(player.x, player.y, car.x, car.y);
    if (d > 0.01 && d < rr) {
      player.x = car.x + ((player.x - car.x) / d) * rr;
      player.y = car.y + ((player.y - car.y) / d) * rr;
    }
  }
  // Aim follows the mouse (canvas pixels → world).
  const mwx = game.camera.x + mouse.x;
  const mwy = game.camera.y + mouse.y;
  player.aimAngle = Math.atan2(mwy - player.y, mwx - player.x);
  if (game.weapon.have) player.angle = player.aimAngle;

  if (pressed.has('KeyF')) {
    const car = game.nearestCar(player.x, player.y, TUNE.enterCarRange);
    if (car && !car.wrecked) game.enterCar(car);
  }

  // Shooting
  game.fireCooldown -= dt;
  if (game.weapon.have && mouse.down && game.fireCooldown <= 0) {
    if (game.weapon.ammo > 0) {
      game.weapon.ammo -= 1;
      game.fireCooldown = 0.23;
      game.combat.fire(game, player.x + Math.cos(player.aimAngle) * 15, player.y + Math.sin(player.aimAngle) * 15, player.aimAngle, { from: 'player' });
      game.addHeat(14, player.x, player.y);
    } else {
      game.fireCooldown = 0.3;
      game.audio.dryFire();
    }
  }
}

function updatePickups(dt) {
  const focus = game.player.car || game.player;
  for (const pickup of city.pickups) {
    if (pickup.respawnT > 0) {
      pickup.respawnT -= dt;
      if (pickup.respawnT <= 0) pickup.taken = false;
      continue;
    }
    if (pickup.taken) continue;
    if (dist(focus.x, focus.y, pickup.x, pickup.y) > 26) continue;
    if (pickup.kind === 'package') {
      pickup.taken = true;
      game.stats.packages += 1;
      game.earn(TUNE.packageReward);
      game.hud.notify('Hidden package', `${game.stats.packages} of ${TUNE.packageCount} — +$${TUNE.packageReward}`);
      game.saveGame();
    } else if (pickup.kind === 'health') {
      if (game.player.hp >= 100) continue;
      pickup.taken = true;
      pickup.respawnT = 45;
      game.player.hp = Math.min(100, game.player.hp + 45);
      game.audio.pickup();
      game.addFx('text', focus.x, focus.y - 24, { str: '+HEALTH', color: '#ff9d9d' });
    } else if (pickup.kind === 'weapon') {
      pickup.taken = true;
      pickup.respawnT = 60;
      game.weapon.have = true;
      game.weapon.ammo += 24;
      game.audio.pickup();
      game.hud.notify('Pistol acquired', 'Aim with the mouse, click to fire. Mind the witnesses.');
    } else if (pickup.kind === 'ammo') {
      if (!game.weapon.have) continue;
      pickup.taken = true;
      pickup.respawnT = 60;
      game.weapon.ammo += 18;
      game.audio.pickup();
      game.addFx('text', focus.x, focus.y - 24, { str: '+18 AMMO', color: '#ffd75e' });
    }
  }
}

function step(dt) {
  game.time += dt;
  game.dayT = (game.dayT + dt / TUNE.dayLength) % 1;
  game.hurtT = Math.max(0, game.hurtT - dt);

  updatePlayer(dt);
  game.people.update(game, dt);
  game.traffic.update(game, dt);
  game.police.update(game, dt);
  game.combat.update(game, dt);
  if (game.mode === 'play') game.missions.update(game, dt);
  updatePickups(dt);

  // Car on car collisions.
  const cars = game.cars;
  for (let i = 0; i < cars.length; i++) {
    for (let j = i + 1; j < cars.length; j++) {
      const a = cars[i];
      const b = cars[j];
      if (Math.abs(a.x - b.x) > 90 || Math.abs(a.y - b.y) > 90) continue;
      const impact = collideCars(a, b);
      if (impact > 110) {
        damageCar(a, (impact - 110) * 0.05);
        damageCar(b, (impact - 110) * 0.05);
        game.audio.crash(clamp((impact - 100) / 300, 0.1, 0.9));
        if (a.driver === 'player' || b.driver === 'player') {
          const other = a.driver === 'player' ? b : a;
          if (other.driver === 'traffic' && other.ai) other.ai.panicT = 2.5;
          if (other.police) game.addHeat(30, other.x, other.y, true);
          else if (impact > 170) game.addHeat(9, game.player.x, game.player.y);
          if (impact > 320) game.damagePlayer((impact - 320) * 0.05, game.player.x, game.player.y);
        }
        if (a.wrecked && a !== game.player.car) game.onCarWrecked(a, b.driver === 'player');
        if (b.wrecked && b !== game.player.car) game.onCarWrecked(b, a.driver === 'player');
      }
    }
  }

  // Wanted level from heat, with decay while unseen.
  const seen = game.police.anySees(game);
  if (seen) game.unseenT = 0;
  else game.unseenT += dt;
  if (!seen && game.unseenT > TUNE.heatSightGrace && game.heat > 0) {
    game.heat = Math.max(0, game.heat - (2.4 + game.heat * 0.014) * dt);
  }
  const effectiveHeat = Math.max(game.heat, game.heatFloor);
  game.stars = clamp(STAR_THRESHOLDS.filter((t) => effectiveHeat >= t).length, 0, 5);
  if (game.stars === 0 && game.heat > 0 && game.heatFloor === 0) game.heat = Math.max(0, game.heat - 4 * dt);

  // Damage smoke and wreck fires.
  for (const car of cars) {
    if (car.health < 55 && rng.chance(0.1)) {
      game.addFx('smoke', car.x + rng.range(-8, 8), car.y + rng.range(-6, 6), { dark: car.health < 25 });
    }
    if (car.wrecked && rng.chance(0.03)) {
      game.combat.pendingBooms.push({ x: car.x, y: car.y, t: 0.2 });
      car.health = 1; // burn once, then it is a husk
      car.wrecked = true;
    }
  }

  // Effects and skid fade.
  for (const fx of game.fx) fx.t += dt;
  game.fx = game.fx.filter((fx) => fx.t < fx.life);
  for (const skid of game.skids) skid.a -= dt * 0.03;
  game.skids = game.skids.filter((skid) => skid.a > 0.02);

  updatePrompt();
}

function updatePrompt() {
  const player = game.player;
  if (player.car) {
    const spray = city.landmarks.spray;
    if (dist(player.car.x, player.car.y, spray.x, spray.y) < 48 && (game.stars > 0 || player.car.health < player.car.spec.health - 1)) {
      game.promptText = game.money >= TUNE.sprayCost ? 'Pay \'n\' Spray — stop here ($100)' : 'Pay \'n\' Spray — you need $100';
    } else {
      game.promptText = 'F — Exit vehicle · Space — Handbrake';
    }
    return;
  }
  const car = game.nearestCar(player.x, player.y, TUNE.enterCarRange);
  if (car && !car.wrecked) {
    const name = car.livery === 'police' ? 'Police Cruiser' : car.type === 'sport' ? 'Comet' : car.type === 'truck' ? 'Hauler' : car.livery === 'taxi' ? 'Taxi' : 'Sedan';
    game.promptText = car.driver === 'traffic' ? `F — Pull the driver out and take the ${name}` : `F — Enter ${name}`;
    return;
  }
  game.promptText = game.weapon.have ? '' : 'WASD — Move · Shift — Sprint · F — Enter car';
}

// --- screens & flow -------------------------------------------------------------------------
function setMode(mode) {
  game.mode = mode;
  if (mode === 'pause') {
    document.getElementById('pauseStats').textContent =
      `$${game.money} · ${game.stats.packages}/10 packages · ${game.storyDone ? 'Story complete' : `Job ${game.missions.idx + 1} of 5`}`;
  }
  game.hud.showScreen(mode === 'play' ? null : mode);
  game.audio.setMusic(mode === 'title' || mode === 'play');
}

function respawn() {
  const door = game.respawnKind === 'busted' ? city.landmarks.police.door : city.landmarks.hospital.door;
  game.player.car = null;
  game.player.x = door.x;
  game.player.y = door.y + 30;
  game.player.hp = 100;
  game.heat = 0;
  game.bustMeter = 0;
  game.police.standDown(game);
  game.missions.cleanup(game);
  game.missions.stage = game.missions.idx >= 5 ? 'done' : 'giver';
  setMode('play');
}

const hasSave = loadSave();
if (hasSave) {
  const continueBtn = document.getElementById('continueBtn');
  continueBtn.style.display = 'inline-block';
  continueBtn.textContent = game.storyDone
    ? `CONTINUE — $${game.money} · STORY COMPLETE`
    : `CONTINUE — $${game.money} · JOB ${game.missions.idx + 1} OF 5`;
}

document.getElementById('newGameBtn').addEventListener('click', () => {
  game.audio.unlock();
  game.audio.uiClick();
  newGame();
  setMode('play');
});
document.getElementById('continueBtn').addEventListener('click', () => {
  game.audio.unlock();
  game.audio.uiClick();
  setMode('play');
});
document.getElementById('resumeBtn').addEventListener('click', () => {
  game.audio.unlock();
  setMode('play');
});
document.getElementById('restartBtn').addEventListener('click', () => {
  game.audio.unlock();
  newGame();
  setMode('play');
});
document.getElementById('respawnBtn').addEventListener('click', () => {
  game.audio.unlock();
  respawn();
});
document.getElementById('freeRoamBtn').addEventListener('click', () => {
  game.audio.unlock();
  setMode('play');
});
window.addEventListener('pointerdown', () => game.audio.unlock(), { once: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'play' && !shotName) setMode('pause');
});

// --- main loop ----------------------------------------------------------------------------------
bindInput(canvas);
let last = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const frameDt = Math.min((now - last) / 1000, 0.1);
  last = now;

  if (!shotName) {
    if (pressed.has('KeyP') || pressed.has('Escape')) {
      if (game.mode === 'play') setMode('pause');
      else if (game.mode === 'pause') setMode('play');
    }
    if (pressed.has('KeyM')) {
      game.audio.setMuted(!game.audio.muted);
      game.hud.notify(game.audio.muted ? 'Sound off' : 'Sound on', '');
    }
    if (pressed.has('Enter')) {
      if (game.mode === 'title') {
        game.audio.unlock();
        if (!hasSave) newGame();
        setMode('play');
      } else if (game.mode === 'over') respawn();
      else if (game.mode === 'end') setMode('play');
    }
  }

  if (game.mode === 'play' || game.mode === 'title') {
    accumulator += frameDt;
    while (accumulator >= STEP) {
      step(STEP);
      accumulator -= STEP;
      if (game.mode !== 'play' && game.mode !== 'title') {
        accumulator = 0;
        break;
      }
    }
  } else {
    accumulator = 0;
  }

  renderer.time = game.time;
  renderer.draw(game);
  if (game.hurtT > 0) {
    renderer.ctx.fillStyle = `rgba(200,30,30,${game.hurtT * 0.22})`;
    renderer.ctx.fillRect(0, 0, VIEW_W, VIEW_H);
  }
  if (!shotName) game.hud.update(game);

  // Loops: engine note follows the player's car; sirens swell as units close in.
  const focusCar = game.player.car;
  if (focusCar && game.mode === 'play') {
    game.audio.setEngine(clamp(Math.abs(Math.hypot(focusCar.vx, focusCar.vy)) / focusCar.spec.topSpeed, 0, 1), true);
  } else {
    game.audio.setEngine(0, false);
  }
  const nearestCop = game.police.nearestUnitDistance(game);
  game.audio.setSiren(game.stars > 0 && nearestCop < 720 ? clamp(1 - nearestCop / 720, 0, 1) : 0);
  game.audio.musicTick(frameDt);

  endFrameInput();
}

if (shotName) {
  stageShot(game, renderer, shotName, step);
} else {
  game.hud.showScreen('title');
  game.audio.setMusic(true);
  requestAnimationFrame(frame);
}
