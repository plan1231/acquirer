import type { APIRoute } from 'astro';
import { getDb } from '@/db';
import { movies, episodes, seasons, series } from '@/db/schema';
import { desc, eq } from 'drizzle-orm';

export const GET: APIRoute = async () => {
  try {
    const db = getDb();

    // Get recent movies
    const recentMovies = await db
      .select({
        id: movies.id,
        title: movies.title,
        filePath: movies.filePath,
        fileSize: movies.fileSize,
        s3Key: movies.s3Key,
        uploadStatus: movies.uploadStatus,
        errorMessage: movies.errorMessage,
        uploadedAt: movies.uploadedAt,
        createdAt: movies.createdAt,
      })
      .from(movies)
      .orderBy(desc(movies.createdAt))
      .limit(10);

    // Get recent episodes with series and season info
    const recentEpisodes = await db
      .select({
        id: episodes.id,
        title: episodes.title,
        episodeNumber: episodes.episodeNumber,
        seasonNumber: seasons.seasonNumber,
        seriesTitle: series.title,
        filePath: episodes.filePath,
        fileSize: episodes.fileSize,
        s3Key: episodes.s3Key,
        uploadStatus: episodes.uploadStatus,
        errorMessage: episodes.errorMessage,
        uploadedAt: episodes.uploadedAt,
        createdAt: episodes.createdAt,
      })
      .from(episodes)
      .innerJoin(seasons, eq(episodes.seasonId, seasons.id))
      .innerJoin(series, eq(seasons.seriesId, series.id))
      .orderBy(desc(episodes.createdAt))
      .limit(10);

    // Format episodes response
    const formattedEpisodes = recentEpisodes.map((ep) => ({
      id: ep.id,
      title: ep.title || `S${ep.seasonNumber}E${ep.episodeNumber}`,
      file_path: ep.filePath,
      file_size: ep.fileSize,
      s3_key: ep.s3Key,
      upload_status: ep.uploadStatus,
      error_message: ep.errorMessage,
      uploaded_at: ep.uploadedAt,
      created_at: ep.createdAt,
    }));

    return new Response(
      JSON.stringify({
        movies: recentMovies.map((m) => ({
          id: m.id,
          title: m.title,
          file_path: m.filePath,
          file_size: m.fileSize,
          s3_key: m.s3Key,
          upload_status: m.uploadStatus,
          error_message: m.errorMessage,
          uploaded_at: m.uploadedAt,
          created_at: m.createdAt,
        })),
        episodes: formattedEpisodes,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );
  } catch (error) {
    console.error('Error getting upload status:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
