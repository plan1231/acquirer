CREATE TYPE "public"."upload_status" AS ENUM('uploading', 'uploaded', 'failed');--> statement-breakpoint
CREATE TABLE "episodes" (
	"id" serial PRIMARY KEY NOT NULL,
	"season_id" integer NOT NULL,
	"episode_number" integer NOT NULL,
	"title" text,
	"file_path" text,
	"file_size" bigint,
	"s3_key" text,
	"upload_status" "upload_status" DEFAULT 'uploading' NOT NULL,
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "movies" (
	"tmdbid" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"file_path" text,
	"file_size" bigint,
	"s3_key" text,
	"upload_status" "upload_status" DEFAULT 'uploading' NOT NULL,
	"error_message" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seasons" (
	"id" serial PRIMARY KEY NOT NULL,
	"series_tmdbid" integer NOT NULL,
	"season_number" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "series" (
	"tmdbid" integer PRIMARY KEY NOT NULL,
	"title" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "upload_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"media_type" text NOT NULL,
	"media_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"file_size" bigint NOT NULL,
	"s3_key" text NOT NULL,
	"s3_bucket" text NOT NULL,
	"status" "upload_status" NOT NULL,
	"error_message" text,
	"logged_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "episodes" ADD CONSTRAINT "episodes_season_id_seasons_id_fk" FOREIGN KEY ("season_id") REFERENCES "public"."seasons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seasons" ADD CONSTRAINT "seasons_series_tmdbid_series_tmdbid_fk" FOREIGN KEY ("series_tmdbid") REFERENCES "public"."series"("tmdbid") ON DELETE no action ON UPDATE no action;