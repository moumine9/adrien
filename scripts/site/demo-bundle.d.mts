/**
 * Throws unless `distDir` holds a normal web build (index.html and assets/app.js) and no demo chunk (assets/demo.js).
 * The demo mock must never ship in the bundle that `adrien serve` serves.
 */
export declare function assertNoDemoBundle(distDir: string): void;
