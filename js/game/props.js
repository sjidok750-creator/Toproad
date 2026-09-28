// 스테이지 오브젝트: 숫자 게이트, 나무 바리케이드, 돌기둥, 보상 통
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SignTexture, NumberTexture, gateStyleFor, gateText } from './labels.js';
import { woodTexture, brickTexture, crackTexture, softCircleTexture } from '../world/textures.js';
import { GeoBuilder, makeCharMaterial, buildTroopIcon, buildCrossbowIcon, buildBoltIcon } from '../world/models.js';
import { rand, easeOutBack, formatNum } from '../engine/util.js';
import { audio } from '../engine/audio.js';

const PI = Math.PI;
let SHARED = null;
function shared() {
  if (SHARED) return SHARED;
  const wood = woodTexture({ seed: 5, planks: 5 });
  const barrelWood = woodTexture({ seed: 8, planks: 8, hue: 26 });
  const stone = brickTexture({ base: [35, 18, 74], rows: 5, cols: 2, seed: 21 });
  const cracks = [crackTexture(3), crackTexture(7), crackTexture(13)];
  SHARED = {
    wood,
    barrelWood,
    stone,
    cracks,
    glowTex: softCircleTexture(128),
    postMat: makeCharMaterial({ rim: 0.2, metalness: 0.3, roughness: 0.5 }),
    woodMat: new THREE.MeshStandardMaterial({ map: wood, roughness: 0.75 }),
    barrelMat: new THREE.MeshStandardMaterial({ map: barrelWood, roughness: 0.7 }),
    ironMat: new THREE.MeshStandardMaterial({ color: 0x4a4e58, metalness: 0.6, roughness: 0.45 }),
    stoneMat: new THREE.MeshStandardMaterial({ map: stone, roughness: 0.9 }),
    capMat: new THREE.MeshStandardMaterial({ color: 0xd8ccb4, roughness: 0.85 }),
  };
  return SHARED;
}

class Prop {
  constructor(game, def) {
    this.game = game;
    this.def = def;
    this.d = def.d;
    this.x = def.x || 0;
    this.w = def.w || 3.4;
    this.hd = 0.2;
    this.alive = true;
    this.solid = false;
    this.group = new THREE.Group();
    this.group.position.set(this.x, 0, -this.d);
    game.world.add(this.group);
    this.bumpT = 0;
    this.disposables = [];
  }
  get hw() {
    return this.w / 2;
  }
  own(o) {
    this.disposables.push(o);
    return o;
  }
  remove() {
    this.alive = false;
    this.game.world.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
    });
    for (const d of this.disposables) d.dispose?.();
  }
  bump(a = 1) {
    this.bumpT = Math.max(this.bumpT, 0.18 * a);
  }
  update(dt) {
    if (this.bumpT > 0) {
      this.bumpT = Math.max(0, this.bumpT - dt);
    }
  }
}

// ---------- 숫자 게이트 ----------
export class Gate extends Prop {
  constructor(game, def) {
    super(game, def);
    this.kind = 'gate';
    this.op = def.op || 'add';
    this.v = def.v;
    this.pair = def.pair || null;
    this.hd = 0.15;
    // 음수 게이트는 쏘면 0을 넘어 조금 더 올라갈 수 있다
    this.cap = this.v < 0 ? Math.max(3, Math.round(-this.v * 0.25)) : this.v;
    this.state = 'idle';
    this.t = 0;
    this.build();
  }
  build() {
    const S = shared();
    const w = this.w;
    const style = gateStyleFor(this.op, this.v);
    this.sign = this.own(new SignTexture(512, 200));
    this.sign.draw(gateText(this.op, this.v), style);
    this.style = style;
    const signMat = this.own(new THREE.MeshStandardMaterial({ map: this.sign.texture, emissive: 0xffffff, emissiveMap: this.sign.texture, emissiveIntensity: 0.5, roughness: 0.35, transparent: true }));
    this.signMat = signMat;
    const sw = w - 0.3;
    const sh = Math.min(1.35, sw * 0.39);
    this.panel = new THREE.Group();
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), signMat);
    plane.position.z = 0.075;
    const back = new THREE.Mesh(new RoundedBoxGeometry(sw, sh, 0.14, 2, 0.05), this.own(new THREE.MeshStandardMaterial({ color: new THREE.Color(style.edge), roughness: 0.5, transparent: true })));
    this.backMat = back.material;
    back.castShadow = true;
    this.panel.add(back, plane);
    this.panel.position.y = 0.35 + sh / 2;
    this.group.add(this.panel);
    // 기둥
    const pb = new GeoBuilder();
    for (const s of [-1, 1]) {
      pb.add(new THREE.CylinderGeometry(0.08, 0.1, 1.95, 8).translate(s * (sw / 2 + 0.04), 0.97, 0), 0xdfe6f0);
      pb.add(new THREE.SphereGeometry(0.14, 8, 6).translate(s * (sw / 2 + 0.04), 2.0, 0), 0xf2b634);
      pb.add(new THREE.CylinderGeometry(0.16, 0.2, 0.14, 8).translate(s * (sw / 2 + 0.04), 0.07, 0), 0x5b6270);
    }
    this.posts = new THREE.Mesh(pb.build(), S.postMat);
    this.posts.castShadow = true;
    this.group.add(this.posts);
    // 바닥 빛줄기
    const glowMat = this.own(new THREE.MeshBasicMaterial({ map: S.glowTex, color: new THREE.Color(style.top).multiplyScalar(1.6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.7 }));
    this.glowMat = glowMat;
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(sw * 1.2, 1.4).rotateX(-PI / 2), glowMat);
    glow.position.y = 0.03;
    this.group.add(glow);
  }
  refresh() {
    const style = gateStyleFor(this.op, this.v);
    this.sign.draw(gateText(this.op, this.v), style);
    if (style !== this.style) {
      this.style = style;
      this.backMat.color.set(style.edge);
      this.glowMat.color.set(style.top).multiplyScalar(1.6);
    }
  }
  // 화살에 반응하는지 (음수 게이트만 쏘아서 올릴 수 있음)
  get shootable() {
    return this.state === 'idle' && this.op === 'add' && this.v < this.cap;
  }
  // 화살 명중: 값 +1
  onArrow(arrow) {
    if (!this.shootable) return false;
    const before = this.v;
    this.v = Math.min(this.cap, this.v + 1);
    this.refresh();
    this.bump(0.6);
    const fx = this.game.fx;
    fx.sparks(arrow.x, 1.0, -this.d + 0.2, new THREE.Color(this.style.top).multiplyScalar(2), 3, 4, 0.14);
    if (before < 0 && this.v >= 0) {
      fx.flare(this.x, 1.0, -this.d + 0.3, new THREE.Color(1.5, 2, 3), 3.5, 0.3);
      audio.upgrade();
    } else audio.hit();
    return true;
  }
  apply(count) {
    if (this.op === 'mul') return count * this.v;
    return count + this.v;
  }
  collect() {
    this.state = 'pop';
    this.t = 0;
    const fx = this.game.fx;
    const c = new THREE.Color(this.style.top);
    const good = this.op === 'mul' || this.v >= 0;
    for (let i = 0; i < 18; i++) {
      fx.glow.spawn({ x: this.x + rand(-this.hw, this.hw), y: rand(0.4, 1.8), z: -this.d, vx: rand(-2, 2), vy: rand(2, 6), vz: rand(-3, 1), life: rand(0.4, 0.8), size: 0.3, s1: 0.05, color: c.clone().multiplyScalar(2.5), grav: 6, drag: 1 });
    }
    fx.ring(this.x, -this.d, c.clone().multiplyScalar(1.5), 0.5, this.w * 1.4, 0.4);
    audio.gate(good);
  }
  fade() {
    if (this.state !== 'idle') return;
    this.state = 'fade';
    this.t = 0;
  }
  update(dt) {
    super.update(dt);
    this.t += dt;
    if (this.state === 'idle') {
      const b = this.bumpT / 0.18;
      this.panel.scale.set(1 + b * 0.12, 1 + b * 0.12, 1);
      this.glowMat.opacity = 0.55 + Math.sin(this.t * 4 + this.d) * 0.15;
    } else if (this.state === 'pop') {
      const k = Math.min(1, this.t / 0.35);
      this.panel.scale.setScalar(1 + k * 0.5);
      this.panel.position.y += dt * 3;
      this.signMat.opacity = this.backMat.opacity = 1 - k;
      this.glowMat.opacity = 0.8 * (1 - k);
      this.posts.scale.setScalar(Math.max(0.01, 1 - k));
      if (k >= 1) this.remove();
    } else if (this.state === 'fade') {
      const k = Math.min(1, this.t / 0.4);
      this.signMat.opacity = this.backMat.opacity = 1 - k;
      this.glowMat.opacity = 0.5 * (1 - k);
      this.group.position.y = -k * 0.5;
      if (k >= 1) this.remove();
    }
  }
}

// ---------- 나무 바리케이드 ----------
export class Barrier extends Prop {
  constructor(game, def) {
    super(game, def);
    this.kind = 'barrier';
    this.solid = true;
    this.hp = this.maxHp = def.hp;
    this.hd = 0.3;
    this.build();
  }
  build() {
    const S = shared();
    const w = this.w;
    const bw = w - 0.9;
    this.board = new THREE.Group();
    const planks = new THREE.Mesh(new THREE.BoxGeometry(bw, 1.35, 0.26), S.woodMat);
    planks.position.y = 0.95;
    planks.castShadow = true;
    planks.receiveShadow = true;
    this.board.add(planks);
    for (const y of [0.45, 1.45]) {
      const band = new THREE.Mesh(new THREE.BoxGeometry(bw + 0.04, 0.14, 0.3), S.ironMat);
      band.position.y = y;
      band.castShadow = true;
      this.board.add(band);
    }
    this.num = this.own(new NumberTexture(256, 160));
    this.num.draw(String(Math.ceil(this.hp)));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(bw * 0.8, 1.9), 1.2), this.own(new THREE.MeshBasicMaterial({ map: this.num.texture, transparent: true, depthWrite: false })));
    lab.position.set(0, 0.95, 0.16);
    this.board.add(lab);
    this.group.add(this.board);
    const pb = new GeoBuilder();
    for (const s of [-1, 1]) {
      const px = s * (bw / 2 + 0.22);
      pb.add(new THREE.BoxGeometry(0.46, 2.1, 0.46).translate(px, 1.05, 0), 0x7c808c);
      pb.add(new THREE.BoxGeometry(0.54, 0.16, 0.54).translate(px, 2.1, 0), 0x5d616c);
      pb.add(new THREE.BoxGeometry(0.54, 0.16, 0.54).translate(px, 0.1, 0), 0x5d616c);
      pb.add(new THREE.ConeGeometry(0.2, 0.55, 6).translate(px, 2.45, 0), 0xa8afbd);
      for (const y of [0.6, 1.1, 1.6]) pb.add(new THREE.SphereGeometry(0.05, 5, 4).translate(px, y, 0.24), 0xc8ccd6);
    }
    this.posts = new THREE.Mesh(pb.build(), S.postMat);
    this.posts.castShadow = true;
    this.group.add(this.posts);
  }
  damage(amount, x = this.x, y = 1) {
    if (!this.alive || this.hp <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.num.draw(String(Math.max(0, Math.ceil(this.hp))));
    this.bump(1);
    const fx = this.game.fx;
    if (Math.random() < 0.5) fx.planks.spawn(x, y, -this.d + 0.2, rand(-2, 2), rand(2, 5), rand(0, 3), rand(0.25, 0.45), 0x9a6634, 1.2);
    fx.sparks(x, y, -this.d + 0.2, new THREE.Color(2, 1.6, 1), 2, 3, 0.12);
    if (this.hp <= 0) this.break();
    else audio.crack();
    return dealt;
  }
  break() {
    const fx = this.game.fx;
    fx.woodBurst(this.x, 0.3, -this.d, this.w - 0.6);
    fx.shake(0.28);
    fx.hitstop(0.05);
    audio.woodBreak();
    this.game.onPropDestroyed(this);
    this.remove();
  }
  update(dt) {
    super.update(dt);
    const b = this.bumpT / 0.18;
    this.board.position.z = -b * 0.12;
    this.board.rotation.x = -b * 0.08;
  }
}

// ---------- 돌기둥 ----------
export class Pillar extends Prop {
  constructor(game, def) {
    super(game, def);
    this.kind = 'pillar';
    this.solid = true;
    this.hp = this.maxHp = def.hp;
    this.hd = 1.0;
    this.build();
  }
  build() {
    const S = shared();
    const w = this.w - 0.2;
    const h = this.def.h || 6.5;
    this.h = h;
    this.body = new THREE.Group();
    const col = new THREE.Mesh(new THREE.BoxGeometry(w, h, 2.0), S.stoneMat);
    col.position.y = h / 2 + 0.8;
    col.castShadow = true;
    col.receiveShadow = true;
    const cap = new THREE.Mesh(new RoundedBoxGeometry(w + 0.4, 0.5, 2.4, 2, 0.12), S.capMat);
    cap.position.y = h + 1.0;
    cap.castShadow = true;
    const base = new THREE.Mesh(new RoundedBoxGeometry(w + 0.5, 0.9, 2.5, 2, 0.12), S.capMat);
    base.position.y = 0.45;
    base.castShadow = true;
    base.receiveShadow = true;
    this.body.add(col, cap, base);
    // 균열 데칼
    this.crackMats = [];
    S.cracks.forEach((tex, i) => {
      const m = this.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.9, h * 0.55), m);
      p.position.set((i - 1) * 0.2, 1.4 + h * (0.25 + i * 0.18), 1.01);
      this.body.add(p);
      this.crackMats.push(m);
    });
    this.num = this.own(new NumberTexture(512, 200));
    this.num.draw(formatNum(Math.ceil(this.hp)));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(w * 0.95, 3.4), 1.3), this.own(new THREE.MeshBasicMaterial({ map: this.num.texture, transparent: true, depthWrite: false })));
    lab.position.set(0, 1.55, 1.02);
    this.body.add(lab);
    this.group.add(this.body);
  }
  damage(amount, x = this.x, y = 2) {
    if (!this.alive || this.hp <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.num.draw(formatNum(Math.max(0, Math.ceil(this.hp))));
    this.bump(0.5);
    const f = 1 - this.hp / this.maxHp;
    this.crackMats.forEach((m, i) => (m.opacity = Math.min(1, Math.max(0, (f - i * 0.28) * 3))));
    const fx = this.game.fx;
    if (Math.random() < 0.35) fx.rocks.spawn(x, y, -this.d + 1.1, rand(-3, 3), rand(2, 6), rand(1, 4), rand(0.15, 0.35), 0xcfc0a4, 1.2);
    if (Math.random() < 0.3) fx.puff(x, y, -this.d + 1.1, new THREE.Color(0.9, 0.85, 0.78), 1, 0.7, 0.2, 0.6);
    if (this.hp <= 0) this.break();
    else audio.thud();
    return dealt;
  }
  break() {
    const fx = this.game.fx;
    fx.stoneBurst(this.x, 0.5, -this.d, this.w, this.h);
    fx.shake(0.55);
    fx.hitstop(0.08);
    fx.flash(0xffffff, 0.25);
    audio.stoneBreak();
    this.game.onPropDestroyed(this);
    this.remove();
  }
  update(dt) {
    super.update(dt);
    const b = this.bumpT / 0.18;
    this.body.position.x = Math.sin(this.bumpT * 90) * b * 0.06;
  }
}

// ---------- 보상 통 ----------
function barrelGeometry() {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push(new THREE.Vector2(0.55 + Math.sin(t * PI) * 0.12, t * 1.4));
  }
  const g = new THREE.LatheGeometry(pts, 16);
  return g;
}
let BARREL_GEO = null;

export class Barrel extends Prop {
  constructor(game, def) {
    super(game, def);
    this.kind = 'barrel';
    this.hp = this.maxHp = def.hp;
    this.reward = def.reward;
    this.hd = 0.7;
    this.w = 1.5;
    this.t = rand(0, 5);
    this.state = 'idle';
    this.build();
  }
  build() {
    const S = shared();
    if (!BARREL_GEO) {
      BARREL_GEO = barrelGeometry();
      BARREL_GEO.userData.shared = true;
    }
    this.body = new THREE.Group();
    const bar = new THREE.Mesh(BARREL_GEO, S.barrelMat);
    bar.castShadow = true;
    bar.receiveShadow = true;
    this.body.add(bar);
    for (const y of [0.18, 1.22]) {
      const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.045, 5, 18).rotateX(PI / 2), S.ironMat);
      hoop.position.y = y;
      this.body.add(hoop);
    }
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 16), S.barrelMat);
    lid.position.y = 1.4;
    this.body.add(lid);
    this.num = this.own(new NumberTexture(256, 128));
    this.num.draw(formatNum(Math.ceil(this.hp)));
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.62), this.own(new THREE.MeshBasicMaterial({ map: this.num.texture, transparent: true, depthWrite: false })));
    lab.position.set(0, 0.7, 0.7);
    this.body.add(lab);
    this.group.add(this.body);
    // 보상 아이콘
    const r = this.reward;
    if (r.kind === 'troops') this.icon = buildTroopIcon();
    else if (r.kind === 'weapon') this.icon = buildCrossbowIcon(r.tier || 2);
    else this.icon = buildBoltIcon();
    this.icon.position.y = 1.75;
    this.icon.scale.setScalar(r.kind === 'troops' ? 1.1 : 0.9);
    this.group.add(this.icon);
    // 아이콘 후광
    const S2 = shared();
    const haloCol = r.kind === 'troops' ? new THREE.Color(0.5, 0.9, 2) : r.kind === 'weapon' ? new THREE.Color(2, 1.5, 0.4) : new THREE.Color(2, 1.8, 0.3);
    this.halo = new THREE.Sprite(this.own(new THREE.SpriteMaterial({ map: S2.glowTex, color: haloCol, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.5 })));
    this.halo.scale.setScalar(2.2);
    this.halo.position.y = 2.1;
    this.group.add(this.halo);
  }
  damage(amount, x = this.x, y = 0.8) {
    if (this.state !== 'idle' || this.hp <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    this.num.draw(formatNum(Math.max(0, Math.ceil(this.hp))));
    this.bump(1);
    const fx = this.game.fx;
    fx.sparks(x, y, -this.d + 0.6, new THREE.Color(2, 1.5, 0.8), 2, 3, 0.12);
    if (this.hp <= 0) this.break();
    else audio.hit();
    return dealt;
  }
  break() {
    const fx = this.game.fx;
    this.state = 'reward';
    this.t = 0;
    this.group.remove(this.body);
    fx.woodBurst(this.x, 0.3, -this.d, 1.2, 0x8a5a2b);
    fx.flare(this.x, 1.8, -this.d, new THREE.Color(2.5, 2, 1), 4, 0.35);
    fx.shake(0.2);
    audio.woodBreak();
    audio.reward();
    this.iconStart = this.icon.position.clone();
  }
  // 부수지 못하고 지나침 → 튕겨 나감
  knock(dir) {
    if (this.state !== 'idle') return;
    this.state = 'knocked';
    this.t = 0;
    this.vel = new THREE.Vector3(dir * rand(4, 7), 6, rand(-2, 2));
    this.spin = new THREE.Vector3(rand(-8, 8), rand(-4, 4), rand(-8, 8));
    audio.thud();
  }
  update(dt) {
    super.update(dt);
    this.t += dt;
    const b = this.bumpT / 0.18;
    if (this.state === 'idle') {
      this.body.scale.set(1 + b * 0.12, 1 - b * 0.1, 1 + b * 0.12);
      this.icon.rotation.y += dt * 1.6;
      this.icon.position.y = 1.75 + Math.sin(this.t * 3) * 0.12;
      this.halo.material.opacity = 0.35 + Math.sin(this.t * 4) * 0.15;
    } else if (this.state === 'reward') {
      // 아이콘이 부대로 날아감
      const sq = this.game.squad;
      const k = Math.min(1, this.t / 0.55);
      const e = k * k;
      const tx = sq.x - this.x;
      const tz = -(sq.d - this.d);
      this.icon.position.set(tx * e, this.iconStart.y + Math.sin(k * PI) * 2.5 + (1.5 - this.iconStart.y) * e, tz * e);
      this.icon.rotation.y += dt * 12;
      this.icon.scale.setScalar(1 + Math.sin(k * PI) * 0.6);
      this.halo.position.copy(this.icon.position);
      if (k >= 1) {
        this.game.applyReward(this.reward, this);
        this.remove();
      }
    } else if (this.state === 'knocked') {
      this.vel.y -= 25 * dt;
      this.group.position.addScaledVector(this.vel, dt);
      this.group.rotation.x += this.spin.x * dt;
      this.group.rotation.z += this.spin.z * dt;
      this.halo.material.opacity = Math.max(0, 0.5 - this.t);
      if (this.t > 1.5) this.remove();
    }
  }
}

export { easeOutBack };
