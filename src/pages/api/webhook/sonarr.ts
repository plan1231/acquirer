import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { series, seasons, episodes, uploadLogs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { uploadFile, generateS3Key } from '@/lib/s3';

// Types for Sonarr webhook payload
interface SonarrEpisodeFile {
  path: string;
  size: number;
}

interface SonarrSeries {
  tvdbId: number;
  title: string;
  firstAirDate?: string;
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
  seasonNumber?: number;
  episodeNumber?: number;
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const db = getDb();
    const payload: SonarrPayload = await request.json();
    console.log(`Received Sonarr webhook: ${payload.eventType}`);

    // Only handle import events
    if (!['OnImport', 'OnDownload'].includes(payload.eventType)) {
      return new Response(
        JSON.stringify({
          success: true,
          message: `Ignored event type: ${payload.eventType}`,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!payload.series || !payload.episodeFile) {
      return new Response(
        JSON.stringify({ success: false, error: 'Missing series or episode file data' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const tvdbId = payload.series.tvdbId;
    const title = payload.series.title;
    const filePath = payload.episodeFile.path;
    const fileSize = payload.episodeFile.size;

    // Get or create series
    let existingSeries = await db
      .select()
      .from(series)
      .where(eq(series.tvdbId, tvdbId))
      .then((rows) => rows[0]);

    let seriesId: number;

    if (!existingSeries) {
      const firstAirYear = payload.series.firstAirDate
        ? parseInt(payload.series.firstAirDate.slice(0, 4))
        : null;

      const result = await db.insert(series).values({
        tvdbId,
        title,
        firstAirYear,
      });
      seriesId = Number(result.lastInsertRowid);
    } else {
      seriesId = existingSeries.id;
    }

    // Process episodes
    if (payload.episodes && payload.episodes.length > 0) {
      // Bulk import - handle multiple episodes
      const seasonEpsMap = new Map<number, SonarrEpisode[]>();

      for (const ep of payload.episodes) {
        const seasonNum = ep.seasonNumber || 1;
        if (!seasonEpsMap.has(seasonNum)) {
          seasonEpsMap.set(seasonNum, []);
        }
        seasonEpsMap.get(seasonNum)!.push(ep);
      }

      for (const [seasonNum, eps] of seasonEpsMap) {
        // Get or create season
        let existingSeason = await db
          .select()
          .from(seasons)
          .where(and(eq(seasons.seriesId, seriesId), eq(seasons.seasonNumber, seasonNum)))
          .then((rows) => rows[0]);

        let seasonId: number;

        if (!existingSeason) {
          const result = await db.insert(seasons).values({
            seriesId,
            seasonNumber: seasonNum,
          });
          seasonId = Number(result.lastInsertRowid);
        } else {
          seasonId = existingSeason.id;
        }

        // Create episode records
        for (const ep of eps) {
          await db.insert(episodes).values({
            seasonId,
            episodeNumber: ep.episodeNumber || 1,
            title: ep.title || '',
            filePath,
            fileSize,
            uploadStatus: 'uploading',
          });
        }
      }

      console.log(`Processed ${payload.episodes.length} episodes for series ${title} (TVDB: ${tvdbId})`);
    } else {
      // Single episode
      const seasonNum = payload.seasonNumber || 1;
      const episodeNum = payload.episodeNumber || 1;

      // Get or create season
      let existingSeason = await db
        .select()
        .from(seasons)
        .where(and(eq(seasons.seriesId, seriesId), eq(seasons.seasonNumber, seasonNum)))
        .then((rows) => rows[0]);

      let seasonId: number;

      if (!existingSeason) {
        const result = await db.insert(seasons).values({
          seriesId,
          seasonNumber: seasonNum,
        });
        seasonId = Number(result.lastInsertRowid);
      } else {
        seasonId = existingSeason.id;
      }

      // Create episode record
      const result = await db.insert(episodes).values({
        seasonId,
        episodeNumber: episodeNum,
        title: '',
        filePath,
        fileSize,
        uploadStatus: 'uploading',
      });

      const episodeId = Number(result.lastInsertRowid);

      // Trigger upload
      const filename = filePath.split('/').pop() || 'video';
      const s3Key = generateS3Key('episode', tvdbId, filename);

      // Perform upload
      const uploadResult = await uploadFile(filePath, s3Key);

      // Update episode status
      await db
        .update(episodes)
        .set({
          uploadStatus: uploadResult.success ? 'uploaded' : 'failed',
          s3Key: uploadResult.success ? s3Key : null,
          uploadedAt: uploadResult.success ? new Date() : null,
          errorMessage: uploadResult.error || null,
        })
        .where(eq(episodes.id, episodeId));

      // Log the upload
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

      console.log(`Processed single episode ${title} S${seasonNum}E${episodeNum} (TVDB: ${tvdbId})`);
    }

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
