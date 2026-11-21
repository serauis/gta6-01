// combat.js — bullets and explosions. Shots are fast tracer rounds stepped in substeps so
// they cannot tunnel through walls or people; every hit is resolved here against buildings,
// cars, pedestrians, officers and the player, and reported back through the game's hooks.
// Explosions damage everything in a radius and can chain from wreck to wreck.

import { dist } from './random.js';
import { damageCar } from './vehicles.js';

const BULLET_SPEED = 980;

export class Combat {
  constructor(rng) {
    this.rng = rng;
    this.bullets = [];
    this.pendingBooms = []; // {x, y, t} — wrecks about to cook off
  }

  fire(game, x, y, angle, { from = 'player', damage = 26 } = {}) {
    const spread = this.rng.range(-0.045, 0.045);
    const a = angle + spread;
    this.bullets.push({
      x, y, px: x, py: y,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      life: 0.55, from, damage,
    });
    game.addFx('flash', x + Math.cos(angle) * 16, y + Math.sin(angle) * 16);
    if (dist(x, y, game.player.x, game.player.y) < 620) game.audio.shot();
    game.people.scare(x, y, 200);
  }

  explode(game, x, y, radius = 115) {
    game.addFx('boom', x, y, radius);
    game.audio.explosion();
    game.people.scare(x, y, 380);
    const hurt = (tx, ty, maxDamage) => {
      const d = dist(x, y, tx, ty);
      if (d >= radius) return 0;
      return maxDamage * (1 - d / radius);
    };
    for (const car of game.cars) {
      const dmg = hurt(car.x, car.y, 85);
      if (dmg > 0) {
        const wasWrecked = car.wrecked;
        damageCar(car, dmg);
        car.vx += (car.x - x) * 2.4;
        car.vy += (car.y - y) * 2.4;
        if (car.wrecked && !wasWrecked) this.pendingBooms.push({ x: car.x, y: car.y, t: 0.45 });
      }
    }
    for (const ped of game.people.peds) {
      if (ped.state !== 'down' && hurt(ped.x, ped.y, 100) > 12) game.people.knockDown(ped, game);
    }
    for (const officer of game.police.officers) {
      if (officer.state !== 'down' && hurt(officer.x, officer.y, 100) > 12) {
        officer.state = 'down';
        officer.hp = 0;
        officer.downT = 8;
        game.onOfficerDown(officer, true);
      }
    }
    const playerDmg = hurt(game.player.x, game.player.y, 65);
    if (playerDmg > 4 && !game.player.car) game.damagePlayer(playerDmg, x, y);
    if (game.player.car) {
      const carDmg = hurt(game.player.car.x, game.player.car.y, 50);
      if (carDmg > 0) damageCar(game.player.car, carDmg);
    }
  }

  update(game, dt) {
    for (const boom of this.pendingBooms) boom.t -= dt;
    const ready = this.pendingBooms.filter((b) => b.t <= 0);
    this.pendingBooms = this.pendingBooms.filter((b) => b.t > 0);
    for (const boom of ready) this.explode(game, boom.x, boom.y, 100);

    const city = game.city;
    for (const bullet of this.bullets) {
      bullet.life -= dt;
      bullet.px = bullet.x;
      bullet.py = bullet.y;
      const steps = 2;
      let dead = false;
      for (let s = 0; s < steps && !dead; s++) {
        bullet.x += (bullet.vx * dt) / steps;
        bullet.y += (bullet.vy * dt) / steps;
        if (city.pointInBuilding(bullet.x, bullet.y, 0)) {
          game.addFx('spark', bullet.x, bullet.y);
          dead = true;
          break;
        }
        // Cars
        for (const car of game.cars) {
          if (dist(bullet.x, bullet.y, car.x, car.y) < car.spec.w * 0.46) {
            game.addFx('spark', bullet.x, bullet.y);
            const wasWrecked = car.wrecked;
            damageCar(car, bullet.damage * 0.45);
            if (car.wrecked && !wasWrecked) {
              this.pendingBooms.push({ x: car.x, y: car.y, t: 0.5 });
              game.onCarWrecked(car, bullet.from === 'player');
            }
            if (bullet.from === 'player' && car.driver === 'traffic') car.ai.panicT = 3;
            dead = true;
            break;
          }
        }
        if (dead) break;
        // The player, on foot, shot by an officer
        if (bullet.from === 'cop' && !game.player.car && dist(bullet.x, bullet.y, game.player.x, game.player.y) < 13) {
          game.damagePlayer(bullet.damage, bullet.x - bullet.vx * 0.1, bullet.y - bullet.vy * 0.1);
          dead = true;
          break;
        }
        // Pedestrians and officers, shot by the player
        if (bullet.from === 'player') {
          for (const ped of game.people.peds) {
            if (ped.state === 'down') continue;
            if (dist(bullet.x, bullet.y, ped.x, ped.y) < 10) {
              ped.hp -= bullet.damage * 2.2;
              game.audio.hitFlesh();
              if (ped.hp <= 0) game.people.knockDown(ped, game);
              else {
                ped.state = 'flee';
                ped.fleeT = 3;
                ped.fleeX = bullet.x;
                ped.fleeY = bullet.y;
              }
              dead = true;
              break;
            }
          }
          if (dead) break;
          for (const officer of game.police.officers) {
            if (officer.state === 'down') continue;
            if (dist(bullet.x, bullet.y, officer.x, officer.y) < 11) {
              officer.hp -= bullet.damage * 2.2;
              if (officer.hp <= 0) {
                officer.state = 'down';
                officer.hp = 0;
                officer.downT = 8;
                game.onOfficerDown(officer, true);
              }
              dead = true;
              break;
            }
          }
        }
      }
      if (dead) bullet.life = 0;
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }
}
