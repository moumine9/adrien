/** On Windows, pnpm and npm are `.cmd` shims, which only a shell can start. */
export function needsShell(cmd: string, platform?: string): boolean;
