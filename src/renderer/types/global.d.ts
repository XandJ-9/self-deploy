import type { AppApi } from '../api/runtime-api';

declare global {
  interface Window {
    api: AppApi;
  }
}

export {};
