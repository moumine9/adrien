import { DatabaseSync } from 'node:sqlite';

test('node:sqlite has FTS5 with unicode61 remove_diacritics', () => {
  const db = new DatabaseSync(':memory:');
  db.exec("create virtual table t using fts5(a, tokenize = 'unicode61 remove_diacritics 2')");
  db.exec("insert into t values ('Arrondi décimal des factures')");
  expect(db.prepare("select a from t where t match 'decimal'").all()).toHaveLength(1);
});
