import { stat } from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { movies, uploadLogs } from '@/db/schema';
import { S3_BUCKET } from 'astro:env/server';
import { generateMovieS3Key, uploadFile } from '@/lib/s3';
import { Job } from './job';

export interface ProcessMovieInput {
  tmdbid: number;
  title: string;
  importedFilePath: string;
}

export class ProcessMovie extends Job<ProcessMovieInput> {
  private uploadProgressPercent: number | null = null;

  describe(): string {
    return `tmdbid=${this.input.tmdbid}, title=${this.input.title}, importedFilePath=${this.input.importedFilePath}, uploadProgress=${this.uploadProgressPercent}`;
  }

  protected async runInternal(): Promise<void> {
    const { tmdbid, title, importedFilePath: filePath } = this.input;
    const { size: fileSize } = await stat(filePath);

    await db
      .insert(movies)
      .values({
        tmdbid,
        title,
        filePath,
        fileSize,
        uploadStatus: 'uploading',
      })
      .onConflictDoNothing({
        target: movies.tmdbid,
      });

    const filename = path.basename(filePath) || 'video';
    const s3Key = generateMovieS3Key(tmdbid, filename);
    const uploadResult = await uploadFile(filePath, s3Key, {
      onProgress: ({ percent }) => {
        this.uploadProgressPercent = Math.round(percent);
      },
    });

    await db
      .update(movies)
      .set({
        uploadStatus: uploadResult.success ? 'uploaded' : 'failed',
        s3Key: uploadResult.success ? s3Key : null,
        uploadedAt: uploadResult.success ? new Date() : null,
        errorMessage: uploadResult.error || null,
      })
      .where(eq(movies.tmdbid, tmdbid));

    await db.insert(uploadLogs).values({
      mediaType: 'movie',
      mediaId: tmdbid,
      filePath,
      fileSize,
      s3Key,
      s3Bucket: S3_BUCKET,
      status: uploadResult.success ? 'uploaded' : 'failed',
      errorMessage: uploadResult.error || null,
    });
  }
}
