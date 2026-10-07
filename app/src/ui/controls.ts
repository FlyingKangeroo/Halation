// Glass controls: slider, switch, segmented chips, colour chip, section.

import { h } from './dom';

export interface Control<T> { el: HTMLElement; set(v: T): void }

export interface SliderOpts {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue?: number;
  format?: (v: number) => string;
  onInput: (v: number) => void;
}

export function slider(o: SliderOpts): Control<number> {
  const fmt = o.format ?? ((v: number) => (o.step < 1 ? v.toFixed(2) : String(Math.round(v))));
  const input = h('input', { type: 'range', min: o.min, max: o.max, step: o.step, value: o.value, 'aria-label': o.label });
  const readout = h('span', { class: 'readout', text: fmt(o.value) });
  const paint = (v: number) => {
    input.style.setProperty('--p', `${((v - o.min) / (o.max - o.min)) * 100}%`);
    readout.textContent = fmt(v);
  };
  paint(o.value);
  input.addEventListener('input', () => { const v = Number(input.value); paint(v); o.onInput(v); });
  const reset = () => { const v = o.defaultValue ?? o.value; input.value = String(v); paint(v); o.onInput(v); };
  input.addEventListener('dblclick', reset);
  const el = h('label', { class: 'slider' },
    h('div', { class: 'slider-head' }, h('span', { class: 'slider-label', text: o.label }), readout),
    input,
  );
  return { el, set(v) { input.value = String(v); paint(v); } };
}

export function toggle(value: boolean, onChange: (v: boolean) => void, label?: string): Control<boolean> {
  const input = h('input', { type: 'checkbox', role: 'switch', 'aria-label': label ?? 'Enable' });
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const el = h('span', { class: 'switch' }, input, h('span', { class: 'switch-knob' }));
  return { el, set(v) { input.checked = v; } };
}

export interface ChipOption<T> { label: string; value: T; hint?: string }

export function chips<T extends string>(options: ChipOption<T>[], value: T | null, onChange: (v: T) => void): Control<T | null> {
  const buttons = new Map<T, HTMLButtonElement>();
  const el = h('div', { class: 'chips', role: 'radiogroup' });
  const paint = (v: T | null) => buttons.forEach((b, k) => b.setAttribute('aria-checked', String(k === v)));
  for (const opt of options) {
    const b = h('button', { class: 'chip', role: 'radio', type: 'button', title: opt.hint, text: opt.label, onclick: () => { paint(opt.value); onChange(opt.value); } });
    buttons.set(opt.value, b);
    el.append(b);
  }
  paint(value);
  return { el, set: paint };
}

export function colorChip(label: string, value: string, onChange: (v: string) => void): Control<string> {
  const input = h('input', { type: 'color', value, 'aria-label': label });
  const swatch = h('span', { class: 'swatch' });
  swatch.style.background = value;
  input.addEventListener('input', () => { swatch.style.background = input.value; onChange(input.value); });
  const el = h('label', { class: 'color-row' }, h('span', { class: 'slider-label', text: label }), h('span', { class: 'color-chip' }, swatch, input));
  return { el, set(v) { input.value = v; swatch.style.background = v; } };
}

export function row(...children: HTMLElement[]): HTMLElement {
  return h('div', { class: 'row' }, ...children);
}

export interface SectionOpts {
  title: string;
  enabled: boolean;
  onToggle: (v: boolean) => void;
  open?: boolean;
}

export function section(o: SectionOpts, ...children: HTMLElement[]): HTMLElement {
  const body = h('div', { class: 'section-body' }, ...children);
  const sw = toggle(o.enabled, (v) => { el.classList.toggle('is-off', !v); o.onToggle(v); }, o.title);
  const chevron = h('span', { class: 'chevron', 'aria-hidden': 'true' });
  const head = h('div', { class: 'section-head' },
    h('button', { class: 'section-title', type: 'button', text: o.title, onclick: () => el.classList.toggle('is-collapsed') }),
    chevron,
    sw.el,
  );
  const el = h('section', { class: 'section' + (o.enabled ? '' : ' is-off') + (o.open === false ? ' is-collapsed' : '') }, head, body);
  return el;
}

export function button(label: string, onClick: () => void, opts: { primary?: boolean; icon?: string; title?: string } = {}): HTMLButtonElement {
  return h('button', { class: 'btn' + (opts.primary ? ' btn-primary' : ''), type: 'button', title: opts.title, onclick: onClick },
    opts.icon ? h('span', { class: 'icon', 'aria-hidden': 'true', text: opts.icon }) : null,
    h('span', { text: label }));
}
