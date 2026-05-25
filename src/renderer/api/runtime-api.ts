import { invoke as tauriInvoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import { IPC } from '@shared/ipc-channels';

export type AppApiListener = (...args: unknown[]) => void;

export interface AppApi {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
  pickDirectory: () => Promise<string | null>;
  on: (channel: string, listener: AppApiListener) => () => void;
  channels: typeof IPC;
}

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    api: AppApi;
  }
}

const SUBSCRIBE_WHITELIST = new Set<string>([IPC.Deploy.OnLog]);

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);
}

function createTauriApi(): AppApi {
  return {
    invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
      return tauriInvoke<T>('invoke_channel', { channel, args });
    },
    pickDirectory: async (): Promise<string | null> => {
      const selected = await open({ directory: true, multiple: false });
      return typeof selected === 'string' ? selected : null;
    },
    on: (channel: string, listener: AppApiListener): (() => void) => {
      if (!SUBSCRIBE_WHITELIST.has(channel)) {
        throw new Error(`Channel not subscribable: ${channel}`);
      }
      const unlisten = listen<unknown>(channel, (event) => {
        const payload = Array.isArray(event.payload) ? event.payload : [event.payload];
        listener(...payload);
      });
      return () => {
        void unlisten.then((fn) => fn());
      };
    },
    channels: IPC,
  };
}

export function ensureRuntimeApi(): void {
  if (typeof window === 'undefined' || window.api) return;
  if (isTauriRuntime()) {
    window.api = createTauriApi();
    return;
  }

  // eslint-disable-next-line no-console
  console.error('[SelfDeploy] window.api 未注入：请在桌面应用窗口中运行，而不是浏览器标签页。');
  document.body.innerHTML =
    '<div style="padding:32px;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#e6e8ef;background:#0b1020;min-height:100vh">' +
    '<h2>请在 SelfDeploy 桌面应用窗口中打开</h2>' +
    '<p>当前页面是渲染层的 Vite 开发服务器，<code>window.api</code> 仅在 Electron preload 或 Tauri runtime 中可用。</p>' +
    '<p>Electron 开发请执行 <code>npm run dev</code>；Tauri 开发请先安装 Rust 工具链，再执行 <code>npm run dev:tauri</code>。</p>' +
    '</div>';
  throw new Error('window.api missing — open via Electron or Tauri, not a browser tab.');
}
