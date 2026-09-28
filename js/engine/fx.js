// 이펙트: GPU 빌보드 파티클, 파편 물리, 충격파 링, 떠오르는 숫자, 화면 흔들림/히트스톱/플래시
import * as THREE from 'three';
import { softCircleTexture, puffTexture, ringTexture } from '../world/textures.js';
import { rand, noise1, clamp } from './util.js';

const PARTICLE_VS = `
attribute vec3 iPos; attribute vec4 iColor; attribute vec3 iVel; attribute vec3 iMisc;
varying vec4 vColor; varying vec2 vUv;
void main(){
  vUv = uv; vColor = iColor;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  vec2 p = position.xy * iMisc.x;
  if (iMisc.z > 0.0) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    float l = length(vv.xy);
    vec2 dir = l > 1e-4 ? vv.xy / l : vec2(0.0, 1.0);
    p.y *= 1.0 + l * iMisc.z;
    p = vec2(dir.y, -dir.x) * p.x + dir * p.y;
  } else {
    float c = cos(iMisc.y), s = sin(iMisc.y);
    p = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  }
  mv.xy += p;
  gl_Position = projectionMatrix * mv;
}`;
const PARTICLE_FS = `
uniform sampler2D map; varying vec4 vColor; varying vec2 vUv;
void main(){
  vec4 t = texture2D(map, vUv);
  gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
}`;

class ParticleSystem {
  constructor(scene, { cap = 2000, texture, blending = THREE.AdditiveBlending, depthWrite = false }) {
    this.cap = cap;
    this.n = 0;
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iColor', this.aColor);
    g.setAttribute('iVel', this.aVel);
    g.setAttribute('iMisc', this.aMisc);
    g.instanceCount = 0;
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: texture } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite,
      blending,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = blending === THREE.AdditiveBlending ? 20 : 10;
    scene.add(this.mesh);
    // CPU 상태
    this.p = new Array(cap);
    for (let i = 0; i < cap; i++)
      this.p[i] = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, s0: 1, s1: 1, r: 1, g: 1, b: 1, a: 1, grav: 0, drag: 0, rot: 0, vr: 0, stretch: 0, fadeIn: 0, floor: -99 };
  }
  spawn(o) {
    if (this.n >= this.cap) return null;
    const p = this.p[this.n++];
    p.x = o.x; p.y = o.y; p.z = o.z;
    p.vx = o.vx || 0; p.vy = o.vy || 0; p.vz = o.vz || 0;
    p.life = p.max = o.life || 0.6;
    p.s0 = o.s0 ?? o.size ?? 0.5;
    p.s1 = o.s1 ?? p.s0;
    const c = o.color;
    p.r = c.r; p.g = c.g; p.b = c.b;
    p.a = o.alpha ?? 1;
    p.grav = o.grav || 0;
    p.drag = o.drag || 0;
    p.rot = o.rot ?? rand(0, 6.28);
    p.vr = o.vr || 0;
    p.stretch = o.stretch || 0;
    p.fadeIn = o.fadeIn || 0;
    p.floor = o.floor ?? -99;
    return p;
  }
  update(dt) {
    const P = this.p;
    let i = 0;
    const pos = this.aPos.array, col = this.aColor.array, vel = this.aVel.array, misc = this.aMisc.array;
    while (i < this.n) {
      const p = P[i];
      p.life -= dt;
      if (p.life <= 0) {
        // 스왑 제거
        this.n--;
        P[i] = P[this.n];
        P[this.n] = p;
        continue;
      }
      const k = Math.exp(-p.drag * dt);
      p.vx *= k; p.vz *= k; p.vy = p.vy * k - p.grav * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < p.floor) { p.y = p.floor; p.vy *= -0.3; p.vx *= 0.6; p.vz *= 0.6; }
      p.rot += p.vr * dt;
      const t = 1 - p.life / p.max;
      const size = p.s0 + (p.s1 - p.s0) * t;
      let a = p.a * (t > 0.6 ? (1 - t) / 0.4 : 1);
      if (p.fadeIn > 0 && t < p.fadeIn) a *= t / p.fadeIn;
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      col[i * 4] = p.r; col[i * 4 + 1] = p.g; col[i * 4 + 2] = p.b; col[i * 4 + 3] = a;
      vel[i * 3] = p.vx; vel[i * 3 + 1] = p.vy; vel[i * 3 + 2] = p.vz;
      misc[i * 3] = size; misc[i * 3 + 1] = p.rot; misc[i * 3 + 2] = p.stretch;
      i++;
    }
    this.geo.instanceCount = this.n;
    this.aPos.needsUpdate = this.aColor.needsUpdate = this.aVel.needsUpdate = this.aMisc.needsUpdate = true;
    this.aPos.clearUpdateRanges();
    this.aPos.addUpdateRange(0, this.n * 3);
    this.aColor.clearUpdateRanges();
    this.aColor.addUpdateRange(0, this.n * 4);
    this.aVel.clearUpdateRanges();
    this.aVel.addUpdateRange(0, this.n * 3);
    this.aMisc.clearUpdateRanges();
    this.aMisc.addUpdateRange(0, this.n * 3);
  }
  clear() {
    this.n = 0;
    this.geo.instanceCount = 0;
  }
}

// 파편 (나무 조각, 돌 덩어리) — 인스턴스 메시 + 간단한 물리
class DebrisSystem {
  constructor(scene, geometry, cap = 300, matOpts = {}) {
    this.cap = cap;
    this.n = 0;
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0, ...matOpts });
    this.mesh = new THREE.InstancedMesh(geometry, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    scene.add(this.mesh);
    this.p = [];
    for (let i = 0; i < cap; i++) this.p.push({ pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), av: new THREE.Vector3(), s: 1, sv: new THREE.Vector3(1, 1, 1), life: 0, max: 1, color: new THREE.Color() });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3();
  }
  spawn(x, y, z, vx, vy, vz, size, color, life = 2.2, stretch = null) {
    if (this.n >= this.cap) {
      // 가장 오래된 것 재활용
      this.n--;
    }
    const p = this.p[this.n++];
    p.pos.set(x, y, z);
    p.vel.set(vx, vy, vz);
    p.q.setFromEuler(this._e.set(rand(0, 6), rand(0, 6), rand(0, 6)));
    p.av.set(rand(-12, 12), rand(-12, 12), rand(-12, 12));
    p.s = size;
    if (stretch) p.sv.copy(stretch);
    else p.sv.set(1, 1, 1);
    p.life = p.max = life * rand(0.8, 1.2);
    p.color.set(color);
    p.color.offsetHSL(0, 0, rand(-0.06, 0.06));
  }
  update(dt) {
    let i = 0;
    const m = this._m;
    while (i < this.n) {
      const p = this.p[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.n--;
        this.p[i] = this.p[this.n];
        this.p[this.n] = p;
        continue;
      }
      p.vel.y -= 26 * dt;
      p.pos.addScaledVector(p.vel, dt);
      const half = p.s * 0.35;
      if (p.pos.y < half) {
        p.pos.y = half;
        if (Math.abs(p.vel.y) > 2) {
          p.vel.y *= -0.35;
          p.vel.x *= 0.6;
          p.vel.z *= 0.6;
          p.av.multiplyScalar(0.6);
        } else {
          p.vel.y = 0;
          p.vel.x *= 0.9;
          p.vel.z *= 0.9;
          p.av.multiplyScalar(0.85);
        }
      }
      this._e.set(p.av.x * dt, p.av.y * dt, p.av.z * dt);
      this._q.setFromEuler(this._e);
      p.q.multiply(this._q);
      const fade = Math.min(1, p.life / 0.5);
      this._s.copy(p.sv).multiplyScalar(p.s * fade);
      m.compose(p.pos, p.q, this._s);
      this.mesh.setMatrixAt(i, m);
      this.mesh.setColorAt(i, p.color);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() {
    this.n = 0;
    this.mesh.count = 0;
  }
}

export class FX {
  constructor(scene, camera, layer) {
    this.scene = scene;
    this.camera = camera;
    this.layer = layer;
    this.glow = new ParticleSystem(scene, { cap: 2500, texture: softCircleTexture() });
    this.smoke = new ParticleSystem(scene, { cap: 900, texture: puffTexture(), blending: THREE.NormalBlending });
    this.rocks = new DebrisSystem(scene, new THREE.DodecahedronGeometry(0.5, 0), 260, { flatShading: true });
    this.planks = new DebrisSystem(scene, new THREE.BoxGeometry(0.22, 0.1, 0.9), 200);
    this.cubes = new DebrisSystem(scene, new THREE.BoxGeometry(0.35, 0.35, 0.35), 200, { roughness: 0.5 });
    // 충격파 링
    this.rings = [];
    const ringTex = ringTexture();
    for (let i = 0; i < 10; i++) {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff })
      );
      m.visible = false;
      m.renderOrder = 15;
      scene.add(m);
      this.rings.push({ mesh: m, life: 0, max: 1, s0: 1, s1: 5 });
    }
    // 떠오르는 숫자 (DOM)
    this.texts = [];
    this.textPool = [];
    this._v = new THREE.Vector3();
    // 화면 효과
    this.trauma = 0;
    this.shakeT = 0;
    this.hitstopT = 0;
    this.flashA = 0;
    this.flashColor = new THREE.Color(1, 1, 1);
    this.slowT = 0;
    this.slowScale = 1;
    this.haptics = true;
  }

  // ---------- 조합 이펙트 ----------
  sparks(x, y, z, color, n = 6, speed = 6, size = 0.18) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(0.4, 1) * speed;
      this.glow.spawn({ x, y, z, vx: Math.cos(a) * s, vy: rand(0.5, 1.4) * speed * 0.6, vz: Math.sin(a) * s, life: rand(0.25, 0.5), size, s1: size * 0.3, color, grav: 18, drag: 2, stretch: 0.06, floor: 0.05 });
    }
  }
  flare(x, y, z, color, size = 1.5, life = 0.25) {
    this.glow.spawn({ x, y, z, life, s0: size * 0.6, s1: size, color, alpha: 1 });
  }
  puff(x, y, z, color, n = 4, size = 0.9, spread = 0.4, life = 0.7) {
    for (let i = 0; i < n; i++) {
      this.smoke.spawn({ x: x + rand(-spread, spread), y: y + rand(0, spread), z: z + rand(-spread, spread), vx: rand(-1, 1), vy: rand(0.6, 1.8), vz: rand(-1, 1), life: rand(life * 0.7, life * 1.2), s0: size * 0.5, s1: size * 1.3, color, alpha: 0.75, drag: 2.5, vr: rand(-2, 2) });
    }
  }
  dust(x, z, w, color, n = 20) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const s = rand(2, 6);
      this.smoke.spawn({ x: x + rand(-w, w) * 0.5, y: rand(0.2, 1.2), z: z + rand(-0.5, 0.5), vx: Math.cos(a) * s, vy: rand(0.5, 3), vz: Math.sin(a) * s * 0.6, life: rand(0.8, 1.6), s0: 1.2, s1: 3.2, color, alpha: 0.6, drag: 2.2, vr: rand(-1, 1) });
    }
  }
  ring(x, z, color, s0 = 0.5, s1 = 6, life = 0.45, y = 0.08) {
    const r = this.rings.find((r) => r.life <= 0) || this.rings[0];
    r.life = r.max = life;
    r.s0 = s0;
    r.s1 = s1;
    r.mesh.position.set(x, y, z);
    r.mesh.material.color.copy(color);
    r.mesh.visible = true;
  }
  woodBurst(x, y, z, w, color = 0x9a6634) {
    for (let i = 0; i < 26; i++) {
      this.planks.spawn(x + rand(-w / 2, w / 2), y + rand(0, 1.2), z + rand(-0.2, 0.2), rand(-5, 5), rand(4, 11), rand(-9, -2), rand(0.6, 1.2), color, 2.5);
    }
    for (let i = 0; i < 12; i++) this.cubes.spawn(x + rand(-w / 2, w / 2), y + rand(0, 1), z, rand(-5, 5), rand(3, 9), rand(-7, -1), rand(0.4, 0.8), 0x5a5f6a, 2.5);
    this.dust(x, z, w, new THREE.Color(0.85, 0.75, 0.6), 18);
  }
  stoneBurst(x, y, z, w, h, color = 0xcfc0a4) {
    for (let i = 0; i < 70; i++) {
      this.rocks.spawn(x + rand(-w / 2, w / 2), y + rand(0, h), z + rand(-0.8, 0.8), rand(-7, 7), rand(2, 12), rand(-10, 2), rand(0.4, 1.3), color, 3);
    }
    this.dust(x, z, w * 1.2, new THREE.Color(0.9, 0.85, 0.78), 40);
  }

  // ---------- 떠오르는 숫자 ----------
  text(x, y, z, str, cls = 'dmg', life = 0.9) {
    let el = this.textPool.pop();
    if (!el) {
      el = document.createElement('div');
      this.layer.appendChild(el);
    }
    el.className = 'ftext ' + cls;
    el.textContent = str;
    el.style.display = 'block';
    this.texts.push({ el, x, y, z, vy: 2.2, life, max: life });
  }

  // ---------- 화면 효과 ----------
  shake(amount) {
    this.trauma = Math.min(1, this.trauma + amount);
    // 큰 충격은 휴대폰 진동으로도 전달
    if (this.haptics && amount >= 0.25 && navigator.vibrate) {
      const now = performance.now();
      if (now - (this.lastBuzz || 0) > 120) {
        this.lastBuzz = now;
        navigator.vibrate(Math.round(Math.min(70, amount * 90)));
      }
    }
  }
  hitstop(t) {
    this.hitstopT = Math.max(this.hitstopT, t);
  }
  slowmo(t, scale = 0.3) {
    this.slowT = t;
    this.slowScale = scale;
  }
  flash(color, a = 0.5) {
    this.flashColor.set(color);
    this.flashA = Math.max(this.flashA, a);
  }
  // 게임 시간 배율 (히트스톱/슬로모션)
  timeScale(realDt) {
    if (this.hitstopT > 0) {
      this.hitstopT -= realDt;
      return 0.04;
    }
    if (this.slowT > 0) {
      this.slowT -= realDt;
      return this.slowScale;
    }
    return 1;
  }
  shakeOffset(realDt, out) {
    this.shakeT += realDt;
    this.trauma = Math.max(0, this.trauma - realDt * 1.5);
    const s = this.trauma * this.trauma;
    out.x = noise1(this.shakeT * 22) * 0.9 * s;
    out.y = noise1(this.shakeT * 22 + 50) * 0.7 * s;
    out.z = noise1(this.shakeT * 22 + 100) * 0.05 * s; // 롤
    return out;
  }

  update(dt, realDt, flashUniform) {
    this.glow.update(dt);
    this.smoke.update(dt);
    this.rocks.update(dt);
    this.planks.update(dt);
    this.cubes.update(dt);
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const t = 1 - Math.max(0, r.life) / r.max;
      const s = r.s0 + (r.s1 - r.s0) * (1 - Math.pow(1 - t, 3));
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = 1 - t;
      if (r.life <= 0) r.mesh.visible = false;
    }
    // 떠오르는 숫자
    const cam = this.camera;
    const w = window.innerWidth, h = window.innerHeight;
    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= realDt;
      if (t.life <= 0) {
        t.el.style.display = 'none';
        this.textPool.push(t.el);
        this.texts.splice(i, 1);
        continue;
      }
      t.y += t.vy * realDt;
      t.vy *= Math.exp(-3 * realDt);
      this._v.set(t.x, t.y, t.z).project(cam);
      const k = 1 - t.life / t.max;
      const sc = k < 0.15 ? 0.6 + (k / 0.15) * 0.7 : 1.3 - Math.min(0.3, (k - 0.15) * 1.5);
      const op = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      t.el.style.transform = `translate(${((this._v.x + 1) / 2) * w}px, ${((1 - this._v.y) / 2) * h}px) translate(-50%,-50%) scale(${sc})`;
      t.el.style.opacity = op;
    }
    // 플래시
    this.flashA = Math.max(0, this.flashA - realDt * 3.5);
    if (flashUniform) {
      flashUniform.set(this.flashColor.r, this.flashColor.g, this.flashColor.b, clamp(this.flashA, 0, 1));
    }
  }

  clear() {
    this.glow.clear();
    this.smoke.clear();
    this.rocks.clear();
    this.planks.clear();
    this.cubes.clear();
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const t of this.texts) {
      t.el.style.display = 'none';
      this.textPool.push(t.el);
    }
    this.texts.length = 0;
    this.trauma = 0;
    this.hitstopT = 0;
    this.slowT = 0;
    this.flashA = 0;
  }
}
