// 플레이어 궁수 부대: 대형, 이동, 발사, 병력 증감 연출
import * as THREE from 'three';
import { buildArcherGeometry, buildHero, makeCharMaterial } from '../world/models.js';
import { SpriteLabel } from './labels.js';
import { HW } from '../world/environment.js';
import { clamp, damp, rand, GOLDEN, easeOutBack } from '../engine/util.js';
import { audio } from '../engine/audio.js';

const MAX_VIS = 200;
const BLUE = new THREE.Color(0.6, 1.2, 3);
const BLUE_PUFF = new THREE.Color(0.6, 0.75, 1);

export class Squad {
  constructor(game) {
    this.game = game;
    this.count = 1;
    this.x = 0;
    this.d = 0;
    this.targetX = 0;
    this.speed = 6.6;
    this.tier = 1;
    this.rateMul = 1;
    this.dmgMul = 1;
    this.units = [];
    this.dying = [];
    this.rx = 0.6;
    this.rz = 0.6;
    this.R = 0.6;
    this.fireAcc = 0;
    this.dead = false;
    this.moving = true;
    this.firing = true;
    this.stopAt = Infinity;
    this.blockD = Infinity;
    this.phase = 0;
    this.geos = [null, buildArcherGeometry(1), buildArcherGeometry(2), buildArcherGeometry(3)];
    const mat = makeCharMaterial({ rim: 0.4, rimColor: 0xbfe0ff });
    this.mesh = new THREE.InstancedMesh(this.geos[1], mat, MAX_VIS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    game.world.add(this.mesh);
    this.ghost = new THREE.InstancedMesh(this.geos[1], mat, 160);
    this.ghost.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.ghost.frustumCulled = false;
    this.ghost.count = 0;
    game.world.add(this.ghost);
    this.hero = buildHero();
    game.world.add(this.hero);
    this.label = new SpriteLabel(game.overlay, { w: 256, h: 128, scale: 1.25 });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.heroRecoil = 0;
    this.shake = 0;
  }

  reset(count, stats) {
    this.count = count;
    this.x = 0;
    this.targetX = 0;
    this.d = 0;
    this.tier = stats.tier || 1;
    this.rateMul = stats.rateMul || 1;
    this.dmgMul = stats.dmgMul || 1;
    this.baseDmg = stats.baseDmg || 1;
    this.units.length = 0;
    this.dying.length = 0;
    this.dead = false;
    this.cheer = false;
    this.fireAcc = 0;
    this.stopAt = Infinity;
    this.moving = true;
    this.firing = true;
    this.hero.visible = true;
    this.hero.rotation.set(0, 0, 0);
    this.hero.position.set(0, 0, 0);
    this.mesh.geometry = this.geos[Math.min(3, this.tier)];
    this.ghost.geometry = this.mesh.geometry;
    this.syncVisuals(true);
    this.label.visible = true;
    this.label.set(this.count, 1, true);
  }

  setTier(t) {
    this.tier = Math.min(3, t);
    this.mesh.geometry = this.geos[this.tier];
    this.ghost.geometry = this.mesh.geometry;
  }

  get damage() {
    return this.baseDmg * this.dmgMul * [1, 1, 1.6, 2.4][this.tier];
  }
  get interval() {
    return 0.55 / this.rateMul;
  }
  get dps() {
    return (this.count / this.interval) * this.damage;
  }

  slot(i, sp) {
    // 해바라기 배치 (중앙은 지휘관 자리)
    const r = sp * Math.sqrt(i + 1.6);
    const a = i * GOLDEN;
    return [Math.cos(a) * r, Math.sin(a) * r];
  }

  visTarget() {
    return Math.max(0, Math.min(MAX_VIS, this.count - 1));
  }

  // 표시 유닛 수를 실제 병력에 맞춤
  syncVisuals(instant = false, fromX = null, fromD = null) {
    const want = this.visTarget();
    while (this.units.length < want) {
      const u = { x: 0, z: 0, phase: rand(0, 6.28), recoil: 0, spawnT: instant ? 1 : 0, s: 1 };
      if (fromX !== null && !instant) {
        u.x = fromX - this.x + rand(-0.8, 0.8);
        u.z = -(fromD - this.d) + rand(-0.3, 0.3);
      } else if (!instant) {
        u.x = rand(-0.5, 0.5);
        u.z = rand(-0.5, 0.5);
      }
      this.units.push(u);
    }
    while (this.units.length > want) this.units.pop();
  }

  addUnits(n, fromX = null, fromD = null) {
    if (n <= 0 || this.dead) return;
    const before = this.count;
    this.count = Math.min(99999, this.count + Math.round(n));
    this.syncVisuals(false, fromX, fromD);
    this.label.pulse(0.45);
    if (fromX !== null) {
      const fx = this.game.fx;
      const spawned = Math.min(40, this.count - before);
      for (let i = 0; i < spawned; i++) fx.glow.spawn({ x: fromX + rand(-1.5, 1.5), y: rand(0.3, 1.2), z: -fromD, vx: rand(-1, 1), vy: rand(1, 4), vz: rand(0, 3), life: rand(0.3, 0.6), size: 0.35, s1: 0.05, color: BLUE, grav: 4 });
    }
  }

  // 유닛 손실: 가까운 표시 유닛부터 제거
  loseUnits(n, atX, atD, cause = 'melee') {
    if (this.dead || n <= 0) return 0;
    n = Math.min(this.count, Math.round(n));
    if (n <= 0) return 0;
    this.count -= n;
    const want = this.visTarget();
    let remove = this.units.length - want;
    const lx = atX - this.x, lz = -(atD - this.d);
    const fx = this.game.fx;
    if (remove > 0) {
      // 가까운 순으로 정렬 후 제거
      const idx = this.units.map((u, i) => [i, (u.x - lx) ** 2 + (u.z - lz) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, remove).map((a) => a[0]).sort((a, b) => b - a);
      for (const i of idx) {
        const u = this.units[i];
        this.addGhost(this.x + u.x, this.d - u.z, cause);
        this.units.splice(i, 1);
      }
    } else if (cause !== 'silent') {
      this.addGhost(atX + rand(-0.3, 0.3), atD - 0.3, cause);
    }
    if (cause !== 'silent' && Math.random() < 0.6) fx.puff(atX, 0.6, -atD + 0.3, BLUE_PUFF, 1, 0.7, 0.2, 0.4);
    audio.lose();
    this.label.pulse(0.3);
    if (this.count <= 0) this.die();
    return n;
  }

  addGhost(x, d, cause) {
    if (this.dying.length >= 150) this.dying.shift();
    this.dying.push({ x, d, y: 0.1, vx: rand(-2.5, 2.5), vd: cause === 'aoe' ? rand(-3, 3) : rand(-4, -1.5), vy: rand(3, 6), rx: 0, rz: 0, vrx: rand(4, 10), vrz: rand(-6, 6), t: 0 });
  }

  // 원형 범위 공격 (보스 내려찍기)
  aoe(cx, cd, r) {
    if (this.dead) return 0;
    const lx = cx - this.x, lz = -(cd - this.d);
    let inside = 0;
    for (const u of this.units) if ((u.x - lx) ** 2 + (u.z - lz) ** 2 < r * r) inside++;
    const heroIn = lx * lx + lz * lz < r * r;
    const total = this.units.length + 1;
    const frac = (inside + (heroIn ? 1 : 0)) / total;
    let kills = Math.round(this.count * frac);
    if (heroIn && this.count <= 1) kills = 1;
    if (kills > 0) {
      // 원 안의 유닛을 우선 제거
      const want = Math.max(0, Math.min(MAX_VIS, this.count - kills - 1));
      const fx = this.game.fx;
      const keep = [];
      const hit = [];
      for (const u of this.units) ((u.x - lx) ** 2 + (u.z - lz) ** 2 < r * r ? hit : keep).push(u);
      while (keep.length + hit.length > want && hit.length) {
        const u = hit.pop();
        this.addGhost(this.x + u.x, this.d - u.z, 'aoe');
      }
      while (keep.length > want) keep.pop();
      this.units = keep.concat(hit);
      this.count -= kills;
      this.game.fx.text(cx, 2.5, -cd, '-' + kills, 'loss big');
      this.label.pulse(0.5);
      if (this.count <= 0) {
        this.count = 0;
        this.die();
      }
      audio.lose();
    }
    return kills;
  }

  die() {
    if (this.dead) return;
    this.dead = true;
    this.count = 0;
    this.units.length = 0;
    this.label.visible = false;
    this.deadT = 0;
    this.game.onSquadDead();
  }

  update(dt, inputX) {
    const game = this.game;
    this.phase += dt * 11;
    // 대형 크기: 넓은 곳은 해바라기 대형, 좁은 차선에서는 종대 대형
    const nVis = this.units.length;
    const sp = Math.min(0.64, 3.3 / Math.sqrt(Math.max(1, nVis)));
    const Rspiral = nVis > 0 ? sp * Math.sqrt(nVis + 1.6) + 0.35 : 0.45;
    const lane = game.laneAt(this.x, this.d + Rspiral * 0.5);
    const laneHalf = (lane[1] - lane[0]) / 2;
    const maxRx = Math.max(0.45, laneHalf - 0.45);
    this.sp = sp;
    if (Rspiral > maxRx && nVis > 0) {
      const cols = Math.max(2, Math.floor((maxRx * 2) / 0.46) + 1);
      const rows = Math.ceil((nVis + 1) / cols);
      this.grid = { cols, rows, spx: (maxRx * 2 - 0.3) / (cols - 1), spz: 0.52 };
      this.R = Math.max(maxRx, ((rows - 1) * 0.52) / 2 + 0.35);
      this.rx = damp(this.rx, maxRx, 8, dt);
      this.rz = damp(this.rz, ((rows - 1) * 0.52) / 2 + 0.4, 8, dt);
    } else {
      this.grid = null;
      this.R = Rspiral;
      this.rx = damp(this.rx, Rspiral, 8, dt);
      this.rz = damp(this.rz, Rspiral, 8, dt);
    }
    // 좌우 이동
    if (!this.dead) {
      this.targetX = clamp(inputX, lane[0] + this.rx + 0.3, lane[1] - this.rx - 0.3);
      if (lane[1] - lane[0] < this.rx * 2 + 0.6) this.targetX = (lane[0] + lane[1]) / 2;
      const prevX = this.x;
      this.x = damp(this.x, this.targetX, 13, dt);
      this.vx = (this.x - prevX) / Math.max(dt, 1e-4);
    }
    // 전진
    this.moving = false;
    if (!this.dead && this.d < this.stopAt) {
      let nd = this.d + this.speed * dt;
      if (nd > this.blockD) nd = Math.max(this.d, this.blockD);
      if (nd > this.stopAt) nd = this.stopAt;
      this.moving = nd > this.d + 1e-4;
      this.d = nd;
    }
    // 사격
    if (!this.dead && this.firing && this.count > 0) {
      const shotsPerSec = this.count / this.interval;
      const maxRate = game.maxArrowRate;
      const rate = Math.min(shotsPerSec, maxRate);
      const power = (shotsPerSec / rate) * this.damage;
      this.fireAcc += rate * dt;
      let fired = 0;
      while (this.fireAcc >= 1) {
        this.fireAcc -= 1;
        const n = this.units.length;
        let ox = 0, oz = 0;
        let pick = null;
        if (n > 0 && Math.random() > 1 / (n + 1)) {
          pick = this.units[Math.floor(Math.random() * n)];
          ox = pick.x;
          oz = pick.z;
          pick.recoil = 1;
        } else this.heroRecoil = 1;
        game.arrows.fire(this.x + ox, this.d - oz + 0.5, power, this.tier);
        fired++;
      }
      if (fired) audio.shoot(this.tier);
    }
    this.render(dt, sp);
  }

  render(dt, sp) {
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    const X = this.x, D = this.d;
    const walk = this.moving ? 1 : 0.25;
    const cheer = this.cheer ? 1 : 0;
    let n = 0;
    for (let i = 0; i < this.units.length; i++) {
      const u = this.units[i];
      let tx, tz;
      if (this.grid) {
        const g = this.grid;
        const k = i + 1;
        const row = Math.floor(k / g.cols), col = k % g.cols;
        tx = (col - (g.cols - 1) / 2) * g.spx + ((row % 2) - 0.5) * 0.08;
        tz = (row - (g.rows - 1) / 2) * g.spz;
      } else [tx, tz] = this.slot(i, sp);
      u.x = damp(u.x, tx, 9, dt);
      u.z = damp(u.z, tz, 9, dt);
      u.recoil = Math.max(0, u.recoil - dt * 6);
      u.spawnT = Math.min(1, u.spawnT + dt * 3);
      u.phase += dt * (cheer ? 7 : 11 * walk);
      const sc = easeOutBack(u.spawnT);
      const bob = cheer ? Math.abs(Math.sin(u.phase)) * 0.55 : Math.abs(Math.sin(u.phase)) * 0.08 * walk;
      e.set(-u.recoil * 0.2, (this.vx || 0) * -0.02, Math.sin(u.phase) * 0.09 * walk);
      q.setFromEuler(e);
      p.set(X + u.x, bob, -D + u.z + u.recoil * 0.06);
      s.setScalar(Math.max(0.001, sc));
      m.compose(p, q, s);
      this.mesh.setMatrixAt(n++, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    // 쓰러지는 유닛
    let g = 0;
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const u = this.dying[i];
      u.t += dt;
      if (u.t > 0.6) {
        this.dying.splice(i, 1);
        continue;
      }
      u.vy -= 22 * dt;
      u.x += u.vx * dt;
      u.d += u.vd * dt;
      u.y = Math.max(0, u.y + u.vy * dt);
      u.rx += u.vrx * dt;
      u.rz += u.vrz * dt;
      const sc = u.t > 0.4 ? 1 - (u.t - 0.4) / 0.2 : 1;
      e.set(u.rx, 0, u.rz);
      q.setFromEuler(e);
      p.set(u.x, u.y, -u.d);
      s.setScalar(Math.max(0.001, sc));
      m.compose(p, q, s);
      this.ghost.setMatrixAt(g++, m);
    }
    this.ghost.count = g;
    this.ghost.instanceMatrix.needsUpdate = true;
    // 지휘관
    this.heroRecoil = Math.max(0, this.heroRecoil - dt * 6);
    if (!this.dead) {
      this.hero.position.set(X, Math.abs(Math.sin(this.phase * 0.9)) * 0.1 * walk, -D + this.heroRecoil * 0.08);
      this.hero.rotation.set(-this.heroRecoil * 0.15, 0, Math.sin(this.phase * 0.9) * 0.07 * walk);
    } else {
      this.deadT += dt;
      const k = Math.min(1, this.deadT / 0.5);
      this.hero.rotation.x = k * 1.4;
      this.hero.position.y = 0;
    }
    // 병력 숫자
    this.label.set(this.count);
    const lsc = 1 + Math.min(0.6, Math.log10(Math.max(1, this.count)) * 0.18);
    this.label.update(dt, X, 2.3 + this.rz * 0.25, -D - this.rz * 0.35, lsc);
  }

  dispose() {
    this.game.world.remove(this.mesh, this.ghost, this.hero);
    this.label.dispose();
  }
}
