// The editor: canvas view state, inspector, toolbar and the export flow.

import { Renderer, ViewRect } from '../engine/pipeline';
import { defaultParams, GRAIN_PRESETS, Params } from '../engine/params';
import { createHost, Host, Job } from '../io/host';
import { decodeImageBytes, LoadedImage } from '../io/image';
import { encodeTiff16 } from '../io/tiff';
import { button, chips, colorChip, Control, row, section, slider, toggle } from './controls';
import { clear, h } from './dom';

type Zoom = 'fit' | 'actual';

export class App {
  private host: Host = createHost();
  private renderer: Renderer;
  private params: Params = defaultParams();
  private defaults: Params = defaultParams();
  private image: LoadedImage | null = null;
  private job: Job | null = null;
  private itemIndex = 0;
  private zoom: Zoom = 'fit';
  private pan = { x: 0, y: 0 };
  private compare = false;
  private frame = 0;
  private busy = false;

  private ui: HTMLElement;
  private canvas: HTMLCanvasElement;
  private inspector!: HTMLElement;
  private toolbar!: HTMLElement;
  private empty!: HTMLElement;
  private filmstrip!: HTMLElement;
  private status!: HTMLElement;
  private nameLabel!: HTMLElement;
  private zoomChips!: Control<Zoom | null>;
  private presetChips!: Control<string | null>;
  private grainControls: Record<string, Control<number>> = {};
  private toastTimer = 0;

  constructor(canvas: HTMLCanvasElement, ui: HTMLElement) {
    this.canvas = canvas;
    this.ui = ui;
    this.renderer = new Renderer(canvas);
    this.buildUi();
    this.bindEvents();
    this.resize();
    void this.boot();
  }

  // ---------------------------------------------------------------- boot

  private async boot(): Promise<void> {
    try {
      this.job = await this.host.getJob();
    } catch (e) {
      this.toast(`Could not read job: ${(e as Error).message}`);
    }
    if (this.job && this.job.items.length) {
      this.renderer.setTransfer(this.job.colorSpace ?? 'sRGB');
      await this.loadItem(0);
    }
    this.updateChrome();
  }

  private async loadItem(index: number): Promise<void> {
    if (!this.job) return;
    const item = this.job.items[index];
    this.itemIndex = index;
    await this.withBusy(`Loading ${item.name}`, async () => {
      const bytes = await this.host.readFile(item.input);
      this.setImage(await decodeImageBytes(item.name, bytes));
    });
  }

  private setImage(img: LoadedImage): void {
    this.image = img;
    this.renderer.setImage({ width: img.width, height: img.height, rgb16: img.rgb16 });
    this.zoom = 'fit';
    this.pan = { x: 0, y: 0 };
    this.updateChrome();
    this.invalidate();
  }

  private async openFile(): Promise<void> {
    const picked = await this.host.pickOpen();
    if (!picked) return;
    await this.withBusy(`Decoding ${picked.name}`, async () => {
      this.setImage(await decodeImageBytes(picked.name, picked.bytes));
    });
  }

  async openBytes(name: string, bytes: Uint8Array): Promise<void> {
    await this.withBusy(`Decoding ${name}`, async () => {
      this.setImage(await decodeImageBytes(name, bytes));
    });
  }

  // -------------------------------------------------------------- export

  private async exportAll(): Promise<void> {
    if (!this.image) return;
    if (this.job) {
      const items = this.job.items;
      await this.withBusy('Rendering', async (progress) => {
        for (let i = 0; i < items.length; i++) {
          if (i !== this.itemIndex) {
            const bytes = await this.host.readFile(items[i].input);
            this.setImage(await decodeImageBytes(items[i].name, bytes));
            this.itemIndex = i;
          }
          progress(`Rendering ${items[i].name} (${i + 1}/${items.length})`);
          await nextFrame();
          const rgb = this.renderer.exportImage(this.params);
          const tiff = encodeTiff16(this.image!.width, this.image!.height, rgb, this.image!.icc);
          await this.host.writeFile(items[i].output, tiff);
        }
      });
      await this.host.close();
      return;
    }
    await this.withBusy('Rendering', async () => {
      await nextFrame();
      const rgb = this.renderer.exportImage(this.params);
      const tiff = encodeTiff16(this.image!.width, this.image!.height, rgb, this.image!.icc);
      const base = this.image!.name.replace(/\.[^.]+$/, '');
      await this.host.saveAs(`${base}-Halation.tif`, tiff);
    });
  }

  private async withBusy(label: string, fn: (progress: (label: string) => void) => Promise<void>): Promise<void> {
    this.busy = true;
    const overlay = h('div', { class: 'glass progress', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), h('span', { class: 'progress-label', text: label }));
    this.ui.append(overlay);
    const setLabel = (l: string) => { (overlay.querySelector('.progress-label') as HTMLElement).textContent = l; };
    try {
      await fn(setLabel);
    } catch (e) {
      console.error(e);
      this.toast((e as Error).message ?? String(e));
    } finally {
      overlay.remove();
      this.busy = false;
      this.updateChrome();
    }
  }

  // ------------------------------------------------------------------ ui

  private buildUi(): void {
    const ui = this.ui;
    clear(ui);

    this.nameLabel = h('span', { class: 'toolbar-name', text: 'No image' });
    const compareBtn = button('Compare', () => undefined, { title: 'Hold to see the original (\\)' });
    compareBtn.addEventListener('pointerdown', () => this.setCompare(true));
    compareBtn.addEventListener('pointerup', () => this.setCompare(false));
    compareBtn.addEventListener('pointerleave', () => this.setCompare(false));
    this.zoomChips = chips<Zoom>([{ label: 'Fit', value: 'fit' }, { label: '1:1', value: 'actual' }], 'fit', (z) => this.setZoom(z));

    this.toolbar = h('div', { class: 'glass toolbar' },
      button('Open', () => void this.openFile(), { icon: '＋', title: 'Open an image (⌘O)' }),
      this.nameLabel,
      h('span', { class: 'divider' }),
      compareBtn,
      this.zoomChips.el,
      h('span', { class: 'divider' }),
      button(this.host.kind === 'tauri' ? 'Save to Lightroom' : 'Export TIFF', () => void this.exportAll(), { primary: true, title: 'Render and export (⌘E)' }),
    );

    this.inspector = h('aside', { class: 'glass inspector' },
      h('header', { class: 'inspector-head' }, h('h1', { text: 'Halation' }), h('span', { class: 'subtle', text: 'film texture' })),
      h('div', { class: 'inspector-scroll' }, this.buildGrain(), this.buildHalation(), this.buildBloom(), this.buildDamage()),
      h('footer', { class: 'inspector-foot' }, button('Reset all', () => this.resetAll())),
    );

    this.empty = h('div', { class: 'glass empty' },
      h('div', { class: 'empty-art', 'aria-hidden': 'true' }),
      h('h2', { text: 'Drop an image' }),
      h('p', { class: 'subtle', text: 'TIFF, JPEG or PNG. From Lightroom Classic, use Edit in Halation.' }),
      button('Open image', () => void this.openFile(), { primary: true }),
    );

    this.filmstrip = h('div', { class: 'glass filmstrip' });
    this.status = h('div', { class: 'glass status', text: '' });
    ui.append(this.toolbar, this.inspector, this.empty, this.filmstrip, this.status);
  }

  private buildGrain(): HTMLElement {
    const g = this.params.grain;
    const d = this.defaults.grain;
    const touch = () => { this.params.grain.preset = 'Custom'; this.presetChips.set(null); this.invalidate(); };
    this.presetChips = chips(
      GRAIN_PRESETS.map((p) => ({ label: p.name, value: p.name, hint: p.blurb })),
      g.preset,
      (name) => this.applyPreset(name),
    );
    const s = (key: keyof typeof g, opts: Omit<Parameters<typeof slider>[0], 'value' | 'onInput' | 'defaultValue'>) => {
      const c = slider({ ...opts, value: g[key] as number, defaultValue: d[key] as number, onInput: (v) => { (this.params.grain[key] as number) = v; touch(); } });
      this.grainControls[key] = c;
      return c.el;
    };
    return section({ title: 'Grain', enabled: g.enabled, onToggle: (v) => { this.params.grain.enabled = v; this.invalidate(); } },
      this.presetChips.el,
      s('amount', { label: 'Amount', min: 0, max: 1, step: 0.01 }),
      s('size', { label: 'Size', min: 0.4, max: 8, step: 0.05, format: (v) => `${v.toFixed(1)} px` }),
      s('softness', { label: 'Softness', min: 0, max: 1, step: 0.01 }),
      s('roughness', { label: 'Roughness', min: 0, max: 1, step: 0.01 }),
      s('chroma', { label: 'Colour', min: 0, max: 1, step: 0.01 }),
      s('shadows', { label: 'Shadow bias', min: 0, max: 1, step: 0.01 }),
      row(button('Reseed', () => { this.params.grain.seed = Math.floor(Math.random() * 1000); this.invalidate(); })),
    );
  }

  private applyPreset(name: string): void {
    const preset = GRAIN_PRESETS.find((p) => p.name === name);
    if (!preset) return;
    Object.assign(this.params.grain, preset.values, { preset: name });
    for (const [k, c] of Object.entries(this.grainControls)) c.set(this.params.grain[k as keyof Params['grain']] as number);
    this.invalidate();
  }

  private buildHalation(): HTMLElement {
    const p = this.params.halation;
    const d = this.defaults.halation;
    const s = (key: 'intensity' | 'radius' | 'threshold', opts: Omit<Parameters<typeof slider>[0], 'value' | 'onInput' | 'defaultValue'>) =>
      slider({ ...opts, value: p[key], defaultValue: d[key], onInput: (v) => { this.params.halation[key] = v; this.invalidate(); } }).el;
    return section({ title: 'Halation', enabled: p.enabled, onToggle: (v) => { this.params.halation.enabled = v; this.invalidate(); } },
      s('intensity', { label: 'Intensity', min: 0, max: 2, step: 0.01 }),
      s('radius', { label: 'Radius', min: 0.2, max: 8, step: 0.05, format: (v) => `${v.toFixed(2)} %` }),
      s('threshold', { label: 'Threshold', min: 0.2, max: 1, step: 0.01 }),
      colorChip('Tint', p.tint, (v) => { this.params.halation.tint = v; this.invalidate(); }).el,
    );
  }

  private buildBloom(): HTMLElement {
    const p = this.params.bloom;
    const d = this.defaults.bloom;
    const s = (key: 'intensity' | 'radius' | 'threshold', opts: Omit<Parameters<typeof slider>[0], 'value' | 'onInput' | 'defaultValue'>) =>
      slider({ ...opts, value: p[key], defaultValue: d[key], onInput: (v) => { this.params.bloom[key] = v; this.invalidate(); } }).el;
    return section({ title: 'Bloom', enabled: p.enabled, onToggle: (v) => { this.params.bloom.enabled = v; this.invalidate(); } },
      s('intensity', { label: 'Intensity', min: 0, max: 2, step: 0.01 }),
      s('radius', { label: 'Radius', min: 0.5, max: 12, step: 0.1, format: (v) => `${v.toFixed(1)} %` }),
      s('threshold', { label: 'Threshold', min: 0.1, max: 1, step: 0.01 }),
    );
  }

  private buildDamage(): HTMLElement {
    const p = this.params.damage;
    const d = this.defaults.damage;
    type NumKey = 'dust' | 'dustSize' | 'scratches' | 'scratchWidth' | 'leak' | 'leakAngle' | 'leakSpread' | 'vignette' | 'vignetteFeather';
    const s = (key: NumKey, opts: Omit<Parameters<typeof slider>[0], 'value' | 'onInput' | 'defaultValue'>) =>
      slider({ ...opts, value: p[key], defaultValue: d[key], onInput: (v) => { this.params.damage[key] = v; this.invalidate(); } }).el;
    const lightToggle = toggle(p.dustLight, (v) => { this.params.damage.dustLight = v; this.invalidate(); }, 'Light specks');
    return section({ title: 'Damage', enabled: p.enabled, onToggle: (v) => { this.params.damage.enabled = v; this.invalidate(); }, open: false },
      h('h3', { text: 'Dust & scratches' }),
      s('dust', { label: 'Dust', min: 0, max: 1, step: 0.01 }),
      s('dustSize', { label: 'Dust size', min: 0.2, max: 3, step: 0.05 }),
      s('scratches', { label: 'Scratches', min: 0, max: 1, step: 0.01 }),
      s('scratchWidth', { label: 'Scratch width', min: 0.5, max: 4, step: 0.1, format: (v) => `${v.toFixed(1)} px` }),
      row(h('span', { class: 'slider-label', text: 'Light specks (scanned negative)' }), lightToggle.el),
      h('h3', { text: 'Light leak' }),
      s('leak', { label: 'Strength', min: 0, max: 2, step: 0.01 }),
      s('leakAngle', { label: 'Direction', min: 0, max: 360, step: 1, format: (v) => `${Math.round(v)}°` }),
      s('leakSpread', { label: 'Spread', min: 0.1, max: 1, step: 0.01 }),
      colorChip('Colour', p.leakColor, (v) => { this.params.damage.leakColor = v; this.invalidate(); }).el,
      h('h3', { text: 'Vignette' }),
      s('vignette', { label: 'Amount', min: 0, max: 1, step: 0.01 }),
      s('vignetteFeather', { label: 'Feather', min: 0.05, max: 1, step: 0.01 }),
      row(button('Reseed damage', () => { this.params.damage.seed = Math.floor(Math.random() * 1000); this.invalidate(); })),
    );
  }

  private resetAll(): void {
    this.params = defaultParams();
    this.buildUi();
    this.updateChrome();
    this.invalidate();
  }

  private updateChrome(): void {
    const has = !!this.image;
    this.empty.classList.toggle('is-hidden', has);
    this.inspector.classList.toggle('is-hidden', !has);
    this.nameLabel.textContent = this.image ? `${this.image.name}  ·  ${this.image.width} × ${this.image.height}` : 'No image';
    this.zoomChips.set(this.zoom);

    clear(this.filmstrip);
    const multi = this.job && this.job.items.length > 1;
    this.filmstrip.classList.toggle('is-hidden', !multi);
    if (multi && this.job) {
      this.filmstrip.append(
        button('‹', () => void this.loadItem((this.itemIndex + this.job!.items.length - 1) % this.job!.items.length)),
        h('span', { class: 'filmstrip-label', text: `${this.itemIndex + 1} / ${this.job.items.length}` }),
        button('›', () => void this.loadItem((this.itemIndex + 1) % this.job!.items.length)),
      );
    }
    this.status.textContent = this.image ? (this.zoom === 'fit' ? 'Fit' : '100%') + (this.compare ? '  ·  Original' : '') : '';
    this.status.classList.toggle('is-hidden', !has);
  }

  toast(message: string): void {
    let t = this.ui.querySelector('.toast') as HTMLElement | null;
    if (!t) { t = h('div', { class: 'glass toast', role: 'alert' }); this.ui.append(t); }
    t.textContent = message;
    t.classList.add('is-visible');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => t!.classList.remove('is-visible'), 4000);
  }

  // --------------------------------------------------------------- view

  private setZoom(z: Zoom): void {
    this.zoom = z;
    this.pan = { x: 0, y: 0 };
    this.updateChrome();
    this.invalidate();
  }

  private setCompare(v: boolean): void {
    if (this.compare === v) return;
    this.compare = v;
    this.updateChrome();
    this.invalidate();
  }

  private viewRect(): ViewRect {
    const dpr = window.devicePixelRatio || 1;
    const cw = this.canvas.width, ch = this.canvas.height;
    const W = this.renderer.width, H = this.renderer.height;
    const inspectorW = this.inspector.classList.contains('is-hidden') ? 0 : this.inspector.offsetWidth * dpr + 16 * dpr;
    const availW = cw - inspectorW;
    const pad = 72 * dpr;
    if (this.zoom === 'fit') {
      const s = Math.min((availW - pad) / W, (ch - pad * 1.6) / H, 1);
      const w = W * s, hh = H * s;
      return { x: (availW - w) / 2, y: (ch - hh) / 2, width: w, height: hh };
    }
    const w = W, hh = H;
    let x = (availW - w) / 2 + this.pan.x;
    let y = (ch - hh) / 2 + this.pan.y;
    if (w > availW) x = Math.min(0, Math.max(availW - w, x));
    if (hh > ch) y = Math.min(0, Math.max(ch - hh, y));
    return { x, y, width: w, height: hh };
  }

  private invalidate(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.draw(); });
  }

  private draw(): void {
    if (!this.renderer.hasImage) { this.renderer.renderPreview(this.params, { x: 0, y: 0, width: 1, height: 1 }); return; }
    try {
      this.renderer.renderPreview(this.params, this.viewRect(), this.compare);
    } catch (e) {
      this.toast((e as Error).message);
    }
  }

  private resize(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(window.innerWidth * dpr), hh = Math.round(window.innerHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== hh) { this.canvas.width = w; this.canvas.height = hh; }
    this.invalidate();
  }

  private bindEvents(): void {
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement && e.target.type !== 'range') return;
      const meta = e.metaKey || e.ctrlKey;
      if (e.key === '\\') { this.setCompare(true); e.preventDefault(); }
      else if (e.key === 'z' && !meta) this.setZoom(this.zoom === 'fit' ? 'actual' : 'fit');
      else if (meta && e.key.toLowerCase() === 'o') { e.preventDefault(); void this.openFile(); }
      else if (meta && e.key.toLowerCase() === 'e') { e.preventDefault(); if (!this.busy) void this.exportAll(); }
    });
    window.addEventListener('keyup', (e) => { if (e.key === '\\') this.setCompare(false); });

    // Drag to pan at 1:1.
    let drag: { x: number; y: number; px: number; py: number } | null = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (this.zoom !== 'actual') return;
      drag = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dpr = window.devicePixelRatio || 1;
      this.pan = { x: drag.px + (e.clientX - drag.x) * dpr, y: drag.py + (e.clientY - drag.y) * dpr };
      this.invalidate();
    });
    this.canvas.addEventListener('pointerup', () => { drag = null; });
    this.canvas.addEventListener('dblclick', () => this.setZoom(this.zoom === 'fit' ? 'actual' : 'fit'));

    // Drop files anywhere.
    window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('is-dragging'); });
    window.addEventListener('dragleave', () => document.body.classList.remove('is-dragging'));
    window.addEventListener('drop', async (e) => {
      e.preventDefault();
      document.body.classList.remove('is-dragging');
      const f = e.dataTransfer?.files?.[0];
      if (f) await this.openBytes(f.name, new Uint8Array(await f.arrayBuffer()));
    });
  }
}

function nextFrame(): Promise<void> {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

