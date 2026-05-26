import { describe, expect, it } from 'vitest';
import { IPC } from '@ipc-contract/index';

describe('IPC contract baseline', () => {
  it('keeps required top-level namespaces', () => {
    expect(IPC.Server).toBeTruthy();
    expect(IPC.Project).toBeTruthy();
    expect(IPC.Git).toBeTruthy();
    expect(IPC.Deploy).toBeTruthy();
  });

  it('keeps deploy log event channel stable', () => {
    expect(IPC.Deploy.OnLog).toBe('deploy:onLog');
  });
});
