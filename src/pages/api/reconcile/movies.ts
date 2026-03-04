import type { APIRoute } from 'astro';
import { or, eq } from 'drizzle-orm';
import { RADARR_API_KEY, RADARR_URL } from 'astro:env/server';
import { db } from '@/db';
import { movies } from '@/db/schema';
import { ProcessMovie, jobRunner } from '@/lib/jobs';
import { RadarrClient } from '@/lib/radarrClient';

function buildMovieKey(tmdbid: number, filePath: string): string {
  return `${tmdbid}|${filePath}`;
}

export const GET: APIRoute = async () => {
  try {
    const radarrClient = new RadarrClient(RADARR_URL, RADARR_API_KEY);
    const downloadedMovies = await radarrClient.getDownloadedMovies();

    const existingMovies = await db
      .select({
        s3Key: movies.s3Key,
      })
      .from(movies)
      .where(or(eq(movies.uploadStatus, 'uploaded'), eq(movies.uploadStatus, 'uploading')));

    const existingKeys = new Set<string>();
    for (const movie of existingMovies) {
      if(movie.s3Key === null) throw new Error("wtf");
      existingKeys.add(movie.s3Key);
    }

    const inFlightKeys = new Set<string>();
    for (const job of jobRunner.getJobs()) {
      if (!(job instanceof ProcessMovie)) {
        continue;
      }

      if (job.status !== 'pending' && job.status !== 'running') {
        continue;
      }

      inFlightKeys.add(buildMovieKey(job.input.tmdbid, job.input.importedFilePath));
    }

    const queuedJobIds: number[] = [];
    let skippedExistingDb = 0;
    let skippedInFlight = 0;

    for (const movie of downloadedMovies) {
      const movieKey = buildMovieKey(movie.tmdbid, movie.filePath);

      if (existingKeys.has(movieKey)) {
        skippedExistingDb += 1;
        continue;
      }

      if (inFlightKeys.has(movieKey)) {
        skippedInFlight += 1;
        continue;
      }

      const job = new ProcessMovie({
        tmdbid: movie.tmdbid,
        title: movie.title,
        importedFilePath: movie.filePath,
      });
      jobRunner.enqueue(job);
      queuedJobIds.push(job.id);
      inFlightKeys.add(movieKey);
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: downloadedMovies.length,
        queued: queuedJobIds.length,
        skipped_existing_db: skippedExistingDb,
        skipped_in_flight: skippedInFlight,
        job_ids: queuedJobIds,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error reconciling movie downloads:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
