import { relations } from 'drizzle-orm';
import { bigint, integer, pgEnum, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core';

export const uploadStatusEnum = pgEnum('upload_status', ['uploading', 'uploaded', 'failed']);

// Series table
export const series = pgTable('series', {
  tmdbid: integer('tmdbid').primaryKey(),
  title: text('title').notNull(),
});

// Seasons table
export const seasons = pgTable('seasons', {
  id: serial('id').primaryKey(),
  seriesTmdbid: integer('series_tmdbid')
    .references(() => series.tmdbid)
    .notNull(),
  seasonNumber: integer('season_number').notNull(),
});

// Episodes table
export const episodes = pgTable('episodes', {
  id: serial('id').primaryKey(),
  seasonId: integer('season_id')
    .references(() => seasons.id)
    .notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title'),
  filePath: text('file_path'),
  fileSize: bigint('file_size', { mode: 'number' }),
  s3Key: text('s3_key'),
  uploadStatus: uploadStatusEnum('upload_status').default('uploading').notNull(),
  errorMessage: text('error_message'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Movies table
export const movies = pgTable('movies', {
  tmdbid: integer('tmdbid').primaryKey(),
  title: text('title').notNull(),
  filePath: text('file_path'),
  fileSize: bigint('file_size', { mode: 'number' }),
  s3Key: text('s3_key'),
  uploadStatus: uploadStatusEnum('upload_status').default('uploading').notNull(),
  errorMessage: text('error_message'),
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// Upload logs table
export const uploadLogs = pgTable('upload_logs', {
  id: serial('id').primaryKey(),
  mediaType: text('media_type').notNull(), // 'movie' or 'episode'
  mediaId: integer('media_id').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: bigint('file_size', { mode: 'number' }).notNull(),
  s3Key: text('s3_key').notNull(),
  s3Bucket: text('s3_bucket').notNull(),
  status: uploadStatusEnum('status').notNull(),
  errorMessage: text('error_message'),
  loggedAt: timestamp('logged_at', { withTimezone: true }).defaultNow().notNull(),
});

// Relations
export const seriesRelations = relations(series, ({ many }) => ({
  seasons: many(seasons),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  series: one(series, {
    fields: [seasons.seriesTmdbid],
    references: [series.tmdbid],
  }),
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  season: one(seasons, {
    fields: [episodes.seasonId],
    references: [seasons.id],
  }),
}));
