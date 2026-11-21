// people.js — the pedestrians of Palmira. They stroll the sidewalk rings around the blocks,
// cross the road at block corners, stroll the beach promenade, and run when the street turns
// dangerous. The module keeps the pavement alive near the player: walkers spawn on rings
// around nearby blocks and leave when they wander too far away.

import { clamp } from './random.js';

const SHIRTS = ['#f2a65a', '#53b7e5', '#e8836b', '#7be495', '#f7f0e1', '#b388eb', '#ef6aa5', '#ffd75e'];
const PANTS = ['#3a4a5a', '#5c6b73', '#2f3b2f', '#6b4a3a', '#44475a'];
const SKIN = ['#f2c79b', '#c68863', '#8a5a3b', '#e8b08a', '#6e452a'];

let nextPedId = 1;

export class People {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.peds = [];
    // Walk rings: the sidewalk loop around each block, just outside its interior.
    this.rings = city.cells.map((cell) => ({
      x: cell.x - 8, y: cell.y - 8, w: cell.w + 16, h: cell.h + 16,
    }));
    this.spawnTimer = 0;
  }

  addPed(x, y, opts = {}) {
    const ped = {
      id: nextPedId++,
      x, y, angle: this.rng.range(0, Math.PI * 2),
      hp: 100,
      state: opts.state || 'walk', // walk | flee | down | stand | toCar
      ring: opts.ring ?? -1,
      corner: this.rng.int(0, 3),
      tx: x, ty: y,
      speed: this.rng.range(52, 78),
      fleeT: 0, fleeX: 0, fleeY: 0,
      downT: 0,
      waitT: 0,
      carTarget: null,
      phase: this.rng.range(0, Math.PI * 2),
      shirt: this.rng.pick(SHIRTS),
      pants: this.rng.pick(PANTS),
      skin: this.rng.pick(SKIN),
      isPassenger: !!opts.passenger,
      removeMe: false,
    };
    this.retarget(ped);
    this.peds.push(ped);
    return ped;
  }

  // Pick the ped's next stroll target: the next corner of its ring, or across the road to
  // the neighbouring block's ring, or along the beach promenade.
  retarget(ped) {
    if (ped.ring === -2) { // promenade walker
      ped.tx = 132;
      ped.ty = clamp(ped.y + this.rng.range(-420, 420), 70, this.city.H - 70);
      return;
    }
    if (ped.ring < 0 || !this.rings[ped.ring]) {
      ped.tx = ped.x + this.rng.range(-160, 160);
      ped.ty = ped.y + this.rng.range(-160, 160);
      return;
    }
    const ring = this.rings[ped.ring];
    if (this.rng.chance(0.22)) {
      // Cross the road: aim for the ring corner of the block across the street.
      ped.corner = this.rng.int(0, 3);
      const corners = ringCorners(ring);
      const [cx, cy] = corners[ped.corner];
      ped.tx = cx + this.rng.range(-190, 190);
      ped.ty = cy + this.rng.range(-190, 190);
      ped.tx = clamp(ped.tx, 70, this.city.W - 70);
      ped.ty = clamp(ped.ty, 70, this.city.H - 70);
      return;
    }
    ped.corner = (ped.corner + 1) % 4;
    const corners = ringCorners(ring);
    const [cx, cy] = corners[ped.corner];
    ped.tx = cx + this.rng.range(-7, 7);
    ped.ty = cy + this.rng.range(-7, 7);
  }

  spawnNear(px, py) {
    const nearRings = [];
    this.rings.forEach((ring, i) => {
      const cx = ring.x + ring.w / 2;
      const cy = ring.y + ring.h / 2;
      if (Math.hypot(cx - px, cy - py) < 900) nearRings.push(i);
    });
    if (nearRings.length && this.rng.chance(0.82)) {
      const ring = this.rings[this.rng.pick(nearRings)];
      const side = this.rng.int(0, 3);
      const t = this.rng.next();
      const x = side === 0 || side === 2 ? ring.x + t * ring.w : (side === 1 ? ring.x + ring.w : ring.x);
      const y = side === 1 || side === 3 ? ring.y + t * ring.h : (side === 0 ? ring.y : ring.y + ring.h);
      this.addPed(x, y, { ring: this.rings.indexOf(ring) });
    } else {
      this.addPed(132, clamp(py + this.rng.range(-500, 500), 70, this.city.H - 70), { ring: -2 });
    }
  }

  // Danger at (x, y): everyone close runs from it.
  scare(x, y, radius = 210) {
    for (const ped of this.peds) {
      if (ped.state !== 'walk' && ped.state !== 'stand') continue;
      if (Math.hypot(ped.x - x, ped.y - y) < radius) {
        ped.state = 'flee';
        ped.fleeT = this.rng.range(2, 3.6);
        ped.fleeX = x;
        ped.fleeY = y;
      }
    }
  }

  knockDown(ped, game) {
    if (ped.state === 'down') return;
    ped.state = 'down';
    ped.hp = 0;
    ped.downT = 7;
    game.onPedDown(ped);
  }

  update(game, dt) {
    const player = game.player;
    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 0.5;
      if (this.peds.length < 30) this.spawnNear(player.x, player.y);
    }
    for (const ped of this.peds) {
      const dPlayer = Math.hypot(ped.x - player.x, ped.y - player.y);
      if (dPlayer > 1500 && ped.state !== 'toCar' && !ped.isPassenger) {
        ped.removeMe = true;
        continue;
      }
      ped.phase += dt * (ped.state === 'flee' ? 13 : 7);
      if (ped.state === 'down') {
        ped.downT -= dt;
        if (ped.downT <= 0) ped.removeMe = true;
        continue;
      }
      if (ped.state === 'stand') continue;
      if (ped.state === 'toCar') {
        if (!ped.carTarget || ped.carTarget.wrecked) {
          ped.state = 'walk';
          ped.isPassenger = false;
        } else if (this.moveToward(ped, ped.carTarget.x, ped.carTarget.y, 120, dt)) {
          ped.removeMe = true;
          game.onPassengerBoarded(ped);
        }
        continue;
      }
      if (ped.state === 'flee') {
        ped.fleeT -= dt;
        const away = Math.atan2(ped.y - ped.fleeY, ped.x - ped.fleeX);
        this.moveToward(ped, ped.x + Math.cos(away) * 120, ped.y + Math.sin(away) * 120, 238, dt);
        if (ped.fleeT <= 0) {
          ped.state = 'walk';
          this.retarget(ped);
        }
        continue;
      }
      // walk
      if (this.moveToward(ped, ped.tx, ped.ty, ped.speed, dt)) this.retarget(ped);
    }
    // Cars are dangerous: a fast car that touches a walker knocks them down; a slow one shoves them off.
    for (const ped of this.peds) {
      if (ped.state === 'down' || ped.state === 'toCar') continue;
      for (const car of game.cars) {
        if (car.driver === 'none' && Math.hypot(car.vx, car.vy) < 4) continue;
        const rr = car.spec.w * 0.44 + 9;
        const dx = ped.x - car.x;
        const dy = ped.y - car.y;
        if (dx * dx + dy * dy < rr * rr) {
          const speed = Math.hypot(car.vx, car.vy);
          if (speed > 105) {
            this.knockDown(ped, game);
            game.audio.hitFlesh();
          } else {
            ped.state = 'flee';
            ped.fleeT = 1.6;
            ped.fleeX = car.x;
            ped.fleeY = car.y;
            ped.x += dx * 0.3;
            ped.y += dy * 0.3;
          }
          break;
        }
      }
    }
    this.peds = this.peds.filter((ped) => !ped.removeMe);
  }

  moveToward(ped, tx, ty, speed, dt) {
    const dx = tx - ped.x;
    const dy = ty - ped.y;
    const d = Math.hypot(dx, dy);
    if (d < 7) return true;
    ped.angle = Math.atan2(dy, dx);
    ped.x += (dx / d) * speed * dt;
    ped.y += (dy / d) * speed * dt;
    const resolved = this.city.collideCircle(ped.x, ped.y, 8);
    ped.x = resolved.x;
    ped.y = resolved.y;
    return false;
  }
}

function ringCorners(ring) {
  return [
    [ring.x, ring.y],
    [ring.x + ring.w, ring.y],
    [ring.x + ring.w, ring.y + ring.h],
    [ring.x, ring.y + ring.h],
  ];
}
