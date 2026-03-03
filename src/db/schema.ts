import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Series table
export const series = sqliteTable('series', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tvdbId: integer('tvdb_id').unique().notNull(),
  title: text('title').notNull(),
  firstAirYear: integer('first_air_year'),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Seasons table
export const seasons = sqliteTable('seasons', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seriesId: integer('series_id').references(() => series.id).notNull(),
  seasonNumber: integer('season_number').notNull(),
});

// Episodes table
export const episodes = sqliteTable('episodes', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  seasonId: integer('season_id').references(() => seasons.id).notNull(),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title'),
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  s3Key: text('s3_key'),
  uploadStatus: text('upload_status').default('pending'),
  errorMessage: text('error_message'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Movies table
export const movies = sqliteTable('movies', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  tmdbId: integer('tmdb_id').unique().notNull(),
  title: text('title').notNull(),
  year: integer('year'),
  filePath: text('file_path'),
  fileSize: integer('file_size'),
  s3Key: text('s3_key'),
  uploadStatus: text('upload_status').default('pending'),
  errorMessage: text('error_message'),
  uploadedAt: integer('uploaded_at', { mode: 'timestamp' }),
  createdAt: integer('created_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Upload logs table
export const uploadLogs = sqliteTable('upload_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mediaType: text('media_type').notNull(), // 'movie' or 'episode'
  mediaId: integer('media_id').notNull(),
  filePath: text('file_path').notNull(),
  fileSize: integer('file_size').notNull(),
  s3Key: text('s3_key').notNull(),
  s3Bucket: text('s3_bucket').notNull(),
  status: text('status').notNull(),
  errorMessage: text('error_message'),
  loggedAt: integer('logged_at', { mode: 'timestamp' }).$defaultFn(() => new Date()),
});

// Relations
export const seriesRelations = relations(series, ({ many }) => ({
  seasons: many(seasons),
}));

export const seasonsRelations = relations(seasons, ({ one, many }) => ({
  series: one(series, {
    fields: [seasons.seriesId],
    references: [series.id],
  }),
  episodes: many(episodes),
}));

export const episodesRelations = relations(episodes, ({ one }) => ({
  season: one(seasons, {
    fields: [episodes.seasonId],
    references: [seasons.id],
  }),
}));
