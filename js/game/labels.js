// 3D 숫자 라벨: 게이트 표지판, 물체 위 숫자, HP바 스프라이트
import * as THREE from 'three';
import { makeCanvas, canvasTexture, drawOutlinedText, fitFont, roundRect, NUM_FONT } from '../world/textures.js';
import { formatNum } from '../engine/util.js';

export const GATE_STYLES = {
  blue: { top: '#5aa9ff', bot: '#1f5fd8', edge: '#0d3a8f', glow: '#bfe0ff', text: '#ffffff', stroke: '#0b2f78' },
  gold: { top: '#ffe066', bot: '#f5a511', edge: '#9a5a00', glow: '#fff4c2', text: '#ffffff', stroke: '#8a4b00' },
  red: { top: '#ff6b5e', bot: '#c9231d', edge: '#7a0f0b', glow: '#ffc2bc', text: '#ffffff', stroke: '#6e0c08' },
  purple: { top: '#c38bff', bot: '#7b3fe4', edge: '#401a8a', glow: '#ead6ff', text: '#ffffff', stroke: '#35137a' },
};

export function gateStyleFor(op, v) {
  if (op === 'mul') return GATE_STYLES.purple;
  if (v < 0) return GATE_STYLES.red;
  if (v >= 50) return GATE_STYLES.gold;
  return GATE_STYLES.blue;
}

export function gateText(op, v) {
  if (op === 'mul') return '×' + v;
  return (v >= 0 ? '+' : '−') + formatNum(Math.abs(v));
}

// 게이트 표지판 텍스처 (배경 그라디언트 + 숫자)
export class SignTexture {
  constructor(w = 512, h = 200) {
    [this.canvas, this.ctx] = makeCanvas(w, h);
    this.texture = canvasTexture(this.canvas, { mips: false });
  }
  draw(text, style) {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, style.top);
    g.addColorStop(1, style.bot);
    ctx.fillStyle = style.edge;
    roundRect(ctx, 0, 0, W, H, 26);
    ctx.fill();
    ctx.fillStyle = g;
    roundRect(ctx, 10, 10, W - 20, H - 20, 20);
    ctx.fill();
    // 상단 광택
    const gl = ctx.createLinearGradient(0, 10, 0, H * 0.5);
    gl.addColorStop(0, 'rgba(255,255,255,0.45)');
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gl;
    roundRect(ctx, 18, 16, W - 36, H * 0.42, 16);
    ctx.fill();
    // 테두리 하이라이트
    ctx.strokeStyle = style.glow;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 5;
    roundRect(ctx, 16, 16, W - 32, H - 32, 16);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const size = fitFont(ctx, text, W * 0.82, H * 0.74);
    drawOutlinedText(ctx, text, W / 2, H * 0.55, size, { fill: style.text, stroke: style.stroke, strokeW: 0.14 });
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}

// 투명 배경 숫자 (바리케이드, 기둥, 통)
export class NumberTexture {
  constructor(w = 256, h = 128, { fill = '#ffffff', stroke = '#1d1b22', strokeW = 0.17 } = {}) {
    [this.canvas, this.ctx] = makeCanvas(w, h);
    this.texture = canvasTexture(this.canvas, { mips: false });
    this.opts = { fill, stroke, strokeW };
    this.last = null;
  }
  draw(text) {
    if (text === this.last) return;
    this.last = text;
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const size = fitFont(ctx, text, canvas.width * 0.9, canvas.height * 0.8);
    drawOutlinedText(ctx, text, canvas.width / 2, canvas.height * 0.52, size, this.opts);
    this.texture.needsUpdate = true;
  }
  dispose() {
    this.texture.dispose();
  }
}

// 항상 위에 그려지는 스프라이트 라벨 (부대 수, 거인/보스 HP)
export class SpriteLabel {
  constructor(overlay, { w = 256, h = 128, scale = 2.2, bar = false, color = '#ffffff', stroke = '#101522', barColor = '#ff3b30' } = {}) {
    [this.canvas, this.ctx] = makeCanvas(w, h);
    this.texture = canvasTexture(this.canvas, { mips: false });
    this.material = new THREE.SpriteMaterial({ map: this.texture, depthTest: false, depthWrite: false, toneMapped: false, transparent: true });
    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 100;
    this.aspect = w / h;
    this.baseScale = scale;
    this.sprite.scale.set(scale * this.aspect, scale, 1);
    this.bar = bar;
    this.color = color;
    this.stroke = stroke;
    this.barColor = barColor;
    this.last = '';
    this.bump = 0;
    overlay.add(this.sprite);
    this.overlay = overlay;
  }
  set(value, frac = 1, force = false) {
    const text = typeof value === 'number' ? formatNum(value) : value;
    const key = text + '|' + (this.bar ? Math.round(frac * 200) : '');
    if (key === this.last && !force) return;
    this.last = key;
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    if (this.bar) {
      const size = fitFont(ctx, text, W * 0.9, H * 0.52);
      drawOutlinedText(ctx, text, W / 2, H * 0.33, size, { fill: this.color, stroke: this.stroke, strokeW: 0.16 });
      const bw = W * 0.86, bh = H * 0.17, bx = (W - bw) / 2, by = H * 0.7;
      ctx.fillStyle = '#15151c';
      roundRect(ctx, bx - 4, by - 4, bw + 8, bh + 8, 8);
      ctx.fill();
      ctx.fillStyle = '#3a3a44';
      roundRect(ctx, bx, by, bw, bh, 5);
      ctx.fill();
      if (frac > 0) {
        const g = ctx.createLinearGradient(0, by, 0, by + bh);
        g.addColorStop(0, '#ff8a5c');
        g.addColorStop(1, this.barColor);
        ctx.fillStyle = g;
        roundRect(ctx, bx, by, Math.max(6, bw * frac), bh, 5);
        ctx.fill();
      }
    } else {
      const size = fitFont(ctx, text, W * 0.92, H * 0.8);
      drawOutlinedText(ctx, text, W / 2, H * 0.52, size, { fill: this.color, stroke: this.stroke, strokeW: 0.17 });
    }
    this.texture.needsUpdate = true;
  }
  pulse(a = 0.25) {
    this.bump = Math.max(this.bump, a);
  }
  update(dt, x, y, z, scaleMul = 1) {
    this.bump = Math.max(0, this.bump - dt * 2.5);
    const s = this.baseScale * scaleMul * (1 + this.bump);
    this.sprite.scale.set(s * this.aspect, s, 1);
    this.sprite.position.set(x, y, z);
  }
  set visible(v) {
    this.sprite.visible = v;
  }
  dispose() {
    this.overlay.remove(this.sprite);
    this.texture.dispose();
    this.material.dispose();
  }
}

export { NUM_FONT };
