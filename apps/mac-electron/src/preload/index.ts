import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC } from '../shared/ipc-channels';

/**
 * 仅暴露 invoke / on / off 的最小白名单 API。
 * 渲染端通过 window.api 调用，无法直接访问 Node。
 */

// 允许订阅的事件通道白名单
const SUBSCRIBE_WHITELIST = new Set<string>([IPC.Deploy.OnLog]);

type Listener = (...args: unknown[]) => void;

const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => {
    return ipcRenderer.invoke(channel, ...args);
  },
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),
  /**
   * 订阅主进程推送事件。返回取消订阅函数。
   * 仅允许订阅白名单内的通道。
   */
  on: (channel: string, listener: Listener): (() => void) => {
    if (!SUBSCRIBE_WHITELIST.has(channel)) {
      throw new Error(`Channel not subscribable: ${channel}`);
    }
    const wrapped = (_e: IpcRendererEvent, ...args: unknown[]) => listener(...args);
    ipcRenderer.on(channel, wrapped);
    return () => ipcRenderer.removeListener(channel, wrapped);
  },
  channels: IPC,
};

contextBridge.exposeInMainWorld('api', api);

export type AppApi = typeof api;
