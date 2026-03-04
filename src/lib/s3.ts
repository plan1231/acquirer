import { Upload } from '@aws-sdk/lib-storage';
import { S3Client } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import path from 'node:path';
import { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT_URL } from "astro:env/server";

const MULTIPART_PART_SIZE_BYTES = 128 * 1024 * 1024;

const client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  endpoint: S3_ENDPOINT_URL,
  maxAttempts: 8,
});

export interface UploadResult {
  success: boolean;
  error?: string;
}

export interface UploadProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
}

export interface UploadFileOptions {
  onProgress?: (progress: UploadProgress) => void;
}

export async function uploadFile(
  filePath: string,
  s3Key: string,
  options?: UploadFileOptions
): Promise<UploadResult> {
  let totalBytes: number;
  try {
    totalBytes = (await statFile(filePath)).size;
  } catch (error) {
    const errorCode =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code ?? '')
        : '';
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorCode === 'ENOENT') {
      return { success: false, error: `File not found: ${filePath}` };
    }
    return { success: false, error: `Failed to read file metadata for ${filePath}: ${errorMsg}` };
  }

  const fileStream = createReadStream(filePath);

  try {
    const upload = new Upload({
      client,
      params: {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: fileStream,
        ContentLength: totalBytes,
      },
      partSize: MULTIPART_PART_SIZE_BYTES,
      leavePartsOnError: false,
      
    });

    options?.onProgress?.({ loadedBytes: 0, totalBytes, percent: totalBytes === 0 ? 100 : 0 });

    upload.on('httpUploadProgress', (progress) => {
      const loadedRaw = typeof progress.loaded === 'number' && Number.isFinite(progress.loaded) ? progress.loaded : 0;
      const totalRaw = typeof progress.total === 'number' && Number.isFinite(progress.total) ? progress.total : totalBytes;
      const loadedBytes = Math.min(totalRaw, Math.max(0, loadedRaw));
      const percent = totalRaw === 0 ? 100 : Math.min(100, (loadedBytes / totalRaw) * 100);

      options?.onProgress?.({
        loadedBytes,
        totalBytes: totalRaw,
        percent,
      });
    });

    await upload.done();
    options?.onProgress?.({ loadedBytes: totalBytes, totalBytes, percent: 100 });
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`Failed to upload ${filePath}: ${errorMsg}`);
    return { success: false, error: errorMsg };
  } finally {
    fileStream.destroy();
  }
}

export function generateMovieS3Key(tmdbid: number, filename: string): string {
  const ext = path.extname(filename);
  return `${tmdbid}${ext}`;
}

export function generateEpisodeS3Key(
  tmdbid: number,
  seasonNumber: number,
  episodeNumber: number,
  filename: string
): string {
  const ext = path.extname(filename);
  const season = String(seasonNumber).padStart(2, '0');
  const episode = String(episodeNumber).padStart(2, '0');
  return `${tmdbid}/S${season}/E${episode}${ext}`;
}

export { client };
