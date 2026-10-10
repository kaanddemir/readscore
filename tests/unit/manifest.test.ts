/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';
import manifest from '../../src/manifest.json';
import pkg from '../../package.json';

describe('manifest (source)', () => {
  it('is MV3 with the approved minimal permissions', () => {
    expect(manifest.manifest_version).toBe(3);
    expect([...manifest.permissions].sort()).toEqual(['activeTab', 'scripting', 'storage']);
    expect(manifest).not.toHaveProperty('host_permissions');
    expect(manifest).not.toHaveProperty('content_scripts');
    expect(manifest).not.toHaveProperty('optional_host_permissions');
  });

  it('points at the 2.0 build outputs', () => {
    expect(manifest.background).toEqual({ service_worker: 'background/sw.js', type: 'module' });
    expect(manifest.action.default_popup).toBe('popup/index.html');
  });

  it('gets its version from package.json at build time', () => {
    expect(pkg.version).toMatch(/^2\.\d+\.\d+$/);
  });
});
