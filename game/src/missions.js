// missions.js — Rosa and Tito's story: five jobs that walk the player across every system
// in the game (a timed delivery, a car theft, a hot pickup, taxi work, and the bank job),
// plus the repeatable free-roam taxi fares that pay between story beats. The module owns
// the current objective marker the HUD, minimap and beacon all point at.

import { TUNE } from './config.js';
import { dist } from './random.js';
import { createCar } from './vehicles.js';

const STORY = [
  { giver: 'diner', name: 'First Delivery', pay: 150 },
  { giver: 'garage', name: 'Borrowed Wheels', pay: 250 },
  { giver: 'diner', name: 'Hot Pickup', pay: 300 },
  { giver: 'garage', name: 'Fare Play', pay: 0 }, // paid per leg, plus a bonus
  { giver: 'diner', name: 'The Palmira Job', pay: 1000 },
];

export class Missions {
  constructor(city, rng) {
    this.city = city;
    this.rng = rng;
    this.idx = 0; // next story mission
    this.stage = 'giver'; // giver | active | done
    this.phase = '';
    this.timer = null;
    this.targetCar = null;
    this.passenger = null;
    this.channel = 0;
    this.legsDone = 0;
    this.roam = null; // free-roam taxi fare {phase, passenger}
    this.title = '';
    this.text = '';
  }

  giverDoor() {
    const spec = STORY[Math.min(this.idx, STORY.length - 1)];
    return this.city.landmarks[spec.giver].door;
  }

  giverName() {
    return STORY[Math.min(this.idx, STORY.length - 1)].giver === 'diner' ? 'Rosa' : 'Tito';
  }

  start(game) {
    const spec = STORY[this.idx];
    this.stage = 'active';
    this.legsDone = 0;
    if (this.idx === 0) {
      this.phase = 'deliver';
      this.timer = 80;
      game.banner('FIRST DELIVERY', 'Take the package to Tito\'s Garage — fast.');
    } else if (this.idx === 1) {
      this.phase = 'steal';
      this.timer = 150;
      const door = this.city.landmarks.motel.door;
      this.targetCar = createCar(this.city, { x: door.x + 42, y: door.y + 16, angle: 0, type: 'sport', color: '#e5484d', rng: this.rng });
      this.targetCar.missionTarget = true;
      game.cars.push(this.targetCar);
      game.banner('BORROWED WHEELS', 'The red Comet at the Coral Motel. Bring it to the garage.');
    } else if (this.idx === 2) {
      this.phase = 'pickup';
      this.timer = 170;
      game.heatFloor = 30;
      this.spawnPassenger(game, this.city.landmarks.bank.door);
      game.banner('HOT PICKUP', 'Pick up Rosa\'s cousin at the bank. The heat is already on.');
    } else if (this.idx === 3) {
      this.phase = 'fare';
      this.newFareLeg(game);
      game.banner('FARE PLAY', 'Run three taxi fares for Tito. Any car with a meter heart.');
    } else if (this.idx === 4) {
      this.phase = 'go';
      game.banner('THE PALMIRA JOB', 'Get to the bank. This one saves the garage.');
    }
    game.audio.sting(true);
    void spec;
  }

  spawnPassenger(game, point) {
    const ped = game.people.addPed(point.x + 8, point.y + 6, { passenger: true });
    ped.state = 'stand';
    this.passenger = ped;
    return ped;
  }

  newFareLeg(game) {
    const doors = ['diner', 'motel', 'bank', 'hospital', 'police', 'garage'].map((k) => this.city.landmarks[k].door);
    const from = this.rng.pick(doors);
    this.spawnPassenger(game, from);
    this.phase = 'farePickup';
  }

  complete(game, pay) {
    game.earn(pay);
    game.audio.sting(true);
    game.banner('JOB DONE', pay > 0 ? `+$${pay} — nice work, Rico.` : 'Nice work, Rico.');
    this.cleanup(game);
    this.idx += 1;
    if (this.idx >= STORY.length) {
      this.stage = 'done';
      game.onStoryComplete();
    } else {
      this.stage = 'giver';
    }
    game.saveGame();
  }

  fail(game, reason) {
    game.audio.sting(false);
    game.banner('JOB FAILED', reason);
    this.cleanup(game);
    this.stage = this.idx >= STORY.length ? 'done' : 'giver';
  }

  cleanup(game) {
    this.timer = null;
    this.phase = '';
    this.channel = 0;
    game.heatFloor = 0;
    if (this.targetCar) {
      this.targetCar.missionTarget = false;
      this.targetCar = null;
    }
    if (this.passenger) {
      this.passenger.removeMe = true;
      this.passenger = null;
    }
    if (this.roam && this.roam.passenger) {
      this.roam.passenger.removeMe = true;
    }
    this.roam = null;
  }

  onPlayerEnterCar(game, car) {
    if (this.stage === 'active' && this.idx === 1 && this.phase === 'steal' && car === this.targetCar) {
      this.phase = 'deliver';
      this.timer = 120;
      game.addHeat(30, car.x, car.y, true);
      game.banner('THAT\'S THE CAR!', 'Now get it to Tito\'s Garage.');
    }
    // Free-roam fares: hop in a taxi between story jobs and a fare appears.
    if ((this.stage === 'giver' || this.stage === 'done') && car.livery === 'taxi' && !this.roam) {
      const doors = ['diner', 'motel', 'bank', 'hospital', 'garage'].map((k) => this.city.landmarks[k].door);
      const from = this.rng.pick(doors);
      const ped = game.people.addPed(from.x + 8, from.y + 6, { passenger: true });
      ped.state = 'stand';
      this.roam = { phase: 'pickup', passenger: ped, dest: null };
      game.notify('Taxi fare', 'A passenger is waiting — follow the gold marker.');
    }
  }

  onPassengerBoarded(game, ped) {
    if (this.passenger && ped === this.passenger) {
      if (this.phase === 'pickup' && this.idx === 2) {
        this.phase = 'deliver';
        game.notify('Got him', 'Lose the heat and get to the docks.');
      } else if (this.phase === 'farePickup') {
        const doors = ['diner', 'motel', 'bank', 'hospital', 'police', 'garage', 'docks', 'hideout'].map((k) => this.city.landmarks[k].door);
        this.fareDest = this.rng.pick(doors);
        this.phase = 'fareDeliver';
      }
      this.passenger = null;
      return;
    }
    if (this.roam && ped === this.roam.passenger) {
      const doors = ['diner', 'motel', 'bank', 'hospital', 'garage', 'docks'].map((k) => this.city.landmarks[k].door);
      this.roam.dest = this.rng.pick(doors);
      this.roam.phase = 'deliver';
      this.roam.passenger = null;
    }
  }

  onCarWrecked(game, car) {
    if (this.stage === 'active' && car === this.targetCar) {
      this.fail(game, 'The Comet is wrecked. Tito needed it whole.');
    }
  }

  currentObjective(game) {
    const player = game.player;
    if (this.stage === 'active') {
      if (this.idx === 0) return { x: this.city.landmarks.garage.door.x, y: this.city.landmarks.garage.door.y, label: 'Garage' };
      if (this.idx === 1) {
        if (this.phase === 'steal' && this.targetCar) return { x: this.targetCar.x, y: this.targetCar.y, label: 'The Comet' };
        return { x: this.city.landmarks.garage.door.x, y: this.city.landmarks.garage.door.y, label: 'Garage' };
      }
      if (this.idx === 2) {
        if (this.phase === 'pickup') return { x: this.city.landmarks.bank.door.x, y: this.city.landmarks.bank.door.y, label: 'Pickup' };
        return { x: this.city.landmarks.docks.door.x, y: this.city.landmarks.docks.door.y, label: 'Docks' };
      }
      if (this.idx === 3) {
        if (this.phase === 'farePickup' && this.passenger) return { x: this.passenger.x, y: this.passenger.y, label: 'Passenger' };
        if (this.phase === 'fareDeliver' && this.fareDest) return { x: this.fareDest.x, y: this.fareDest.y, label: 'Drop-off' };
      }
      if (this.idx === 4) {
        if (this.phase === 'escape') return { x: this.city.landmarks.hideout.door.x, y: this.city.landmarks.hideout.door.y, label: 'Hideout' };
        return { x: this.city.landmarks.bank.door.x, y: this.city.landmarks.bank.door.y, label: 'Bank' };
      }
    }
    if (this.roam) {
      if (this.roam.phase === 'pickup' && this.roam.passenger) return { x: this.roam.passenger.x, y: this.roam.passenger.y, label: 'Passenger' };
      if (this.roam.phase === 'deliver' && this.roam.dest) return { x: this.roam.dest.x, y: this.roam.dest.y, label: 'Drop-off' };
    }
    if (this.stage === 'giver') {
      const door = this.giverDoor();
      return { x: door.x, y: door.y, label: this.giverName() };
    }
    void player;
    return null;
  }

  update(game, dt) {
    const player = game.player;
    const px = player.car ? player.car.x : player.x;
    const py = player.car ? player.car.y : player.y;

    if (this.timer !== null && this.stage === 'active') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.fail(game, 'Out of time.');
        return;
      }
    }

    if (this.stage === 'giver') {
      const door = this.giverDoor();
      const spec = STORY[this.idx];
      this.title = spec.name;
      this.text = `Meet ${this.giverName()} — ${spec.giver === 'diner' ? "Rosa's Diner" : "Tito's Garage"}`;
      if (dist(px, py, door.x, door.y) < 58) this.start(game);
      return;
    }
    if (this.stage === 'done') {
      this.title = 'Palmira is yours';
      this.text = 'Free roam — fares, packages and the pay \'n\' spray still pay.';
      this.updateRoam(game, px, py);
      return;
    }

    // Active story mission text + arrivals.
    const garage = this.city.landmarks.garage.door;
    const bank = this.city.landmarks.bank.door;
    if (this.idx === 0) {
      this.title = 'First Delivery';
      this.text = 'Deliver the package to Tito\'s Garage';
      if (dist(px, py, garage.x, garage.y) < 58) this.complete(game, STORY[0].pay);
    } else if (this.idx === 1) {
      this.title = 'Borrowed Wheels';
      this.text = this.phase === 'steal' ? 'Steal the red Comet at the Coral Motel' : 'Bring the Comet to the garage';
      if (this.phase === 'deliver' && player.car === this.targetCar && dist(px, py, garage.x, garage.y) < 62) this.complete(game, STORY[1].pay);
    } else if (this.idx === 2) {
      this.title = 'Hot Pickup';
      this.text = this.phase === 'pickup' ? 'Pick up the cousin at the bank (bring a car)' : 'Take him to the docks';
      if (this.phase === 'pickup' && player.car && this.passenger && dist(px, py, this.passenger.x, this.passenger.y) < 52 && Math.hypot(player.car.vx, player.car.vy) < 40) {
        this.passenger.state = 'toCar';
        this.passenger.carTarget = player.car;
      }
      if (this.phase === 'deliver' && dist(px, py, this.city.landmarks.docks.door.x, this.city.landmarks.docks.door.y) < 64) this.complete(game, STORY[2].pay);
    } else if (this.idx === 3) {
      this.title = 'Fare Play';
      this.text = this.phase === 'farePickup' ? `Fare ${this.legsDone + 1} of 3 — pick up your passenger` : `Fare ${this.legsDone + 1} of 3 — drop them off`;
      if (this.phase === 'farePickup' && player.car && this.passenger && dist(px, py, this.passenger.x, this.passenger.y) < 52 && Math.hypot(player.car.vx, player.car.vy) < 40) {
        this.passenger.state = 'toCar';
        this.passenger.carTarget = player.car;
      } else if (this.phase === 'fareDeliver' && this.fareDest && dist(px, py, this.fareDest.x, this.fareDest.y) < 60) {
        const fare = Math.round(40 + dist(this.city.landmarks.garage.door.x, this.city.landmarks.garage.door.y, this.fareDest.x, this.fareDest.y) * TUNE.farePerMeter * 0.2);
        game.earn(fare);
        game.notify('Fare paid', `+$${fare}`);
        this.legsDone += 1;
        if (this.legsDone >= 3) {
          this.complete(game, 100);
          return;
        }
        this.newFareLeg(game);
      }
    } else if (this.idx === 4) {
      this.title = 'The Palmira Job';
      if (this.phase === 'go') {
        this.text = 'Get to the bank — on foot at the door';
        if (!player.car && dist(px, py, bank.x, bank.y) < 46) this.phase = 'grab';
      } else if (this.phase === 'grab') {
        this.text = 'Taking the loot… stay at the door';
        if (!player.car && dist(px, py, bank.x, bank.y) < 52) {
          this.channel += dt;
          game.channel = { t: this.channel / 3, label: 'Grabbing the loot…' };
          if (this.channel >= 3) {
            this.phase = 'escape';
            game.heatFloor = 70;
            game.addHeat(70, px, py, true);
            game.channel = null;
            game.banner('GO GO GO', 'Lose them and reach the Old Cannery.');
          }
        } else {
          this.channel = 0;
          game.channel = null;
        }
      } else if (this.phase === 'escape') {
        this.text = 'Reach the Old Cannery hideout, east edge of town';
        const door = this.city.landmarks.hideout.door;
        if (dist(px, py, door.x, door.y) < 66) {
          game.channel = null;
          this.complete(game, STORY[4].pay);
        }
      }
    }
    this.updateRoam(game, px, py);
  }

  updateRoam(game, px, py) {
    if (!this.roam) return;
    const player = game.player;
    if (this.roam.phase === 'pickup' && this.roam.passenger) {
      if (player.car && dist(px, py, this.roam.passenger.x, this.roam.passenger.y) < 52 && Math.hypot(player.car.vx, player.car.vy) < 40) {
        this.roam.passenger.state = 'toCar';
        this.roam.passenger.carTarget = player.car;
      }
    } else if (this.roam.phase === 'deliver' && this.roam.dest) {
      if (dist(px, py, this.roam.dest.x, this.roam.dest.y) < 60) {
        const fare = Math.round(30 + this.rng.range(0, 60));
        game.earn(fare);
        game.notify('Fare paid', `+$${fare} — hop in a taxi for another.`);
        this.roam = null;
      }
    }
    if (this.roam && !player.car) {
      // Stepped out and walked away: the fare gives up after a while.
      this.roam = null;
      game.notify('Fare cancelled', 'The passenger gave up waiting.');
    }
  }
}
