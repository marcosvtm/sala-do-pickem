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
    participantId: text('participant_id'),
    revision: integer('revision').notNull().default(1),
    removedAt: integer('removed_at'),
  },
  (t) => [
    uniqueIndex('stage_nick').on(t.stage, t.nickKey),
    uniqueIndex('stage_participant').on(t.stage, t.participantId),
  ]
);

export const participants = sqliteTable('participants', {
  id: text('id').primaryKey(),
  recoveryHash: text('recovery_hash').notNull().unique(),
});

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

export const editions = sqliteTable('stage_editions', {
  stage: text('stage').primaryKey(),
  attempted: integer('attempted').notNull(),
  activatedAt: integer('activated_at'),
  detail: text('detail'),
  edition: text('edition'),
  replay: text('replay'),
});
