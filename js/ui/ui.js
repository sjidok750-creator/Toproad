// DOM UI: HUD, 자막, 메뉴, 강화 상점, 설정, 결과 화면
import { formatNum } from '../engine/util.js';
import { UPGRADES, upgradeCost } from '../save.js';
import { audio } from '../engine/audio.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      coins: $('coins'),
      level: $('hud-level'),
      bar: $('progress-bar'),
      knob: $('progress-knob'),
      caption: $('caption'),
      banner: $('banner'),
      hint: $('hint'),
      bossBar: $('boss-bar'),
      bossFill: $('boss-fill'),
      bossHp: $('boss-hp'),
      menu: $('menu'),
      shop: $('shop'),
      settings: $('settings'),
      pause: $('pause'),
      result: $('result'),
      loading: $('loading'),
    };
    this.handlers = {};
    this.bind('btn-play', 'play');
    this.bind('btn-shop', 'shop');
    this.bind('btn-settings', 'settings');
    this.bind('btn-shop-close', 'shopClose');
    this.bind('btn-settings-close', 'settingsClose');
    this.bind('btn-pause', 'pause');
    this.bind('btn-resume', 'resume');
    this.bind('btn-restart', 'restart');
    this.bind('btn-home', 'home');
    this.bind('btn-next', 'next');
    this.bind('btn-r-shop', 'resultShop');
    this.bind('btn-r-home', 'home');
    this.bind('btn-reset', 'reset');
    $('tg-sound').addEventListener('click', () => this.emit('toggleSound'));
    $('tg-music').addEventListener('click', () => this.emit('toggleMusic'));
    $('tg-vibrate').addEventListener('click', () => this.emit('toggleVibrate'));
    $('seg-quality').addEventListener('click', (e) => {
      const q = e.target?.dataset?.q;
      if (q != null) this.emit('quality', +q);
    });
    this.captionTimer = null;
  }

  bind(id, name) {
    $(id).addEventListener('click', (e) => {
      e.stopPropagation();
      audio.init();
      audio.click();
      this.emit(name);
    });
  }
  on(name, fn) {
    this.handlers[name] = fn;
  }
  emit(name, arg) {
    this.handlers[name]?.(arg);
  }

  show(name, v = true) {
    this.el[name].classList.toggle('hidden', !v);
  }

  loadProgress(f) {
    $('load-fill').style.width = Math.round(f * 100) + '%';
  }
  hideLoading() {
    this.el.loading.classList.add('fade');
    setTimeout(() => this.el.loading.classList.add('hidden'), 600);
  }

  setAvatar(url) {
    $('avatar-img').src = url;
  }
  setCoins(v) {
    this.el.coins.textContent = formatNum(v);
  }
  setLevel(n) {
    this.el.level.textContent = 'LV ' + n;
    $('menu-level').textContent = '레벨 ' + n;
  }
  setProgress(f) {
    const p = (f * 100).toFixed(1) + '%';
    this.el.bar.style.width = p;
    this.el.knob.style.left = p;
  }

  caption(text) {
    const c = this.el.caption;
    c.textContent = text;
    c.classList.remove('show');
    void c.offsetWidth;
    c.classList.add('show');
  }
  levelBanner(n, name) {
    const b = this.el.banner;
    b.innerHTML = `<div class="b-lv">LEVEL ${n}</div><div class="b-name">${name}</div>`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
  hint(v) {
    if (this.hintOn === v) return;
    this.hintOn = v;
    this.show('hint', v);
    clearTimeout(this.hintTimer);
    if (v) this.hintTimer = setTimeout(() => this.hint(false), 4500);
  }
  bossBar(v, frac = 1, hp = 0) {
    if (this.bossOn !== v) {
      this.bossOn = v;
      this.show('bossBar', v);
    }
    if (v) {
      this.el.bossFill.style.width = Math.max(0, frac * 100).toFixed(1) + '%';
      this.el.bossHp.textContent = formatNum(Math.ceil(hp));
    }
  }

  renderShop(state) {
    $('shop-coins').textContent = formatNum(state.coins);
    const list = $('shop-list');
    list.innerHTML = '';
    for (const u of UPGRADES) {
      const lv = state.up[u.id] || 0;
      const maxed = lv >= u.max;
      const cost = upgradeCost(u, lv);
      const row = document.createElement('div');
      row.className = 'up-item';
      row.innerHTML = `<div class="up-ico">${u.icon}</div>
        <div class="up-info"><div class="up-name">${u.name}<small>Lv.${lv}</small></div><div class="up-desc">${u.desc}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'btn gold';
      btn.innerHTML = maxed ? '<span>MAX</span>' : `<i class="ico-coin"></i><span>${formatNum(cost)}</span>`;
      btn.disabled = maxed || state.coins < cost;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emit('buy', u.id);
      });
      row.appendChild(btn);
      list.appendChild(row);
    }
  }

  renderSettings(state, quality) {
    $('tg-sound').classList.toggle('on', !!state.sound);
    $('tg-music').classList.toggle('on', !!state.music);
    $('tg-vibrate').classList.toggle('on', state.vibrate !== false);
    for (const b of $('seg-quality').children) b.classList.toggle('on', +b.dataset.q === quality);
  }

  showResult(r) {
    const t = $('result-title');
    t.textContent = r.won ? '승리!' : '패배...';
    t.classList.toggle('lose', !r.won);
    const stars = $('result-stars');
    stars.classList.toggle('hidden', !r.won);
    [...stars.children].forEach((s, i) => s.classList.toggle('on', i < r.stars));
    $('r-kills').textContent = formatNum(r.kills);
    $('r-max').textContent = formatNum(r.maxCount);
    $('r-count').textContent = formatNum(r.count);
    $('r-coins').textContent = formatNum(r.earned);
    $('btn-next').innerHTML = r.won ? '<span>다음 레벨</span>' : '<span>다시 도전</span>';
    this.show('result', true);
    this.show('hud', false);
    this.hint(false);
    this.emit('resultShown', r);
  }
}
