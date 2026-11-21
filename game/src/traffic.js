// traffic.js — Palmira's civilian traffic. Cars spawn on roads beyond the player's view,
// follow right-hand lanes, turn at intersections, brake for whoever is ahead of them and
// stop being traffic when wrecked or abandoned: the driver gets out and runs, and the car
// becomes just another parked car the player can take.

import { createCar, driveToward } from './vehicles.js';

const TYPES = ['sedan', 'sedan', 'sedan', 'taxi', 'taxi', 'sport', 'truck'];

export class Traffic {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.cars = [];
    this.spawnTimer = 0;
  }

  spawn(game) {
    const player = game.player;
    for (let tries = 0; tries < 8; tries++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = this.rng.range(760, 980);
      const x = player.x + Math.cos(angle) * distance;
      const y = player.y + Math.sin(angle) * distance;
      if (x < 90 || y < 60 || x > this.city.W - 60 || y > this.city.H - 60) continue;
      if (!this.city.onRoad(x, y)) continue;
      // Snap onto the nearest road centreline.
      let sx = x;
      let sy = y;
      let bestD = Infinity;
      for (const rx of this.city.vx) {
        const d = Math.abs(x - rx);
        if (d < bestD) { bestD = d; sx = rx; }
      }
      let bestDy = Infinity;
      for (const ry of this.city.hz) {
        const d = Math.abs(y - ry);
        if (d < bestDy) { bestDy = d; sy = ry; }
      }
      const vertical = bestD < bestDy;
      const car = createCar(this.city, {
        x: vertical ? sx : x, y: vertical ? y : sy,
        angle: 0, type: this.rng.pick(TYPES), rng: this.rng,
      });
      car.driver = 'traffic';
      car.traffic = true;
      car.ai = {
        hx: vertical ? 0 : (this.rng.chance(0.5) ? 1 : -1),
        hy: vertical ? (this.rng.chance(0.5) ? 1 : -1) : 0,
        turnCooldown: 0,
        panicT: 0,
        abandonT: -1,
      };
      car.angle = Math.atan2(car.ai.hy, car.ai.hx);
      if (game.cars.some((other) => Math.hypot(other.x - car.x, other.y - car.y) < 60)) continue;
      game.cars.push(car);
      this.cars.push(car);
      return;
    }
  }

  abandon(game, car) {
    car.driver = 'none';
    car.traffic = false;
    const doorX = car.x + Math.cos(car.angle + Math.PI / 2) * 20;
    const doorY = car.y + Math.sin(car.angle + Math.PI / 2) * 20;
    const ped = game.people.addPed(doorX, doorY, {});
    ped.state = 'flee';
    ped.fleeT = 3;
    ped.fleeX = car.x;
    ped.fleeY = car.y;
    this.cars = this.cars.filter((c) => c !== car);
  }

  update(game, dt) {
    const player = game.player;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.8;
      if (this.cars.length < 11) this.spawn(game);
    }
    for (const car of [...this.cars]) {
      const dPlayer = Math.hypot(car.x - player.x, car.y - player.y);
      if (dPlayer > 1550) {
        game.cars = game.cars.filter((c) => c !== car);
        this.cars = this.cars.filter((c) => c !== car);
        continue;
      }
      if (car.wrecked || car.health < 26) {
        if (car.ai.abandonT < 0) car.ai.abandonT = 0.8;
        car.ai.abandonT -= dt;
        game.stepCarFor(car, { throttle: 0, steer: 0, handbrake: true }, dt);
        if (car.ai.abandonT <= 0) this.abandon(game, car);
        continue;
      }
      const ai = car.ai;
      ai.turnCooldown -= dt;
      ai.panicT -= dt;

      // Turning: near an intersection centre, sometimes pick a new heading.
      if (ai.turnCooldown <= 0) {
        for (const ix of this.city.vx) {
          for (const iy of this.city.hz) {
            if (Math.hypot(car.x - ix, car.y - iy) < 34 && this.rng.chance(0.45)) {
              const options = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([hx, hy]) => !(hx === -ai.hx && hy === -ai.hy));
              const [hx, hy] = this.rng.pick(options);
              ai.hx = hx;
              ai.hy = hy;
              ai.turnCooldown = 2.2;
            }
          }
        }
      }

      const aheadX = car.x + ai.hx * 150;
      const aheadY = car.y + ai.hy * 150;
      const lane = this.city.lanePoint(aheadX, aheadY, ai.hx, ai.hy);
      const desired = ai.panicT > 0 ? car.spec.topSpeed : 195;
      let control = driveToward(car, lane.x, lane.y, dt, desired);

      // Brake for anything slow or stopped ahead in the same lane.
      const fx = Math.cos(car.angle);
      const fy = Math.sin(car.angle);
      for (const other of game.cars) {
        if (other === car) continue;
        const dx = other.x - car.x;
        const dy = other.y - car.y;
        const ahead = dx * fx + dy * fy;
        const side = -dx * fy + dy * fx;
        if (ahead > 0 && ahead < 58 && Math.abs(side) < 21) {
          const otherSpeed = Math.hypot(other.vx, other.vy);
          if (otherSpeed < Math.hypot(car.vx, car.vy) - 12 || ahead < 34) {
            control = { throttle: ahead < 30 ? -0.55 : 0, steer: control.steer, handbrake: false };
            car.blockedTime += dt;
          }
          break;
        }
      }
      game.stepCarFor(car, control, dt);
    }
  }
}
