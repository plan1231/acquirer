PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text,
	`file_path` text,
	`file_size` integer,
	`s3_key` text,
	`upload_status` text DEFAULT 'uploading' NOT NULL,
	`error_message` text,
	`uploaded_at` integer,
	`created_at` integer,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "episodes_upload_status_check" CHECK("__new_episodes"."upload_status" in ('uploading', 'uploaded', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_episodes`("id", "season_id", "episode_number", "title", "file_path", "file_size", "s3_key", "upload_status", "error_message", "uploaded_at", "created_at") SELECT "id", "season_id", "episode_number", "title", "file_path", "file_size", "s3_key", "upload_status", "error_message", "uploaded_at", "created_at" FROM `episodes`;--> statement-breakpoint
DROP TABLE `episodes`;--> statement-breakpoint
ALTER TABLE `__new_episodes` RENAME TO `episodes`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`file_path` text,
	`file_size` integer,
	`s3_key` text,
	`upload_status` text DEFAULT 'uploading' NOT NULL,
	`error_message` text,
	`uploaded_at` integer,
	`created_at` integer,
	CONSTRAINT "movies_upload_status_check" CHECK("__new_movies"."upload_status" in ('uploading', 'uploaded', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_movies`("id", "tmdb_id", "title", "year", "file_path", "file_size", "s3_key", "upload_status", "error_message", "uploaded_at", "created_at") SELECT "id", "tmdb_id", "title", "year", "file_path", "file_size", "s3_key", "upload_status", "error_message", "uploaded_at", "created_at" FROM `movies`;--> statement-breakpoint
DROP TABLE `movies`;--> statement-breakpoint
ALTER TABLE `__new_movies` RENAME TO `movies`;--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);