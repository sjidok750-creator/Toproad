// 거인(몽둥이)과 보스(철퇴 기사)
import * as THREE from 'three';
import { buildGiant, buildBoss } from '../world/models.js';
import { SpriteLabel } from './labels.js';
import { rand, clamp, lerp, formatNum } from '../engine/util.js';
import { softCircleTexture, ringTexture } from '../world/textures.js';
import { audio } from '../engine/audio.js';

const PI = Math.PI;

class BigUnit {
  constructor(game, def, root, scale) {
    this.game = game;
    this.d = def.d;
    this.x = def.x || 0;
    this.hp = this.maxHp = def.hp;
    this.alive = true;
    this.solid = true;
    this.root = root;
    this.u = root.userData;
    root.scale.setScalar(scale);
    root.rotation.y = PI;
    root.position.set(this.x, 0, -this.d);
    game.world.add(root);
    this.t = 0;
    this.walkPhase = 0;
    this.flash = 0;
    this.dmgAcc = 0;
    this.dmgT = 0;
    this.hitRecoil = 0;
    this.state = 'idle';
  }
  damage(amount, x, y) {
    if (!this.alive || this.hp <= 0) return 0;
    const dealt = Math.min(this.hp, amount);
    this.hp -= dealt;
    // 연속 피격 시에도 형체가 보이도록 번쩍임은 간격을 두고 짧게
    if (this.flash < 0.05 && this.t - (this.lastFlash || -1) > 0.16) {
      this.flash = this.kind === 'boss' ? 0.4 : 0.6;
      this.lastFlash = this.t;
    }
    this.hitRecoil = Math.min(1, this.hitRecoil + 0.25);
    this.dmgAcc += dealt;
    this.label.pulse(0.08);
    if (Math.random() < 0.4) this.game.fx.sparks(x, y, -this.d + this.hd, new THREE.Color(2.5, 1.2, 0.6), 2, 4, 0.14);
    if (Math.random() < 0.35) audio.hit();
    if (this.hp <= 0) this.die();
    return dealt;
  }
  commonUpdate(dt) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 11);
    this.hitRecoil = Math.max(0, this.hitRecoil - dt * 4);
    this.u.mat.userData.flashAll.value = this.flash * 0.7;
    this.dmgT += dt;
    if (this.dmgT > 0.28 && this.dmgAcc > 0) {
      this.game.fx.text(this.x + rand(-1.4, 1.4), this.topY * rand(0.45, 0.75), -this.d + this.hd, '-' + formatNum(Math.ceil(this.dmgAcc)), 'dmg');
      this.dmgAcc = 0;
      this.dmgT = 0;
    }
    if (this.alive && this.label.sprite.visible !== false) {
      this.label.set(Math.ceil(this.hp), this.hp / this.maxHp);
      this.label.update(dt, this.x, this.topY + 0.8, -this.d);
    }
  }
  remove() {
    this.game.world.remove(this.root);
    this.label?.dispose();
    this.root.traverse((o) => o.geometry?.dispose());
    this.u.mat.dispose();
  }
}

// ---------- 거인 ----------
export class Giant extends BigUnit {
  constructor(game, def) {
    super(game, def, buildGiant(), def.scale || 1.35);
    this.kind = 'giant';
    this.hw = 1.2 * (def.scale || 1.35);
    this.hd = 0.7;
    this.topY = 3.4 * (def.scale || 1.35) / 1.35;
    this.speed = def.speed ?? 1.4;
    this.trigger = def.trigger ?? 32;
    this.label = new SpriteLabel(game.overlay, { w: 256, h: 128, scale: 1.8, bar: true });
    this.label.set(this.hp, 1);
    this.label.update(0, this.x, this.topY + 0.8, -this.d);
    this.swingT = 0;
    this.contact = false;
  }
  die() {
    this.alive = false;
    this.state = 'dying';
    this.dieT = 0;
    this.label.visible = false;
    const fx = this.game.fx;
    fx.hitstop(0.09);
    fx.shake(0.5);
    fx.flash(0xffffff, 0.3);
    audio.boom();
    this.game.onBigKilled(this);
  }
  update(dt) {
    const u = this.u;
    const sq = this.game.squad;
    if (this.state === 'dying') {
      this.dieT += dt;
      const k = Math.min(1, this.dieT / 0.7);
      u.body.rotation.x = -k * k * 1.45;
      u.body.position.y = -k * 0.2;
      if (this.dieT > 0.7 && !this.landed) {
        this.landed = true;
        this.game.fx.dust(this.x, -this.d - 1.5, 4, new THREE.Color(...this.game.theme.dust), 26);
        this.game.fx.shake(0.4);
        audio.thud();
      }
      if (this.dieT > 1.4) {
        this.root.scale.multiplyScalar(Math.max(0, 1 - dt * 5));
      }
      if (this.dieT > 1.8) {
        this.game.fx.puff(this.x, 1, -this.d, new THREE.Color(1, 0.9, 0.85), 6, 2, 1, 0.8);
        this.remove();
        this.state = 'gone';
      }
      return;
    }
    if (this.state === 'gone') return;
    if (this.state === 'idle' && sq.d > this.d - this.trigger) {
      this.state = 'walk';
      audio.roar();
    }
    this.contact = this.game.isInContact(this);
    if (this.state === 'walk' && !this.contact) {
      this.d -= this.speed * dt;
      this.x = lerp(this.x, clamp(sq.x, this.x - 2, this.x + 2), dt * 0.3);
      this.walkPhase += dt * 5;
    }
    // 걷기 애니메이션
    const w = this.state === 'walk' && !this.contact ? 1 : 0;
    const s = Math.sin(this.walkPhase);
    u.legL.rotation.x = s * 0.5 * w;
    u.legR.rotation.x = -s * 0.5 * w;
    u.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.08 * w;
    u.armL.rotation.x = -s * 0.4 * w;
    u.body.rotation.x = -this.hitRecoil * 0.12;
    // 몽둥이 휘두르기
    if (this.contact) {
      this.swingT += dt;
      const cyc = (this.swingT % 0.8) / 0.8;
      u.armR.rotation.x = cyc < 0.6 ? lerp(0, -2.4, cyc / 0.6) : lerp(-2.4, 0.4, (cyc - 0.6) / 0.4);
      if (cyc >= 0.85 && !this.swung) {
        this.swung = true;
        const fx = this.game.fx;
        fx.shake(0.25);
        fx.dust(this.x, -this.d + 2, 2.5, new THREE.Color(...this.game.theme.dust), 8);
        fx.ring(this.x, -this.d + 2.2, new THREE.Color(1.5, 1.2, 1), 0.5, 5, 0.35);
        audio.thud();
      }
      if (cyc < 0.5) this.swung = false;
    } else {
      u.armR.rotation.x = lerp(u.armR.rotation.x, s * 0.4 * w - 0.2, dt * 6);
    }
    this.root.position.set(this.x, 0, -this.d);
    this.commonUpdate(dt);
  }
}

// ---------- 보스 ----------
export class Boss extends BigUnit {
  constructor(game, def) {
    super(game, def, buildBoss(), 2.05);
    this.kind = 'boss';
    this.hw = 3.0;
    this.hd = 1.6;
    this.topY = 9.8;
    this.speed = def.speed ?? 0.95;
    this.label = new SpriteLabel(game.overlay, { w: 320, h: 140, scale: 2.4, bar: true });
    this.label.set(this.hp, 1);
    this.label.visible = false;
    this.def = def;
    this.attackT = 2.5;
    this.summonT = def.summonEvery ?? 7;
    this.atk = null;
    // 경고 원판
    const S = { ring: ringTexture(), soft: softCircleTexture(128) };
    this.teleGroup = new THREE.Group();
    // 위험 범위는 병사들 위로도 보이도록 깊이 테스트 없이 그린다
    this.teleFill = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 0.08, 0.04), transparent: true, opacity: 0.3, depthWrite: false, depthTest: false }));
    this.teleRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.35, 0.2), transparent: true, depthWrite: false, depthTest: false }));
    this.teleGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ map: S.ring, color: new THREE.Color(3, 0.25, 0.1), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
    this.teleInner = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.2, 0.1), transparent: true, opacity: 0.4, depthWrite: false, depthTest: false }));
    for (const m of [this.teleFill, this.teleInner, this.teleGlow, this.teleRing]) m.renderOrder = 30;
    this.teleGroup.add(this.teleFill, this.teleInner, this.teleGlow, this.teleRing);
    this.teleGroup.position.y = 0.06;
    this.teleGroup.visible = false;
    this.teleGroup.renderOrder = 5;
    game.world.add(this.teleGroup);
    // 투척용 가시공
    this.projectile = this.u.ball.clone();
    this.projectile.visible = false;
    this.projectile.scale.setScalar(2.05);
    game.world.add(this.projectile);
    this.textures = S;
  }
  activate() {
    this.state = 'intro';
    this.introT = 0;
    audio.roar();
    this.game.fx.shake(0.35);
  }
  die() {
    this.alive = false;
    this.state = 'dying';
    this.dieT = 0;
    this.label.visible = false;
    this.teleGroup.visible = false;
    this.projectile.visible = false;
    const fx = this.game.fx;
    fx.hitstop(0.15);
    fx.slowmo(1.6, 0.25);
    fx.shake(0.8);
    fx.flash(0xffffff, 0.7);
    audio.boom();
    audio.roar();
    this.game.onBigKilled(this);
  }
  startAttack() {
    const sq = this.game.squad;
    const gap = this.d - this.hd - (sq.d + sq.rz);
    if (gap < 8) {
      // 근접 내려찍기
      this.atk = { type: 'smash', t: 0, wind: 0.95, x: clamp(sq.x, this.x - 3, this.x + 3), d: this.d - this.hd - 4.2, r: 3.4 };
    } else {
      // 가시공 투척
      const r = clamp(1.8 + sq.rx * 0.25, 2.2, 3.0);
      this.atk = { type: 'throw', t: 0, wind: 1.3, x: sq.x, d: sq.d + 0.5, r };
    }
    this.teleGroup.visible = true;
    this.teleGroup.position.set(this.atk.x, 0.06, -this.atk.d);
    this.teleGroup.scale.setScalar(this.atk.r);
    audio.warn();
  }
  impact() {
    const a = this.atk;
    const fx = this.game.fx;
    fx.shake(0.75);
    fx.hitstop(0.06);
    fx.flash(0xff3322, 0.25);
    fx.ring(a.x, -a.d, new THREE.Color(3, 1, 0.5), 0.5, a.r * 2.6, 0.5);
    fx.ring(a.x, -a.d, new THREE.Color(1.5, 1.5, 1.5), 0.3, a.r * 1.8, 0.35);
    fx.dust(a.x, -a.d, a.r * 1.5, new THREE.Color(...this.game.theme.dust), 30);
    for (let i = 0; i < 26; i++) fx.rocks.spawn(a.x + rand(-a.r, a.r) * 0.6, 0.2, -a.d + rand(-a.r, a.r) * 0.6, rand(-6, 6), rand(4, 11), rand(-6, 6), rand(0.2, 0.55), 0x8c8577, 2);
    fx.sparks(a.x, 0.5, -a.d, new THREE.Color(3, 1.4, 0.4), 22, 9, 0.2);
    audio.slam();
    this.game.squad.aoe(a.x, a.d, a.r);
    // 주변 적병도 휘말림 (아군 오사)
    this.teleGroup.visible = false;
  }
  update(dt) {
    const u = this.u;
    const sq = this.game.squad;
    const fx = this.game.fx;
    if (this.state === 'dying') {
      this.dieT += dt;
      const k = Math.min(1, this.dieT / 1.2);
      u.body.rotation.x = -k * k * 1.5;
      u.body.rotation.z = Math.sin(this.dieT * 20) * 0.05 * (1 - k);
      if (this.dieT < 1.2 && Math.random() < 0.5) fx.sparks(this.x + rand(-1.5, 1.5), rand(1, 5), -this.d, new THREE.Color(0.5, 2.5, 3), 3, 6, 0.2);
      if (this.dieT > 1.2 && !this.landed) {
        this.landed = true;
        fx.shake(0.7);
        fx.dust(this.x, -this.d - 2.5, 7, new THREE.Color(...this.game.theme.dust), 50);
        fx.ring(this.x, -this.d - 2.5, new THREE.Color(2, 2, 2), 1, 14, 0.7);
        audio.boom();
      }
      if (this.dieT > 2.3) {
        this.root.scale.multiplyScalar(Math.max(0, 1 - dt * 4));
        if (!this.poofed) {
          this.poofed = true;
          for (let i = 0; i < 40; i++) fx.glow.spawn({ x: this.x + rand(-2, 2), y: rand(0.5, 4), z: -this.d + rand(-2, 2), vx: rand(-4, 4), vy: rand(3, 9), vz: rand(-4, 4), life: rand(0.6, 1.2), size: 0.5, s1: 0.1, color: new THREE.Color(0.6, 2.2, 3), grav: 4, drag: 1.5 });
          fx.puff(this.x, 2, -this.d, new THREE.Color(0.35, 0.38, 0.45), 14, 3, 2, 1.2);
        }
      }
      if (this.dieT > 2.7) {
        this.remove();
        this.state = 'gone';
      }
      return;
    }
    if (this.state === 'gone') return;
    if (this.state === 'idle') {
      // 부대가 도착하기 전 대기 (숨쉬기)
      u.body.position.y = Math.sin(this.t * 2) * 0.05;
      this.commonUpdate(dt);
      this.label.visible = false;
      return;
    }
    if (this.state === 'intro') {
      this.introT += dt;
      u.armR.rotation.x = -Math.sin(Math.min(1, this.introT / 0.6) * PI * 0.5) * 2.2;
      u.head.rotation.x = -0.3 * Math.sin(Math.min(1, this.introT / 0.5) * PI);
      if (this.introT > 1.4) this.state = 'fight';
      this.commonUpdate(dt);
      return;
    }
    // 전투
    this.contact = this.game.isInContact(this);
    const attacking = !!this.atk;
    if (!this.contact && !attacking) {
      this.d -= this.speed * dt;
      this.x = lerp(this.x, clamp(sq.x, -3, 3), dt * 0.25);
      this.walkPhase += dt * 3.5;
    }
    const w = !this.contact && !attacking ? 1 : 0;
    const s = Math.sin(this.walkPhase);
    u.legL.rotation.x = s * 0.4 * w;
    u.legR.rotation.x = -s * 0.4 * w;
    u.body.position.y = Math.abs(Math.cos(this.walkPhase)) * 0.1 * w;
    u.body.rotation.x = -this.hitRecoil * 0.06;
    u.armL.rotation.x = -s * 0.3 * w;
    u.flail.rotation.x = Math.sin(this.t * 3) * 0.4;
    // 소환
    this.summonT -= dt;
    if (this.summonT <= 0) {
      this.summonT = this.def.summonEvery ?? 7;
      const n = this.def.summon ?? 16;
      const kind = this.def.summonShield ? 1 : 0;
      for (let i = 0; i < n; i++) this.game.crowd.spawn(this.x + rand(-4, 4), this.d - 2 - rand(0, 3), kind, kind ? 3 : 1, 2.4);
      fx.puff(this.x, 0.6, -this.d + 3, new THREE.Color(0.9, 0.4, 0.35), 8, 1.8, 3, 0.8);
      audio.whoosh();
    }
    // 공격 패턴
    if (!this.atk) {
      this.attackT -= dt;
      u.armR.rotation.x = lerp(u.armR.rotation.x, -0.3 + s * 0.2 * w, dt * 5);
      if (this.attackT <= 0) {
        this.startAttack();
        this.attackT = this.def.attackEvery ?? 3.6;
      }
    } else {
      const a = this.atk;
      a.t += dt;
      const k = Math.min(1, a.t / a.wind);
      // 경고 원 맥동
      const pulse = 0.5 + 0.5 * Math.sin(a.t * 18);
      this.teleInner.scale.setScalar(Math.max(0.01, k));
      this.teleFill.material.opacity = 0.22 + pulse * 0.14;
      this.teleRing.material.opacity = 0.75 + pulse * 0.25;
      this.teleGlow.material.opacity = 0.5 + pulse * 0.5;
      if (a.type === 'throw') {
        // 투척 대상은 도착 전까지 부대를 약간 따라감
        if (k < 0.35) {
          a.x = lerp(a.x, sq.x, dt * 1.2);
          this.teleGroup.position.x = a.x;
        }
        u.armR.rotation.x = k < 0.5 ? lerp(-0.3, -2.8, k / 0.5) : lerp(-2.8, 0.6, Math.min(1, (k - 0.5) / 0.15));
        if (k >= 0.5) {
          const pk = (k - 0.5) / 0.5;
          this.projectile.visible = true;
          const sx = this.x, sz = -this.d + 1, ex = a.x, ez = -a.d;
          this.projectile.position.set(lerp(sx, ex, pk), 9 + Math.sin(pk * PI) * 8 - pk * 8, lerp(sz, ez, pk));
          this.projectile.rotation.x += dt * 12;
          u.ball.visible = false;
        }
      } else {
        u.armR.rotation.x = k < 0.8 ? lerp(-0.3, -3.0, k / 0.8) : lerp(-3.0, 0.9, (k - 0.8) / 0.2);
      }
      if (k >= 1) {
        this.impact();
        this.projectile.visible = false;
        u.ball.visible = true;
        this.atk = null;
      }
    }
    if (this.contact && !this.atk) {
      // 근접 시 빠르게 재공격
      this.attackT = Math.min(this.attackT, 0.4);
    }
    this.root.position.set(this.x, 0, -this.d);
    this.commonUpdate(dt);
  }
  remove() {
    super.remove();
    this.game.world.remove(this.teleGroup);
    this.game.world.remove(this.projectile);
  }
}
