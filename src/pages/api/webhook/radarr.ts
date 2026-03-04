import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { movies, uploadLogs } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { uploadFile, generateS3Key } from '@/lib/s3';

// Types for Radarr webhook payload
interface RadarrMovieFile {
  path: string;
  size: number;
}

interface RadarrMovie {
  tmdbId: number;
  title: string;
  year?: number;
}

interface RadarrPayload {
  eventType: string;
  movie?: RadarrMovie;
  movieFile?: RadarrMovieFile;
  downloadId?: string;
  downloadClient?: string;
  downloadClientType?: string;
  isUpgrade?: boolean;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const db = getDb();
    const payload: RadarrPayload = await request.json();
    console.log(`Received Radarr webhook: ${payload.eventType}`);
    console.log(payload);
    // Radarr "On Download" webhook payload emits eventType "Download".
    // This event is sent after import for a new download.
    if (payload.eventType !== 'Download') {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Ignored event type: ${payload.eventType}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.movie || !payload.movieFile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing movie or movie file data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tmdbId = payload.movie.tmdbId;
    const title = payload.movie.title;
    const year = payload.movie.year;
    const filePath = payload.movieFile.path;
    const fileSize = payload.movieFile.size;

    // Get or create movie
    let existingMovie = await db
      .select()
      .from(movies)
      .where(eq(movies.tmdbId, tmdbId))
      .then((rows) => rows[0]);

    let movieId: number;

    if (!existingMovie) {
      const result = await db.insert(movies).values({
        tmdbId,
        title,
        year,
        filePath,
        fileSize,
        uploadStatus: 'uploading',
      });
      movieId = Number(result.lastInsertRowid);
    } else {
      // Update existing movie record
      await db
        .update(movies)
        .set({
          filePath,
          fileSize,
          uploadStatus: 'uploading',
          s3Key: null,
          errorMessage: null,
        })
        .where(eq(movies.id, existingMovie.id));
      movieId = existingMovie.id;
    }

    // Trigger upload
    const filename = filePath.split('/').pop() || 'video';
    const s3Key = generateS3Key('movie', tmdbId, filename);

    // Perform upload
    const uploadResult = await uploadFile(filePath, s3Key);

    // Update movie status
    await db
      .update(movies)
      .set({
        uploadStatus: uploadResult.success ? 'uploaded' : 'failed',
        s3Key: uploadResult.success ? s3Key : null,
        uploadedAt: uploadResult.success ? new Date() : null,
        errorMessage: uploadResult.error || null,
      })
      .where(eq(movies.id, movieId));

    // Log the upload
    await db.insert(uploadLogs).values({
      mediaType: 'movie',
      mediaId: movieId,
      filePath,
      fileSize,
      s3Key,
      s3Bucket: process.env.S3_BUCKET || '',
      status: uploadResult.success ? 'uploaded' : 'failed',
      errorMessage: uploadResult.error || null,
    });

    console.log(
      `Processed Radarr Download webhook for ${title} (TMDB: ${tmdbId}, Year: ${year}, downloadId: ${payload.downloadId || 'n/a'})`
    );

    return new Response(JSON.stringify({ success: true, message: 'Webhook processed' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error handling Radarr webhook:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
