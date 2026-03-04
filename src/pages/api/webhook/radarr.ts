import type { APIRoute } from 'astro';
import { ProcessMovie, jobRunner } from '@/lib/jobs';

// Types for Radarr webhook payload
interface RadarrMovieFile {
  path: string;
  size: number;
}

interface RadarrMovie {
  tmdbId: number;
  title: string;
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
    const job = new ProcessMovie({
      tmdbid: tmdbId,
      title,
      importedFilePath: payload.movieFile.path,
    });
    jobRunner.enqueue(job);

    console.log(
      `Queued Radarr Download webhook for ${title} (TMDB: ${tmdbId}, jobId: ${job.id}, downloadId: ${payload.downloadId || 'n/a'})`
    );

    return new Response(JSON.stringify({ success: true, message: 'Webhook queued', jobId: job.id }), {
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
