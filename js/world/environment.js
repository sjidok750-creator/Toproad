// 스테이지 지형/배경 생성: 도로, 바다/용암 셰이더, 난간, 나무, 가로등, 성문, 눈 내림
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { flagstoneTextures, brickTexture, snowTextures, grassTextures, dirtRoadTextures, canvasTexture, makeCanvas } from './textures.js';
import { GeoBuilder, makeCharMaterial } from './models.js';
import { mulberry32 } from '../engine/util.js';

export const HW = 6.2; // 도로 반폭
const PI = Math.PI;

const NOISE_GLSL = `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  float a=hash21(i), b=hash21(i+vec2(1,0)), c=hash21(i+vec2(0,1)), d=hash21(i+vec2(1,1));
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<4;i++){ v+=a*vnoise(p); p*=2.03; a*=0.5; } return v; }
`;

function waterMaterial(theme) {
  const lava = theme.ground === 'lava';
  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(lava ? 0x5a0a02 : 0x0f55c9) },
      uShallow: { value: new THREE.Color(lava ? 0xff5a0a : 0x2b8cf0) },
      uSky: { value: new THREE.Color(lava ? 0xffa040 : 0xbfe6ff) },
      uSunDir: { value: new THREE.Vector3(-0.35, 0.85, 0.3).normalize() },
      uHW: { value: HW + 0.6 },
    },
  ]);
  return new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    vertexShader: `
      varying vec3 vWorld;
      #include <fog_pars_vertex>
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime; uniform vec3 uDeep, uShallow, uSky, uSunDir; uniform float uHW;
      varying vec3 vWorld;
      #include <fog_pars_fragment>
      ${NOISE_GLSL}
      void main(){
        vec2 p = vWorld.xz;
        float t = uTime;
        ${lava ? `
        vec2 q = p * 0.08 + vec2(fbm(p*0.05 + t*0.03), fbm(p*0.05 - t*0.025));
        float n = fbm(q * 3.0 + t * 0.05);
        float veins = smoothstep(0.55, 0.75, n);
        vec3 col = mix(uDeep, uShallow, veins);
        col += uSky * pow(veins, 3.0) * 1.8;
        float crust = smoothstep(0.35, 0.2, n);
        col = mix(col, vec3(0.05, 0.02, 0.02), crust * 0.85);
        float edge = abs(vWorld.x) - uHW;
        col += uShallow * smoothstep(3.0, 0.0, edge) * 0.8 * (0.6 + 0.4 * sin(t * 2.0 + p.y * 0.3));
        gl_FragColor = vec4(col, 1.0);
        ` : `
        vec2 g = vec2(0.0);
        g += 0.22 * cos(dot(p, vec2(0.8, 0.6)) * 0.9 + t * 1.3) * vec2(0.8, 0.6);
        g += 0.16 * cos(dot(p, vec2(-0.5, 0.86)) * 1.4 + t * 1.7) * vec2(-0.5, 0.86);
        g += 0.10 * cos(dot(p, vec2(0.2, -0.98)) * 2.3 + t * 2.1) * vec2(0.2, -0.98);
        float n1 = fbm(p * 0.35 + vec2(t * 0.05, t * 0.08));
        float n2 = fbm(p * 1.3 - vec2(t * 0.12, -t * 0.07));
        g += (vec2(n1, n2) - 0.5) * 0.9;
        vec3 N = normalize(vec3(-g.x * 0.35, 1.0, -g.y * 0.35));
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 col = mix(uDeep, uShallow, smoothstep(0.3, 0.8, n1) * 0.8 + 0.1);
        col = mix(col, uSky, fres * 0.55 + 0.05);
        vec3 H = normalize(uSunDir + V);
        float spec = pow(max(dot(N, H), 0.0), 220.0);
        col += vec3(1.0, 0.97, 0.9) * spec * 2.5;
        // 반짝임
        vec2 sp = p * 2.2;
        vec2 cell = floor(sp);
        float h = hash21(cell);
        vec2 f = fract(sp) - 0.5 - (vec2(hash21(cell + 3.1), hash21(cell + 7.7)) - 0.5) * 0.6;
        float tw = max(0.0, sin(t * (2.0 + h * 4.0) + h * 40.0));
        float spark = step(0.9, h) * smoothstep(0.09, 0.0, length(f * vec2(1.0, 1.8))) * tw;
        col += vec3(1.0) * spark * 1.8;
        // 다리 주변 거품
        float edge = abs(vWorld.x) - uHW;
        float foam = smoothstep(2.2, 0.0, edge) * smoothstep(0.35, 0.6, fbm(p * 1.8 + vec2(0.0, t * 0.6)) + smoothstep(1.2, 0.0, edge) * 0.4);
        col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.85);
        gl_FragColor = vec4(col, 1.0);
        `}
        #include <fog_fragment>
      }`,
  });
}

// 머지된 소품 지오메트리들
function pineGeometry(snowy = true) {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.18, 0.26, 1.2, 6).translate(0, 0.6, 0), 0x6b4a33);
  const levels = [[1.6, 1.6, 1.4], [1.25, 1.4, 2.3], [0.85, 1.2, 3.1], [0.45, 0.9, 3.8]];
  for (const [r, h, y] of levels) {
    b.add(new THREE.ConeGeometry(r, h, 7).translate(0, y, 0), snowy ? 0x2f6b5a : 0x2e7d45);
    if (snowy) b.add(new THREE.ConeGeometry(r * 0.82, h * 0.45, 7).translate(0, y + h * 0.3, 0), 0xf4f8ff);
  }
  return b.build();
}
function roundTreeGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.2, 0.3, 1.6, 6).translate(0, 0.8, 0), 0x7a5234);
  b.add(new THREE.IcosahedronGeometry(1.4, 1).translate(0, 2.4, 0), 0x4f9a36);
  b.add(new THREE.IcosahedronGeometry(1.0, 1).translate(0.7, 2.9, 0.3), 0x65b23f);
  b.add(new THREE.IcosahedronGeometry(0.9, 1).translate(-0.6, 3.0, -0.2), 0x5aa83b);
  return b.build();
}
function lampGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.BoxGeometry(0.5, 0.3, 0.5).translate(0, 0.15, 0), 0x6d7079);
  b.add(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6).translate(0, 1.7, 0), 0x6b4a33);
  b.add(new THREE.BoxGeometry(1.0, 0.12, 0.12).translate(0.45, 3.2, 0), 0x6b4a33);
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4).translate(0.85, 3.0, 0), 0x333333);
  b.add(new THREE.BoxGeometry(0.34, 0.42, 0.34).translate(0.85, 2.7, 0), 0x2d2f36);
  b.add(new THREE.BoxGeometry(0.26, 0.32, 0.26).translate(0.85, 2.7, 0), 0xffc45a, 2.2);
  b.add(new THREE.ConeGeometry(0.3, 0.25, 4).rotateY(PI / 4).translate(0.85, 3.02, 0), 0x2d2f36);
  return b.build();
}
function rockGeometry(color = 0x9ea4ad, snow = false) {
  const b = new GeoBuilder();
  const g = new THREE.DodecahedronGeometry(1, 0).scale(1, 0.6, 0.85);
  b.add(g, color);
  if (snow) b.add(new THREE.DodecahedronGeometry(0.8, 0).scale(1, 0.3, 0.75).translate(0, 0.45, 0), 0xf6f9ff);
  return b.build();
}
function crystalGeometry(color = 0x8fd8ff, glow = 0.5) {
  const b = new GeoBuilder();
  const parts = [[0, 0, 0, 1.4, 0], [0.35, 0, 0.1, 1.0, 0.4], [-0.3, 0, -0.1, 0.9, -0.5], [0.1, 0, -0.35, 0.7, 0.2]];
  for (const [x, y, z, h, tilt] of parts) {
    b.add(new THREE.OctahedronGeometry(0.25, 0).scale(1, h * 2.2, 1).rotateZ(tilt * 0.6).translate(x, h * 0.45, z), color, glow);
  }
  return b.build();
}
function bushGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.IcosahedronGeometry(0.7, 1).scale(1, 0.75, 1).translate(0, 0.4, 0), 0x4c9636);
  b.add(new THREE.IcosahedronGeometry(0.5, 1).translate(0.55, 0.35, 0.2), 0x5aa83b);
  b.add(new THREE.SphereGeometry(0.09, 5, 4).translate(0.2, 0.85, -0.35), 0xff6b8b);
  b.add(new THREE.SphereGeometry(0.09, 5, 4).translate(-0.3, 0.7, -0.45), 0xffe066);
  return b.build();
}
function flowerGeometry(color) {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 3).translate(0, 0.17, 0), 0x3f8a2e);
  b.add(new THREE.SphereGeometry(0.1, 6, 4).scale(1, 0.5, 1).translate(0, 0.37, 0), color, 0.1);
  return b.build();
}
function braizerGeometry() {
  const b = new GeoBuilder();
  b.add(new THREE.CylinderGeometry(0.35, 0.2, 1.2, 6).translate(0, 0.6, 0), 0x2b2522);
  b.add(new THREE.CylinderGeometry(0.55, 0.4, 0.35, 8).translate(0, 1.3, 0), 0x3a302b);
  b.add(new THREE.ConeGeometry(0.4, 0.7, 6).translate(0, 1.75, 0), 0xff7a1a, 2.5);
  return b.build();
}

// 긴 도로를 따라 흩어진 소품은 z 구간별 인스턴스 메시로 나눠 화면/그림자 컬링이 되게 한다
function scatter(geo, mat, items, opts = {}) {
  const CH = 36;
  const buckets = new Map();
  for (const it of items) {
    const k = Math.floor(it.z / CH);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(it);
  }
  if (buckets.size <= 1) return scatterOne(geo, mat, items, opts);
  const g = new THREE.Group();
  for (const list of buckets.values()) g.add(scatterOne(geo, mat, list, opts));
  return g;
}

function scatterOne(geo, mat, items, { shadow = true, receive = false } = {}) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const s = new THREE.Vector3();
  const p = new THREE.Vector3();
  items.forEach((it, i) => {
    p.set(it.x, it.y || 0, it.z);
    q.setFromEuler(e.set(it.rx || 0, it.ry || 0, it.rz || 0));
    s.set(it.sx ?? it.s ?? 1, it.sy ?? it.s ?? 1, it.sz ?? it.s ?? 1);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  });
  mesh.count = items.length;
  mesh.castShadow = shadow;
  mesh.receiveShadow = receive;
  mesh.computeBoundingSphere();
  return mesh;
}

export class Environment {
  constructor(scene, theme, length, seed = 1) {
    this.scene = scene;
    this.theme = theme;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.length = length;
    this.d0 = -30;
    this.d1 = length + 70;
    this.time = 0;
    this.rng = mulberry32(seed * 7919 + 13);
    this.dispose_ = [];
    this.decorMat = makeCharMaterial({ rim: 0.18, rimColor: theme.rim });
    this.build();
  }

  track(o) {
    this.dispose_.push(o);
    return o;
  }

  build() {
    const th = this.theme;
    const len = this.d1 - this.d0;
    const zc = -(this.d0 + this.d1) / 2;
    // 지면 / 수면
    if (th.ground === 'water' || th.ground === 'lava') {
      this.water = new THREE.Mesh(new THREE.PlaneGeometry(420, 420).rotateX(-PI / 2), this.track(waterMaterial(th)));
      this.water.position.y = th.ground === 'lava' ? -2.2 : -2.6;
      this.group.add(this.water);
    } else {
      const tx = th.ground === 'snow' ? snowTextures({ road: false, seed: 5 }) : { map: grassTextures() };
      tx.map.wrapS = tx.map.wrapT = THREE.RepeatWrapping;
      tx.map.repeat.set(120 / 14, len / 14);
      const mat = this.track(new THREE.MeshStandardMaterial({ map: this.track(tx.map), roughness: 0.95, normalMap: tx.normal || null, normalScale: new THREE.Vector2(0.6, 0.6) }));
      if (tx.normal) {
        tx.normal.wrapS = tx.normal.wrapT = THREE.RepeatWrapping;
        tx.normal.repeat.copy(tx.map.repeat);
        this.track(tx.normal);
      }
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(120, len).rotateX(-PI / 2), mat);
      ground.position.set(0, -0.03, zc);
      ground.receiveShadow = true;
      this.group.add(ground);
    }

    // 도로
    let roadTex;
    if (th.road === 'flagstone') roadTex = flagstoneTextures({ base: th.roadHSL, seed: 7, grass: th.key === 'bridge' });
    else if (th.road === 'snow') roadTex = snowTextures({ road: true, seed: 9 });
    else roadTex = dirtRoadTextures({ seed: 3 });
    for (const t of [roadTex.map, roadTex.normal]) {
      if (!t) continue;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set((HW * 2) / 6.2, len / 6.2);
      this.track(t);
    }
    const ns = th.road === 'flagstone' ? 1 : 0.6;
    const roadMat = this.track(new THREE.MeshStandardMaterial({ map: roadTex.map, normalMap: roadTex.normal, normalScale: new THREE.Vector2(ns, ns), roughness: th.road === 'snow' ? 0.8 : 0.88 }));
    const bridge = th.ground === 'water' || th.ground === 'lava';
    if (bridge) {
      const sideTex = brickTexture({ base: th.wallHSL, rows: 4, cols: 2 });
      sideTex.wrapS = sideTex.wrapT = THREE.RepeatWrapping;
      sideTex.repeat.set(len / 3, 1);
      const sideMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(sideTex), roughness: 0.9 }));
      const deckH = 3.2;
      const deck = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 1.6, deckH, len), [sideMat, sideMat, roadMat, sideMat, sideMat, sideMat]);
      // 윗면 UV는 박스 전체로 반복되므로 도로 텍스처 반복값을 맞춰준다
      deck.position.set(0, -deckH / 2, zc);
      deck.receiveShadow = true;
      this.group.add(deck);
      // 교각
      const pierMat = sideMat;
      for (let d = this.d0 + 10; d < this.d1; d += 26) {
        const pier = new THREE.Mesh(new THREE.BoxGeometry(HW * 2 + 2.6, 2.2, 3.4), pierMat);
        pier.position.set(0, -3.5, -d);
        this.group.add(pier);
      }
    } else {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(HW * 2 + 0.6, len).rotateX(-PI / 2), roadMat);
      road.position.set(0, 0, zc);
      road.receiveShadow = true;
      this.group.add(road);
    }

    this.buildEdges();
    this.buildDecor();
    this.buildCastle();
    if (th.ground === 'snow') this.buildSnowfall();
    if (th.ground === 'lava') this.buildEmbers();
  }

  buildEdges() {
    const th = this.theme;
    const rng = this.rng;
    if (th.edge === 'parapet') {
      const tex = brickTexture({ base: th.wallHSL, rows: 3, cols: 2, seed: 4 });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.repeat.set((this.d1 - this.d0) / 3, 1);
      const wallMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(tex), roughness: 0.9 }));
      for (const s of [-1, 1]) {
        const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.55, this.d1 - this.d0), wallMat);
        w.position.set(s * (HW + 0.45), 0.27, -(this.d0 + this.d1) / 2);
        w.castShadow = true;
        w.receiveShadow = true;
        this.group.add(w);
      }
      const merlonGeo = new RoundedBoxGeometry(0.95, 0.85, 1.05, 2, 0.12);
      const items = [];
      for (let d = this.d0; d < this.d1; d += 1.9) {
        for (const s of [-1, 1]) items.push({ x: s * (HW + 0.45), y: 0.9, z: -d, ry: (rng() - 0.5) * 0.06, sy: 0.9 + rng() * 0.2 });
      }
      const c = new THREE.Color().setHSL(th.wallHSL[0] / 360, th.wallHSL[1] / 100, th.wallHSL[2] / 100);
      const mat = this.track(new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, map: this.track(brickTexture({ base: th.wallHSL, rows: 2, cols: 1, seed: 8 })) }));
      mat.color.setRGB(1, 1, 1);
      const mesh = scatter(merlonGeo, mat, items, { shadow: true, receive: true });
      const col = new THREE.Color();
      mesh.traverse((o) => {
        if (!o.isInstancedMesh) return;
        for (let i = 0; i < o.count; i++) o.setColorAt(i, col.setScalar(0.88 + rng() * 0.2));
      });
      this.group.add(mesh);
    } else if (th.edge === 'snowbank') {
      const geo = new THREE.SphereGeometry(1, 10, 6);
      const items = [];
      for (let d = this.d0; d < this.d1; d += 1.3) {
        for (const s of [-1, 1]) items.push({ x: s * (HW + 0.9 + rng() * 0.5), y: -0.1, z: -d - rng(), sx: 1.1 + rng() * 0.6, sy: 0.35 + rng() * 0.25, sz: 1.2 + rng() * 0.6, ry: rng() * 3 });
      }
      const mat = this.track(new THREE.MeshStandardMaterial({ color: 0xf3f7ff, roughness: 0.8 }));
      this.group.add(scatter(geo, mat, items, { shadow: false, receive: true }));
    } else if (th.edge === 'fence') {
      const b = new GeoBuilder();
      b.add(new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.55, 0), 0x8a5d38);
      b.add(new THREE.BoxGeometry(0.1, 0.12, 2.6).translate(0, 0.8, -1.3), 0xa06d42);
      b.add(new THREE.BoxGeometry(0.1, 0.12, 2.6).translate(0, 0.45, -1.3), 0xa06d42);
      const geo = b.build();
      const items = [];
      for (let d = this.d0; d < this.d1; d += 2.6) for (const s of [-1, 1]) items.push({ x: s * (HW + 0.6), z: -d });
      this.group.add(scatter(geo, this.decorMat, items));
    }
  }

  buildDecor() {
    const th = this.theme;
    const rng = this.rng;
    const mat = this.decorMat;
    const side = (min, max) => (rng() < 0.5 ? -1 : 1) * (min + rng() * (max - min));
    const along = () => this.d0 + rng() * (this.d1 - this.d0);
    if (th.key === 'snow') {
      const trees = [];
      for (let i = 0; i < 520; i++) {
        const x = side(HW + 2.5, 48);
        trees.push({ x, z: -along(), s: 0.9 + rng() * 0.9, ry: rng() * 6 });
      }
      this.group.add(scatter(pineGeometry(true), mat, trees));
      const lamps = [];
      for (let d = this.d0 + 8; d < this.d1; d += 18) {
        const s = (Math.floor(d / 18) % 2) * 2 - 1;
        lamps.push({ x: s * (HW + 1.8), z: -d, ry: s > 0 ? PI : 0, s: 1.1 });
      }
      this.group.add(scatter(lampGeometry(), mat, lamps));
      const rocks = [];
      for (let i = 0; i < 90; i++) rocks.push({ x: side(HW + 1.8, 30), z: -along(), s: 0.4 + rng() * 0.8, ry: rng() * 6 });
      this.group.add(scatter(rockGeometry(0x8f98a8, true), mat, rocks));
      const crystals = [];
      for (let i = 0; i < 70; i++) crystals.push({ x: side(HW + 1.6, 26), z: -along(), s: 0.6 + rng() * 0.8, ry: rng() * 6 });
      this.group.add(scatter(crystalGeometry(0xa9e4ff, 0.35), mat, crystals));
    } else if (th.key === 'meadow') {
      const trees = [];
      for (let i = 0; i < 300; i++) trees.push({ x: side(HW + 3, 50), z: -along(), s: 0.8 + rng() * 0.8, ry: rng() * 6 });
      this.group.add(scatter(roundTreeGeometry(), mat, trees));
      const bushes = [];
      for (let i = 0; i < 180; i++) bushes.push({ x: side(HW + 1.4, 30), z: -along(), s: 0.6 + rng() * 0.8, ry: rng() * 6 });
      this.group.add(scatter(bushGeometry(), mat, bushes));
      for (const c of [0xff5c8a, 0xffe14d, 0xffffff, 0xb58cff]) {
        const fl = [];
        for (let i = 0; i < 200; i++) fl.push({ x: side(HW + 1.1, 24), z: -along(), s: 0.8 + rng() * 0.8, ry: rng() * 6 });
        this.group.add(scatter(flowerGeometry(c), mat, fl, { shadow: false }));
      }
      const rocks = [];
      for (let i = 0; i < 50; i++) rocks.push({ x: side(HW + 2, 30), z: -along(), s: 0.3 + rng() * 0.6, ry: rng() * 6 });
      this.group.add(scatter(rockGeometry(0xa7a49a), mat, rocks));
    } else if (th.key === 'bridge') {
      const rocks = [];
      for (let i = 0; i < 40; i++) rocks.push({ x: side(HW + 6, 45), y: -2.8, z: -along(), s: 1 + rng() * 2.2, ry: rng() * 6 });
      this.group.add(scatter(rockGeometry(0x9a8f80), mat, rocks));
      // 바위 섬의 야자수 느낌 나무
      const trees = [];
      rocks.forEach((r) => {
        if (rng() < 0.35) trees.push({ x: r.x, y: -2.6 + r.s * 0.5, z: r.z, s: 0.7 + rng() * 0.4, ry: rng() * 6 });
      });
      if (trees.length) this.group.add(scatter(roundTreeGeometry(), mat, trees));
      // 깃발 기둥
      const flags = [];
      for (let d = this.d0 + 12; d < this.d1; d += 30) for (const s of [-1, 1]) flags.push({ x: s * (HW + 0.45), y: 1.3, z: -d });
      const fb = new GeoBuilder();
      fb.add(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 6).translate(0, 1.6, 0), 0x6b4a33);
      fb.add(new THREE.BoxGeometry(0.05, 1.1, 1.2).translate(0, 2.6, -0.6), 0x2f6fe4);
      fb.add(new THREE.BoxGeometry(0.06, 0.3, 0.35).translate(0, 2.6, -0.6), 0xf2b634, 0.3);
      fb.add(new THREE.SphereGeometry(0.12, 6, 4).translate(0, 3.25, 0), 0xf2b634);
      this.group.add(scatter(fb.build(), mat, flags));
    } else if (th.key === 'lava') {
      const rocks = [];
      for (let i = 0; i < 70; i++) rocks.push({ x: side(HW + 4, 45), y: -2.4, z: -along(), s: 1 + rng() * 2.5, ry: rng() * 6 });
      this.group.add(scatter(rockGeometry(0x3a2d2a), mat, rocks));
      const crystals = [];
      for (let i = 0; i < 40; i++) crystals.push({ x: side(HW + 5, 30), y: -1.6, z: -along(), s: 1 + rng() * 1.5, ry: rng() * 6 });
      this.group.add(scatter(crystalGeometry(0xff5a2a, 1.2), mat, crystals));
      const br = [];
      for (let d = this.d0 + 8; d < this.d1; d += 16) for (const s of [-1, 1]) br.push({ x: s * (HW + 0.45), y: 0.55, z: -d, s: 0.8 });
      this.group.add(scatter(braizerGeometry(), mat, br));
      this.braziers = br;
    }
  }

  // 결승점: 적의 성문
  buildCastle() {
    const th = this.theme;
    const d = this.length + 46;
    const stone = new THREE.Color().setHSL(th.wallHSL[0] / 360, th.wallHSL[1] / 100, (th.wallHSL[2] - 8) / 100);
    const b = new GeoBuilder();
    const roof = th.key === 'lava' ? 0x3a1010 : 0xc8322c;
    for (const s of [-1, 1]) {
      const x = s * (HW + 2.4);
      b.add(new THREE.CylinderGeometry(2.3, 2.6, 9, 12).translate(x, 4.5, 0), stone);
      b.add(new THREE.CylinderGeometry(2.7, 2.5, 0.8, 12).translate(x, 9.2, 0), stone.clone().offsetHSL(0, 0, 0.05));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * PI * 2;
        b.add(new THREE.BoxGeometry(0.8, 0.9, 0.8).translate(x + Math.cos(a) * 2.3, 10, Math.sin(a) * 2.3), stone);
      }
      b.add(new THREE.ConeGeometry(2.6, 3.8, 12).translate(x, 12.2, 0), roof);
      b.add(new THREE.BoxGeometry(0.5, 1.2, 0.2).translate(x, 6.5, -2.5), 0x1d1a22);
      b.add(new THREE.BoxGeometry(1.4, 3.2, 0.1).translate(x, 5, -2.62), 0xb3282a);
      b.add(new THREE.BoxGeometry(0.5, 0.5, 0.12).translate(x, 5.5, -2.7), 0xf2b634, 0.3);
    }
    b.add(new THREE.BoxGeometry(HW * 2 + 1, 3.2, 2.4).translate(0, 7.4, 0), stone);
    for (let i = -6; i <= 6; i++) b.add(new THREE.BoxGeometry(0.8, 0.8, 0.8).translate(i * 1.05, 9.4, -0.8), stone);
    b.add(new THREE.BoxGeometry(HW * 2 - 1.5, 5.8, 0.4).translate(0, 2.9, 0.4), 0x4a3526);
    for (let i = -5; i <= 5; i++) b.add(new THREE.BoxGeometry(0.12, 5.8, 0.1).translate(i * 1.0, 2.9, 0.15), 0x2d2f36);
    const mesh = new THREE.Mesh(b.build(), this.decorMat);
    mesh.position.z = -d;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  buildSnowfall() {
    const n = 1400;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 22;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const [c, ctx] = makeCanvas(32, 32);
    const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 32, 32);
    const mat = this.track(new THREE.PointsMaterial({ size: 0.28, map: this.track(canvasTexture(c)), transparent: true, depthWrite: false, color: 0xffffff, opacity: 0.9 }));
    this.snow = new THREE.Points(g, mat);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
  }

  buildEmbers() {
    const n = 500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 60;
      pos[i * 3 + 1] = Math.random() * 18;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const [c, ctx] = makeCanvas(32, 32);
    const gr = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, 32, 32);
    const mat = this.track(new THREE.PointsMaterial({ size: 0.22, map: this.track(canvasTexture(c)), transparent: true, depthWrite: false, color: new THREE.Color(3, 1.2, 0.3), blending: THREE.AdditiveBlending }));
    this.embers = new THREE.Points(g, mat);
    this.embers.frustumCulled = false;
    this.group.add(this.embers);
  }

  // 차선 분리벽
  addDivider(x, d0, d1, h = 1.3) {
    const th = this.theme;
    if (!this.dividerMat) {
      const tex = brickTexture({ base: th.wallHSL, rows: 3, cols: 2, seed: 12 });
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this.dividerTex = this.track(tex);
      this.dividerMat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
      this.capMat = this.track(new THREE.MeshStandardMaterial({ color: th.key === 'snow' ? 0xf4f8ff : new THREE.Color().setHSL(th.wallHSL[0] / 360, th.wallHSL[1] / 100, (th.wallHSL[2] + 6) / 100), roughness: 0.8 }));
    }
    const len = d1 - d0;
    const geo = new THREE.BoxGeometry(0.7, h, len);
    // 길이에 맞춰 UV 반복
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * (len / 2.4));
    const wall = new THREE.Mesh(geo, this.dividerMat);
    wall.position.set(x, h / 2, -(d0 + d1) / 2);
    wall.castShadow = true;
    wall.receiveShadow = true;
    this.group.add(wall);
    const cap = new THREE.Mesh(new RoundedBoxGeometry(0.9, 0.3, len + 0.2, 2, 0.1), this.capMat);
    cap.position.set(x, h + 0.1, -(d0 + d1) / 2);
    cap.castShadow = true;
    this.group.add(cap);
    // 앞쪽 기둥 (뾰족 장식)
    const pb = new GeoBuilder();
    pb.add(new THREE.BoxGeometry(1.1, h + 0.9, 1.1).translate(0, (h + 0.9) / 2, 0), 0x8c8f99);
    pb.add(new THREE.ConeGeometry(0.4, 0.8, 6).translate(0, h + 1.3, 0), 0x6d717c);
    const post = new THREE.Mesh(pb.build(), this.decorMat);
    post.position.set(x, 0, -d0);
    post.castShadow = true;
    this.group.add(post);
  }

  update(dt, camZ) {
    this.time += dt;
    if (this.water) {
      this.water.material.uniforms.uTime.value = this.time;
      this.water.position.z = Math.round(camZ / 20) * 20;
    }
    if (this.snow) {
      const p = this.snow.geometry.attributes.position;
      const a = p.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= dt * (2.2 + (i % 7) * 0.2);
        a[i] += Math.sin(this.time + i) * dt * 0.4;
        if (a[i + 1] < 0) a[i + 1] += 22;
      }
      p.needsUpdate = true;
      this.snow.position.z = camZ - 20;
      // 카메라 이동에 따라 z 방향 순환
      this.snow.position.z = camZ - 25;
    }
    if (this.embers) {
      const a = this.embers.geometry.attributes.position.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] += dt * (1 + (i % 5) * 0.3);
        a[i] += Math.sin(this.time * 2 + i) * dt * 0.5;
        if (a[i + 1] > 18) a[i + 1] -= 18;
      }
      this.embers.geometry.attributes.position.needsUpdate = true;
      this.embers.position.z = camZ - 25;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const o of this.dispose_) o.dispose?.();
    this.decorMat.dispose();
  }
}
