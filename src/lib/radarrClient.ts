interface RadarrMovie {
  tmdbId?: number;
  title?: string;
  hasFile?: boolean;
  movieFileId?: number;
  movieFile?: {
    path?: string;
  };
}

interface RadarrMovieFile {
  id: number;
  path?: string;
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
    const [movieList, movieFiles] = await Promise.all([
      this.fetchJson<RadarrMovie[]>('/movie'),
      this.fetchJson<RadarrMovieFile[]>('/moviefile'),
    ]);

    const filePathById = new Map<number, string>();
    for (const file of movieFiles) {
      if (isNonEmptyString(file.path)) {
        filePathById.set(file.id, file.path);
      }
    }

    const downloadedMovies: DownloadedMovie[] = [];
    for (const movie of movieList) {
      if (!movie.hasFile || typeof movie.tmdbId !== 'number') {
        continue;
      }

      const filePath =
        (isNonEmptyString(movie.movieFile?.path) && movie.movieFile.path) ||
        (typeof movie.movieFileId === 'number' ? filePathById.get(movie.movieFileId) : undefined);

      if (!isNonEmptyString(filePath)) {
        continue;
      }

      downloadedMovies.push({
        tmdbid: movie.tmdbId,
        title: isNonEmptyString(movie.title) ? movie.title : `tmdb:${movie.tmdbId}`,
        filePath,
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
