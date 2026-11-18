import { assertNoDemoBundle } from '../../../scripts/site/demo-bundle.mjs';
import { tmpDir, writeFiles } from '../../core/test/helpers/fixtures.ts';

/** A dist folder shaped like the normal web build: the app and its page, and no demo chunk. */
const NORMAL_BUILD = {
  'index.html': '<!doctype html><title>Adrien</title>',
  'assets/app.js': 'console.log("app");',
  'assets/index.css': 'body {}',
};

describe('assertNoDemoBundle', () => {
  it('passes for a normal web build', () => {
    const dist = tmpDir();
    writeFiles(dist, NORMAL_BUILD);
    expect(() => assertNoDemoBundle(dist)).not.toThrow();
  });

  it('fails with a clear message when the demo chunk is in the normal build', () => {
    const dist = tmpDir();
    writeFiles(dist, { ...NORMAL_BUILD, 'assets/demo.js': 'export const mock = true;' });
    expect(() => assertNoDemoBundle(dist)).toThrow(/demo\.js is in the normal web build/);
  });

  it('fails when there is no normal build to check, so the check cannot pass by accident', () => {
    expect(() => assertNoDemoBundle(tmpDir())).toThrow(/No normal web build/);
    const partial = tmpDir();
    writeFiles(partial, { 'index.html': '<!doctype html>' });
    expect(() => assertNoDemoBundle(partial)).toThrow(/No normal web build/);
  });
});
