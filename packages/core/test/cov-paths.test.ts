import { join } from 'node:path';
import { canonicalPath } from '../src/paths.ts';
import { tmpDir } from './helpers/fixtures.ts';

test('preserves the supplied path when it does not exist', () => {
  const path = join(tmpDir(), 'missing');
  expect(canonicalPath(path)).toBe(path);
});
