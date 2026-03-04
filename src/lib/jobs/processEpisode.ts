import { stat } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { episodes, series, uploadLogs } from '@/db/schema';
import { S3_BUCKET } from 'astro:env/server';
import { generateEpisodeS3Key, uploadFile } from '@/lib/s3';
import { Job } from './job';

export interface ProcessEpisodeInput {
  tmdbid: number;
  showTitle: string;
  season: number;
  episodeNumber: number;
  episodeTitle: string;
  importedFilePath: string;
}

export class ProcessEpisode extends Job<ProcessEpisodeInput> {
  private uploadProgressPercent: number | null = null;

  describe(): string {
    const { tmdbid, showTitle, season, episodeNumber, episodeTitle, importedFilePath } = this.input;
    return `tmdbid=${tmdbid}, showTitle=${showTitle}, season=${season}, episode=${episodeNumber}, episodeTitle=${episodeTitle}, importedFilePath=${importedFilePath}, uploadProgress=${this.uploadProgressPercent}`;
  }

  protected async runInternal(): Promise<void> {
    const { tmdbid, showTitle, season, episodeNumber, episodeTitle, importedFilePath: filePath } = this.input;
    const { size: fileSize } = await stat(filePath);

    await db
      .insert(series)
      .values({
        tmdbid,
        title: showTitle,
      })
      .onConflictDoNothing({
        target: series.tmdbid,
      });

    const seriesTmdbid = tmdbid;

    const existingEpisode = await db
      .select()
      .from(episodes)
      .where(
        and(
          eq(episodes.seriesTmdbid, seriesTmdbid),
          eq(episodes.seasonNumber, season),
          eq(episodes.episodeNumber, episodeNumber),
          eq(episodes.filePath, filePath)
        )
      )
      .then((rows) => rows[0]);

    let episodeId: number;
    if (!existingEpisode) {
      const [insertedEpisode] = await db
        .insert(episodes)
        .values({
          seriesTmdbid,
          seasonNumber: season,
          episodeNumber,
          title: episodeTitle,
          filePath,
          fileSize,
          uploadStatus: 'uploading',
        })
        .returning({ id: episodes.id });
      episodeId = insertedEpisode.id;
    } else {
      episodeId = existingEpisode.id;
      await db
        .update(episodes)
        .set({
          title: episodeTitle,
          uploadStatus: 'uploading',
          s3Key: null,
          errorMessage: null,
        })
        .where(eq(episodes.id, episodeId));
    }

    const filename = path.basename(filePath) || 'video';
    const s3Key = generateEpisodeS3Key(tmdbid, season, episodeNumber, filename);
    const uploadResult = await uploadFile(filePath, s3Key, {
      onProgress: ({ percent }) => {
        this.uploadProgressPercent = Math.round(percent);
      },
    });
    await db
      .update(episodes)
      .set({
        uploadStatus: uploadResult.success ? 'uploaded' : 'failed',
        s3Key: uploadResult.success ? s3Key : null,
        uploadedAt: uploadResult.success ? new Date() : null,
        errorMessage: uploadResult.error || null,
      })
      .where(eq(episodes.id, episodeId));

    await db.insert(uploadLogs).values({
      mediaType: 'episode',
      mediaId: episodeId,
      filePath,
      fileSize,
      s3Key,
      s3Bucket: S3_BUCKET,
      status: uploadResult.success ? 'uploaded' : 'failed',
      errorMessage: uploadResult.error || null,
    });
  }
}
