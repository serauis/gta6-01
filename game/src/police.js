// police.js — the Palmira PD response. The wanted level (kept by the game as heat and stars)
// decides how many units roll: patrol cars spawn on roads out of sight, pursue, try to box
// the player in, and put officers on foot who make the arrest — or open fire at three stars
// and up. When the heat dies, units check the last seen spot, then leave.

import { TUNE } from './config.js';
import { clamp, dist } from './random.js';
import { createCar, driveToward } from './vehicles.js';

const UNIT_COUNT = [0, 1, 2, 3, 4, 5];

export class Police {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.units = []; // police cars on the hunt
    this.officers = []; // officers on foot
    this.spawnTimer = 0;
    this.searchT = 0;
  }

  desiredUnits(stars) {
    return UNIT_COUNT[clamp(stars, 0, 5)];
  }

  spawnUnit(game) {
    const player = game.player;
    for (let tries = 0; tries < 10; tries++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = this.rng.range(660, 840);
      const x = player.x + Math.cos(angle) * distance;
      const y = player.y + Math.sin(angle) * distance;
      if (x < 90 || y < 60 || x > this.city.W - 60 || y > this.city.H - 60) continue;
      if (!this.city.onRoad(x, y)) continue;
      const car = createCar(this.city, { x, y, angle: 0, type: 'police', livery: 'police', color: '#f7f0e1' });
      car.driver = 'cop';
      car.police = true;
      car.ai = { mode: 'pursue', droppedOfficer: false };
      car.angle = Math.atan2(player.y - y, player.x - x);
      game.cars.push(car);
      this.units.push(car);
      return true;
    }
    return false;
  }

  dropOfficer(game, car) {
    const officer = {
      x: car.x + Math.cos(car.angle + Math.PI / 2) * 22,
      y: car.y + Math.sin(car.angle + Math.PI / 2) * 22,
      angle: car.angle, hp: 100, state: 'chase', shootT: this.rng.range(0.6, 1.4),
      downT: 0, phase: this.rng.range(0, Math.PI * 2), removeMe: false,
    };
    this.officers.push(officer);
    car.ai.droppedOfficer = true;
    return officer;
  }

  anySees(game) {
    const player = game.player;
    const px = player.car ? player.car.x : player.x;
    const py = player.car ? player.car.y : player.y;
    for (const unit of this.units) {
      if (dist(unit.x, unit.y, px, py) < TUNE.copSightRange && this.city.losClear(unit.x, unit.y, px, py)) return true;
    }
    for (const officer of this.officers) {
      if (officer.state !== 'down' && dist(officer.x, officer.y, px, py) < TUNE.copSightRange && this.city.losClear(officer.x, officer.y, px, py)) return true;
    }
    return false;
  }

  nearestUnitDistance(game) {
    const player = game.player;
    let best = Infinity;
    for (const unit of this.units) best = Math.min(best, dist(unit.x, unit.y, player.x, player.y));
    for (const officer of this.officers) if (officer.state !== 'down') best = Math.min(best, dist(officer.x, officer.y, player.x, player.y));
    return best;
  }

  update(game, dt) {
    const player = game.player;
    const stars = game.stars;
    const px = player.car ? player.car.x : player.x;
    const py = player.car ? player.car.y : player.y;

    this.spawnTimer -= dt;
    if (stars > 0 && this.units.length < this.desiredUnits(stars) && this.spawnTimer <= 0) {
      this.spawnTimer = 1.6;
      this.spawnUnit(game);
    }

    // --- cars -----------------------------------------------------------------
    for (const unit of [...this.units]) {
      const dPlayer = dist(unit.x, unit.y, px, py);
      if (unit.wrecked) {
        if (!unit.ai.droppedOfficer) this.dropOfficer(game, unit);
        unit.driver = 'none';
        unit.police = false;
        this.units = this.units.filter((u) => u !== unit);
        continue;
      }
      if (stars === 0) {
        // Stand down: drive off and despawn once well away.
        const away = this.city.lanePoint(unit.x + Math.cos(unit.angle) * 200, unit.y + Math.sin(unit.angle) * 200, Math.cos(unit.angle), Math.sin(unit.angle));
        game.stepCarFor(unit, driveToward(unit, away.x, away.y, dt, 200), dt);
        if (dPlayer > 780) {
          game.cars = game.cars.filter((c) => c !== unit);
          this.units = this.units.filter((u) => u !== unit);
        }
        continue;
      }
      // Put an officer on foot when the player is on foot and we are close.
      if (!player.car && dPlayer < 240 && this.officers.filter((o) => o.state !== 'down').length < Math.min(2, stars + 1) && !unit.ai.droppedOfficer) {
        this.dropOfficer(game, unit);
      }
      let tx = px;
      let ty = py;
      let desired = unit.spec.topSpeed;
      if (player.car) {
        tx = px + player.car.vx * 0.35;
        ty = py + player.car.vy * 0.35;
      } else if (dPlayer < 110) {
        // On foot: box in, don't run them over at full speed.
        desired = 120;
        const back = Math.atan2(unit.y - py, unit.x - px);
        tx = px + Math.cos(back) * 62;
        ty = py + Math.sin(back) * 62;
      }
      game.stepCarFor(unit, driveToward(unit, tx, ty, dt, desired), dt);
    }

    // --- officers on foot -------------------------------------------------------
    let bustRate = 0;
    for (const officer of this.officers) {
      officer.phase += dt * 9;
      if (officer.state === 'down') {
        officer.downT -= dt;
        if (officer.downT <= 0) officer.removeMe = true;
        continue;
      }
      const d = dist(officer.x, officer.y, px, py);
      if (stars === 0 && d > 500) {
        officer.removeMe = true;
        continue;
      }
      if (d > 34) {
        const speed = player.car ? 150 : 208;
        const a = Math.atan2(py - officer.y, px - officer.x);
        officer.angle = a;
        officer.x += Math.cos(a) * speed * dt;
        officer.y += Math.sin(a) * speed * dt;
        const resolved = this.city.collideCircle(officer.x, officer.y, 9);
        officer.x = resolved.x;
        officer.y = resolved.y;
      } else {
        officer.angle = Math.atan2(py - officer.y, px - officer.x);
      }
      // Arrest pressure: close + a slow player.
      const playerSpeed = player.car ? Math.hypot(player.car.vx, player.car.vy) : player.speedNow;
      if (d < 40 && playerSpeed < 55) bustRate = Math.max(bustRate, player.car ? 0.75 : 1);
      // Gunfire at three stars and up, with line of sight.
      if (stars >= 3 && d > 46 && d < 300 && this.city.losClear(officer.x, officer.y, px, py)) {
        officer.shootT -= dt;
        if (officer.shootT <= 0) {
          officer.shootT = this.rng.range(0.85, 1.5);
          const a = Math.atan2(py - officer.y, px - officer.x);
          game.combat.fire(game, officer.x, officer.y, a, { from: 'cop' });
        }
      }
      // Run over by any moving car.
      for (const car of game.cars) {
        if (Math.hypot(car.vx, car.vy) < 90) continue;
        if (dist(officer.x, officer.y, car.x, car.y) < car.spec.w * 0.44 + 8) {
          officer.state = 'down';
          officer.hp = 0;
          officer.downT = 8;
          game.onOfficerDown(officer, car.driver === 'player');
          break;
        }
      }
    }
    this.officers = this.officers.filter((o) => !o.removeMe);

    if (bustRate > 0) {
      game.bustMeter = Math.min(1.4, game.bustMeter + bustRate * dt / TUNE.bustTime);
      if (game.bustMeter >= 1) game.onBusted();
    } else {
      game.bustMeter = Math.max(0, game.bustMeter - dt * 0.7 / TUNE.bustTime);
    }
  }

  // Clear the whole response (after a bust, a respawn or a pay'n'spray visit).
  standDown(game) {
    for (const unit of this.units) {
      unit.driver = 'none';
      unit.police = false;
    }
    this.units = [];
    this.officers = [];
  }
}
