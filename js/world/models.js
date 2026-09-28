// 캐릭터/무기 로우폴리 모델 (정점 색상 + 발광 속성으로 병합) 및 공용 셰이더 머티리얼
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const PI = Math.PI;
const _c = new THREE.Color();

// ---------- 머티리얼: 림라이트 + 피격 플래시 + 발광 정점 ----------
export function makeCharMaterial({ flash = false, rim = 0.35, rimColor = 0xffffff, roughness = 0.62, metalness = 0.05, side = THREE.FrontSide, map = null } = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness, side, map });
  m.userData.rim = { value: rim };
  m.userData.rimColor = { value: new THREE.Color(rimColor) };
  m.userData.flashAll = { value: 0 };
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRim = m.userData.rim;
    sh.uniforms.uRimColor = m.userData.rimColor;
    sh.uniforms.uFlashAll = m.userData.flashAll;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float glow;
varying float vGlow;
${flash ? 'attribute float aFlash; varying float vFlash;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vGlow = glow;
${flash ? 'vFlash = aFlash;' : ''}`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uRim; uniform vec3 uRimColor; uniform float uFlashAll;
varying float vGlow;
${flash ? 'varying float vFlash;' : ''}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float fl = uFlashAll ${flash ? '+ vFlash' : ''};
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), clamp(fl, 0.0, 1.0) * 0.8);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vGlow * 2.2 + vec3(clamp(fl, 0.0, 1.0) * 0.9);
float rimF = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
totalEmissiveRadiance += uRimColor * pow(rimF, 3.0) * uRim;`);
  };
  m.customProgramCacheKey = () => `char-${flash ? 1 : 0}`;
  return m;
}

// ---------- 지오메트리 빌더 ----------
export class GeoBuilder {
  constructor() {
    this.parts = [];
  }
  add(geo, color, glow = 0) {
    let g = geo.index ? geo.toNonIndexed() : geo;
    g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    _c.set(color);
    for (let i = 0; i < n; i++) {
      col[i * 3] = _c.r;
      col[i * 3 + 1] = _c.g;
      col[i * 3 + 2] = _c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    this.parts.push(g);
    return this;
  }
  build() {
    const g = mergeGeometries(this.parts, false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

// 편의 지오메트리
const sphere = (r, w = 8, h = 6) => new THREE.SphereGeometry(r, w, h);
const cyl = (rt, rb, h, s = 8, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const torus = (r, t, rs, ts, arc = PI * 2) => new THREE.TorusGeometry(r, t, rs, ts, arc);

export const COLORS = {
  blue: 0x2f6fe4,
  blueLight: 0x4b93ff,
  blueDark: 0x1d4db4,
  skin: 0xf6c7a0,
  skinRed: 0xe9b08a,
  boot: 0x4a3122,
  wood: 0x8a5a2b,
  gold: 0xf2b634,
  red: 0xd0322c,
  redLight: 0xe8463c,
  redDark: 0x8e1c1b,
  steel: 0xb8c0cc,
  white: 0xf4f1ea,
};

// ---------- 무기 ----------
function addBow(b, x = -0.19, y = 0.55, z = -0.2) {
  b.add(torus(0.3, 0.024, 3, 10, PI).scale(1, 0.5, 1).rotateZ(-PI / 2).rotateY(PI / 2).translate(x, y, z), COLORS.wood);
  b.add(cyl(0.006, 0.006, 0.6, 3).translate(x, y, z + 0.0), 0xeeeeee);
  b.add(sphere(0.045, 5, 3).translate(x, y, z - 0.02), COLORS.skin);
}
function addCrossbow(b, tier, y = 0.56) {
  const stock = tier >= 3 ? 0x5a2a18 : 0x7a4a24;
  const prod = tier >= 3 ? 0xff7a1a : COLORS.gold;
  b.add(box(0.075, 0.07, 0.5).translate(0.02, y, -0.28), stock);
  b.add(torus(0.27, 0.028, 4, 12, PI).scale(1, 0.45, 1).rotateX(-PI / 2).translate(0.02, y + 0.02, -0.42), prod, tier >= 3 ? 0.6 : 0);
  b.add(box(0.54, 0.012, 0.012).translate(0.02, y + 0.02, -0.42), 0xeeeeee);
  b.add(cone(0.035, 0.12, 5).rotateX(-PI / 2).translate(0.02, y + 0.05, -0.57), tier >= 3 ? 0xffb347 : 0xdadfe6, tier >= 3 ? 1 : 0);
  b.add(sphere(0.05, 6, 4).translate(-0.12, y - 0.02, -0.2), COLORS.skin);
  b.add(sphere(0.05, 6, 4).translate(0.15, y - 0.02, -0.12), COLORS.skin);
}

// ---------- 아군 궁수 ----------
export function buildArcherGeometry(tier = 1) {
  const b = new GeoBuilder();
  b.add(sphere(0.085, 5, 3).scale(1, 0.7, 1.4).translate(-0.1, 0.05, -0.02), COLORS.boot);
  b.add(sphere(0.085, 5, 3).scale(1, 0.7, 1.4).translate(0.1, 0.05, -0.02), COLORS.boot);
  b.add(cyl(0.16, 0.27, 0.46, 9).translate(0, 0.3, 0), COLORS.blue);
  b.add(cyl(0.272, 0.28, 0.06, 9).translate(0, 0.08, 0), COLORS.blueDark);
  b.add(cyl(0.18, 0.185, 0.07, 9).translate(0, 0.48, 0), 0x6b4526);
  b.add(sphere(0.2, 8, 5).scale(1, 0.62, 0.9).translate(0, 0.56, 0), COLORS.blue);
  b.add(sphere(0.165, 9, 7).translate(0, 0.76, 0), COLORS.skin);
  b.add(cone(0.215, 0.44, 10).rotateX(0.18).translate(0, 0.99, 0.03), COLORS.blueLight);
  b.add(torus(0.17, 0.045, 4, 9).rotateX(PI / 2).translate(0, 0.83, 0.01), COLORS.blueDark);
  b.add(sphere(0.022, 3, 2).translate(-0.06, 0.77, -0.15), 0x1a1a22);
  b.add(sphere(0.022, 3, 2).translate(0.06, 0.77, -0.15), 0x1a1a22);
  // 화살통
  b.add(cyl(0.055, 0.045, 0.34, 6).rotateX(-0.35).translate(0.1, 0.62, 0.2), 0x7a4a24);
  b.add(cone(0.05, 0.1, 4).translate(0.1, 0.83, 0.27), 0xf0f0f0);
  if (tier <= 1) addBow(b);
  else addCrossbow(b, tier);
  return b.build();
}

// ---------- 적 병사 ----------
export function buildSoldierGeometry(kind = 'basic') {
  const b = new GeoBuilder();
  const shield = kind === 'shield';
  const robe = shield ? 0xb82a2a : COLORS.red;
  b.add(sphere(0.085, 5, 3).scale(1, 0.7, 1.4).translate(-0.1, 0.05, -0.02), 0x3a2419);
  b.add(sphere(0.085, 5, 3).scale(1, 0.7, 1.4).translate(0.1, 0.05, -0.02), 0x3a2419);
  b.add(cyl(0.16, 0.26, 0.46, 8).translate(0, 0.3, 0), robe);
  b.add(cyl(0.262, 0.27, 0.06, 8).translate(0, 0.08, 0), COLORS.redDark);
  b.add(sphere(0.19, 7, 5).scale(1, 0.62, 0.9).translate(0, 0.56, 0), robe);
  b.add(sphere(0.16, 8, 6).translate(0, 0.76, 0), COLORS.skinRed);
  // 뾰족 투구
  b.add(cone(0.2, 0.4, 9).translate(0, 0.98, 0.02), COLORS.redLight);
  b.add(sphere(0.045, 4, 3).translate(0, 1.19, 0.02), 0x9c1c18);
  b.add(torus(0.165, 0.04, 3, 8).rotateX(PI / 2).translate(0, 0.83, 0.01), COLORS.redDark);
  b.add(box(0.2, 0.03, 0.02).translate(0, 0.8, -0.15), 0x2a1010);
  // 창
  b.add(cyl(0.016, 0.016, 1.15, 4).translate(0.21, 0.62, -0.08), 0x6b4526);
  b.add(cone(0.04, 0.14, 4).translate(0.21, 1.25, -0.08), COLORS.steel);
  b.add(sphere(0.05, 4, 3).translate(0.21, 0.5, -0.08), COLORS.skinRed);
  if (shield) {
    const z = -0.26;
    b.add(cyl(0.25, 0.25, 0.05, 10).rotateX(PI / 2).translate(-0.1, 0.46, z), 0xc0302a);
    // 원판은 +z를 보므로 뒤집어서 방패 앞면(-z)에 붙인다
    b.add(new THREE.CircleGeometry(0.18, 10).translate(0.1, 0.46, -z + 0.03).rotateY(PI), COLORS.white);
    b.add(new THREE.CircleGeometry(0.1, 10).translate(0.1, 0.46, -z + 0.036).rotateY(PI), 0xd33b33);
    b.add(sphere(0.045, 4, 3).translate(-0.1, 0.46, z - 0.04), 0xd9d9d9);
  }
  return b.build();
}

// ---------- 화살 ----------
export function buildArrowGeometry(tier = 1) {
  const b = new GeoBuilder();
  const shaft = tier >= 2 ? 0xd79a4a : 0xb07a45;
  // -z 방향이 앞
  b.add(cyl(0.022, 0.022, 0.9, 4).rotateX(PI / 2), shaft);
  b.add(cone(0.06, 0.2, 4).rotateX(-PI / 2).translate(0, 0, -0.52), tier >= 3 ? 0xffc36b : 0xe8f4ff, tier >= 2 ? 1.2 : 0.8);
  b.add(box(0.14, 0.012, 0.18).translate(0, 0, 0.38), tier >= 3 ? 0xff5a2a : 0xffffff, tier >= 3 ? 0.6 : 0.2);
  b.add(box(0.012, 0.14, 0.18).translate(0, 0, 0.38), tier >= 3 ? 0xff5a2a : 0xffffff, tier >= 3 ? 0.6 : 0.2);
  return b.build();
}

// ---------- 지휘관 (영웅) ----------
export function buildHero() {
  const g = new THREE.Group();
  const mat = makeCharMaterial({ rim: 0.45, side: THREE.DoubleSide });
  const body = new GeoBuilder();
  body.add(sphere(0.1, 6, 4).scale(1, 0.7, 1.4).translate(-0.12, 0.06, -0.02), 0x3b2618);
  body.add(sphere(0.1, 6, 4).scale(1, 0.7, 1.4).translate(0.12, 0.06, -0.02), 0x3b2618);
  body.add(cyl(0.2, 0.32, 0.55, 12).translate(0, 0.36, 0), 0x2a62d6);
  body.add(cyl(0.325, 0.33, 0.07, 12).translate(0, 0.1, 0), COLORS.gold);
  body.add(cyl(0.215, 0.22, 0.08, 12).translate(0, 0.57, 0), 0x6b4526);
  body.add(box(0.1, 0.08, 0.04).translate(0, 0.57, -0.22), COLORS.gold);
  body.add(sphere(0.25, 12, 8).scale(1, 0.6, 0.9).translate(0, 0.67, 0), 0x2a62d6);
  // 망토
  body.add(new THREE.CylinderGeometry(0.3, 0.47, 0.82, 14, 1, true, -PI / 2, PI).translate(0, 0.42, 0.04), 0x1b4fb8);
  body.add(sphere(0.2, 12, 10).translate(0, 0.92, 0), COLORS.skin);
  body.add(sphere(0.21, 12, 8).scale(1.02, 0.7, 1.05).translate(0, 1.0, 0.03), 0x5a3520);
  // 왕관
  body.add(cyl(0.15, 0.14, 0.1, 12, true).translate(0, 1.13, 0), COLORS.gold);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2;
    body.add(cone(0.035, 0.1, 4).translate(Math.cos(a) * 0.145, 1.22, Math.sin(a) * 0.145), COLORS.gold);
  }
  body.add(sphere(0.03, 6, 4).translate(0, 1.14, -0.15), 0xff3355, 1);
  body.add(sphere(0.026, 4, 3).translate(-0.07, 0.93, -0.18), 0x1a1a22);
  body.add(sphere(0.026, 4, 3).translate(0.07, 0.93, -0.18), 0x1a1a22);
  addCrossbow(body, 2, 0.68);
  const mesh = new THREE.Mesh(body.build(), mat);
  mesh.castShadow = true;
  mesh.scale.setScalar(1.35);
  g.add(mesh);
  g.userData.mesh = mesh;
  g.userData.mat = mat;
  return g;
}

// ---------- 거인 (몽둥이) ----------
function part(builderFn, mat) {
  const b = new GeoBuilder();
  builderFn(b);
  const m = new THREE.Mesh(b.build(), mat);
  m.castShadow = true;
  return m;
}

export function buildGiant() {
  const mat = makeCharMaterial({ rim: 0.3 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const tunic = 0xe5623d, vest = 0x9d2b2b, pants = 0x3a3a4c, skin = 0xeeb08a, hair = 0x2a211e;
  const legL = part((b) => {
    b.add(cyl(0.2, 0.18, 0.7, 8).translate(0, -0.35, 0), pants);
    b.add(box(0.36, 0.28, 0.5).translate(0, -0.72, -0.08), 0x5b3a22);
  }, mat);
  legL.position.set(-0.32, 0.86, 0);
  const legR = legL.clone();
  legR.position.x = 0.32;
  const torso = part((b) => {
    b.add(cyl(0.62, 0.52, 1.1, 12).scale(1, 1, 0.75).translate(0, 1.45, 0), tunic);
    b.add(cyl(0.64, 0.6, 0.35, 12).scale(1, 1, 0.77).translate(0, 1.72, 0), vest);
    b.add(cyl(0.56, 0.56, 0.16, 12).scale(1, 1, 0.78).translate(0, 1.0, 0), 0x5b3a1f);
    b.add(box(0.26, 0.2, 0.06).translate(0, 1.0, -0.44), 0xd9d9e0);
    b.add(box(0.14, 0.1, 0.07).translate(0, 1.0, -0.45), 0x5b3a1f);
    b.add(cyl(0.54, 0.5, 0.3, 12).scale(1, 1, 0.75).translate(0, 0.86, 0), pants);
  }, mat);
  const head = part((b) => {
    b.add(sphere(0.42, 12, 10).translate(0, 0.3, 0), skin);
    b.add(sphere(0.44, 12, 8).scale(1.02, 0.6, 1).translate(0, 0.52, 0.06), hair);
    for (let i = 0; i < 9; i++) {
      const a = -0.6 + (i / 8) * (PI + 1.2);
      b.add(cone(0.13, 0.32, 5).rotateZ(Math.cos(a) * -0.9).rotateX(0.5).translate(Math.cos(a) * 0.32, 0.62, Math.sin(a) * 0.2 + 0.1), hair);
    }
    b.add(box(0.12, 0.05, 0.04).rotateZ(0.3).translate(-0.15, 0.4, -0.38), hair);
    b.add(box(0.12, 0.05, 0.04).rotateZ(-0.3).translate(0.15, 0.4, -0.38), hair);
    b.add(sphere(0.06, 6, 5).scale(1.2, 0.7, 0.6).translate(-0.15, 0.32, -0.38), 0xff2a2a, 1.5);
    b.add(sphere(0.06, 6, 5).scale(1.2, 0.7, 0.6).translate(0.15, 0.32, -0.38), 0xff2a2a, 1.5);
    b.add(sphere(0.09, 6, 5).translate(0, 0.22, -0.42), 0xe59b76);
    b.add(box(0.2, 0.03, 0.03).translate(0, 0.08, -0.4), 0x7a3b2a);
  }, mat);
  head.position.set(0, 1.9, 0);
  const armL = part((b) => {
    b.add(sphere(0.26, 8, 6).translate(0, 0, 0), tunic);
    b.add(cyl(0.17, 0.15, 0.8, 8).translate(0, -0.45, 0), skin);
    b.add(sphere(0.2, 8, 6).translate(0, -0.9, 0), skin);
  }, mat);
  armL.position.set(-0.75, 1.75, 0);
  armL.rotation.z = -0.25;
  const armR = part((b) => {
    b.add(sphere(0.26, 8, 6), tunic);
    b.add(cyl(0.17, 0.15, 0.8, 8).translate(0, -0.45, 0), skin);
    b.add(sphere(0.2, 8, 6).translate(0, -0.9, 0), skin);
    // 몽둥이
    b.add(cyl(0.2, 0.08, 1.5, 8).rotateX(PI / 2).translate(0, -0.95, -0.7), 0x9b6a3b);
    b.add(sphere(0.21, 8, 6).translate(0, -0.95, -1.45), 0x8d5e33);
  }, mat);
  armR.position.set(0.75, 1.75, 0);
  armR.rotation.z = 0.25;
  body.add(legL, legR, torso, head, armL, armR);
  root.userData = { mat, body, legL, legR, head, armL, armR, height: 2.5 };
  return root;
}

// ---------- 보스 (철퇴 기사) ----------
export function buildBoss() {
  const mat = makeCharMaterial({ rim: 0.5, rimColor: 0x7fe8ff, metalness: 0.35, roughness: 0.45 });
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const steel = 0x3a4252, steelL = 0x6a7590, glowC = 0x39e6ff, cloth = 0x9b1b26, spike = 0x262b36;
  const legL = part((b) => {
    b.add(cyl(0.3, 0.26, 0.9, 8).translate(0, -0.45, 0), steel);
    b.add(sphere(0.28, 8, 6).translate(0, -0.05, -0.05), steelL);
    b.add(box(0.5, 0.35, 0.75).translate(0, -0.95, -0.12), spike);
  }, mat);
  legL.position.set(-0.48, 1.15, 0);
  const legR = legL.clone();
  legR.position.x = 0.48;
  const torso = part((b) => {
    b.add(cyl(0.95, 0.7, 1.4, 12).scale(1, 1, 0.72).translate(0, 1.95, 0), steel);
    b.add(cyl(0.7, 0.62, 0.5, 12).scale(1, 1, 0.8).translate(0, 1.15, 0), 0x2c3240);
    // 붉은 휘장
    b.add(box(0.7, 1.2, 0.08).translate(0, 1.05, -0.62), cloth);
    b.add(box(0.7, 0.12, 0.1).translate(0, 1.62, -0.63), 0xc9a13a);
    // 발광 장식
    b.add(box(0.9, 0.06, 0.06).translate(0, 2.25, -0.7), glowC, 1.6);
    b.add(box(0.06, 0.6, 0.06).translate(0, 1.95, -0.7), glowC, 1.6);
    b.add(sphere(0.14, 8, 6).translate(0, 1.95, -0.72), glowC, 2);
    // 어깨 가시 갑옷
    for (const s of [-1, 1]) {
      b.add(sphere(0.55, 10, 8).scale(1, 0.75, 1).translate(s * 1.05, 2.55, 0), steelL);
      b.add(cone(0.14, 0.7, 6).rotateZ(-s * 0.7).translate(s * 1.4, 2.95, 0.1), spike);
      b.add(cone(0.12, 0.55, 6).rotateZ(-s * 0.3).translate(s * 1.1, 3.05, -0.1), spike);
      b.add(cone(0.1, 0.45, 6).rotateZ(-s * 1.1).translate(s * 1.55, 2.6, 0.2), spike);
    }
  }, mat);
  const head = part((b) => {
    b.add(sphere(0.5, 12, 10).scale(1, 1.1, 1).translate(0, 0.35, 0), steel);
    b.add(box(0.8, 0.14, 0.2).translate(0, 0.33, -0.44), 0x10131a);
    b.add(box(0.18, 0.07, 0.05).translate(-0.18, 0.34, -0.55), glowC, 2.5);
    b.add(box(0.18, 0.07, 0.05).translate(0.18, 0.34, -0.55), glowC, 2.5);
    b.add(cone(0.12, 0.9, 6).translate(0, 1.05, 0.05), spike);
    b.add(cone(0.1, 0.6, 6).rotateZ(0.9).translate(-0.55, 0.75, 0), spike);
    b.add(cone(0.1, 0.6, 6).rotateZ(-0.9).translate(0.55, 0.75, 0), spike);
    b.add(box(0.12, 0.5, 0.35).translate(0, 0.65, -0.35), steelL);
  }, mat);
  head.position.set(0, 2.85, 0);
  const armL = part((b) => {
    b.add(cyl(0.26, 0.22, 1.0, 8).translate(0, -0.55, 0), steel);
    b.add(box(0.5, 0.5, 0.5).translate(0, -1.15, -0.05), steelL);
    b.add(cone(0.08, 0.35, 5).rotateZ(PI / 2).translate(-0.4, -1.1, 0), spike);
  }, mat);
  armL.position.set(-1.15, 2.4, 0);
  armL.rotation.z = -0.35;
  const armR = part((b) => {
    b.add(cyl(0.26, 0.22, 1.0, 8).translate(0, -0.55, 0), steel);
    b.add(box(0.5, 0.5, 0.5).translate(0, -1.15, -0.05), steelL);
    b.add(cyl(0.07, 0.07, 0.9, 6).rotateX(PI / 2).translate(0, -1.15, -0.4), 0x5a3a22);
  }, mat);
  armR.position.set(1.15, 2.4, 0);
  armR.rotation.z = 0.35;
  // 철퇴 사슬 + 가시공 (별도 객체로 휘두름)
  const flail = new THREE.Group();
  const chain = part((b) => {
    for (let i = 0; i < 6; i++) {
      b.add(torus(0.09, 0.03, 4, 8).rotateY(i % 2 ? PI / 2 : 0).translate(0, -i * 0.2, 0), 0x6d7482);
    }
  }, mat);
  const ball = part((b) => {
    b.add(sphere(0.55, 12, 10), 0x2e3440);
    const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1], [0.7, 0.7, 0], [-0.7, 0.7, 0], [0.7, -0.7, 0], [-0.7, -0.7, 0], [0, 0.7, 0.7], [0, -0.7, 0.7], [0, 0.7, -0.7], [0, -0.7, -0.7]];
    for (const d of dirs) {
      const v = new THREE.Vector3(...d).normalize();
      const c = cone(0.14, 0.42, 5);
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), v);
      c.applyQuaternion(q).translate(v.x * 0.62, v.y * 0.62, v.z * 0.62);
      b.add(c, 0x1d2129);
    }
  }, mat);
  ball.position.y = -1.35;
  flail.add(chain, ball);
  flail.position.set(0, -1.15, -0.8);
  armR.add(flail);
  body.add(legL, legR, torso, head, armL, armR);
  root.userData = { mat, body, legL, legR, head, armL, armR, flail, ball, height: 4 };
  return root;
}

// ---------- 보상 아이콘 ----------
export function buildTroopIcon() {
  const g = new THREE.Group();
  const mat = makeCharMaterial({ rim: 0.6, rimColor: 0x9fd0ff });
  const geo = buildArcherGeometry(2);
  for (const x of [-0.28, 0.28]) {
    const m = new THREE.Mesh(geo, mat);
    m.position.x = x;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

export function buildCrossbowIcon(tier = 2) {
  const b = new GeoBuilder();
  const col = tier >= 3 ? 0xff6a1a : COLORS.gold;
  b.add(box(0.16, 0.14, 1.2).translate(0, 0, 0), 0x7a4a24);
  b.add(torus(0.62, 0.07, 5, 14, PI).scale(1, 0.5, 1).rotateX(-PI / 2).translate(0, 0.05, -0.25), col, tier >= 3 ? 0.8 : 0.15);
  b.add(box(1.24, 0.03, 0.03).translate(0, 0.05, -0.25), 0xffffff);
  b.add(cone(0.08, 0.3, 5).rotateX(-PI / 2).translate(0, 0.1, -0.75), tier >= 3 ? 0xffb347 : 0xe6ecf5, 0.8);
  const m = new THREE.Mesh(b.build(), makeCharMaterial({ rim: 0.6, rimColor: 0xffe7a0, metalness: 0.3, roughness: 0.4 }));
  m.castShadow = true;
  m.rotation.set(0.5, 0.6, 0);
  const g = new THREE.Group();
  g.add(m);
  return g;
}

export function buildBoltIcon() {
  const s = new THREE.Shape();
  s.moveTo(0.1, 0.7);
  s.lineTo(-0.35, 0.0);
  s.lineTo(-0.02, 0.0);
  s.lineTo(-0.15, -0.7);
  s.lineTo(0.35, 0.1);
  s.lineTo(0.03, 0.1);
  s.closePath();
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.18, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  geo.translate(0, 0, -0.09);
  const b = new GeoBuilder();
  b.add(geo, 0xffd23a, 0.7);
  const m = new THREE.Mesh(b.build(), makeCharMaterial({ rim: 0.6, rimColor: 0xfff3b0 }));
  m.castShadow = true;
  const g = new THREE.Group();
  g.add(m);
  return g;
}
