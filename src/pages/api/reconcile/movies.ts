import type { APIRoute } from 'astro';
import path from 'node:path';
import { RADARR_API_KEY, RADARR_URL } from 'astro:env/server';
import { db } from '@/db';
import { ProcessMovie, jobRunner } from '@/lib/jobs';
import { RadarrClient } from '@/lib/radarrClient';
import { generateMovieS3Key } from '@/lib/s3';

function buildMovieKey(tmdbid: number, filePath: string): string {
  const filename = path.basename(filePath);
  return generateMovieS3Key(tmdbid, filename);
}

export const GET: APIRoute = async () => {
  try {
    const radarrClient = new RadarrClient(RADARR_URL, RADARR_API_KEY);
    const downloadedMovies = await radarrClient.getDownloadedMovies();

    const existingMovies = await db.query.movies.findMany({
      columns: {
        tmdbid: true,
        filePath: true,
      },
      where: (movie, { or, eq }) =>
        or(eq(movie.uploadStatus, 'uploaded'), eq(movie.uploadStatus, 'uploading')),
    });

    const existingKeys = new Set<string>();
    for (const movie of existingMovies) {
      if (movie.filePath === null) {
        console.log(`skipping movie ${movie.tmdbid} due to missing filepath`);
        continue;
      }
      existingKeys.add(buildMovieKey(movie.tmdbid, movie.filePath));
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
