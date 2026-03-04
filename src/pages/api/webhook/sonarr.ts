import type { APIRoute } from 'astro';
import { db } from '@/db';
import { series, seasons, episodes, uploadLogs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { uploadFile, generateS3Key } from '@/lib/s3';

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
    const fileSize = payload.episodeFile.size;

    // Get or create series
    let existingSeries = await db
      .select()
      .from(series)
      .where(eq(series.tmdbid, tmdbId))
      .then((rows) => rows[0]);

    let seriesTmdbid: number;

    if (!existingSeries) {
      await db.insert(series).values({
        tmdbid: tmdbId,
        title,
      });
      seriesTmdbid = tmdbId;
    } else {
      seriesTmdbid = existingSeries.tmdbid;
    }

    const insertedEpisodeIds: number[] = [];

    // Group episodes by season so we can create/reuse seasons efficiently.
    const seasonEpsMap = new Map<number, SonarrEpisode[]>();

    for (const ep of payload.episodes) {
      const seasonNum = ep.seasonNumber || 1;
      if (!seasonEpsMap.has(seasonNum)) {
        seasonEpsMap.set(seasonNum, []);
      }
      seasonEpsMap.get(seasonNum)!.push(ep);
    }

    for (const [seasonNum, seasonEpisodes] of seasonEpsMap) {
      let existingSeason = await db
        .select()
        .from(seasons)
        .where(and(eq(seasons.seriesTmdbid, seriesTmdbid), eq(seasons.seasonNumber, seasonNum)))
        .then((rows) => rows[0]);

      let seasonId: number;

      if (!existingSeason) {
        const [insertedSeason] = await db
          .insert(seasons)
          .values({
            seriesTmdbid,
            seasonNumber: seasonNum,
          })
          .returning({ id: seasons.id });
        seasonId = insertedSeason.id;
      } else {
        seasonId = existingSeason.id;
      }

      for (const ep of seasonEpisodes) {
        const episodeNumber = ep.episodeNumber || 1;

        // Idempotency: skip creating a duplicate row for the same imported file+episode.
        const existingEpisode = await db
          .select()
          .from(episodes)
          .where(
            and(
              eq(episodes.seasonId, seasonId),
              eq(episodes.episodeNumber, episodeNumber),
              eq(episodes.filePath, filePath)
            )
          )
          .then((rows) => rows[0]);

        if (existingEpisode) {
          insertedEpisodeIds.push(existingEpisode.id);
          continue;
        }

        const [insertedEpisode] = await db
          .insert(episodes)
          .values({
            seasonId,
            episodeNumber,
            title: ep.title || '',
            filePath,
            fileSize,
            uploadStatus: 'uploading',
          })
          .returning({ id: episodes.id });

        insertedEpisodeIds.push(insertedEpisode.id);
      }
    }

    const filename = filePath.split('/').pop() || 'video';
    const s3Key = generateS3Key('episode', tmdbId, filename);
    const uploadResult = await uploadFile(filePath, s3Key);

    for (const episodeId of insertedEpisodeIds) {
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
        s3Bucket: process.env.S3_BUCKET || '',
        status: uploadResult.success ? 'uploaded' : 'failed',
        errorMessage: uploadResult.error || null,
      });
    }

    console.log(
      `Processed Sonarr Download webhook for ${title} (TMDB: ${tmdbId}) - ${insertedEpisodeIds.length} episode(s), downloadId=${payload.downloadId || 'n/a'}`
    );

    return new Response(JSON.stringify({ success: true, message: 'Webhook processed' }), {
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
