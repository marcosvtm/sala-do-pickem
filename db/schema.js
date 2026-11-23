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
    editHash: text('edit_hash'),
    revision: integer('revision').notNull().default(1),
    removedAt: integer('removed_at'),
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

export const models = sqliteTable(
  'personal_models',
  {
    id: text('id').primaryKey(),
    stage: text('stage').notNull(),
    nick: text('nick').notNull(),
    nickKey: text('nick_key').notNull(),
    submitted: integer('submitted').notNull(),
    settings: text('settings').notNull(),
  },
  (t) => [uniqueIndex('stage_nick_settings').on(t.stage, t.nickKey, t.settings)]
);
