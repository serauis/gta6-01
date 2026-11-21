// vehicles.js — car objects and their arcade physics: acceleration, grip, handbrake drift,
// building collision and damage. Also the steering helper every driver (player, traffic,
// police) shares: given a target point, produce throttle/steer inputs for stepCar.

import { CAR_COLORS, CAR_TYPES } from './config.js';
import { angleDelta, clamp } from './random.js';

let nextCarId = 1;

export function createCar(city, { x, y, angle = 0, type = 'sedan', livery = 'civil', color = null, rng = null }) {
  const spec = CAR_TYPES[type];
  const car = {
    id: nextCarId++,
    x, y, angle,
    vx: 0, vy: 0,
    type, spec,
    livery,
    color: color || (rng ? rng.pick(CAR_COLORS) : '#e5484d'),
    health: spec.health,
    driver: 'none', // none | player | traffic | cop
    steerVis: 0, // front-wheel angle for the renderer
    throttleVis: 0,
    brakeVis: false,
    wrecked: false,
    missionTarget: false,
    traffic: false,
    police: false,
    blockedTime: 0,
    honkTime: 0,
  };
  // Never spawn inside a building: nudge out if the spot was bad.
  const resolved = city.collideCircle(x, y, spec.w * 0.36);
  car.x = resolved.x;
  car.y = resolved.y;
  return car;
}

export function carSpeed(car) {
  return Math.hypot(car.vx, car.vy);
}

export function forwardSpeed(car) {
  return car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
}

/**
 * Advance one car one step. control: {throttle: -1..1, steer: -1..1, handbrake: bool}.
 * Returns the impact speed if the car hit a building hard this step, else 0.
 */
export function stepCar(car, dt, control, city) {
  const spec = car.spec;
  if (car.wrecked) {
    car.vx *= 0.9;
    car.vy *= 0.9;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    return 0;
  }
  const fx = Math.cos(car.angle);
  const fy = Math.sin(car.angle);
  let vf = car.vx * fx + car.vy * fy; // forward speed
  let vl = -car.vx * fy + car.vy * fx; // lateral speed (slide)

  const throttle = clamp(control.throttle, -1, 1);
  vf += throttle * spec.accel * dt;
  vf -= vf * 0.55 * dt; // drag
  if (!control.handbrake && Math.abs(throttle) < 0.05) vf -= Math.sign(vf) * Math.min(Math.abs(vf), 26 * dt); // rolling stop
  const top = throttle < 0 ? -95 : spec.topSpeed;
  vf = clamp(vf, -95, spec.topSpeed);
  void top;

  const grip = control.handbrake ? spec.grip * 0.22 : spec.grip;
  vl -= vl * Math.min(1, grip * dt);

  const steerAuthority = clamp(vf / 130, -1, 1);
  const steer = clamp(control.steer, -1, 1);
  car.angle += steer * spec.turn * steerAuthority * dt * (control.handbrake ? 1.3 : 1);
  car.steerVis = steer;
  car.throttleVis = throttle;
  car.brakeVis = throttle < -0.05 && vf > 10 || (throttle > 0.05 && vf < -10);

  const nfx = Math.cos(car.angle);
  const nfy = Math.sin(car.angle);
  car.vx = nfx * vf - nfy * vl;
  car.vy = nfy * vf + nfx * vl;

  const beforeVx = car.vx;
  const beforeVy = car.vy;
  car.x += car.vx * dt;
  car.y += car.vy * dt;
  car.x = clamp(car.x, 74, city.W - 26); // the west edge is open water — cars stop at the shore
  car.y = clamp(car.y, 26, city.H - 26);

  const resolved = city.collideCircle(car.x, car.y, spec.w * 0.36);
  let impact = 0;
  if (resolved.hit) {
    car.x = resolved.x;
    car.y = resolved.y;
    const intoX = beforeVx;
    const intoY = beforeVy;
    impact = Math.hypot(intoX, intoY);
    // Bounce a little and kill most of the speed; hard hits cost health.
    car.vx = -intoX * 0.22;
    car.vy = -intoY * 0.22;
    if (impact > 130) damageCar(car, (impact - 130) * 0.11);
  }
  return impact;
}

export function damageCar(car, amount) {
  if (car.wrecked) return;
  car.health -= amount;
  if (car.health <= 0) {
    car.health = 0;
    car.wrecked = true;
  }
}

// Shared driver brain: steer toward a point, with a desired speed (px/s). Slows for sharp
// turns and when close to the target; reverses briefly if the target is right behind.
export function driveToward(car, tx, ty, dt, desiredSpeed = 999) {
  const dx = tx - car.x;
  const dy = ty - car.y;
  const distance = Math.hypot(dx, dy);
  const targetAngle = Math.atan2(dy, dx);
  const diff = angleDelta(car.angle, targetAngle);
  const steer = clamp(diff * 1.7, -1, 1);
  const vf = forwardSpeed(car);
  let throttle = 0;
  const speedTarget = Math.min(desiredSpeed, car.spec.topSpeed * (Math.abs(diff) > 0.9 ? 0.35 : 1));
  if (Math.abs(diff) > 2.4 && distance < 70 && vf < 20) {
    throttle = -0.7; // back up toward it
  } else if (vf < speedTarget) {
    throttle = distance < 26 && Math.abs(diff) < 0.4 ? 0.25 : 0.9;
  } else if (vf > speedTarget + 30) {
    throttle = -0.4;
  }
  return { throttle, steer, handbrake: false, distance, diff };
}

// Circle collision between two cars: push apart, trade some velocity, return impact speed.
export function collideCars(a, b) {
  const ra = a.spec.w * 0.4;
  const rb = b.spec.w * 0.4;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  const min = ra + rb;
  if (d === 0 || d >= min) return 0;
  const nx = dx / d;
  const ny = dy / d;
  const push = (min - d) / 2;
  a.x -= nx * push;
  a.y -= ny * push;
  b.x += nx * push;
  b.y += ny * push;
  const relVx = b.vx - a.vx;
  const relVy = b.vy - a.vy;
  const rel = relVx * nx + relVy * ny;
  if (rel < 0) {
    const impulse = -rel * 0.72;
    a.vx -= impulse * nx;
    a.vy -= impulse * ny;
    b.vx += impulse * nx;
    b.vy += impulse * ny;
    return -rel;
  }
  return 0;
}
