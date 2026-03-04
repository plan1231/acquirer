import type { APIRoute } from 'astro';
import { or, eq } from 'drizzle-orm';
import { SONARR_API_KEY, SONARR_URL } from 'astro:env/server';
import { db } from '@/db';
import { episodes, seasons, series } from '@/db/schema';
import { ProcessEpisode, jobRunner } from '@/lib/jobs';
import { SonarrClient } from '@/lib/sonarrClient';

function buildEpisodeKey(tmdbid: number, seasonNumber: number, episodeNumber: number, filePath: string): string {
  return `${tmdbid}|${seasonNumber}|${episodeNumber}|${filePath}`;
}

export const GET: APIRoute = async () => {
  try {
    const sonarrClient = new SonarrClient(SONARR_URL, SONARR_API_KEY);
    const downloadedEpisodes = await sonarrClient.getDownloadedEpisodes();

    const existingEpisodes = await db
      .select({
        key: episodes.s3Key
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(series, eq(seasons.seriesTmdbid, series.tmdbid))
      .where(or(eq(episodes.uploadStatus, 'uploaded'), eq(episodes.uploadStatus, 'uploading')));

    const existingKeys = new Set<string>();
    for (const existingEpisode of existingEpisodes) {
      if(existingEpisode.key === null) throw new Error("WTF no key when adding existing episode to set");
      existingKeys.add(existingEpisode.key);
    }

    const inFlightKeys = new Set<string>();
    for (const job of jobRunner.getJobs()) {
      if (!(job instanceof ProcessEpisode)) {
        continue;
      }

      if (job.status !== 'pending' && job.status !== 'running') {
        continue;
      }

      inFlightKeys.add(
        buildEpisodeKey(job.input.tmdbid, job.input.season, job.input.episodeNumber, job.input.importedFilePath)
      );
    }

    const queuedJobIds: number[] = [];
    const reconciledEpisodes: Array<{ showTitle: string; seasonNumber: number; episodeNumber: number }> = [];
    let skippedExistingDb = 0;
    let skippedInFlight = 0;

    for (const episode of downloadedEpisodes) {
      const episodeKey = buildEpisodeKey(
        episode.tmdbid,
        episode.seasonNumber,
        episode.episodeNumber,
        episode.filePath
      );

      if (existingKeys.has(episodeKey)) {
        skippedExistingDb += 1;
        continue;
      }

      if (inFlightKeys.has(episodeKey)) {
        skippedInFlight += 1;
        continue;
      }

      const job = new ProcessEpisode({
        tmdbid: episode.tmdbid,
        showTitle: episode.showTitle,
        season: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: episode.episodeTitle,
        importedFilePath: episode.filePath,
      });
      jobRunner.enqueue(job);
      queuedJobIds.push(job.id);
      reconciledEpisodes.push({
        showTitle: episode.showTitle,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
      });
      console.log(
        `Reconciled TV episode: ${episode.showTitle} S${episode.seasonNumber}E${episode.episodeNumber}`
      );
      inFlightKeys.add(episodeKey);
    }

    return new Response(
      JSON.stringify({
        success: true,
        scanned: downloadedEpisodes.length,
        queued: queuedJobIds.length,
        skipped_existing_db: skippedExistingDb,
        skipped_in_flight: skippedInFlight,
        job_ids: queuedJobIds,
        reconciled_episodes: reconciledEpisodes,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error reconciling TV downloads:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
