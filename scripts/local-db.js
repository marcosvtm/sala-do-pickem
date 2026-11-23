import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function openDb(filename = ':memory:') {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY)'
  );
  const journal = JSON.parse(
    readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url))
  );
  for (const { tag } of journal.entries) {
    if (
      sqlite.prepare('SELECT name FROM local_migrations WHERE name=?').get(tag)
    )
      continue;
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(
        readFileSync(
          new URL('../drizzle/' + tag + '.sql', import.meta.url),
          'utf8'
        )
      );
      sqlite.prepare('INSERT INTO local_migrations VALUES(?)').run(tag);
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  }
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      return {
        bind: (...params) => ({
          all: async () => ({ results: statement.all(...params) }),
          first: async () => statement.get(...params) ?? null,
          run: async () => ({
            meta: { changes: statement.run(...params).changes },
          }),
        }),
      };
    },
  };
}
