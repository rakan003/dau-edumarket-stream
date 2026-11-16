import { integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const dauSessions = sqliteTable('dau_sessions', {
  id: text('id').primaryKey(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at').notNull(),
});

export const dauCheckouts = sqliteTable('dau_checkouts', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => dauSessions.id),
  clientKey: text('client_key').notNull(),
  fingerprint: text('fingerprint').notNull(),
  inputJson: text('input_json').notNull(),
  totalCents: integer('total_cents').notNull(),
  consumerId: text('consumer_id'),
  linkId: text('link_id'),
  url: text('url'),
  stage: text('stage').notNull().default('new'),
  attempt: integer('attempt').notNull().default(1),
  errorCode: text('error_code'),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
}, (table) => [uniqueIndex('dau_session_request').on(table.sessionId, table.clientKey),
  uniqueIndex('dau_session_fingerprint').on(table.sessionId, table.fingerprint)]);

export const dauContacts = sqliteTable('dau_contacts', {
  id: text('id').primaryKey(),
  consumerId: text('consumer_id'),
  stage: text('stage').notNull().default('new'),
  updatedAt: integer('updated_at').notNull(),
});

export const dauLocks = sqliteTable('dau_locks', {
  id: text('id').primaryKey(),
  token: text('token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const dauRequestKeys = sqliteTable('dau_request_keys', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => dauSessions.id),
  fingerprint: text('fingerprint').notNull(),
  checkoutId: text('checkout_id').notNull().references(() => dauCheckouts.id),
});
