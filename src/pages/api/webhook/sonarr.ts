import type { APIRoute } from 'astro';
import { ProcessEpisode, jobRunner } from '@/lib/jobs';

// Types for Sonarr webhook payload
interface SonarrEpisodeFile {
  path: string;
  size: number;
  sourcePath?: string;
}

interface SonarrSeries {
  tmdbId?: number;
  title: string;
}

interface SonarrEpisode {
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
}

interface SonarrPayload {
  eventType: string;
  series?: SonarrSeries;
  episodes?: SonarrEpisode[];
  episodeFile?: SonarrEpisodeFile;
  episodeFiles?: SonarrEpisodeFile[];
  downloadId?: string;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const payload: SonarrPayload = await request.json();
    console.log(`Received Sonarr webhook: ${payload.eventType}`);
    console.log(payload);
    // Sonarr webhook EventType is "Download" for both OnDownload and OnImportComplete.
    if (payload.eventType !== 'Download') {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Ignored event type: ${payload.eventType}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Ignore OnImportComplete payloads to prevent duplicate processing.
    // OnImportComplete payloads include episodeFiles[] (plural), while OnDownload includes episodeFile.
    if (!payload.episodeFile) {
      if (payload.episodeFiles && payload.episodeFiles.length > 0) {
        return new Response(
          JSON.stringify({
            success: true,
            message: 'Ignored OnImportComplete Download webhook to avoid duplicate episode processing',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: false, error: 'Missing episodeFile payload for OnDownload event' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.series || !payload.episodes || payload.episodes.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required series/episodes metadata' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (typeof payload.series.tmdbId !== 'number') {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing required series.tmdbId metadata' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tmdbId = payload.series.tmdbId;
    const title = payload.series.title;
    const filePath = payload.episodeFile.path;

    const queuedJobIds: number[] = [];

    for (const ep of payload.episodes) {
      const seasonNumber = ep.seasonNumber || 1;
      const episodeNumber = ep.episodeNumber || 1;
      const job = new ProcessEpisode({
        tmdbid: tmdbId,
        showTitle: title,
        season: seasonNumber,
        episodeNumber,
        episodeTitle: ep.title || `S${seasonNumber}E${episodeNumber}`,
        importedFilePath: filePath,
      });

      jobRunner.enqueue(job);
      queuedJobIds.push(job.id);
    }

    console.log(
      `Queued Sonarr Download webhook for ${title} (TMDB: ${tmdbId}) - ${queuedJobIds.length} episode job(s), downloadId=${payload.downloadId || 'n/a'}`
    );

    return new Response(JSON.stringify({ success: true, message: 'Webhook queued', jobIds: queuedJobIds }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error handling Sonarr webhook:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
