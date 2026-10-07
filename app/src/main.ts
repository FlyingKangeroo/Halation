import './style.css';
import { App } from './ui/app';

const canvas = document.getElementById('stage') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;

try {
  const app = new App(canvas, ui);
  // Exposed for the end-to-end test harness.
  (window as unknown as { halation: App }).halation = app;
} catch (e) {
  ui.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'glass fatal';
  msg.textContent = (e as Error).message;
  ui.append(msg);
}
