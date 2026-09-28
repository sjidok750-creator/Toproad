// 렌더러, 카메라, 조명, 후처리(블룸/비네트), 화질 자동 조정
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { setMaxAnisotropy } from '../world/textures.js';

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, uStrength: { value: 0.35 }, uSat: { value: 1.08 }, uFlash: { value: new THREE.Vector4(1, 1, 1, 0) } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform sampler2D tDiffuse; uniform float uStrength; uniform float uSat; uniform vec4 uFlash; varying vec2 vUv;
  void main(){
    vec4 c = texture2D(tDiffuse, vUv);
    float l = dot(c.rgb, vec3(0.299,0.587,0.114));
    c.rgb = mix(vec3(l), c.rgb, uSat);
    vec2 d = vUv - 0.5;
    float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 1.15)));
    c.rgb *= mix(1.0 - uStrength, 1.0, v);
    c.rgb = mix(c.rgb, uFlash.rgb, uFlash.a * (0.4 + 0.6 * (1.0 - v)));
    gl_FragColor = c;
  }`,
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 700;
    this.isMobile = isMobile;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', stencil: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.bloomThreshold = 0.86;
    this.overlayScene = null;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.5, 260);

    // 조명
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8a7a60, 1.4);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    const sc = this.sun.shadow.camera;
    sc.left = -22; sc.right = 22; sc.top = 34; sc.bottom = -26; sc.near = 1; sc.far = 120;
    this.scene.add(this.sun, this.sun.target);
    this.sunOffset = new THREE.Vector3(-14, 36, 10);

    this.quality = -1;
    this.composer = null;
    this.flash = VignetteShader.uniforms.uFlash.value;
    this.fpsSamples = [];
    this.autoQuality = true;
    const forced = new URLSearchParams(location.search).get('q');
    let saved = forced;
    try {
      saved ??= localStorage.getItem('toproad.quality');
    } catch (e) {
      /* 저장소 접근 불가 */
    }
    this.setQuality(saved != null ? +saved : isMobile ? 1 : 2, false);
    if (saved != null) this.autoQuality = false;
    this.warmup = 90;
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  // 0: 낮음, 1: 보통, 2: 높음
  setQuality(q, persist = true) {
    q = Math.max(0, Math.min(2, q));
    if (q === this.quality) return;
    this.quality = q;
    if (persist) {
      try {
        localStorage.setItem('toproad.quality', q);
      } catch (e) {
        /* 저장소 접근 불가 */
      }
      this.autoQuality = false;
    }
    const dpr = window.devicePixelRatio || 1;
    this.pixelRatio = [Math.min(dpr, 1), Math.min(dpr, 1.5), Math.min(dpr, 2)][q];
    this.renderer.setPixelRatio(this.pixelRatio);
    this.sun.shadow.mapSize.setScalar([1024, 2048, 2048][q]);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    this.renderer.shadowMap.type = q === 0 ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) this.composer.dispose?.();
    const q = this.quality;
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x * this.pixelRatio), Math.max(1, size.y * this.pixelRatio), {
      type: THREE.HalfFloatType,
      samples: q >= 1 ? 4 : 0,
    });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), q === 2 ? 0.6 : 0.5, 0.55, this.bloomThreshold);
    this.bloom.enabled = q >= 1;
    this.composer.addPass(this.bloom);
    this.vignette = new ShaderPass(VignetteShader);
    this.vignette.uniforms.uFlash.value = this.flash;
    this.composer.addPass(this.vignette);
    this.composer.addPass(new OutputPass());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.camera.aspect = w / h;
    // 세로 화면에서도 도로 폭이 들어오도록 수평 시야각 보정
    const hFov = 47;
    const vFromH = (2 * Math.atan(Math.tan((hFov * Math.PI) / 360) / this.camera.aspect) * 180) / Math.PI;
    // 가로 화면은 세로 시야를 넉넉히 (앞쪽이 충분히 보이도록)
    this.camera.fov = this.camera.aspect > 1 ? 56 : Math.min(74, Math.max(48, vFromH));
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
      // 블룸은 저해상도로 (성능)
      const bs = this.quality === 2 ? 0.5 : 0.35;
      this.bloom.resolution.set(w * bs, h * bs);
      this.bloom.setSize?.(Math.round(w * this.pixelRatio * bs), Math.round(h * this.pixelRatio * bs));
    }
  }

  // 그림자 카메라가 부대를 따라가도록
  followShadow(x, z) {
    this.sun.position.set(x + this.sunOffset.x, this.sunOffset.y, z + this.sunOffset.z);
    this.sun.target.position.set(x, 0, z - 8);
  }

  render(dt) {
    this.composer.render(dt);
    // 라벨(부대 수, HP바)은 후처리 없이 맨 위에 그린다
    if (this.overlayScene) {
      const r = this.renderer;
      r.autoClear = false;
      r.clearDepth();
      r.render(this.overlayScene, this.camera);
      r.autoClear = true;
    }
    if (this.autoQuality && dt > 0) this._sampleFps(dt);
  }

  // 프레임이 계속 느리면 화질을 한 단계 낮춘다 (초기 셰이더 컴파일 구간은 무시)
  _sampleFps(dt) {
    if (this.warmup > 0) {
      this.warmup--;
      return;
    }
    if (dt > 0.2) return;
    this.fpsSamples.push(dt);
    if (this.fpsSamples.length >= 120) {
      const avg = this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length;
      this.fpsSamples.length = 0;
      if (avg > 1 / 42) {
        this.slowWindows = (this.slowWindows || 0) + 1;
        if (this.slowWindows >= 2 && this.quality > 0) {
          this.slowWindows = 0;
          this.setQuality(this.quality - 1, false);
          if (this.bloom) this.bloom.threshold = this.bloomThreshold;
        }
      } else this.slowWindows = 0;
    }
  }
}
