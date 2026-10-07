// Where the app is running. Inside Tauri it reads the job file Lightroom
// wrote and talks to the file system; in a browser it falls back to file
// pickers and downloads so the editor can be developed without Lightroom.

import type { Transfer } from '../engine/params';

export interface JobItem { input: string; output: string; name: string }
export interface Job { version: number; colorSpace: Transfer; items: JobItem[] }

export interface PickedFile { name: string; bytes: Uint8Array }

export interface Host {
  readonly kind: 'tauri' | 'browser';
  getJob(): Promise<Job | null>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, bytes: Uint8Array): Promise<void>;
  pickOpen(): Promise<PickedFile | null>;
  saveAs(suggestedName: string, bytes: Uint8Array): Promise<boolean>;
  close(): Promise<void>;
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function basename(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

class TauriHost implements Host {
  readonly kind = 'tauri' as const;

  async getJob(): Promise<Job | null> {
    const { getMatches } = await import('@tauri-apps/plugin-cli');
    const matches = await getMatches();
    const jobPath = matches.args['job']?.value;
    if (typeof jobPath !== 'string' || !jobPath) return null;
    const text = new TextDecoder().decode(await this.readFile(jobPath));
    const job = JSON.parse(text) as Job;
    if (!Array.isArray(job.items)) throw new Error('Malformed job file');
    return job;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const { readFile } = await import('@tauri-apps/plugin-fs');
    return readFile(path);
  }

  async writeFile(path: string, bytes: Uint8Array): Promise<void> {
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, bytes);
  }

  async pickOpen(): Promise<PickedFile | null> {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['tif', 'tiff', 'jpg', 'jpeg', 'png', 'webp'] }],
    });
    if (!picked || typeof picked !== 'string') return null;
    return { name: basename(picked), bytes: await this.readFile(picked) };
  }

  async saveAs(suggestedName: string, bytes: Uint8Array): Promise<boolean> {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName, filters: [{ name: 'TIFF', extensions: ['tif'] }] });
    if (!path) return false;
    await this.writeFile(path, bytes);
    return true;
  }

  async close(): Promise<void> {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().close();
  }
}

class BrowserHost implements Host {
  readonly kind = 'browser' as const;

  async getJob(): Promise<Job | null> { return null; }

  async readFile(): Promise<Uint8Array> { throw new Error('File paths are not readable in the browser'); }

  async writeFile(): Promise<void> { throw new Error('File paths are not writable in the browser'); }

  pickOpen(): Promise<PickedFile | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.tif,.tiff,image/*';
      input.onchange = async () => {
        const f = input.files?.[0];
        if (!f) return resolve(null);
        resolve({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
      };
      input.oncancel = () => resolve(null);
      input.click();
    });
  }

  async saveAs(suggestedName: string, bytes: Uint8Array): Promise<boolean> {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/tiff' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = suggestedName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  }

  async close(): Promise<void> { /* nothing to close in a tab */ }
}

export function createHost(): Host {
  return isTauri() ? new TauriHost() : new BrowserHost();
}
