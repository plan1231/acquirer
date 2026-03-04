interface RadarrMovie {
  tmdbId?: number;
  title?: string;
  movieFileId?: number;
  movieFile?: {
    path?: string;
  };
}

export interface DownloadedMovie {
  tmdbid: number;
  title: string;
  filePath: string;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export class RadarrClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    if (!baseUrl.trim()) {
      throw new Error('RADARR_URL is required');
    }

    if (!apiKey.trim()) {
      throw new Error('RADARR_API_KEY is required');
    }

    this.baseUrl = this.normalizeBaseUrl(baseUrl);
    this.apiKey = apiKey;
  }

  async getDownloadedMovies(): Promise<DownloadedMovie[]> {
    const movieList = await this.fetchJson<RadarrMovie[]>('/movie');

    const downloadedMovies: DownloadedMovie[] = [];
    for (const movie of movieList) {
      if (typeof movie.tmdbId !== 'number') {
        continue;
      }

      if (typeof movie.movieFileId !== 'number' || movie.movieFileId <= 0) {
        continue;
      }

      if (!isNonEmptyString(movie.movieFile?.path)) {
        continue;
      }

      downloadedMovies.push({
        tmdbid: movie.tmdbId,
        title: isNonEmptyString(movie.title) ? movie.title : `tmdb:${movie.tmdbId}`,
        filePath: movie.movieFile.path,
      });
    }

    return downloadedMovies;
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
      throw new Error(`Radarr API request failed (${response.status} ${response.statusText}) at ${url}: ${body}`);
    }

    return (await response.json()) as T;
  }
}
