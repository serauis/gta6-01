// render.js — everything the player sees, painted on the 2D canvas: the city from the top
// down (water, sand, roads with lane dashes and crosswalks, sidewalks, buildings with
// parapet roofs, palms and props), the cars with their liveries, the people, bullets and
// effects, a day/night tint with lamp glow and headlights, the objective beacon, and the
// minimap. The camera follows the player and everything off-screen is culled.

import { PALETTE, ROAD_W, SIDEWALK, VIEW_H, VIEW_W } from './config.js';
import { clamp, lerp } from './random.js';

// Darken or lighten a #rrggbb colour by a factor.
export function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

function hash(n) {
  let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class Renderer {
  constructor(canvas, minimapCanvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.mctx = minimapCanvas.getContext('2d');
    this.time = 0;
    this.buildingsSorted = null;
    // A soft radial glow sprite, reused for lamps, headlights and flashes.
    this.glow = document.createElement('canvas');
    this.glow.width = 128;
    this.glow.height = 128;
    const g = this.glow.getContext('2d');
    const grad = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,0.85)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }

  daylight(dayT) {
    const sun = Math.sin((dayT - 0.25) * Math.PI * 2);
    return { sun, light: clamp(sun * 1.5 + 0.3, 0.05, 1) };
  }

  draw(game) {
    const { ctx } = this;
    const city = game.city;
    const focus = game.player.car || game.player;
    const cam = {
      x: clamp(focus.x - VIEW_W / 2, 0, Math.max(0, city.W - VIEW_W)),
      y: clamp(focus.y - VIEW_H / 2, 0, Math.max(0, city.H - VIEW_H)),
    };
    game.camera = cam;
    const { light, sun } = this.daylight(game.dayT);
    const view = { x: cam.x - 90, y: cam.y - 90, w: VIEW_W + 180, h: VIEW_H + 180 };
    const inView = (x, y, m = 0) => x > view.x - m && x < view.x + view.w + m && y > view.y - m && y < view.y + view.h + m;

    ctx.save();
    ctx.translate(-cam.x, -cam.y);
    this.drawGround(game, view);
    this.drawRoads(game, view);
    this.drawCells(game, view);
    this.drawProps(game, view, inView);
    this.drawPickups(game, inView);
    this.drawBeacon(game);
    this.drawBuildings(game, view, inView);
    this.drawSkids(game);
    for (const car of [...game.cars].sort((a, b) => a.y - b.y)) {
      if (inView(car.x, car.y, 70)) this.drawCar(game, car, light);
    }
    this.drawPeople(game, inView);
    this.drawBullets(game);
    this.drawFx(game);
    ctx.restore();

    // Channel progress (bank grab) as a ring around the screen centre.
    if (game.channel) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)';
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(VIEW_W / 2, VIEW_H / 2 + 60, 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = '#ffd75e';
      ctx.beginPath();
      ctx.arc(VIEW_W / 2, VIEW_H / 2 + 60, 30, -Math.PI / 2, -Math.PI / 2 + game.channel.t * Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = '700 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(game.channel.label, VIEW_W / 2, VIEW_H / 2 + 116);
      ctx.restore();
    }

    this.drawNight(game, cam, light, sun, inView);
    this.drawMinimap(game);
  }

  drawGround(game, view) {
    const { ctx } = this;
    const city = game.city;
    ctx.fillStyle = PALETTE.water;
    ctx.fillRect(view.x, view.y, view.w, view.h);
    // Water shimmer: short drifting strokes.
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < 26; i++) {
      const x = hash(i * 3 + Math.floor(this.time * 0.4)) * 60 + (Math.sin(this.time * 0.7 + i) * 3);
      const y = ((i * 173 + Math.floor(this.time * 12)) % Math.max(1, Math.floor(view.h))) + view.y;
      if (x < view.x + view.w) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + 22, y);
      }
    }
    ctx.stroke();
    // Land
    ctx.fillStyle = PALETTE.grass;
    ctx.fillRect(64, view.y, city.W - 64, view.h);
    // Sand beach
    ctx.fillStyle = PALETTE.sand;
    ctx.fillRect(64, view.y, 92, view.h);
    ctx.fillStyle = PALETTE.sandDark;
    ctx.fillRect(148, view.y, 6, view.h);
    // Docks concrete
    ctx.fillStyle = '#a9a294';
    ctx.fillRect(300, city.hz[city.hz.length - 1] + ROAD_W / 2, city.W - 300, city.H);
    // Two boats riding the bay, bobbing on the swell: the water is a place too.
    this.drawBoat(30, city.hz[1] + 150, '#e5484d');
    this.drawBoat(25, city.hz[3] + 40, '#f7f0e1');
  }

  drawBoat(x, y, color) {
    const { ctx } = this;
    const bob = Math.sin(this.time * 0.9 + y) * 2;
    ctx.save();
    ctx.translate(x, y + bob);
    // Wake: two fading strokes astern.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-14, 7);
    ctx.lineTo(-30 - Math.sin(this.time * 1.3 + y) * 3, 11);
    ctx.moveTo(-14, -7);
    ctx.lineTo(-30 - Math.cos(this.time * 1.1 + y) * 3, -11);
    ctx.stroke();
    // Hull and cabin.
    ctx.fillStyle = 'rgba(20,40,50,0.25)';
    ctx.beginPath();
    ctx.ellipse(2, 4, 19, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-17, -6, 34, 12, 5);
    ctx.fill();
    ctx.fillStyle = '#f7f0e1';
    ctx.fillRect(-5, -4, 11, 8);
    ctx.fillStyle = '#274b73';
    ctx.fillRect(-3, -3, 4, 6);
    ctx.restore();
  }

  drawRoads(game, view) {
    const { ctx } = this;
    const city = game.city;
    ctx.fillStyle = PALETTE.asphalt;
    for (const x of city.vx) ctx.fillRect(x - ROAD_W / 2, 26, ROAD_W, city.H - 52);
    for (const y of city.hz) ctx.fillRect(66, y - ROAD_W / 2, city.W - 96, ROAD_W);
    // Edge lines
    ctx.fillStyle = PALETTE.curb;
    for (const x of city.vx) {
      ctx.fillRect(x - ROAD_W / 2, 26, 2, city.H - 52);
      ctx.fillRect(x + ROAD_W / 2 - 2, 26, 2, city.H - 52);
    }
    for (const y of city.hz) {
      ctx.fillRect(66, y - ROAD_W / 2, city.W - 96, 2);
      ctx.fillRect(66, y + ROAD_W / 2 - 2, city.W - 96, 2);
    }
    // Lane dashes, skipping intersections
    ctx.fillStyle = PALETTE.laneMark;
    for (const x of city.vx) {
      for (let y = 40; y < city.H - 40; y += 48) {
        if (city.hz.some((ry) => Math.abs(y - ry) < ROAD_W / 2 + 8)) continue;
        if (y > view.y - 40 && y < view.y + view.h) ctx.fillRect(x - 2, y, 4, 24);
      }
    }
    for (const y of city.hz) {
      for (let x = 90; x < city.W - 40; x += 48) {
        if (city.vx.some((rx) => Math.abs(x - rx) < ROAD_W / 2 + 8)) continue;
        if (x > view.x - 40 && x < view.x + view.w) ctx.fillRect(x, y - 2, 24, 4);
      }
    }
    // Crosswalks at intersections in view
    ctx.fillStyle = 'rgba(240,240,235,0.75)';
    for (const x of city.vx) {
      for (const y of city.hz) {
        if (x < view.x - 60 || x > view.x + view.w + 60 || y < view.y - 60 || y > view.y + view.h + 60) continue;
        for (let i = -2; i <= 2; i++) {
          ctx.fillRect(x + i * 13 - 4, y - ROAD_W / 2 - 9, 8, 6);
          ctx.fillRect(x + i * 13 - 4, y + ROAD_W / 2 + 3, 8, 6);
          ctx.fillRect(x - ROAD_W / 2 - 9, y + i * 13 - 4, 6, 8);
          ctx.fillRect(x + ROAD_W / 2 + 3, y + i * 13 - 4, 6, 8);
        }
      }
    }
  }

  drawCells(game, view) {
    const { ctx } = this;
    for (const cell of game.city.cells) {
      if (cell.x + cell.w < view.x || cell.x > view.x + view.w || cell.y + cell.h < view.y || cell.y > view.y + view.h) continue;
      ctx.fillStyle = PALETTE.sidewalk;
      ctx.fillRect(cell.x - SIDEWALK, cell.y - SIDEWALK, cell.w + SIDEWALK * 2, cell.h + SIDEWALK * 2);
      if (cell.kind === 'park') {
        ctx.fillStyle = PALETTE.park;
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(cell.x, cell.y + cell.h / 2);
        ctx.lineTo(cell.x + cell.w, cell.y + cell.h / 2);
        ctx.moveTo(cell.x + cell.w / 2, cell.y);
        ctx.lineTo(cell.x + cell.w / 2, cell.y + cell.h);
        ctx.stroke();
        // Flower beds in the quadrants: seeded dots of colour, so a park reads as tended.
        const FLOWERS = ['#ef6aa5', '#ffd75e', '#e5484d', '#f7f0e1'];
        for (let i = 0; i < 12; i++) {
          const fx = cell.x + 16 + hash(cell.x * 3 + i * 17) * (cell.w - 32);
          const fy = cell.y + 16 + hash(cell.y * 5 + i * 23) * (cell.h - 32);
          if (Math.abs(fx - (cell.x + cell.w / 2)) < 14 || Math.abs(fy - (cell.y + cell.h / 2)) < 14) continue;
          ctx.fillStyle = FLOWERS[i % FLOWERS.length];
          ctx.beginPath();
          ctx.arc(fx, fy, 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (cell.kind === 'parking') {
        ctx.fillStyle = PALETTE.asphaltDark;
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
        ctx.strokeStyle = 'rgba(255,255,255,0.35)';
        ctx.lineWidth = 2;
        for (let x = cell.x + 12; x < cell.x + cell.w - 8; x += 46) {
          ctx.strokeRect(x, cell.y + cell.h / 2 - 24, 40, 48);
        }
      } else if (cell.kind === 'plaza') {
        ctx.fillStyle = PALETTE.plaza;
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
        ctx.strokeStyle = 'rgba(120,90,40,0.16)';
        ctx.lineWidth = 1;
        for (let x = cell.x + 22; x < cell.x + cell.w; x += 22) {
          ctx.beginPath(); ctx.moveTo(x, cell.y); ctx.lineTo(x, cell.y + cell.h); ctx.stroke();
        }
        for (let y = cell.y + 22; y < cell.y + cell.h; y += 22) {
          ctx.beginPath(); ctx.moveTo(cell.x, y); ctx.lineTo(cell.x + cell.w, y); ctx.stroke();
        }
        // The plaza fountain: a stone ring, animated ripples, a bright jet at the centre.
        const fx = cell.x + cell.w / 2;
        const fy = cell.y + cell.h / 2;
        ctx.fillStyle = 'rgba(60,45,20,0.18)';
        ctx.beginPath();
        ctx.ellipse(fx + 3, fy + 5, 30, 30, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#a89a7d';
        ctx.beginPath();
        ctx.arc(fx, fy, 28, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#4fb8c9';
        ctx.beginPath();
        ctx.arc(fx, fy, 21, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1.6;
        for (let k = 0; k < 2; k++) {
          const rr = 4 + ((this.time * 9 + k * 8) % 15);
          ctx.globalAlpha = 1 - rr / 20;
          ctx.beginPath();
          ctx.arc(fx, fy, rr, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#eafcff';
        ctx.beginPath();
        ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = '#c8b995';
        ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
      }
    }
  }

  drawProps(game, view, inView) {
    const { ctx } = this;
    for (const prop of game.city.props) {
      if (!inView(prop.x, prop.y, 40)) continue;
      if (prop.kind === 'palm') {
        ctx.strokeStyle = PALETTE.palmTrunk;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(prop.x, prop.y);
        ctx.quadraticCurveTo(prop.x + 3, prop.y - 8, prop.x + 6, prop.y - 15);
        ctx.stroke();
        const sway = Math.sin(this.time * 1.2 + prop.sway) * 2;
        ctx.strokeStyle = PALETTE.palmLeaf;
        ctx.lineWidth = 3;
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 + prop.sway;
          ctx.beginPath();
          ctx.moveTo(prop.x + 6, prop.y - 15);
          ctx.quadraticCurveTo(
            prop.x + 6 + Math.cos(a) * 13 + sway, prop.y - 15 + Math.sin(a) * 6 - 4,
            prop.x + 6 + Math.cos(a) * 21 + sway, prop.y - 15 + Math.sin(a) * 11 + 5,
          );
          ctx.stroke();
        }
      } else if (prop.kind === 'crate') {
        ctx.fillStyle = '#a4713d';
        ctx.fillRect(prop.x - 9, prop.y - 9, 18, 18);
        ctx.strokeStyle = 'rgba(60,35,10,0.5)';
        ctx.lineWidth = 2;
        ctx.strokeRect(prop.x - 9, prop.y - 9, 18, 18);
      } else if (prop.kind === 'container') {
        const colors = ['#c96f4a', '#4a7fc9', '#5da85d', '#b0526b'];
        ctx.fillStyle = colors[Math.floor(hash(prop.x) * 4)];
        ctx.fillRect(prop.x - 26, prop.y - 11, 52, 22);
        ctx.strokeStyle = 'rgba(0,0,0,0.25)';
        ctx.lineWidth = 2;
        for (let i = -2; i <= 2; i++) {
          ctx.beginPath();
          ctx.moveTo(prop.x + i * 10, prop.y - 11);
          ctx.lineTo(prop.x + i * 10, prop.y + 11);
          ctx.stroke();
        }
      } else if (prop.kind === 'lamp') {
        ctx.fillStyle = '#5c6068';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffe9a8';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'umbrella') {
        // A beach umbrella from above: striped canopy, a soft shadow, the pole at centre.
        ctx.fillStyle = 'rgba(60,40,10,0.20)';
        ctx.beginPath();
        ctx.ellipse(prop.x + 4, prop.y + 5, 13, 11, 0, 0, Math.PI * 2);
        ctx.fill();
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i % 2 === 0 ? prop.color : '#f7f0e1';
          ctx.beginPath();
          ctx.moveTo(prop.x, prop.y);
          ctx.arc(prop.x, prop.y, 12.5, (i / 6) * Math.PI * 2, ((i + 1) / 6) * Math.PI * 2);
          ctx.closePath();
          ctx.fill();
        }
        ctx.fillStyle = '#6b4a2a';
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, 1.8, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'bench') {
        ctx.save();
        ctx.translate(prop.x, prop.y);
        ctx.rotate(prop.angle || 0);
        ctx.fillStyle = 'rgba(60,40,10,0.20)';
        ctx.fillRect(-11, -3, 22, 8);
        ctx.fillStyle = '#8a6b46';
        ctx.fillRect(-11, -4.5, 22, 2.6);
        ctx.fillRect(-11, -1, 22, 2.6);
        ctx.fillRect(-11, 2.5, 22, 2.6);
        ctx.fillStyle = '#4c4438';
        ctx.fillRect(-11, -5.5, 22, 1.2);
        ctx.fillRect(-11, 5, 22, 1.2);
        ctx.restore();
      }
    }
  }

  drawPickups(game, inView) {
    const { ctx } = this;
    for (const pickup of game.city.pickups) {
      if (pickup.taken || !inView(pickup.x, pickup.y, 30)) continue;
      const bob = Math.sin(this.time * 3 + pickup.x) * 3;
      const y = pickup.y + bob;
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pickup.x, pickup.y, 13 + Math.sin(this.time * 3) * 2, 0, Math.PI * 2);
      ctx.stroke();
      if (pickup.kind === 'package') {
        ctx.fillStyle = '#d9a441';
        ctx.fillRect(pickup.x - 8, y - 8, 16, 16);
        ctx.strokeStyle = '#8a5f14';
        ctx.strokeRect(pickup.x - 8, y - 8, 16, 16);
        ctx.beginPath();
        ctx.moveTo(pickup.x - 8, y);
        ctx.lineTo(pickup.x + 8, y);
        ctx.stroke();
      } else if (pickup.kind === 'health') {
        ctx.fillStyle = '#f7f0e1';
        ctx.fillRect(pickup.x - 9, y - 9, 18, 18);
        ctx.fillStyle = '#e5484d';
        ctx.fillRect(pickup.x - 2.5, y - 6, 5, 12);
        ctx.fillRect(pickup.x - 6, y - 2.5, 12, 5);
      } else if (pickup.kind === 'weapon') {
        ctx.fillStyle = '#33383f';
        ctx.fillRect(pickup.x - 10, y - 7, 20, 14);
        ctx.fillStyle = '#c8ccd2';
        ctx.fillRect(pickup.x - 7, y - 2, 13, 4);
        ctx.fillRect(pickup.x + 3, y + 2, 4, 6);
      } else if (pickup.kind === 'ammo') {
        ctx.fillStyle = '#3f7d3c';
        ctx.fillRect(pickup.x - 9, y - 7, 18, 14);
        ctx.fillStyle = '#ffd75e';
        for (let i = -1; i <= 1; i++) ctx.fillRect(pickup.x + i * 5 - 1.5, y - 4, 3, 8);
      }
    }
  }

  drawBeacon(game) {
    const objective = game.missions.currentObjective(game);
    if (!objective) return;
    const { ctx } = this;
    const pulse = 0.14 + Math.sin(this.time * 4) * 0.05;
    const grad = ctx.createLinearGradient(0, objective.y - 300, 0, objective.y);
    grad.addColorStop(0, 'rgba(255,215,94,0)');
    grad.addColorStop(1, `rgba(255,215,94,${pulse + 0.12})`);
    ctx.fillStyle = grad;
    ctx.fillRect(objective.x - 13, objective.y - 300, 26, 300);
    ctx.strokeStyle = 'rgba(255,215,94,0.8)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(objective.x, objective.y, 20 + Math.sin(this.time * 4) * 4, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawBuildings(game, view, inView) {
    const { ctx } = this;
    if (!this.buildingsSorted) {
      this.buildingsSorted = [...game.city.buildings].sort((a, b) => (a.y + a.h) - (b.y + b.h));
    }
    for (const b of this.buildingsSorted) {
      if (b.x + b.w < view.x || b.x > view.x + view.w || b.y + b.h < view.y || b.y > view.y + view.h) continue;
      ctx.fillStyle = 'rgba(50,30,10,0.25)';
      ctx.fillRect(b.x + 9, b.y + 11, b.w, b.h);
      ctx.fillStyle = shade(b.roof, 0.6);
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      ctx.strokeStyle = 'rgba(0,0,0,0.18)';
      ctx.lineWidth = 2;
      ctx.strokeRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
      if (b.storeys >= 3) {
        ctx.fillStyle = shade(b.roof, 0.78);
        const ax = b.x + 14 + hash(b.x) * Math.max(1, b.w - 44);
        const ay = b.y + 14 + hash(b.y) * Math.max(1, b.h - 44);
        ctx.fillRect(ax, ay, 17, 13);
        if (b.storeys >= 5) ctx.fillRect(b.x + b.w - 34, b.y + b.h - 30, 15, 12);
      }
      // Sun-bleach: one quadrant of the roof faded harder than the rest.
      const bleach = hash(b.x * 1.7 + b.y * 0.3);
      if (bleach > 0.45 && b.w > 60 && b.h > 60) {
        ctx.fillStyle = 'rgba(255,250,235,0.10)';
        const bw = (b.w - 10) / 2;
        const bh = (b.h - 10) / 2;
        ctx.fillRect(b.x + 5 + (bleach > 0.72 ? bw : 0), b.y + 5 + (bleach > 0.72 ? 0 : bh), bw, bh);
      }
      // Vent pipes on anything two storeys up.
      if (b.storeys >= 2) {
        const vents = 1 + Math.floor(hash(b.x + b.y) * 3);
        for (let i = 0; i < vents; i++) {
          const vx2 = b.x + 13 + hash(b.x * 3 + i * 29) * Math.max(1, b.w - 30);
          const vy2 = b.y + 13 + hash(b.y * 3 + i * 41) * Math.max(1, b.h - 30);
          ctx.fillStyle = 'rgba(0,0,0,0.16)';
          ctx.beginPath();
          ctx.arc(vx2 + 1.5, vy2 + 2, 3.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = shade(b.roof, 0.55);
          ctx.beginPath();
          ctx.arc(vx2, vy2, 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // A water tank crowns the tall blocks.
      if (b.storeys >= 5) {
        const tx = b.x + b.w - 24;
        const ty = b.y + 22;
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.beginPath();
        ctx.arc(tx + 2, ty + 3, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9a7b58';
        ctx.beginPath();
        ctx.arc(tx, ty, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#7d6244';
        ctx.beginPath();
        ctx.arc(tx, ty, 4.5, 0, Math.PI * 2);
        ctx.fill();
      } else if (b.storeys >= 3 && hash(b.y * 2.1 + b.x) < 0.34 && b.w > 90) {
        // Solar panels: a dark blue grid catching the sun.
        const px = b.x + 12 + hash(b.x * 5) * Math.max(1, b.w - 60);
        const py = b.y + 12 + hash(b.y * 5) * Math.max(1, b.h - 44);
        ctx.fillStyle = '#274b73';
        ctx.fillRect(px, py, 36, 22);
        ctx.strokeStyle = 'rgba(190,225,255,0.4)';
        ctx.lineWidth = 1;
        for (let gx = 1; gx < 4; gx++) {
          ctx.beginPath(); ctx.moveTo(px + gx * 9, py); ctx.lineTo(px + gx * 9, py + 22); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(px, py + 11); ctx.lineTo(px + 36, py + 11); ctx.stroke();
      }
      // A roof garden softens the low, wide blocks.
      if (b.storeys <= 2 && b.w > 120 && hash(b.x * 0.7 + b.y * 1.3) < 0.3) {
        const gx = b.x + b.w * 0.18;
        const gy = b.y + b.h * 0.16;
        const gw = b.w * 0.34;
        const gh = b.h * 0.3;
        ctx.fillStyle = '#6db85e';
        ctx.fillRect(gx, gy, gw, gh);
        ctx.fillStyle = '#3f9e4d';
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          ctx.arc(gx + 6 + hash(b.x + i * 13) * (gw - 12), gy + 6 + hash(b.y + i * 7) * (gh - 12), 3.4, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      // A striped storefront awning over the pavement on the street side.
      if (b.kind !== 'warehouse' && hash(b.x * 2.3 + b.y * 0.9) < 0.6) {
        const aw = b.w * 0.66;
        const ax = b.x + (b.w - aw) / 2;
        const ay = b.y + b.h;
        for (let sx = 0; sx < aw; sx += 9) {
          ctx.fillStyle = Math.floor(sx / 9) % 2 === 0 ? shade(b.roof, 0.82) : '#f3e6cf';
          ctx.fillRect(ax + sx, ay, Math.min(9, aw - sx), 9);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(ax, ay + 9, aw, 3);
      }
      if (b.label) {
        const cx = b.x + b.w / 2;
        const cy = b.y + b.h / 2;
        const d = Math.hypot(cx - (game.camera.x + VIEW_W / 2), cy - (game.camera.y + VIEW_H / 2));
        if (d < 640) {
          ctx.font = '700 13px system-ui, sans-serif';
          ctx.textAlign = 'center';
          ctx.lineWidth = 4;
          ctx.strokeStyle = 'rgba(20,16,8,0.65)';
          const labelY = b.y - 8;
          ctx.strokeText(b.label, cx, labelY);
          ctx.fillStyle = '#fff7e0';
          ctx.fillText(b.label, cx, labelY);
        }
      }
      void inView;
    }
  }

  drawSkids(game) {
    const { ctx } = this;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    for (const skid of game.skids) {
      ctx.strokeStyle = `rgba(22,22,22,${skid.a})`;
      ctx.beginPath();
      ctx.moveTo(skid.x1, skid.y1);
      ctx.lineTo(skid.x2, skid.y2);
      ctx.stroke();
    }
  }

  drawCar(game, car, light) {
    const { ctx } = this;
    const { w, h } = car.spec;
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.fillStyle = 'rgba(30,20,10,0.3)';
    ctx.beginPath();
    ctx.ellipse(4, 6, w * 0.55, h * 0.75, car.angle, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(car.angle);
    // Wheels
    ctx.fillStyle = '#15161a';
    const wy = h / 2 - 1;
    ctx.fillRect(-w * 0.32, -wy - 2, 11, 4.5);
    ctx.fillRect(-w * 0.32, wy - 2.5, 11, 4.5);
    ctx.save();
    ctx.translate(w * 0.3, -wy);
    ctx.rotate(car.steerVis * 0.45);
    ctx.fillRect(-5.5, -2.2, 11, 4.5);
    ctx.restore();
    ctx.save();
    ctx.translate(w * 0.3, wy);
    ctx.rotate(car.steerVis * 0.45);
    ctx.fillRect(-5.5, -2.2, 11, 4.5);
    ctx.restore();
    // Body
    ctx.fillStyle = car.livery === 'police' ? '#20242c' : car.color;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, 6);
    ctx.fill();
    if (car.livery === 'police') {
      ctx.fillStyle = '#f2f2ee';
      ctx.fillRect(-w * 0.18, -h / 2, w * 0.4, h);
      // Light bar, flashing
      const phase = Math.floor(this.time * 5 + car.id) % 2 === 0;
      ctx.fillStyle = phase ? '#ff4b4b' : 'rgba(255,75,75,0.35)';
      ctx.fillRect(-4, -h / 2 + 2, 8, h / 2 - 2);
      ctx.fillStyle = phase ? 'rgba(80,140,255,0.35)' : '#508cff';
      ctx.fillRect(-4, 0, 8, h / 2 - 2);
    }
    if (car.livery === 'taxi') {
      ctx.fillStyle = '#ffd75e';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = car.color;
      ctx.fillRect(-w / 2, -h / 2, w * 0.22, h);
      ctx.fillRect(w * 0.3, -h / 2, w * 0.2, h);
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(-6, -5, 12, 10);
      ctx.fillStyle = '#8a6d1f';
      ctx.font = '700 7px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TAXI', 0, 2.5);
    }
    if (car.type === 'sport') {
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillRect(-w / 2, -2, w, 4);
      ctx.fillStyle = shade(car.color, 0.7);
      ctx.fillRect(-w / 2 - 2, -h / 2 + 1, 5, h - 2);
    }
    if (car.type === 'truck') {
      ctx.fillStyle = shade(car.color, 1.25);
      ctx.fillRect(-w / 2, -h / 2 + 1, w * 0.62, h - 2);
      ctx.fillStyle = 'rgba(0,0,0,0.15)';
      ctx.fillRect(-w / 2 + 6, -h / 2 + 4, 3, h - 8);
      ctx.fillRect(-w / 2 + 16, -h / 2 + 4, 3, h - 8);
    }
    // Cabin
    ctx.fillStyle = 'rgba(24,34,48,0.92)';
    ctx.beginPath();
    ctx.roundRect(-w * 0.14, -h / 2 + 3.5, w * 0.32, h - 7, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(160,210,240,0.5)';
    ctx.fillRect(w * 0.13, -h / 2 + 4.5, 3.5, h - 9);
    // Lights
    ctx.fillStyle = light < 0.55 ? '#fff6c9' : 'rgba(255,246,201,0.55)';
    ctx.fillRect(w / 2 - 2, -h / 2 + 2, 2.5, 4);
    ctx.fillRect(w / 2 - 2, h / 2 - 6, 2.5, 4);
    ctx.fillStyle = car.brakeVis ? '#ff2d2d' : 'rgba(200,40,40,0.6)';
    ctx.fillRect(-w / 2, -h / 2 + 2, 2.5, 4);
    ctx.fillRect(-w / 2, h / 2 - 6, 2.5, 4);
    if (car.missionTarget) {
      ctx.strokeStyle = `rgba(255,215,94,${0.65 + Math.sin(this.time * 5) * 0.3})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 8);
      ctx.stroke();
    }
    ctx.restore();
    // Damage smoke is emitted as effects by the game; a wreck gets a scorch mark.
    if (car.wrecked) {
      ctx.fillStyle = 'rgba(15,12,10,0.35)';
      ctx.beginPath();
      ctx.ellipse(car.x, car.y, w * 0.6, h * 0.8, car.angle, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  drawPeople(game, inView) {
    const { ctx } = this;
    const drawFigure = (x, y, angle, phase, shirt, skin, opts = {}) => {
      ctx.fillStyle = 'rgba(30,20,10,0.28)';
      ctx.beginPath();
      ctx.ellipse(x + 2, y + 3, 9, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      if (opts.down) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle + Math.PI / 2);
        ctx.fillStyle = shirt;
        ctx.beginPath();
        ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = skin;
        ctx.beginPath();
        ctx.arc(13, 0, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      const bob = Math.sin(phase) * 1.4;
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.arc(x, y + bob * 0.3, 7.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(x + Math.cos(angle) * 2.5, y + Math.sin(angle) * 2.5 + bob * 0.3, 4.3, 0, Math.PI * 2);
      ctx.fill();
      if (opts.cap) {
        ctx.fillStyle = opts.cap;
        ctx.beginPath();
        ctx.arc(x + Math.cos(angle) * 2.5, y + Math.sin(angle) * 2.5 + bob * 0.3, 4.4, angle - 2.2, angle + 2.2);
        ctx.fill();
      }
    };

    for (const ped of game.people.peds) {
      if (!inView(ped.x, ped.y, 30)) continue;
      if (ped.state === 'down') {
        ctx.globalAlpha = clamp(ped.downT / 2.5, 0, 1);
        drawFigure(ped.x, ped.y, ped.angle, 0, ped.shirt, ped.skin, { down: true });
        ctx.globalAlpha = 1;
        continue;
      }
      if (ped.isPassenger && ped.state === 'stand') {
        ctx.strokeStyle = 'rgba(255,215,94,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ped.x, ped.y, 13 + Math.sin(this.time * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
      }
      drawFigure(ped.x, ped.y, ped.angle, ped.phase, ped.shirt, ped.skin);
    }
    for (const officer of game.police.officers) {
      if (!inView(officer.x, officer.y, 30)) continue;
      if (officer.state === 'down') {
        ctx.globalAlpha = clamp(officer.downT / 2.5, 0, 1);
        drawFigure(officer.x, officer.y, officer.angle, 0, '#2c3e6b', '#e8b08a', { down: true });
        ctx.globalAlpha = 1;
        continue;
      }
      drawFigure(officer.x, officer.y, officer.angle, officer.phase, '#2c3e6b', '#e8b08a', { cap: '#1d2a4a' });
    }
    // The player, when on foot.
    const player = game.player;
    if (!player.car) {
      drawFigure(player.x, player.y, player.angle, player.walkPhase, '#12b5a5', '#c68863', { cap: '#f7f0e1' });
      if (game.weapon.have) {
        const aim = player.aimAngle;
        ctx.strokeStyle = '#22262c';
        ctx.lineWidth = 3.5;
        ctx.beginPath();
        ctx.moveTo(player.x + Math.cos(aim) * 6, player.y + Math.sin(aim) * 6);
        ctx.lineTo(player.x + Math.cos(aim) * 17, player.y + Math.sin(aim) * 17);
        ctx.stroke();
      }
      // A small marker so Rico is never lost in a crowd.
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath();
      const bounce = Math.sin(this.time * 3) * 2;
      ctx.moveTo(player.x, player.y - 16 + bounce);
      ctx.lineTo(player.x - 5, player.y - 23 + bounce);
      ctx.lineTo(player.x + 5, player.y - 23 + bounce);
      ctx.closePath();
      ctx.fill();
    }
  }

  drawBullets(game) {
    const { ctx } = this;
    ctx.strokeStyle = 'rgba(255,238,170,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const b of game.combat.bullets) {
      ctx.moveTo(b.px, b.py);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
  }

  drawFx(game) {
    const { ctx } = this;
    for (const fx of game.fx) {
      const t = fx.t / fx.life;
      if (fx.kind === 'flash') {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = '#ffd75e';
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, 7 * (1 - t) + 2, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'spark') {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = '#ffcf6e';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          const a = fx.seed + i * 2.1;
          ctx.moveTo(fx.x, fx.y);
          ctx.lineTo(fx.x + Math.cos(a) * 9 * (1 - t * 0.4), fx.y + Math.sin(a) * 9 * (1 - t * 0.4));
        }
        ctx.stroke();
      } else if (fx.kind === 'smoke') {
        ctx.globalAlpha = 0.34 * (1 - t);
        ctx.fillStyle = fx.dark ? '#2c2c30' : '#9aa0a3';
        ctx.beginPath();
        ctx.arc(fx.x, fx.y - t * 26, 6 + t * 15, 0, Math.PI * 2);
        ctx.fill();
      } else if (fx.kind === 'boom') {
        const r = (fx.radius || 110) * Math.min(1, t * 2.4);
        ctx.globalAlpha = 0.75 * (1 - t);
        ctx.fillStyle = t < 0.4 ? '#ffb347' : '#e5533c';
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r * 0.62, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.9 * (1 - t);
        ctx.strokeStyle = '#ffe9a8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(fx.x, fx.y, r, 0, Math.PI * 2);
        ctx.stroke();
      } else if (fx.kind === 'text') {
        ctx.globalAlpha = 1 - t;
        ctx.fillStyle = fx.color || '#7be495';
        ctx.font = '700 16px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(fx.str, fx.x, fx.y - t * 34);
      }
      ctx.globalAlpha = 1;
    }
  }

  drawNight(game, cam, light, sun, inView) {
    const { ctx } = this;
    if (sun < 0.32) {
      // Dusk warmth near the horizon hours.
      const dusk = clamp(1 - Math.abs(sun - 0.05) / 0.3, 0, 1);
      if (dusk > 0) {
        ctx.fillStyle = `rgba(255,116,44,${dusk * 0.10})`;
        ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      }
    }
    if (light >= 0.92) return;
    const alpha = (0.92 - light) * 0.52;
    ctx.fillStyle = `rgba(13,16,46,${alpha})`;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Lamp pools
    for (const prop of game.city.props) {
      if (prop.kind !== 'lamp' || !inView(prop.x, prop.y, 60)) continue;
      ctx.globalAlpha = alpha * 1.15;
      ctx.drawImage(this.glow, prop.x - cam.x - 54, prop.y - cam.y - 54, 108, 108);
    }
    // Headlights for driven cars
    for (const car of game.cars) {
      if (car.driver === 'none' || !inView(car.x, car.y, 130)) continue;
      ctx.globalAlpha = alpha * 0.8;
      ctx.save();
      ctx.translate(car.x - cam.x, car.y - cam.y);
      ctx.rotate(car.angle);
      ctx.drawImage(this.glow, car.spec.w / 2 - 8, -34, 96, 68);
      ctx.restore();
    }
    // Neon spill from the landmark signs: each named place throws its colour onto the street.
    const NEON = {
      "ROSA'S DINER": '#ff6b5e', 'CORAL MOTEL': '#ff7ac0', 'PALMIRA TRUST BANK': '#ffd75e',
      "TITO'S GARAGE": '#53b7e5', 'PALMIRA GENERAL': '#eaf6ff', 'PALMIRA PD': '#508cff',
      'OLD CANNERY': '#ffb347', 'PALMIRA DOCKS': '#7fd4c9',
    };
    for (const b of game.city.buildings) {
      if (!b.label || !NEON[b.label] || !inView(b.door.x, b.door.y, 80)) continue;
      const hex = NEON[b.label];
      const n = parseInt(hex.slice(1), 16);
      const grad = ctx.createRadialGradient(b.door.x - cam.x, b.door.y - cam.y, 4, b.door.x - cam.x, b.door.y - cam.y, 95);
      grad.addColorStop(0, `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha * 0.85})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = 1;
      ctx.fillStyle = grad;
      ctx.fillRect(b.door.x - cam.x - 95, b.door.y - cam.y - 95, 190, 190);
    }
    ctx.restore();
    // The signs themselves, re-lit: label text with a neon halo once the sun is down.
    if (alpha > 0.1) {
      const NEON = {
        "ROSA'S DINER": '#ff6b5e', 'CORAL MOTEL': '#ff7ac0', 'PALMIRA TRUST BANK': '#ffd75e',
        "TITO'S GARAGE": '#53b7e5', 'PALMIRA GENERAL': '#eaf6ff', 'PALMIRA PD': '#508cff',
        'OLD CANNERY': '#ffb347', 'PALMIRA DOCKS': '#7fd4c9',
      };
      ctx.save();
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      for (const b of game.city.buildings) {
        if (!b.label || !NEON[b.label]) continue;
        const sx = b.x + b.w / 2 - cam.x;
        const sy = b.y - 8 - cam.y;
        if (sx < -80 || sx > VIEW_W + 80 || sy < -20 || sy > VIEW_H + 20) continue;
        ctx.shadowColor = NEON[b.label];
        ctx.shadowBlur = 16;
        ctx.fillStyle = '#ffffff';
        ctx.fillText(b.label, sx, sy);
        ctx.fillText(b.label, sx, sy);
      }
      ctx.restore();
    }
    void lerp;
  }

  drawMinimap(game) {
    const m = this.mctx;
    const city = game.city;
    const S = 192 / city.W;
    const oy = (192 - city.H * S) / 2;
    m.fillStyle = '#178a94';
    m.fillRect(0, 0, 192, 192);
    m.fillStyle = '#8fce6e';
    m.fillRect(64 * S, oy, (city.W - 64) * S, city.H * S);
    m.fillStyle = '#eed9a0';
    m.fillRect(64 * S, oy, 92 * S, city.H * S);
    m.strokeStyle = 'rgba(240,240,235,0.8)';
    m.lineWidth = 2.4;
    m.beginPath();
    for (const x of city.vx) {
      m.moveTo(x * S, oy + 26 * S);
      m.lineTo(x * S, oy + (city.H - 26) * S);
    }
    for (const y of city.hz) {
      m.moveTo(66 * S, oy + y * S);
      m.lineTo((city.W - 30) * S, oy + y * S);
    }
    m.stroke();
    // Remaining packages
    m.fillStyle = 'rgba(255,215,94,0.75)';
    for (const p of city.pickups) {
      if (p.kind === 'package' && !p.taken) m.fillRect(p.x * S - 1.5, oy + p.y * S - 1.5, 3, 3);
    }
    // Police
    if (game.stars > 0) {
      m.fillStyle = '#508cff';
      for (const unit of game.police.units) m.fillRect(unit.x * S - 2.5, oy + unit.y * S - 2.5, 5, 5);
      for (const officer of game.police.officers) {
        if (officer.state !== 'down') m.fillRect(officer.x * S - 2, oy + officer.y * S - 2, 4, 4);
      }
    }
    // Objective
    const objective = game.missions.currentObjective(game);
    if (objective) {
      m.fillStyle = '#ffd75e';
      m.beginPath();
      m.arc(objective.x * S, oy + objective.y * S, 4 + Math.sin(this.time * 5) * 1.2, 0, Math.PI * 2);
      m.fill();
    }
    // Player arrow
    const player = game.player;
    const focus = player.car || player;
    m.save();
    m.translate(focus.x * S, oy + focus.y * S);
    m.rotate(player.car ? player.car.angle : player.angle);
    m.fillStyle = '#ffffff';
    m.beginPath();
    m.moveTo(6, 0);
    m.lineTo(-4.5, -4);
    m.lineTo(-4.5, 4);
    m.closePath();
    m.fill();
    m.restore();
  }
}
