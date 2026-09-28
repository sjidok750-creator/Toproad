// 입력: 터치/마우스 드래그(상대 이동) + 키보드
export class Input {
  constructor(el, range = 6.2) {
    this.el = el;
    this.range = range;
    this.x = 0;
    this.active = false;
    this.moved = false;
    this.keys = new Set();
    this.enabled = false;
    el.addEventListener('pointerdown', (e) => this.down(e));
    window.addEventListener('pointermove', (e) => this.move(e));
    window.addEventListener('pointerup', () => this.up());
    window.addEventListener('pointercancel', () => this.up());
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.up();
    });
  }
  down(e) {
    if (!this.enabled) return;
    this.active = true;
    this.pid = e.pointerId;
    this.startClient = e.clientX;
    this.startX = this.x;
    this.el.setPointerCapture?.(e.pointerId);
  }
  move(e) {
    if (!this.active || !this.enabled || e.pointerId !== this.pid) return;
    const w = Math.min(window.innerWidth, 900);
    const k = (this.range * 2) / (w * 0.62);
    this.x = Math.max(-this.range, Math.min(this.range, this.startX + (e.clientX - this.startClient) * k));
    if (Math.abs(e.clientX - this.startClient) > 6) this.moved = true;
  }
  up() {
    this.active = false;
  }
  update(dt) {
    if (!this.enabled) return;
    let dir = 0;
    if (this.keys.has('arrowleft') || this.keys.has('a')) dir -= 1;
    if (this.keys.has('arrowright') || this.keys.has('d')) dir += 1;
    if (dir) {
      this.x = Math.max(-this.range, Math.min(this.range, this.x + dir * 13 * dt));
      this.moved = true;
    }
  }
  reset() {
    this.x = 0;
    this.active = false;
    this.moved = false;
  }
  // 부대가 벽에 막혀 있을 때 입력값이 멀리 떨어지지 않도록
  syncTo(x, lim = 3) {
    if (Math.abs(this.x - x) > lim) {
      const nx = x + Math.sign(this.x - x) * lim;
      if (this.active) this.startX += nx - this.x;
      this.x = nx;
    }
  }
}
