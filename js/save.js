// 진행 상황 저장 (localStorage)
const KEY = 'toproad.save.v1';

export const UPGRADES = [
  { id: 'troops', name: '시작 병력', desc: '출발 병력 +2', icon: '🛡️', base: 60, grow: 1.55, max: 30 },
  { id: 'damage', name: '공격력', desc: '화살 피해 +12%', icon: '🏹', base: 80, grow: 1.6, max: 30 },
  { id: 'rate', name: '연사 속도', desc: '발사 속도 +8%', icon: '⚡', base: 90, grow: 1.62, max: 25 },
  { id: 'income', name: '전리품', desc: '골드 획득 +15%', icon: '💰', base: 120, grow: 1.7, max: 20 },
];

const DEFAULT = { level: 1, coins: 0, best: 1, up: { troops: 0, damage: 0, rate: 0, income: 0 }, sound: true, music: true, stars: {} };

export function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && typeof s === 'object') return { ...DEFAULT, ...s, up: { ...DEFAULT.up, ...(s.up || {}) }, stars: { ...(s.stars || {}) } };
  } catch (e) {
    /* 저장 데이터 손상 시 초기화 */
  }
  return structuredClone(DEFAULT);
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
  } catch (e) {
    /* 저장소 접근 불가 */
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch (e) {
    /* 저장 불가 환경 무시 */
  }
}

export function upgradeCost(u, lv) {
  return Math.round(u.base * Math.pow(u.grow, lv));
}

export function statsFrom(state) {
  const up = state.up;
  return {
    bonusTroops: up.troops * 2,
    dmgMul: 1 + up.damage * 0.12,
    rateMul: 1 + up.rate * 0.08,
    coinMul: 1 + up.income * 0.15,
  };
}
