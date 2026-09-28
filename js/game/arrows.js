// 화살 투사체: 인스턴스 메시 + 발광 궤적, 관통/충돌 처리
import * as THREE from 'three';
import { buildArrowGeometry, makeCharMaterial } from '../world/models.js';
import { rand } from '../engine/util.js';

const CAP = 500;
const SPEED = [0, 44, 50, 54];
const RANGE = 31;

const TRAIL_VS = `
attribute vec3 iPos; attribute vec3 iDir; attribute vec4 iColor; attribute float iWidth;
varying vec2 vUv; varying vec4 vColor;
void main(){
  vUv = uv; vColor = iColor;
  float t = position.y + 0.5;
  vec3 wp = iPos - iDir * (1.0 - t);
  vec4 mv = modelViewMatrix * vec4(wp, 1.0);
  vec3 dv = (modelViewMatrix * vec4(iDir, 0.0)).xyz;
  vec2 perp = vec2(dv.y, -dv.x);
  float l = length(perp);
  perp = l > 1e-5 ? perp / l : vec2(1.0, 0.0);
  mv.xy += perp * position.x * iWidth;
  gl_Position = projectionMatrix * mv;
}`;
const TRAIL_FS = `
varying vec2 vUv; varying vec4 vColor;
void main(){
  float across = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = pow(vUv.y, 1.3) * pow(across, 1.5);
  gl_FragColor = vec4(vColor.rgb * a * vColor.a, 1.0);
}`;

const TRAIL_COLORS = [null, new THREE.Color(1.8, 3.2, 6.0), new THREE.Color(3.0, 4.2, 6.5), new THREE.Color(6.0, 2.0, 0.45)];

export class Arrows {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.pool = [];
    this.geos = [null, buildArrowGeometry(1), buildArrowGeometry(2), buildArrowGeometry(3)];
    const mat = makeCharMaterial({ rim: 0 });
    this.meshes = [null];
    for (let t = 1; t <= 3; t++) {
      const m = new THREE.InstancedMesh(this.geos[t], mat, CAP);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      game.world.add(m);
      this.meshes.push(m);
    }
    // 궤적
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aDir = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aW = new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iDir', this.aDir);
    g.setAttribute('iColor', this.aCol);
    g.setAttribute('iWidth', this.aW);
    g.instanceCount = 0;
    this.trailGeo = g;
    this.trail = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: TRAIL_VS, fragmentShader: TRAIL_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.trail.frustumCulled = false;
    this.trail.renderOrder = 18;
    game.world.add(this.trail);
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3(1.5, 1.5, 1.35);
  }

  fire(x, d, power, tier) {
    if (this.list.length >= CAP) return;
    const a = this.pool.pop() || {};
    let ang = rand(-0.025, 0.025);
    // 적 병사가 가까우면 살짝 조준 (최대 약 12도)
    // 단, 정면에 부숴야 할 목표물이 있으면 직선으로 쏜다
    const game = this.game;
    let straight = false;
    for (const o of game.activeTargets) {
      if (!o.alive || o.d < d || o.d - d > RANGE) continue;
      if (Math.abs(o.x - x) > o.hw) continue;
      if (o.kind === 'gate' ? o.shootable : o.kind !== 'barrel' || o.state === 'idle') {
        straight = true;
        break;
      }
    }
    const lane = game.laneAt(x, d + 3);
    const t = straight ? null : game.crowd.pickTarget(x, d, RANGE - 4, 3.6, lane[0], lane[1]);
    if (t) {
      const lead = (t.d - d) / SPEED[tier];
      const tx = t.x + (t.state === 'charge' ? 0 : 0);
      const td = t.d - (t.state === 'idle' ? 0 : (t.group?.speed || 1.5) * lead);
      ang = Math.max(-0.21, Math.min(0.21, Math.atan2(tx - x, Math.max(0.5, td - d)))) + rand(-0.01, 0.01);
    }
    a.x = x;
    a.d = d;
    a.y = 0.85 + rand(-0.1, 0.12);
    a.vx = Math.sin(ang) * SPEED[tier];
    a.vd = Math.cos(ang) * SPEED[tier];
    a.power = power;
    a.tier = tier;
    a.dist = 0;
    a.last = null;
    a.age = 0;
    this.list.push(a);
  }

  update(dt) {
    const game = this.game;
    const crowd = game.crowd;
    const targets = game.activeTargets;
    const walls = game.walls;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const a = this.list[i];
      a.age += dt;
      let d0 = a.d;
      const nx = a.x + a.vx * dt;
      const nd = a.d + a.vd * dt;
      a.dist += a.vd * dt;
      let done = a.dist > RANGE;
      // 차선벽 앞면
      for (const w of walls) {
        if (d0 <= w.d0 && nd >= w.d0 && Math.abs(nx - w.x) < 0.5) {
          game.fx.sparks(nx, a.y, -w.d0, new THREE.Color(2, 1.8, 1.4), 2, 3, 0.1);
          done = true;
        }
      }
      if (!done) {
        // 가장 가까운 대형 목표물
        let tgt = null, tgtD = Infinity;
        for (const t of targets) {
          if (!t.alive) continue;
          const front = t.d - t.hd;
          if (Math.abs(nx - t.x) > t.hw) continue;
          if (front > nd || t.d + t.hd < d0) continue;
          if (t.kind === 'gate' && !t.shootable) continue;
          const entry = Math.max(front, d0);
          if (entry < tgtD) {
            tgtD = entry;
            tgt = t;
          }
        }
        // 관통하며 병사 처리
        let guard = 0;
        while (a.power > 0.001 && guard++ < 12) {
          const s = crowd.query(nx, d0, Math.min(nd, tgtD));
          if (!s) break;
          const dealt = crowd.damage(s, a.power);
          a.power -= dealt;
          d0 = s.d + 0.01;
          if (a.power <= 0.001) done = true;
        }
        if (!done && tgt) {
          if (tgt.kind === 'gate') {
            if (tgt.onArrow(a)) done = true;
          } else {
            tgt.damage(a.power, nx, a.y + (tgt.kind === 'boss' ? 2.5 : tgt.kind === 'giant' ? 1.5 : 0.3));
            done = true;
          }
        }
      }
      a.x = nx;
      a.d = nd;
      if (done) {
        this.list[i] = this.list[this.list.length - 1];
        this.list.pop();
        this.pool.push(a);
      }
    }
    this.render();
  }

  render() {
    const m = this._m, q = this._q, e = this._e, p = this._p, s = this._s;
    const counts = [0, 0, 0, 0];
    const pos = this.aPos.array, dir = this.aDir.array, col = this.aCol.array, w = this.aW.array;
    let n = 0;
    for (const a of this.list) {
      const t = a.tier;
      const mesh = this.meshes[t];
      e.set(0, -Math.atan2(a.vx, a.vd), 0);
      q.setFromEuler(e);
      const drop = a.dist > RANGE - 5 ? (a.dist - (RANGE - 5)) * 0.12 : 0;
      p.set(a.x, a.y - drop, -a.d);
      m.compose(p, q, s);
      mesh.setMatrixAt(counts[t]++, m);
      // 궤적
      const len = Math.min(a.dist, t >= 3 ? 4.2 : 3.4);
      const sp = Math.hypot(a.vx, a.vd);
      pos[n * 3] = a.x; pos[n * 3 + 1] = a.y - drop; pos[n * 3 + 2] = -a.d + 0.3;
      dir[n * 3] = (a.vx / sp) * len; dir[n * 3 + 1] = 0; dir[n * 3 + 2] = -(a.vd / sp) * len;
      const c = TRAIL_COLORS[t];
      const fade = Math.min(1, a.age * 12) * (a.dist > RANGE - 4 ? Math.max(0, (RANGE - a.dist) / 4) : 1);
      col[n * 4] = c.r; col[n * 4 + 1] = c.g; col[n * 4 + 2] = c.b; col[n * 4 + 3] = fade * 0.9;
      w[n] = t >= 3 ? 0.55 : 0.42;
      n++;
    }
    for (let t = 1; t <= 3; t++) {
      this.meshes[t].count = counts[t];
      this.meshes[t].instanceMatrix.needsUpdate = true;
    }
    this.trailGeo.instanceCount = n;
    this.aPos.needsUpdate = this.aDir.needsUpdate = this.aCol.needsUpdate = this.aW.needsUpdate = true;
  }

  clear() {
    for (const a of this.list) this.pool.push(a);
    this.list.length = 0;
    this.render();
  }
}
