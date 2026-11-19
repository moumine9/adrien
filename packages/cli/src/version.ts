import { createRequire } from 'node:module';

/** The CLI's own version, read from its package.json (the bundle and the source tree both sit one level below it). */
export const VERSION: string = createRequire(import.meta.url)('../package.json').version;
