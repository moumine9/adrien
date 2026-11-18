type Sqlite = typeof import('node:sqlite');

let loading: Promise<Sqlite> | undefined;

/**
 * Node prints an ExperimentalWarning the first time `node:sqlite` loads. On `adrien mcp` that stray output would
 * reach the user's terminal on every run, so drop that one warning and forward every other warning to stderr.
 */
function silenceSqliteWarning(): void {
  process.removeAllListeners('warning');
  process.on('warning', (warning) => {
    if (warning.name === 'ExperimentalWarning' && /SQLite/i.test(warning.message)) return;
    process.stderr.write(`${warning.name}: ${warning.message}\n`);
  });
}

export function loadSqlite(): Promise<Sqlite> {
  if (!loading) {
    silenceSqliteWarning();
    loading = import('node:sqlite');
  }
  return loading;
}
