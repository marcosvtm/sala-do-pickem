import {
  sqliteTable,
  text,
  integer,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    stage: text('stage').notNull(),
    nick: text('nick').notNull(),
    nickKey: text('nick_key').notNull(),
    submitted: integer('submitted').notNull(),
    settings: text('settings').notNull(),
  },
  (t) => [uniqueIndex('stage_nick').on(t.stage, t.nickKey)]
);

export const results = sqliteTable('stage_results', {
  stage: text('stage').primaryKey(),
  locks: text('locks').notNull(),
  schedule: text('schedule'),
  checked: integer('checked').notNull(),
  attempted: integer('attempted').notNull(),
});
