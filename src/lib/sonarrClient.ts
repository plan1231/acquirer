interface SonarrSeries {
  id: number;
  tmdbId?: number;
  title?: string;
}

interface SonarrEpisode {
  seriesId: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  hasFile?: boolean;
  episodeFileId?: number;
  episodeFile?: {
    path?: string;
  };
}

interface SonarrEpisodeFile {
  id: number;
  path?: string;
}

export interface DownloadedEpisode {
  tmdbid: number;
  showTitle: string;
  seasonNumber: number;
  episodeNumber: number;
  episodeTitle: string;
  filePath: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class SonarrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    if (!baseUrl.trim()) {
      throw new Error('SONARR_URL is required');
    }

    if (!apiKey.trim()) {
      throw new Error('SONARR_API_KEY is required');
    }

    this.baseUrl = this.normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
  }

  async getDownloadedEpisodes(): Promise<DownloadedEpisode[]> {
    const seriesList = await this.fetchJson<SonarrSeries[]>('/series');
    const episodeList = await this.fetchEpisodesForSeries(seriesList);

    const episodeFileIdsToFetch = new Set<number>();
    for (const episode of episodeList) {
      if (!episode.hasFile) {
        continue;
      }

      const hasEmbeddedPath = isNonEmptyString(episode.episodeFile?.path);
      if (!hasEmbeddedPath && typeof episode.episodeFileId === 'number') {
        episodeFileIdsToFetch.add(episode.episodeFileId);
      }
    }

    const episodeFiles = await this.fetchEpisodeFilesByIds([...episodeFileIdsToFetch]);

    const seriesById = new Map<number, SonarrSeries>();
    for (const entry of seriesList) {
      seriesById.set(entry.id, entry);
    }

    const filePathById = new Map<number, string>();
    for (const file of episodeFiles) {
      if (isNonEmptyString(file.path)) {
        filePathById.set(file.id, file.path);
      }
    }

    const downloadedEpisodes: DownloadedEpisode[] = [];
    for (const episode of episodeList) {
      if (!episode.hasFile) {
        continue;
      }

      const series = seriesById.get(episode.seriesId);
      if (!series || typeof series.tmdbId !== 'number') {
        continue;
      }

      const filePath =
        (isNonEmptyString(episode.episodeFile?.path) && episode.episodeFile.path) ||
        (typeof episode.episodeFileId === 'number' ? filePathById.get(episode.episodeFileId) : undefined);

      if (!isNonEmptyString(filePath)) {
        continue;
      }

      if (typeof episode.seasonNumber !== 'number' || typeof episode.episodeNumber !== 'number') {
        continue;
      }

      downloadedEpisodes.push({
        tmdbid: series.tmdbId,
        showTitle: isNonEmptyString(series.title) ? series.title : `tmdb:${series.tmdbId}`,
        seasonNumber: episode.seasonNumber,
        episodeNumber: episode.episodeNumber,
        episodeTitle: isNonEmptyString(episode.title)
          ? episode.title
          : `S${episode.seasonNumber}E${episode.episodeNumber}`,
        filePath,
      });
    }

    return downloadedEpisodes;
  }

  private async fetchEpisodesForSeries(seriesList: SonarrSeries[]): Promise<SonarrEpisode[]> {
    const seriesIds = seriesList
      .map((series) => series.id)
      .filter((id): id is number => typeof id === 'number');

    if (seriesIds.length === 0) {
      return [];
    }

    const batchSize = 10;
    const episodes: SonarrEpisode[] = [];

    for (let i = 0; i < seriesIds.length; i += batchSize) {
      const batchSeriesIds = seriesIds.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batchSeriesIds.map((seriesId) =>
          this.fetchJson<SonarrEpisode[]>(`/episode?seriesId=${seriesId}&includeEpisodeFile=true`)
        )
      );

      for (const seriesEpisodes of batchResults) {
        episodes.push(...seriesEpisodes);
      }
    }

    return episodes;
  }

  private async fetchEpisodeFilesByIds(episodeFileIds: number[]): Promise<SonarrEpisodeFile[]> {
    if (episodeFileIds.length === 0) {
      return [];
    }

    const chunkSize = 100;
    const episodeFiles: SonarrEpisodeFile[] = [];
    for (let i = 0; i < episodeFileIds.length; i += chunkSize) {
      const params = new URLSearchParams();
      for (const id of episodeFileIds.slice(i, i + chunkSize)) {
        params.append('episodeFileIds', String(id));
      }

      const filesChunk = await this.fetchJson<SonarrEpisodeFile[]>(`/episodefile?${params.toString()}`);
      episodeFiles.push(...filesChunk);
    }

    return episodeFiles;
  }

  private normalizeBaseUrl(url: string): string {
    const withoutTrailingSlash = url.replace(/\/+$/, '');
    if (withoutTrailingSlash.endsWith('/api/v3')) {
      return withoutTrailingSlash.slice(0, -'/api/v3'.length);
    }

    return withoutTrailingSlash;
  }

  private buildApiUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    return `${this.baseUrl}/api/v3${normalizedPath}`;
  }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = this.buildApiUrl(path);
    const response = await fetch(url, {
      headers: {
        'X-Api-Key': this.apiKey,
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Sonarr API request failed (${response.status} ${response.statusText}) at ${url}: ${body}`);
    }

    return (await response.json()) as T;
  }
}
