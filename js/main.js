// 부트스트랩: 폰트 로드 → 렌더러/게임 생성 → 메인 루프 → UI 이벤트 연결
import * as THREE from 'three';
import { Renderer } from './engine/renderer.js';
import { FX } from './engine/fx.js';
import { Input } from './engine/input.js';
import { audio } from './engine/audio.js';
import { UI } from './ui/ui.js';
import { Game } from './game/game.js';
import { buildHero } from './world/models.js';
import { load, save, UPGRADES, upgradeCost } from './save.js';
import { HW } from './world/environment.js';

const ui = new UI();
const errBox = document.getElementById('error');
function showError(msg) {
  errBox.textContent = '오류: ' + msg;
  errBox.classList.remove('hidden');
}
window.addEventListener('error', (e) => showError(e.message));
window.addEventListener('unhandledrejection', (e) => showError(String(e.reason?.message || e.reason)));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

async function loadFonts() {
  if (!document.fonts) return;
  try {
    await Promise.race([Promise.all([document.fonts.load('64px "Lilita One"'), document.fonts.load('64px "Black Han Sans"', '가')]), wait(2500)]);
  } catch (e) {
    /* 폰트 로드 실패 시 대체 폰트 사용 */
  }
}

// HUD 초상화: 지휘관 모델을 별도 렌더러로 한 번 그려 이미지로 사용
function makeAvatar() {
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 192;
    const r = new THREE.WebGLRenderer({ canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xeaf4ff, 0x6a7a90, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.4);
    sun.position.set(-2, 3, -3);
    scene.add(sun);
    const hero = buildHero();
    scene.add(hero);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
    cam.position.set(0.45, 1.5, -1.55);
    cam.lookAt(0, 1.3, 0);
    r.render(scene, cam);
    const url = c.toDataURL('image/png');
    r.dispose();
    r.forceContextLoss?.();
    return url;
  } catch (e) {
    return '';
  }
}

async function boot() {
  ui.loadProgress(0.1);
  await loadFonts();
  ui.loadProgress(0.35);
  await nextFrame();
  const canvas = document.getElementById('game');
  const renderer = new Renderer(canvas);
  const fx = new FX(renderer.scene, renderer.camera, document.getElementById('ftext-layer'));
  const input = new Input(canvas, HW);
  const state = load();
  const qLevel = +new URLSearchParams(location.search).get('level');
  if (qLevel > 0) state.level = qLevel;
  audio.setEnabled(state.sound);
  audio.setMusic(state.music);
  fx.haptics = state.vibrate !== false;
  ui.loadProgress(0.55);
  await nextFrame();
  const game = new Game(renderer, fx, ui, input, state);
  ui.setAvatar(makeAvatar());
  ui.loadProgress(0.75);
  await nextFrame();
  game.loadLevel(state.level);
  ui.setLevel(state.level);
  ui.setCoins(state.coins);
  // 셰이더 예열을 위해 한 번 렌더
  game.update(0.016);
  renderer.render(0.016);
  ui.loadProgress(1);
  await wait(150);
  ui.hideLoading();
  ui.show('menu', true);

  // ---------- 메인 루프 ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    game.update(dt);
    renderer.render(dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- UI 이벤트 ----------
  const hideAll = () => ['menu', 'shop', 'settings', 'pause', 'result'].forEach((n) => ui.show(n, false));
  let shopReturn = null;

  const startLevel = (n) => {
    hideAll();
    game.loadLevel(n);
    ui.setLevel(n);
    ui.show('hud', true);
    game.startRun();
  };

  ui.on('play', () => startLevel(state.level));
  ui.on('shop', () => {
    shopReturn = 'menu';
    ui.renderShop(state);
    ui.show('menu', false);
    ui.show('shop', true);
  });
  ui.on('resultShop', () => {
    shopReturn = 'result';
    ui.renderShop(state);
    ui.show('result', false);
    ui.show('shop', true);
  });
  ui.on('shopClose', () => {
    ui.show('shop', false);
    ui.show(shopReturn || 'menu', true);
    ui.setCoins(state.coins);
  });
  ui.on('buy', (id) => {
    const u = UPGRADES.find((x) => x.id === id);
    const lv = state.up[id] || 0;
    const cost = upgradeCost(u, lv);
    if (state.coins < cost || lv >= u.max) return;
    state.coins -= cost;
    state.up[id] = lv + 1;
    save(state);
    audio.upgrade();
    ui.renderShop(state);
    ui.setCoins(state.coins);
    game.stats = null;
  });
  ui.on('settings', () => {
    ui.renderSettings(state, renderer.quality);
    ui.show('menu', false);
    ui.show('settings', true);
  });
  ui.on('settingsClose', () => {
    ui.show('settings', false);
    ui.show('menu', true);
  });
  ui.on('toggleSound', () => {
    state.sound = !state.sound;
    audio.setEnabled(state.sound);
    save(state);
    ui.renderSettings(state, renderer.quality);
  });
  ui.on('toggleMusic', () => {
    state.music = !state.music;
    audio.init();
    audio.setMusic(state.music);
    save(state);
    ui.renderSettings(state, renderer.quality);
  });
  ui.on('toggleVibrate', () => {
    state.vibrate = state.vibrate === false;
    fx.haptics = state.vibrate;
    if (state.vibrate) navigator.vibrate?.(30);
    save(state);
    ui.renderSettings(state, renderer.quality);
  });
  ui.on('quality', (q) => {
    renderer.setQuality(q);
    if (renderer.bloom) renderer.bloom.threshold = renderer.bloomThreshold ?? 0.85;
    ui.renderSettings(state, renderer.quality);
  });
  ui.on('reset', () => {
    if (!confirm('모든 진행 상황을 초기화할까요?')) return;
    localStorage.removeItem('toproad.save.v1');
    location.reload();
  });
  ui.on('pause', () => {
    if (game.state !== 'play' && game.state !== 'intro' && game.state !== 'boss') return;
    game.pause(true);
    ui.show('pause', true);
  });
  ui.on('resume', () => {
    ui.show('pause', false);
    game.pause(false);
  });
  ui.on('restart', () => {
    ui.show('pause', false);
    startLevel(game.levelN);
  });
  ui.on('home', () => {
    hideAll();
    ui.show('hud', false);
    ui.bossBar(false);
    ui.hint(false);
    game.loadLevel(state.level);
    game.input.enabled = false;
    ui.setLevel(state.level);
    ui.setCoins(state.coins);
    ui.show('menu', true);
    audio.startMusic('menu');
  });
  ui.on('next', () => {
    ui.show('result', false);
    startLevel(state.level);
  });
  ui.on('resultShown', () => {
    ui.setCoins(state.coins);
    ui.setLevel(state.level);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ['play', 'intro', 'boss'].includes(game.state)) {
      game.pause(true);
      ui.show('pause', true);
    }
  });
  window.addEventListener('pointerdown', () => audio.init(), { passive: true });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'p') {
      if (game.state === 'paused') ui.emit('resume');
      else ui.emit('pause');
    }
    if (e.key === 'Enter' && game.state === 'menu' && !document.getElementById('menu').classList.contains('hidden')) ui.emit('play');
  });

  // 디버그/테스트용: 렌더링 없이 시뮬레이션 진행
  window.__game = game;
  window.__sim = (sec, x = null) => {
    const steps = Math.round(sec * 60);
    for (let i = 0; i < steps; i++) {
      if (x !== null) game.input.x = x;
      game.update(1 / 60);
    }
    return { state: game.state, count: game.squad.count, d: game.squad.d.toFixed(1), arrows: game.arrows.list.length };
  };
}

boot().catch((e) => {
  console.error(e);
  showError(e.message || String(e));
});
