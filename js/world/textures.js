// 절차적 캔버스 텍스처 (외부 이미지 없이 모든 표면을 생성)
import * as THREE from 'three';
import { mulberry32 } from '../engine/util.js';

export const NUM_FONT = '"Lilita One", "Arial Black", Impact, sans-serif';
export const KR_FONT = '"Black Han Sans", "Lilita One", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';

let maxAniso = 4;
export function setMaxAnisotropy(v) { maxAniso = v; }

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

export function canvasTexture(c, { repeat = null, srgb = true, mips = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = maxAniso;
  if (!mips) {
    t.generateMipmaps = false;
    t.minFilter = THREE.LinearFilter;
  }
  return t;
}

function hsl(h, s, l, a = 1) {
  return `hsla(${h},${s}%,${l}%,${a})`;
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
export { roundRect };

function speckle(ctx, w, h, n, rng, colorFn) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colorFn(rng);
    const s = rng() * 2 + 0.6;
    ctx.fillRect(rng() * w, rng() * h, s, s);
  }
}

// 높이 맵(회색조 캔버스)을 타일링 가능한 노멀 맵으로 변환.
// 범프 맵 셰이더는 일부 모바일 GPU에서 미분값이 0일 때 NaN을 만들어
// 블룸과 함께 화면 전체를 검게 만들 수 있어 노멀 맵을 쓴다.
const NORMAL_STRENGTH = 2.2;
export function heightToNormal(heightCanvas, strength = 2) {
  const w = heightCanvas.width, h = heightCanvas.height;
  const src = heightCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  const [c, ctx] = makeCanvas(w, h);
  const out = ctx.createImageData(w, h);
  const H = (x, y) => src[((((y + h) % h) * w + ((x + w) % w)) << 2)] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * w + x) << 2;
      out.data[i] = (-dx / len * 0.5 + 0.5) * 255;
      out.data[i + 1] = (dy / len * 0.5 + 0.5) * 255;
      out.data[i + 2] = (1 / len * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return canvasTexture(c, { srgb: false });
}

// 판석 도로 (다리 테마) — 색상 맵 + 노멀 맵
export function flagstoneTextures({ base = [36, 38, 74], seed = 7, rows = 8, grass = true, size = 512 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const [bc, bctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  const [H, S, L] = base;
  ctx.fillStyle = hsl(H, S - 10, L - 22);
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#202020';
  bctx.fillRect(0, 0, size, size);
  const rowH = size / rows;
  const gap = size * 0.008;
  for (let r = 0; r < rows; r++) {
    let x = -rng() * rowH;
    const y = r * rowH;
    // 한 줄의 폭 합이 정확히 size가 되도록 나눠서 반복 타일 이음매를 없앤다
    const widths = [];
    let sum = 0;
    while (sum < size) {
      const w = rowH * (0.9 + rng() * 1.1);
      widths.push(w);
      sum += w;
    }
    const k = size / sum;
    for (const w0 of widths) {
      const w = w0 * k;
      const l = L + (rng() - 0.5) * 9;
      const hh = H + (rng() - 0.5) * 6;
      // 가로 이음매가 보이지 않도록 경계를 넘는 돌은 반대편에도 그린다
      drawStone(ctx, bctx, x + gap, y + gap, w - gap * 2, rowH - gap * 2, hh, S, l, rng);
      if (x + w > size) drawStone(ctx, bctx, x + gap - size, y + gap, w - gap * 2, rowH - gap * 2, hh, S, l, rng);
      if (x < 0) drawStone(ctx, bctx, x + gap + size, y + gap, w - gap * 2, rowH - gap * 2, hh, S, l, rng);
      x += w;
    }
  }
  if (grass) {
    // 틈새의 풀
    for (let i = 0; i < 70; i++) {
      const gx = rng() * size;
      const gy = Math.round(rng() * rows) * rowH + (rng() - 0.5) * 4;
      for (let k = 0; k < 6; k++) {
        ctx.strokeStyle = hsl(95 + rng() * 25, 45, 38 + rng() * 15, 0.85);
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(gx + k * 1.5, gy);
        ctx.lineTo(gx + k * 1.5 + (rng() - 0.5) * 6, gy - 3 - rng() * 7);
        ctx.stroke();
      }
    }
  }
  speckle(ctx, size, size, 3000, rng, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '60,50,40'},${0.05 + r() * 0.07})`);
  return { map: canvasTexture(c), normal: heightToNormal(bc, NORMAL_STRENGTH) };
}

function drawStone(ctx, bctx, x, y, w, h, H, S, L, rng) {
  const r = Math.min(w, h) * 0.18;
  const g = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, hsl(H, S, L + 5));
  g.addColorStop(1, hsl(H, S, L - 4));
  ctx.fillStyle = g;
  roundRect(ctx, x, y, w, h, r);
  ctx.fill();
  // 베벨 하이라이트/그림자
  ctx.save();
  ctx.clip();
  ctx.lineWidth = 3;
  ctx.strokeStyle = hsl(H, S, L + 14, 0.5);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y);
  ctx.lineTo(x + w, y);
  ctx.stroke();
  ctx.strokeStyle = hsl(H, S, L - 18, 0.45);
  ctx.beginPath();
  ctx.moveTo(x + w, y);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.stroke();
  // 얼룩
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = hsl(H, S, L + (rng() - 0.5) * 12, 0.25);
    ctx.beginPath();
    ctx.ellipse(x + rng() * w, y + rng() * h, w * (0.1 + rng() * 0.2), h * (0.1 + rng() * 0.2), rng() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  const bg = bctx.createRadialGradient(x + w / 2, y + h / 2, 2, x + w / 2, y + h / 2, Math.max(w, h) * 0.7);
  bg.addColorStop(0, '#e0e0e0');
  bg.addColorStop(1, '#a8a8a8');
  bctx.fillStyle = bg;
  roundRect(bctx, x, y, w, h, r);
  bctx.fill();
}

// 벽돌/석벽 (난간, 차선 벽, 기둥)
export function brickTexture({ base = [36, 30, 72], seed = 3, rows = 6, cols = 3, size = 256 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  const [H, S, L] = base;
  ctx.fillStyle = hsl(H, S - 8, L - 25);
  ctx.fillRect(0, 0, size, size);
  const rh = size / rows;
  const cw = size / cols;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * cw * 0.5;
    for (let k = -1; k <= cols; k++) {
      const x = k * cw + off + 2;
      const y = r * rh + 2;
      const l = L + (rng() - 0.5) * 10;
      const g = ctx.createLinearGradient(x, y, x, y + rh);
      g.addColorStop(0, hsl(H, S, l + 6));
      g.addColorStop(1, hsl(H, S, l - 6));
      ctx.fillStyle = g;
      roundRect(ctx, x, y, cw - 4, rh - 4, 5);
      ctx.fill();
    }
  }
  speckle(ctx, size, size, 900, rng, (r) => `rgba(${r() < 0.5 ? '255,255,255' : '40,30,20'},${0.05 + r() * 0.08})`);
  return canvasTexture(c);
}

// 눈길
export function snowTextures({ seed = 11, size = 512, road = true } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const [bc, bctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  ctx.fillStyle = road ? '#c9d6ea' : '#eef4fc';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#808080';
  bctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 260; i++) {
    const x = rng() * size;
    const y = rng() * size;
    const r = 10 + rng() * 50;
    const l = road ? 80 + rng() * 10 : 90 + rng() * 8;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, hsl(215, 40, l, 0.35));
    g.addColorStop(1, hsl(215, 40, l, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
    const bg = bctx.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.floor(100 + rng() * 80);
    bg.addColorStop(0, `rgba(${v},${v},${v},0.5)`);
    bg.addColorStop(1, `rgba(${v},${v},${v},0)`);
    bctx.fillStyle = bg;
    bctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  if (road) {
    // 바퀴 자국/발자국 줄
    for (let k = 0; k < 7; k++) {
      const x = (k + 0.5) * (size / 7) + (rng() - 0.5) * 20;
      ctx.strokeStyle = 'rgba(120,140,175,0.13)';
      ctx.lineWidth = 8 + rng() * 10;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      for (let y = 0; y <= size; y += 32) ctx.lineTo(x + Math.sin(y * 0.02 + k) * 6, y);
      ctx.stroke();
    }
  }
  speckle(ctx, size, size, 2500, rng, (r) => `rgba(255,255,255,${0.2 + r() * 0.5})`);
  return { map: canvasTexture(c), normal: heightToNormal(bc, NORMAL_STRENGTH) };
}

// 초원/흙길
export function grassTextures({ seed = 21, size = 512 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  ctx.fillStyle = '#6fae43';
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 300; i++) {
    const x = rng() * size, y = rng() * size, r = 12 + rng() * 40;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = 34 + rng() * 16;
    g.addColorStop(0, hsl(88 + rng() * 20, 50, l, 0.4));
    g.addColorStop(1, hsl(88, 50, l, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  for (let i = 0; i < 5000; i++) {
    ctx.strokeStyle = hsl(80 + rng() * 30, 50, 30 + rng() * 30, 0.6);
    ctx.lineWidth = 1;
    const x = rng() * size, y = rng() * size;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (rng() - 0.5) * 3, y - 2 - rng() * 4);
    ctx.stroke();
  }
  return canvasTexture(c);
}

export function dirtRoadTextures({ seed = 31, size = 512 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const [bc, bctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  ctx.fillStyle = '#c9a26b';
  ctx.fillRect(0, 0, size, size);
  bctx.fillStyle = '#707070';
  bctx.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const x = rng() * size, y = rng() * size, r = 8 + rng() * 30;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const l = 55 + rng() * 15;
    g.addColorStop(0, hsl(33, 42, l, 0.35));
    g.addColorStop(1, hsl(33, 42, l, 0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // 조약돌
  for (let i = 0; i < 260; i++) {
    const x = rng() * size, y = rng() * size, r = 2 + rng() * 5;
    ctx.fillStyle = hsl(30, 15, 55 + rng() * 25);
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 0.75, rng() * 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3, y - r * 0.3, r * 0.4, r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    bctx.fillStyle = '#e8e8e8';
    bctx.beginPath();
    bctx.ellipse(x, y, r, r * 0.75, 0, 0, Math.PI * 2);
    bctx.fill();
  }
  speckle(ctx, size, size, 3000, rng, (r) => `rgba(${r() < 0.5 ? '255,240,220' : '80,55,30'},${0.08 + r() * 0.1})`);
  return { map: canvasTexture(c), normal: heightToNormal(bc, NORMAL_STRENGTH) };
}

// 나무 판자 (바리케이드, 통)
export function woodTexture({ seed = 5, planks = 5, size = 256, vertical = true, hue = 28 } = {}) {
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  const pw = size / planks;
  for (let i = 0; i < planks; i++) {
    const l = 40 + rng() * 10;
    const g = ctx.createLinearGradient(i * pw, 0, (i + 1) * pw, 0);
    g.addColorStop(0, hsl(hue, 55, l - 6));
    g.addColorStop(0.5, hsl(hue, 58, l + 4));
    g.addColorStop(1, hsl(hue, 55, l - 8));
    ctx.fillStyle = g;
    ctx.fillRect(i * pw, 0, pw, size);
    // 나뭇결
    for (let k = 0; k < 9; k++) {
      ctx.strokeStyle = hsl(hue, 50, l - 16, 0.35);
      ctx.lineWidth = 1 + rng();
      ctx.beginPath();
      const x0 = i * pw + rng() * pw;
      ctx.moveTo(x0, 0);
      for (let y = 0; y <= size; y += 16) ctx.lineTo(x0 + Math.sin(y * 0.05 + k) * 2.5, y);
      ctx.stroke();
    }
    ctx.fillStyle = hsl(hue, 50, 18, 0.9);
    ctx.fillRect(i * pw, 0, 2, size);
  }
  const t = canvasTexture(c);
  if (!vertical) t.rotation = Math.PI / 2;
  return t;
}

// 균열 오버레이 (기둥 손상 단계)
export function crackTexture(seed = 9, size = 256) {
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  ctx.clearRect(0, 0, size, size);
  const branches = (x, y, a, len, w, depth) => {
    if (depth <= 0 || w < 0.4) return;
    ctx.strokeStyle = 'rgba(40,30,25,0.9)';
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    let cx = x, cy = y;
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      a += (rng() - 0.5) * 0.9;
      cx += Math.cos(a) * len / steps;
      cy += Math.sin(a) * len / steps;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
    branches(cx, cy, a + (rng() - 0.5) * 1.4, len * 0.7, w * 0.65, depth - 1);
    if (rng() < 0.7) branches(cx, cy, a + (rng() - 0.5) * 2, len * 0.6, w * 0.55, depth - 1);
  };
  for (let i = 0; i < 4; i++) branches(size * (0.3 + rng() * 0.4), size * (0.2 + rng() * 0.5), rng() * Math.PI * 2, size * 0.3, 4, 4);
  return canvasTexture(c);
}

// ---------- 파티클 스프라이트 ----------
export function softCircleTexture(size = 64) {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(c, { srgb: false });
}

export function puffTexture(size = 128, seed = 4) {
  const [c, ctx] = makeCanvas(size, size);
  const rng = mulberry32(seed);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const r = rng() * size * 0.18;
    const x = size / 2 + Math.cos(a) * r;
    const y = size / 2 + Math.sin(a) * r;
    const rr = size * (0.16 + rng() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return canvasTexture(c, { srgb: false });
}

export function ringTexture(size = 128) {
  const [c, ctx] = makeCanvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, size * 0.28, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,1)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvasTexture(c, { srgb: false });
}

export function streakTexture(w = 32, h = 128) {
  const [c, ctx] = makeCanvas(w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.75, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,1)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const g2 = ctx.createLinearGradient(0, 0, w, 0);
  g2.addColorStop(0, 'rgba(0,0,0,1)');
  g2.addColorStop(0.5, 'rgba(0,0,0,0)');
  g2.addColorStop(1, 'rgba(0,0,0,1)');
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = g2;
  ctx.fillRect(0, 0, w, h);
  return canvasTexture(c, { srgb: false });
}

// ---------- 숫자 라벨 ----------
export function drawOutlinedText(ctx, text, x, y, size, { fill = '#fff', stroke = '#1b2233', strokeW = 0.16, font = NUM_FONT, shadow = true, align = 'center' } = {}) {
  ctx.font = `${size}px ${font}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  if (shadow) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = size * strokeW;
    ctx.strokeText(text, x, y + size * 0.07);
    ctx.fillText(text, x, y + size * 0.07);
  }
  ctx.strokeStyle = stroke;
  ctx.lineWidth = size * strokeW;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

// 크기에 맞게 폰트 크기 조절
export function fitFont(ctx, text, maxW, size, font = NUM_FONT) {
  ctx.font = `${size}px ${font}`;
  const w = ctx.measureText(text).width;
  return w > maxW ? Math.floor(size * (maxW / w)) : size;
}
