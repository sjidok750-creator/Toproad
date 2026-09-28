// 게임 진행 총괄: 레벨 로드, 업데이트 루프, 접촉/교환, 게이트, 카메라, 보스전, 승패
import * as THREE from 'three';
import { Environment, HW } from '../world/environment.js';
import { Squad } from './squad.js';
import { Crowd } from './crowd.js';
import { Arrows } from './arrows.js';
import { Gate, Barrier, Pillar, Barrel } from './props.js';
import { Giant, Boss } from './bigunits.js';
import { buildLevel } from './levels.js';
import { audio } from '../engine/audio.js';
import { clamp, damp, lerp, formatNum, rand, easeOutCubic } from '../engine/util.js';
import { statsFrom, save } from '../save.js';

const GOLD = new THREE.Color(3, 2.2, 0.6);

export class Game {
  constructor(renderer, fx, ui, input, saveState) {
    this.r = renderer;
    this.scene = renderer.scene;
    this.camera = renderer.camera;
    this.fx = fx;
    this.ui = ui;
    this.input = input;
    this.save = saveState;
    this.world = new THREE.Group();
    this.scene.add(this.world);
    this.overlay = new THREE.Scene();
    renderer.overlayScene = this.overlay;
    this.crowd = new Crowd(this);
    this.squad = new Squad(this);
    this.arrows = new Arrows(this);
    this.props = [];
    this.gates = [];
    this.barrels = [];
    this.bigs = [];
    this.walls = [];
    this.activeTargets = [];
    this.triggers = [];
    this.state = 'menu';
    this.time = 0;
    this.camPos = new THREE.Vector3(0, 30, 20);
    this.camLook = new THREE.Vector3(0, 0, -10);
    this._shake = new THREE.Vector3();
    this._v = new THREE.Vector3();
    this.maxArrowRate = renderer.isMobile ? 70 : 100;
    this.hudCache = {};
  }

  // ---------- 레벨 ----------
  loadLevel(n) {
    this.unload();
    this.state = 'menu';
    this.resultShown = false;
    this.levelN = n;
    const stats = statsFrom(this.save);
    this.stats = stats;
    const lv = buildLevel(n, stats.bonusTroops);
    this.level = lv;
    this.theme = lv.theme;
    this.applyTheme(lv.theme);
    this.env = new Environment(this.scene, lv.theme, lv.length, n);
    for (const it of lv.items) {
      switch (it.type) {
        case 'walls':
          for (const x of it.xs) {
            this.walls.push({ x, d0: it.d0, d1: it.d1 });
            this.env.addDivider(x, it.d0, it.d1);
          }
          break;
        case 'gate':
          this.addGate(new Gate(this, it));
          break;
        case 'gatePair': {
          const pair = 'p' + it.d;
          this.addGate(new Gate(this, { d: it.d, x: -HW / 2, w: HW - 0.5, op: it.a.op, v: it.a.v, pair }));
          this.addGate(new Gate(this, { d: it.d, x: HW / 2, w: HW - 0.5, op: it.b.op, v: it.b.v, pair }));
          break;
        }
        case 'barrier':
          this.props.push(new Barrier(this, it));
          break;
        case 'pillar':
          this.props.push(new Pillar(this, it));
          break;
        case 'barrel': {
          const b = new Barrel(this, it);
          this.props.push(b);
          this.barrels.push(b);
          break;
        }
        case 'army':
          this.crowd.addArmy(it);
          break;
        case 'giant':
          this.bigs.push(new Giant(this, it));
          break;
        case 'caption':
        case 'hint':
          this.triggers.push(it);
          break;
      }
    }
    this.gates.sort((a, b) => a.d - b.d);
    this.triggers.sort((a, b) => a.d - b.d);
    this.boss = new Boss(this, { d: lv.length + 18, x: 0, ...lv.boss });
    this.bigs.push(this.boss);
    this.squad.reset(lv.startCount, { tier: 1, rateMul: stats.rateMul, dmgMul: stats.dmgMul });
    this.input.reset();
    this.runCoins = 0;
    this.kills = 0;
    this.bossMode = false;
    this.maxCount = lv.startCount;
    this.time = 0;
    this.endT = 0;
    this.hudCache = {};
    this.ui.bossBar(false);
    this.snapCamera();
  }

  addGate(g) {
    this.props.push(g);
    this.gates.push(g);
  }

  unload() {
    for (const p of this.props) if (p.alive) p.remove();
    for (const b of this.bigs) if (b.state !== 'gone') b.remove();
    this.props.length = 0;
    this.gates.length = 0;
    this.barrels.length = 0;
    this.bigs.length = 0;
    this.walls.length = 0;
    this.triggers.length = 0;
    this.crowd.clear();
    this.arrows.clear();
    this.fx.clear();
    if (this.env) this.env.dispose();
    this.env = null;
  }

  applyTheme(th) {
    const r = this.r;
    this.scene.background = new THREE.Color(th.bg);
    this.scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
    r.hemi.color.set(th.hemiSky);
    r.hemi.groundColor.set(th.hemiGround);
    r.hemi.intensity = th.hemiI;
    r.sun.color.set(th.sun);
    r.sun.intensity = th.sunI;
    r.renderer.toneMappingExposure = th.exposure;
    r.bloomThreshold = th.bloomThreshold;
    if (r.bloom) r.bloom.threshold = th.bloomThreshold;
  }

  // ---------- 흐름 ----------
  startRun() {
    this.state = 'intro';
    this.introT = 0;
    this.input.enabled = true;
    this.ui.levelBanner(this.levelN, this.theme.name);
    audio.startMusic('run');
    audio.whoosh();
  }

  pause(v) {
    if (v && (this.state === 'play' || this.state === 'intro' || this.state === 'boss')) {
      this.prevState = this.state;
      this.state = 'paused';
    } else if (!v && this.state === 'paused') {
      this.state = this.prevState;
    }
  }

  // ---------- 공간 질의 ----------
  laneAt(x, d) {
    let left = -HW, right = HW;
    for (const w of this.walls) {
      if (d < w.d0 - 0.3 || d > w.d1 + 0.3) continue;
      if (w.x <= x && w.x > left) left = w.x;
      else if (w.x > x && w.x < right) right = w.x;
    }
    return [left === -HW ? -HW : left + 0.35, right === HW ? HW : right - 0.35];
  }

  isInContact(t) {
    return !!t.contact;
  }

  buildActive() {
    const sd = this.squad.d;
    const a = this.activeTargets;
    a.length = 0;
    for (const p of this.props) if (p.alive && p.d > sd - 6 && p.d < sd + 44) a.push(p);
    for (const b of this.bigs) if (b.alive && b.d > sd - 6 && b.d < sd + 46) a.push(b);
  }

  // 단단한 목표와 부딪히면 병력과 숫자를 1:1로 교환
  resolveContacts(dt) {
    const sq = this.squad;
    sq.blockD = Infinity;
    for (const t of this.activeTargets) {
      t.contact = false;
      if (!t.solid || !t.alive || sq.dead) continue;
      const front = t.d - t.hd;
      const reach = sq.rz * 0.8;
      if (Math.abs(sq.x - t.x) > t.hw + sq.rx * 0.7) continue;
      if (sq.d + reach < front - 0.15 || sq.d - sq.rz > t.d + t.hd) continue;
      t.contact = true;
      sq.blockD = Math.min(sq.blockD, front - reach);
      const rate = Math.max(16, Math.min(t.hp, sq.count) * 1.9);
      t.tradeAcc = (t.tradeAcc || 0) + rate * dt;
      const k = Math.floor(t.tradeAcc);
      if (k > 0) {
        t.tradeAcc -= k;
        const n = Math.min(k, sq.count, Math.ceil(t.hp));
        if (n <= 0) continue;
        const cx = clamp(sq.x, t.x - t.hw, t.x + t.hw);
        sq.loseUnits(n, cx, front - 0.3, 'melee');
        this.fx.sparks(cx + rand(-0.5, 0.5), 0.9, -front + 0.3, new THREE.Color(2.5, 1.8, 1), 3, 4, 0.15);
        this.fx.shake(0.06);
        t.damage(n, cx, 1);
        this.contactTextAcc = (this.contactTextAcc || 0) + n;
      }
    }
    this.contactTextT = (this.contactTextT || 0) + dt;
    if (this.contactTextT > 0.2 && this.contactTextAcc > 0) {
      this.fx.text(sq.x, 2.4, -(sq.d + sq.rz), '-' + formatNum(this.contactTextAcc), 'loss');
      this.contactTextAcc = 0;
      this.contactTextT = 0;
    }
  }

  checkGates() {
    const sq = this.squad;
    if (sq.dead) return;
    for (const g of this.gates) {
      if (g.d > sq.d + 30) break;
      if (g.state !== 'idle' || g.passed) continue;
      if (sq.d + sq.rz * 0.35 >= g.d) {
        if (Math.abs(sq.x - g.x) <= g.hw + 0.1) this.collectGate(g);
        else if (sq.d - sq.rz > g.d + 0.3) g.passed = true;
      }
    }
    for (const b of this.barrels) {
      if (b.state !== 'idle') continue;
      if (sq.d + sq.rz >= b.d - 0.6 && sq.d - sq.rz < b.d + 0.6 && Math.abs(sq.x - b.x) < sq.rx + 0.75) {
        b.knock(Math.sign(b.x - sq.x) || 1);
      }
    }
  }

  collectGate(g) {
    const sq = this.squad;
    const before = sq.count;
    const after = Math.max(0, Math.round(g.apply(before)));
    g.collect();
    if (g.pair) for (const o of this.gates) if (o !== g && o.pair === g.pair) o.fade();
    const delta = after - before;
    if (delta > 0) {
      sq.addUnits(delta, g.x, g.d);
      this.fx.text(sq.x, 2.8, -(sq.d + sq.rz), '+' + formatNum(delta), g.op === 'mul' ? 'gain mul' : 'gain');
      if (delta >= 50) this.fx.flash(0x9fd0ff, 0.18);
    } else if (delta < 0) {
      this.fx.text(sq.x, 2.8, -(sq.d + sq.rz), '-' + formatNum(-delta), 'loss big');
      this.fx.flash(0xff2a2a, 0.3);
      this.fx.shake(0.25);
      sq.loseUnits(-delta, g.x, g.d, 'gate');
    }
    this.maxCount = Math.max(this.maxCount, sq.count);
  }

  applyReward(r, barrel) {
    const sq = this.squad;
    const fx = this.fx;
    if (sq.dead) return;
    fx.ring(sq.x, -sq.d, new THREE.Color(2, 1.8, 0.6), 0.5, sq.rx * 2.5 + 3, 0.5);
    if (r.kind === 'troops') {
      sq.addUnits(r.v, sq.x, sq.d + 1);
      fx.text(sq.x, 3, -sq.d, '+' + formatNum(r.v), 'gain big');
      audio.reward();
    } else if (r.kind === 'weapon') {
      if (r.tier > sq.tier) sq.setTier(r.tier);
      fx.text(sq.x, 3.2, -sq.d, r.tier >= 3 ? '화염 쇠뇌!' : '쇠뇌 획득!', 'gold big');
      fx.flash(0xffd76a, 0.35);
      audio.upgrade();
      for (let i = 0; i < 30; i++) fx.glow.spawn({ x: sq.x + rand(-sq.rx, sq.rx), y: rand(0.2, 1.5), z: -sq.d + rand(-sq.rz, sq.rz), vy: rand(2, 6), life: rand(0.5, 1), size: 0.3, s1: 0.05, color: GOLD, grav: -1 });
    } else if (r.kind === 'rate') {
      sq.rateMul += r.v;
      fx.text(sq.x, 3.2, -sq.d, `연사 +${Math.round(r.v * 100)}%`, 'gold big');
      fx.flash(0xfff07a, 0.25);
      audio.upgrade();
    }
    this.maxCount = Math.max(this.maxCount, sq.count);
  }

  // ---------- 이벤트 ----------
  onEnemyKilled(s, cause) {
    this.kills++;
    this.runCoins += 1 * this.stats.coinMul;
  }
  onPropDestroyed(p) {
    this.runCoins += (p.kind === 'pillar' ? 15 : 3) * this.stats.coinMul;
  }
  onBigKilled(b) {
    if (b.kind === 'giant') {
      this.runCoins += 40 * this.levelN * this.stats.coinMul;
      this.ui.caption('거인 격파!');
    } else if (b.kind === 'boss') {
      this.runCoins += 250 * this.levelN * this.stats.coinMul;
      this.win();
    }
  }
  onSquadDead() {
    if (this.state === 'win') return;
    this.state = 'lose';
    this.endT = 0;
    this.fx.slowmo(1.2, 0.35);
    this.fx.flash(0xff2020, 0.45);
    this.fx.shake(0.4);
    audio.stopMusic();
    audio.defeat();
    this.ui.bossBar(false);
  }
  win() {
    this.state = 'win';
    this.endT = 0;
    this.squad.firing = false;
    this.squad.cheer = true;
    this.ui.bossBar(false);
    audio.stopMusic();
    setTimeout(() => audio.victory(), 900);
    // 남은 적 소멸
    for (const s of this.crowd.soldiers) if (s.state !== 'dead' && s.state !== 'dying') this.crowd.kill(s, 'trade');
  }

  finishRun(won) {
    const lv = this.levelN;
    const count = this.squad.count;
    let bonus = 0, stars = 0;
    if (won) {
      bonus = Math.round((60 * lv + count * 0.5) * this.stats.coinMul);
      const ratio = count / Math.max(1, this.maxCount);
      stars = ratio > 0.55 ? 3 : ratio > 0.25 ? 2 : 1;
    }
    const earned = Math.round(this.runCoins) + bonus;
    this.save.coins += earned;
    if (won) {
      this.save.stars[lv] = Math.max(this.save.stars[lv] || 0, stars);
      this.save.level = lv + 1;
      this.save.best = Math.max(this.save.best, lv + 1);
    }
    save(this.save);
    return { won, earned, bonus, kills: this.kills, count, stars, level: lv, maxCount: this.maxCount };
  }

  // ---------- 업데이트 ----------
  update(realDt) {
    this.time += realDt;
    const fx = this.fx;
    const ts = this.state === 'paused' ? 0 : fx.timeScale(realDt);
    const dt = realDt * ts;
    const sq = this.squad;

    this.overlay.visible = this.state !== 'menu';
    if (this.state === 'menu') {
      sq.firing = false;
      sq.stopAt = sq.d;
      sq.update(realDt, 0);
      this.updateProps(realDt);
      this.crowd.update(0);
      this.env?.update(realDt, this.camera.position.z);
      fx.update(realDt, realDt, this.r.flash);
      this.menuCamera(realDt);
      return;
    }
    if (this.state === 'paused') {
      fx.update(0, 0, this.r.flash);
      return;
    }
    if (this.state === 'intro') {
      this.introT += realDt;
      sq.firing = false;
      sq.stopAt = sq.d;
      if (this.introT > 1.3) {
        this.state = 'play';
        sq.firing = true;
        sq.stopAt = Infinity;
      }
    }
    this.input.update(realDt);
    this.input.syncTo(sq.x);
    this.buildActive();
    if (this.state === 'play' || this.state === 'boss') this.resolveContacts(dt);
    sq.update(dt, this.input.x);
    if (this.state === 'play' || this.state === 'boss') this.checkGates();
    this.crowd.update(dt);
    this.updateProps(dt);
    for (const b of this.bigs) if (b.state !== 'gone') b.update(dt);
    this.arrows.update(dt);
    this.updateTriggers();
    this.env?.update(dt, this.camera.position.z);
    fx.update(dt, realDt, this.r.flash);
    this.updateCamera(realDt);
    this.updateHud();
    if (this.state === 'win' || this.state === 'lose') {
      this.endT += realDt;
      if (this.state === 'win' && this.endT > 3.0 && !this.resultShown) {
        this.resultShown = true;
        this.ui.showResult(this.finishRun(true));
      }
      if (this.state === 'lose' && this.endT > 1.8 && !this.resultShown) {
        this.resultShown = true;
        this.ui.showResult(this.finishRun(false));
      }
    } else this.resultShown = false;
  }

  updateProps(dt) {
    const sd = this.squad.d;
    let dead = 0;
    for (const p of this.props) {
      if (!p.alive) {
        dead++;
        continue;
      }
      const vis = p.d > sd - 22 && p.d < sd + 120;
      p.group.visible = vis;
      if (vis) p.update(dt);
    }
    if (dead > 30) {
      this.props = this.props.filter((p) => p.alive);
      this.gates = this.gates.filter((p) => p.alive);
      this.barrels = this.barrels.filter((p) => p.alive);
    }
  }

  updateTriggers() {
    const sq = this.squad;
    while (this.triggers.length && this.triggers[0].d <= sq.d) {
      const t = this.triggers.shift();
      if (t.type === 'caption') this.ui.caption(t.text);
      else if (t.type === 'hint' && (this.levelN === 1 || this.save.best <= 1)) this.ui.hint(true);
    }
    if (this.input.moved) this.ui.hint(false);
    // 보스 구역 진입
    if (!this.bossMode && this.state === 'play' && sq.d >= this.level.length - 1) {
      this.bossMode = true;
      this.state = 'boss';
      sq.stopAt = this.level.length;
      this.boss.activate();
      this.ui.caption('보스 도전');
      this.ui.bossBar(true, 1, this.boss.hp);
      audio.startMusic('boss');
    }
    if (this.bossMode && this.boss.alive) this.ui.bossBar(true, this.boss.hp / this.boss.maxHp, this.boss.hp);
  }

  // ---------- 카메라 ----------
  camTarget(outPos, outLook) {
    const sq = this.squad;
    const size = Math.max(sq.rx, sq.rz * 0.8);
    let zoom = 1 + clamp((size - 1.5) / 9, 0, 0.3);
    let ahead = 13;
    if (this.bossMode) {
      zoom += 0.08;
      ahead = 12;
    }
    const aspect = this.camera.aspect;
    if (aspect > 1) zoom *= 1.08;
    const x = sq.x * 0.5;
    outPos.set(x, 15.5 * zoom, -sq.d + 12.5 * zoom);
    outLook.set(x * 0.9, 0, -(sq.d + ahead * zoom));
  }
  snapCamera() {
    this.camTarget(this.camPos, this.camLook);
  }
  updateCamera(dt) {
    const tp = this._v;
    const tl = new THREE.Vector3();
    this.camTarget(tp, tl);
    let k = 5;
    if (this.state === 'intro') {
      const t = easeOutCubic(Math.min(1, this.introT / 1.3));
      // 높은 곳에서 내려오는 인트로
      tp.y += (1 - t) * 14;
      tp.z += (1 - t) * 10;
      tl.z -= (1 - t) * 20;
      k = 8;
    }
    this.camPos.x = damp(this.camPos.x, tp.x, k, dt);
    this.camPos.y = damp(this.camPos.y, tp.y, k * 0.6, dt);
    this.camPos.z = damp(this.camPos.z, tp.z, k * 1.6, dt);
    this.camLook.x = damp(this.camLook.x, tl.x, k, dt);
    this.camLook.y = damp(this.camLook.y, tl.y, k, dt);
    this.camLook.z = damp(this.camLook.z, tl.z, k * 1.6, dt);
    this.applyCamera(dt);
  }
  menuCamera(dt) {
    const sq = this.squad;
    const a = this.time * 0.15;
    const tp = this._v.set(sq.x + Math.sin(a) * 7, 7.5 + Math.sin(this.time * 0.3) * 0.6, -sq.d + 9 + Math.cos(a) * 2);
    const tl = new THREE.Vector3(sq.x, 1.2, -sq.d - 6);
    this.camPos.x = damp(this.camPos.x, tp.x, 2, dt);
    this.camPos.y = damp(this.camPos.y, tp.y, 2, dt);
    this.camPos.z = damp(this.camPos.z, tp.z, 2, dt);
    this.camLook.lerp(tl, 1 - Math.exp(-2 * dt));
    this.applyCamera(dt);
  }
  applyCamera(dt) {
    const cam = this.camera;
    const sh = this.fx.shakeOffset(dt, this._shake);
    cam.position.copy(this.camPos);
    cam.lookAt(this.camLook);
    cam.translateX(sh.x);
    cam.translateY(sh.y);
    cam.rotateZ(sh.z);
    this.r.followShadow(this.squad.x, -this.squad.d);
  }

  // ---------- HUD ----------
  updateHud() {
    const c = this.hudCache;
    const coins = Math.floor(this.save.coins + this.runCoins);
    if (c.coins !== coins) {
      c.coins = coins;
      this.ui.setCoins(coins);
    }
    const prog = clamp(this.squad.d / this.level.length, 0, 1);
    if (Math.abs((c.prog ?? -1) - prog) > 0.002) {
      c.prog = prog;
      this.ui.setProgress(prog);
    }
  }
}
