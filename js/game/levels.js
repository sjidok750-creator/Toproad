// 레벨 설계: 1레벨은 수작업(광고 장면 재현), 이후는 템플릿 조합 + 예상 병력 기반 난이도 스케일링
import { mulberry32, clamp } from '../engine/util.js';
import { themeForLevel } from '../world/themes.js';
import { HW } from '../world/environment.js';

const L3 = [-HW, -2.1, 2.1, HW]; // 3차선 경계
const L2 = [-HW, 0, HW];
const laneC = (b, i) => (b[i] + b[i + 1]) / 2;
const laneW = (b, i) => b[i + 1] - b[i] - 0.8;

// 1레벨: 광고 장면 (1명 → 차선 선택 → 기둥 → 거인 → 보스)
function level1() {
  const it = [];
  it.push({ type: 'caption', d: 4, text: '빠른 판단' });
  it.push({ type: 'hint', d: 0 });
  it.push({ type: 'walls', d0: 16, d1: 64, xs: [L3[1], L3[2]] });
  // 왼쪽: +1 게이트 행렬
  it.push({ type: 'barrier', d: 19, x: laneC(L3, 0), w: laneW(L3, 0) + 0.4, hp: 3 });
  for (let i = 0; i < 13; i++) it.push({ type: 'gate', d: 24 + i * 3, x: laneC(L3, 0), w: laneW(L3, 0), op: 'add', v: 1 });
  it.push({ type: 'caption', d: 23, text: '병력 확장' });
  // 가운데: 적 대군 (함정)
  it.push({ type: 'army', d: 28, x: 0, cols: 5, rows: 18, kind: 'basic', speed: 1.2, trigger: 40 });
  // 오른쪽: 바리케이드 → 기둥 → +10
  it.push({ type: 'barrier', d: 19, x: laneC(L3, 2), w: laneW(L3, 2) + 0.4, hp: 3 });
  it.push({ type: 'pillar', d: 29, x: laneC(L3, 2), w: laneW(L3, 2) + 0.4, hp: 45 });
  for (let i = 0; i < 3; i++) it.push({ type: 'gate', d: 38 + i * 8, x: laneC(L3, 2), w: laneW(L3, 2), op: 'add', v: 10 });

  it.push({ type: 'gatePair', d: 76, a: { op: 'mul', v: 2 }, b: { op: 'add', v: 8 } });
  it.push({ type: 'army', d: 96, x: 0, cols: 9, rows: 6, kind: 'basic', speed: 1.5 });
  it.push({ type: 'caption', d: 108, text: '화력 증강' });
  it.push({ type: 'barrel', d: 118, x: -3.4, hp: 18, reward: { kind: 'troops', v: 15 } });
  it.push({ type: 'barrel', d: 118, x: 3.4, hp: 28, reward: { kind: 'weapon', tier: 2 } });

  it.push({ type: 'caption', d: 132, text: '굳센 의지' });
  it.push({ type: 'walls', d0: 140, d1: 188, xs: [0] });
  it.push({ type: 'pillar', d: 146, x: laneC(L2, 1), w: laneW(L2, 1) + 0.4, hp: 160 });
  it.push({ type: 'gate', d: 158, x: laneC(L2, 1), w: laneW(L2, 1), op: 'add', v: 99 });
  it.push({ type: 'gate', d: 170, x: laneC(L2, 1), w: laneW(L2, 1), op: 'add', v: 99 });
  for (let i = 0; i < 5; i++) it.push({ type: 'gate', d: 148 + i * 8, x: laneC(L2, 0), w: laneW(L2, 0), op: 'add', v: 3 });

  it.push({ type: 'caption', d: 200, text: '전군 돌격' });
  it.push({ type: 'giant', d: 222, x: 0, hp: 650 });
  it.push({ type: 'army', d: 226, x: 0, cols: 12, rows: 8, kind: 'mixed', speed: 1.4, shieldRows: 0.25 });
  it.push({ type: 'gatePair', d: 256, a: { op: 'add', v: 30 }, b: { op: 'add', v: -40 } });
  it.push({ type: 'barrel', d: 270, x: 0, hp: 60, reward: { kind: 'rate', v: 0.2 } });
  it.push({ type: 'army', d: 288, x: 0, cols: 10, rows: 7, kind: 'basic', speed: 1.6 });
  return { n: 1, theme: themeForLevel(1), startCount: 1, length: 316, items: it, boss: { hp: 5200, summon: 14, summonEvery: 7.5, attackEvery: 3.6 } };
}

// 절차적 레벨
function genLevel(n, startCount) {
  const rng = mulberry32(n * 7717 + 3);
  const it = [];
  let d = 14;
  let est = Math.max(3, startCount);
  let tier = 1;
  let weaponGiven = false;
  let rate = 1;
  const dmgPerUnit = () => (1 / (0.55 / rate)) * [1, 1, 1.6, 2.4][tier] * (1 + (n - 1) * 0.03);
  const hard = 1 + Math.min(0.7, (n - 2) * 0.045);
  const round = (v) => Math.max(1, Math.round(v));
  const roundNice = (v) => {
    v = Math.max(1, v);
    if (v < 20) return Math.round(v);
    if (v < 100) return Math.round(v / 5) * 5;
    return Math.round(v / 10) * 10;
  };

  const T = {
    lanes3() {
      it.push({ type: 'caption', d: d - 8, text: '빠른 판단' });
      const len = 46;
      it.push({ type: 'walls', d0: d, d1: d + len, xs: [L3[1], L3[2]] });
      const roles = [0, 1, 2].sort(() => rng() - 0.5); // 0=+1 행렬, 1=함정 대군, 2=기둥 잭팟
      const gain1 = 12;
      const jack = roundNice(est * 0.8 + 10);
      for (let li = 0; li < 3; li++) {
        const x = laneC(L3, li), w = laneW(L3, li);
        const role = roles[li];
        if (role === 0) {
          it.push({ type: 'barrier', d: d + 3, x, w: w + 0.4, hp: roundNice(est * 0.3 + 2) });
          for (let i = 0; i < gain1; i++) it.push({ type: 'gate', d: d + 8 + i * 3, x, w, op: 'add', v: 1 });
        } else if (role === 1) {
          it.push({ type: 'army', d: d + 12, x, cols: 5, rows: round(Math.min(30, est * 0.5 + 10)), kind: n > 4 ? 'mixed' : 'basic', speed: 1.3, trigger: 44 });
        } else {
          it.push({ type: 'barrier', d: d + 3, x, w: w + 0.4, hp: roundNice(est * 0.3 + 2) });
          it.push({ type: 'pillar', d: d + 13, x, w: w + 0.4, hp: roundNice(est * dmgPerUnit() * 2.2 * hard) });
          it.push({ type: 'gate', d: d + 24, x, w, op: 'add', v: jack });
          it.push({ type: 'gate', d: d + 36, x, w, op: 'add', v: jack });
        }
      }
      est += (gain1 + jack * 2) * 0.5;
      d += len + 10;
    },
    lanes2() {
      it.push({ type: 'caption', d: d - 8, text: '굳센 의지' });
      const len = 44;
      it.push({ type: 'walls', d0: d, d1: d + len, xs: [0] });
      const flip = rng() < 0.5;
      const jl = flip ? 0 : 1, sl = 1 - jl;
      const jack = roundNice(est * 0.9 + 20);
      it.push({ type: 'pillar', d: d + 6, x: laneC(L2, jl), w: laneW(L2, jl) + 0.4, hp: roundNice(est * dmgPerUnit() * 2.1 * hard) });
      it.push({ type: 'gate', d: d + 18, x: laneC(L2, jl), w: laneW(L2, jl), op: 'add', v: jack });
      const mul = est < 150 && rng() < 0.4;
      it.push({ type: 'gate', d: d + 30, x: laneC(L2, jl), w: laneW(L2, jl), op: mul ? 'mul' : 'add', v: mul ? 2 : jack });
      const small = roundNice(est * 0.12 + 2);
      for (let i = 0; i < 5; i++) it.push({ type: 'gate', d: d + 8 + i * 7, x: laneC(L2, sl), w: laneW(L2, sl), op: 'add', v: small });
      est = est + jack * 1.1 + small * 1.5;
      d += len + 10;
    },
    pair() {
      const opts = [
        [{ op: 'mul', v: 2 }, { op: 'add', v: roundNice(est * 0.6) }],
        [{ op: 'add', v: roundNice(est * 0.8) }, { op: 'add', v: -roundNice(est * 0.4) }],
        [{ op: 'mul', v: 3 }, { op: 'add', v: -roundNice(est * 0.6) }],
        [{ op: 'add', v: roundNice(est * 0.5) }, { op: 'mul', v: 2 }],
      ];
      const o = opts[Math.floor(rng() * opts.length)];
      const [a, b] = rng() < 0.5 ? o : [o[1], o[0]];
      it.push({ type: 'gatePair', d, a, b });
      const best = Math.max(...[a, b].map((g) => (g.op === 'mul' ? est * g.v : est + g.v)));
      const worst = Math.max(1, Math.min(...[a, b].map((g) => (g.op === 'mul' ? est * g.v : est + g.v))));
      est = worst * 0.45 + best * 0.55;
      d += 18;
    },
    army() {
      if (rng() < 0.5) it.push({ type: 'caption', d: d - 8, text: '전군 돌격' });
      const total = clamp(est * (0.55 + rng() * 0.3) * hard, 14, 900);
      const cols = clamp(Math.round(Math.sqrt(total * 1.6)), 6, 15);
      const rows = Math.max(3, Math.round(total / cols));
      const kind = n <= 2 ? 'basic' : rng() < 0.5 ? 'mixed' : 'basic';
      it.push({ type: 'army', d, x: 0, cols, rows, kind, speed: 1.4 + rng() * 0.4, shieldRows: 0.3, shieldHp: 2 + Math.floor(n / 5) });
      est = Math.max(3, est - total * 0.28);
      d += rows * 0.72 + 16;
    },
    barrels() {
      it.push({ type: 'caption', d: d - 8, text: '화력 증강' });
      const two = rng() < 0.7;
      const rewards = [];
      if (tier < 3 && (!weaponGiven || rng() < 0.5)) {
        rewards.push({ kind: 'weapon', tier: tier + 1 });
        weaponGiven = true;
      } else rewards.push({ kind: 'rate', v: 0.2 });
      rewards.push({ kind: 'troops', v: roundNice(est * 0.45 + 5) });
      const xs = two ? [-3.3, 3.3] : [0];
      xs.forEach((x, i) => {
        const r = rewards[i] || rewards[0];
        it.push({ type: 'barrel', d, x, hp: roundNice(est * dmgPerUnit() * (r.kind === 'troops' ? 0.7 : 1.0) * hard), reward: r });
      });
      // 선택지가 둘이면 추정치는 절반만 반영
      if (rewards[0].kind === 'weapon') tier = two ? tier : rewards[0].tier;
      else rate += two ? 0.05 : 0.1;
      est += roundNice(est * 0.45 + 5) * (two ? 0.35 : 0.6);
      d += 20;
    },
    giant() {
      it.push({ type: 'caption', d: d - 10, text: '전군 돌격' });
      const hp = roundNice(est * dmgPerUnit() * 1.4 * hard);
      it.push({ type: 'giant', d: d + 6, x: 0, hp });
      const esc = clamp(est * 0.35, 8, 300);
      const cols = clamp(Math.round(Math.sqrt(esc * 1.6)), 6, 14);
      it.push({ type: 'army', d: d + 9, x: 0, cols, rows: Math.max(2, Math.round(esc / cols)), kind: 'mixed', speed: 1.4, shieldRows: 0.4, shieldHp: 2 + Math.floor(n / 5) });
      est *= 0.75;
      d += 36;
    },
    redSign() {
      // 음수 게이트 (쏘면 올라감) + 반대편 보통 게이트
      const neg = -roundNice(est * 0.5);
      const side = rng() < 0.5 ? -1 : 1;
      it.push({ type: 'gate', d, x: side * 3.1, w: 5.6, op: 'add', v: neg, pair: 'r' + d });
      it.push({ type: 'gate', d, x: -side * 3.1, w: 5.6, op: 'add', v: roundNice(est * 0.15), pair: 'r' + d });
      est += est * 0.15;
      d += 16;
    },
  };

  const seqs = [
    ['lanes3', 'pair', 'army', 'barrels', 'lanes2', 'giant', 'redSign', 'army'],
    ['pair', 'army', 'lanes3', 'barrels', 'giant', 'pair', 'lanes2', 'army'],
    ['lanes3', 'barrels', 'army', 'pair', 'giant', 'lanes2', 'redSign', 'army', 'barrels'],
    ['lanes2', 'army', 'barrels', 'lanes3', 'pair', 'giant', 'army', 'redSign'],
  ];
  const seq = seqs[(n - 2) % seqs.length];
  for (const k of seq) T[k]();
  const bossHp = roundNice(est * dmgPerUnit() * 7 * hard);
  return {
    n,
    theme: themeForLevel(n),
    startCount,
    length: d + 12,
    items: it,
    boss: { hp: bossHp, summon: Math.round(clamp(est * 0.08, 10, 40)), summonShield: n >= 5, summonEvery: Math.max(5, 8 - n * 0.2), attackEvery: Math.max(2.6, 3.8 - n * 0.08), speed: Math.min(1.3, 0.9 + n * 0.02) },
  };
}

// 레벨별 기본 출발 병력 + 강화 보너스
export function buildLevel(n, bonus = 0) {
  if (n === 1) {
    const l = level1();
    l.startCount = 1 + bonus;
    return l;
  }
  const base = Math.min(40, 3 + n * 2);
  return genLevel(n, base + bonus);
}
