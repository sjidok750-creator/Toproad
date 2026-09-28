// 적 병사 군단 (인스턴싱 렌더링, 대형 이동, 돌격, 피격/사망 애니메이션, 공간 해시)
import * as THREE from 'three';
import { buildSoldierGeometry, makeCharMaterial } from '../world/models.js';
import { rand, clamp } from '../engine/util.js';
import { audio } from '../engine/audio.js';

const MAX_VIS = 1600;
const RADIUS = 0.32;
const RED = new THREE.Color(2.2, 0.35, 0.25);
const RED_PUFF = new THREE.Color(0.95, 0.55, 0.5);

export class Crowd {
  constructor(game) {
    this.game = game;
    this.soldiers = [];
    this.groups = [];
    this.kinds = [];
    for (const kind of ['basic', 'shield']) {
      const geo = buildSoldierGeometry(kind);
      const flash = new THREE.InstancedBufferAttribute(new Float32Array(MAX_VIS), 1).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('aFlash', flash);
      const mat = makeCharMaterial({ flash: true, rim: 0.28, rimColor: 0xffd0c0 });
      const mesh = new THREE.InstancedMesh(geo, mat, MAX_VIS);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      mesh.count = 0;
      game.world.add(mesh);
      this.kinds.push({ mesh, flash, n: 0 });
    }
    this.cells = [];
    this.cellBase = 0;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this.aliveCount = 0;
  }

  addArmy(def) {
    const g = { d: def.d, active: false, trigger: def.trigger ?? 34, speed: def.speed ?? 1.5, lead: 0, alive: 0 };
    this.groups.push(g);
    const cols = def.cols, rows = def.rows;
    const sp = def.spacing ?? 0.72;
    const x0 = (def.x || 0) - ((cols - 1) * sp) / 2;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        let kind = 0;
        if (def.kind === 'shield') kind = 1;
        else if (def.kind === 'mixed') kind = r < Math.ceil(rows * (def.shieldRows ?? 0.3)) ? 1 : 0;
        const hp = kind === 1 ? (def.shieldHp ?? 3) : (def.hp ?? 1);
        this.add(x0 + c * sp + rand(-0.08, 0.08), def.d + r * sp + rand(-0.08, 0.08), kind, hp, g);
      }
    }
    return g;
  }

  add(x, d, kind, hp, group, state = 'idle') {
    const s = { x, d, y: 0, hp, maxHp: hp, kind, group, state, phase: rand(0, 6.28), flash: 0, vx: 0, vd: 0, vy: 0, rx: 0, rz: 0, ry: Math.PI, dieT: 0, spd: rand(0.9, 1.1) };
    if (group) group.alive++;
    this.soldiers.push(s);
    return s;
  }

  // 보스 소환 등 즉시 행진
  spawn(x, d, kind = 0, hp = 1, speed = 2) {
    const g = { d, active: true, trigger: 999, speed, alive: 0 };
    const s = this.add(x, d, kind, hp, g, 'march');
    s.y = 0;
    return s;
  }

  update(dt) {
    const game = this.game;
    const sq = game.squad;
    const sd = sq.d, sx = sq.x;
    const rx = sq.rx + RADIUS + 0.1, rz = sq.rz + RADIUS + 0.1;
    // 대형 활성화
    for (const g of this.groups) {
      if (!g.active && sd > g.d - g.trigger) g.active = true;
    }
    // 공간 해시 초기화
    const base = Math.floor(sd) - 20;
    this.cellBase = base;
    const NC = 120;
    if (this.cells.length !== NC) this.cells = Array.from({ length: NC }, () => []);
    for (const c of this.cells) c.length = 0;

    const list = this.soldiers;
    let write = 0;
    let alive = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.state === 'dead') continue;
      list[write++] = s;
      if (s.state === 'dying') {
        s.dieT += dt;
        s.flash = Math.max(0, s.flash - dt * 9);
        s.vy -= 22 * dt;
        s.x += s.vx * dt;
        s.d += s.vd * dt;
        s.y += s.vy * dt;
        s.rx += s.vrx * dt;
        s.rz += s.vrz * dt;
        if (s.y < 0) {
          s.y = 0;
          s.vy *= -0.3;
          s.vx *= 0.5;
          s.vd *= 0.5;
        }
        if (s.dieT > 0.55) {
          s.state = 'dead';
          game.fx.puff(s.x, s.y + 0.4, -s.d, RED_PUFF, 1, 0.7, 0.2, 0.45);
        }
        continue;
      }
      alive++;
      // 너무 뒤로 지나간 병사는 제거
      if (s.d < sd - 16) {
        s.state = 'dead';
        continue;
      }
      if (s.d > sd + 110) continue; // 멀리 있는 대형은 대기
      s.flash = Math.max(0, s.flash - dt * 7);
      const g = s.group;
      if (s.state === 'idle' && g && g.active) s.state = 'march';
      if (s.state === 'march' || s.state === 'charge') {
        const dx = sx - s.x;
        const dd = sd - s.d;
        const front = sd + sq.rz;
        if (s.state === 'march' && s.d - front < 5.5 && Math.abs(dx) < sq.rx + 4 && s.d > sd - 1) s.state = 'charge';
        if (s.state === 'charge') {
          const len = Math.hypot(dx, dd) || 1;
          const v = 5.2 * s.spd;
          s.x += (dx / len) * v * dt;
          s.d += (dd / len) * v * dt;
          // 모델 정면(-z)이 부대를 향하도록
          s.ry = Math.atan2(-dx, dd);
        } else {
          s.d -= g.speed * s.spd * dt;
          s.ry = Math.PI;
        }
        s.phase += dt * (s.state === 'charge' ? 16 : 10) * s.spd;
        // 차선 벽 제한
        const lane = game.laneAt(s.x, s.d);
        if (lane) s.x = clamp(s.x, lane[0] + 0.35, lane[1] - 0.35);
        // 부대와 접촉 → 1:1 교환
        if (sq.count > 0 && !sq.dead) {
          const ex = (s.x - sx) / rx;
          const ez = (s.d - sd) / rz;
          if (ex * ex + ez * ez < 1) {
            this.kill(s, 'trade');
            sq.loseUnits(1, s.x, s.d, 'melee');
            continue;
          }
        }
      } else {
        s.phase += dt * 2;
      }
      // 해시 등록
      const ci = Math.floor(s.d) - base;
      if (ci >= 0 && ci < NC) this.cells[ci].push(s);
    }
    list.length = write;
    this.aliveCount = alive;
    this.render(sd);
  }

  render(sd) {
    const m = this._m, q = this._q, e = this._e, p = this._p, sc = this._s;
    const K = this.kinds;
    K[0].n = K[1].n = 0;
    const lo = sd - 18, hi = sd + 95;
    for (const s of this.soldiers) {
      if (s.state === 'dead' || s.d < lo || s.d > hi) continue;
      const k = K[s.kind];
      if (k.n >= MAX_VIS) continue;
      let bob = 0, roll = 0, scale = s.kind === 1 ? 1.06 : 1;
      if (s.state === 'dying') {
        const t = s.dieT / 0.55;
        scale *= t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        e.set(s.rx, s.ry, s.rz);
      } else {
        const moving = s.state !== 'idle';
        bob = moving ? Math.abs(Math.sin(s.phase)) * 0.08 : Math.sin(s.phase) * 0.01;
        roll = moving ? Math.sin(s.phase) * 0.1 : Math.sin(s.phase * 0.7) * 0.03;
        e.set(0, s.ry, roll);
      }
      q.setFromEuler(e);
      p.set(s.x, s.y + bob, -s.d);
      sc.setScalar(Math.max(0.001, scale));
      m.compose(p, q, sc);
      k.mesh.setMatrixAt(k.n, m);
      k.flash.array[k.n] = s.flash;
      k.n++;
    }
    for (const k of K) {
      k.mesh.count = k.n;
      k.mesh.instanceMatrix.needsUpdate = true;
      k.mesh.instanceMatrix.clearUpdateRanges();
      k.mesh.instanceMatrix.addUpdateRange(0, k.n * 16);
      k.flash.needsUpdate = true;
      k.flash.clearUpdateRanges();
      k.flash.addUpdateRange(0, k.n);
    }
  }

  // 화살 경로 [d0, d1] 에서 x 근처의 첫 병사
  query(x, d0, d1, exclude) {
    const base = this.cellBase;
    const c0 = Math.max(0, Math.floor(d0 - 0.4) - base);
    const c1 = Math.min(this.cells.length - 1, Math.floor(d1 + 0.4) - base);
    let best = null, bestD = Infinity;
    for (let c = c0; c <= c1; c++) {
      const cell = this.cells[c];
      if (!cell) continue;
      for (let i = 0; i < cell.length; i++) {
        const s = cell[i];
        if (s.state === 'dying' || s.state === 'dead' || s === exclude || s.hp <= 0) continue;
        if (Math.abs(s.x - x) > RADIUS + 0.06) continue;
        if (s.d < d0 - 0.35 || s.d > d1 + 0.35) continue;
        if (s.d < bestD) {
          bestD = s.d;
          best = s;
        }
      }
    }
    return best;
  }

  // 조준 보조: 전방 부채꼴 안의 가까운 병사 하나 (가까운 몇 명 중 무작위)
  pickTarget(x, d, range, spread, lo = -99, hi = 99) {
    const base = this.cellBase;
    const c0 = Math.max(0, Math.floor(d) - base);
    const c1 = Math.min(this.cells.length - 1, Math.floor(d + range) - base);
    const cand = this._cand || (this._cand = []);
    cand.length = 0;
    for (let c = c0; c <= c1 && cand.length < 6; c++) {
      const cell = this.cells[c];
      for (let i = 0; i < cell.length; i++) {
        const s = cell[i];
        if (s.hp <= 0 || s.state === 'dying') continue;
        const dd = s.d - d;
        if (dd < 1.5) continue;
        // 거리가 멀수록 좌우 허용폭 증가
        if (Math.abs(s.x - x) > spread * Math.min(1, 0.35 + dd / 14)) continue;
        if (s.x < lo || s.x > hi) continue;
        cand.push(s);
      }
    }
    if (!cand.length) return null;
    return cand[Math.floor(Math.random() * cand.length)];
  }

  // 범위 내 병사 목록 (광역 피해)
  inRadius(x, d, r, out = []) {
    const base = this.cellBase;
    const c0 = Math.max(0, Math.floor(d - r) - base);
    const c1 = Math.min(this.cells.length - 1, Math.floor(d + r) - base);
    for (let c = c0; c <= c1; c++) {
      for (const s of this.cells[c]) {
        if (s.state === 'dying' || s.state === 'dead' || s.hp <= 0) continue;
        if ((s.x - x) ** 2 + (s.d - d) ** 2 < r * r) out.push(s);
      }
    }
    return out;
  }

  damage(s, amount) {
    const dealt = Math.min(s.hp, amount);
    s.hp -= dealt;
    s.flash = 1;
    if (s.hp <= 0.001) this.kill(s, 'arrow');
    return dealt;
  }

  kill(s, cause) {
    if (s.state === 'dying' || s.state === 'dead') return;
    s.state = 'dying';
    s.hp = 0;
    s.dieT = 0;
    s.flash = 1;
    if (s.group) s.group.alive--;
    const fx = this.game.fx;
    if (cause === 'arrow') {
      s.vd = rand(3, 7);
      s.vx = rand(-2, 2);
      s.vy = rand(3.5, 6);
      s.vrx = rand(-10, -4);
      s.vrz = rand(-6, 6);
      fx.sparks(s.x, 0.8, -s.d, RED, 3, 4, 0.13);
      audio.pop();
    } else {
      s.vd = rand(1, 3);
      s.vx = rand(-3, 3);
      s.vy = rand(2, 4);
      s.vrx = rand(-8, 8);
      s.vrz = rand(-8, 8);
      fx.puff(s.x, 0.5, -s.d, RED_PUFF, 1, 0.8, 0.2, 0.4);
    }
    this.game.onEnemyKilled(s, cause);
  }

  // 남은 병력 (활성 대형 전체)
  remainingNear(d0, d1) {
    let n = 0;
    for (const s of this.soldiers) if (s.state !== 'dying' && s.state !== 'dead' && s.d >= d0 && s.d <= d1) n++;
    return n;
  }

  clear() {
    this.soldiers.length = 0;
    this.groups.length = 0;
    for (const k of this.kinds) k.mesh.count = 0;
  }

  dispose() {
    for (const k of this.kinds) {
      this.game.world.remove(k.mesh);
      k.mesh.geometry.dispose();
      k.mesh.material.dispose();
    }
  }
}
