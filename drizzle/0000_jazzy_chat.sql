CREATE TABLE `episodes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`season_id` integer NOT NULL,
	`episode_number` integer NOT NULL,
	`title` text,
	`file_path` text,
	`file_size` integer,
	`s3_key` text,
	`upload_status` text DEFAULT 'pending',
	`error_message` text,
	`uploaded_at` integer,
	`created_at` integer,
	FOREIGN KEY (`season_id`) REFERENCES `seasons`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `movies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tmdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`file_path` text,
	`file_size` integer,
	`s3_key` text,
	`upload_status` text DEFAULT 'pending',
	`error_message` text,
	`uploaded_at` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movies_tmdb_id_unique` ON `movies` (`tmdb_id`);--> statement-breakpoint
CREATE TABLE `seasons` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`series_id` integer NOT NULL,
	`season_number` integer NOT NULL,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`tvdb_id` integer NOT NULL,
	`title` text NOT NULL,
	`first_air_year` integer,
	`created_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `series_tvdb_id_unique` ON `series` (`tvdb_id`);--> statement-breakpoint
CREATE TABLE `upload_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_type` text NOT NULL,
	`media_id` integer NOT NULL,
	`file_path` text NOT NULL,
	`file_size` integer NOT NULL,
	`s3_key` text NOT NULL,
	`s3_bucket` text NOT NULL,
	`status` text NOT NULL,
	`error_message` text,
	`logged_at` integer
);
