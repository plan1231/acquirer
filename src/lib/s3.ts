import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT_URL } from "astro:env/server";


const UPLOAD_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 10_000;

const client = new S3Client({
  region: S3_REGION,
  credentials: {
    accessKeyId: S3_ACCESS_KEY,
    secretAccessKey: S3_SECRET_KEY,
  },
  endpoint: S3_ENDPOINT_URL,
  maxAttempts: 3,
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(retryCount: number): number {
  const cappedBackoff = Math.min(RETRY_MAX_DELAY_MS, RETRY_BASE_DELAY_MS * 2 ** (retryCount - 1));
  const jitter = Math.floor(Math.random() * Math.max(1, Math.floor(cappedBackoff * 0.2)));
  return cappedBackoff + jitter;
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

  let lastErrorMsg = '';
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    let fileStream: ReturnType<typeof createReadStream> | null = null;
    try {
      fileStream = createReadStream(filePath);
      let loadedBytes = 0;

      const command = new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body:
          options?.onProgress
            ? fileStream.pipe(
                new Transform({
                  transform(chunk, _encoding, callback) {
                    const chunkLength = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
                    loadedBytes += chunkLength;
                    options.onProgress?.({
                      loadedBytes,
                      totalBytes,
                      percent: totalBytes === 0 ? 100 : Math.min(100, (loadedBytes / totalBytes) * 100),
                    });
                    callback(null, chunk);
                  },
                })
              )
            : fileStream,
        ContentLength: totalBytes,
      });

      if (options?.onProgress) {
        options.onProgress({ loadedBytes: 0, totalBytes, percent: totalBytes === 0 ? 100 : 0 });
      }

      await client.send(command);
      if (options?.onProgress) {
        options.onProgress({ loadedBytes: totalBytes, totalBytes, percent: 100 });
      }
      console.log(
        attempt === 1
          ? `Successfully uploaded ${filePath} to s3://${S3_BUCKET}/${s3Key}`
          : `Successfully uploaded ${filePath} to s3://${S3_BUCKET}/${s3Key} after ${attempt} attempts`
      );
      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastErrorMsg = errorMsg;
      const hasRemainingAttempts = attempt < UPLOAD_MAX_ATTEMPTS;

      if (!hasRemainingAttempts) {
        console.error(`Failed to upload ${filePath}: ${errorMsg}`);
        return { success: false, error: errorMsg };
      }

      const retryDelay = getRetryDelayMs(attempt);
      console.warn(
        `Upload attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS} failed for ${filePath}: ${errorMsg}. Retrying in ${retryDelay}ms...`
      );
      await sleep(retryDelay);
    } finally {
      fileStream?.destroy();
    }
  }

  console.error(`Failed to upload ${filePath}: ${lastErrorMsg}`);
  return { success: false, error: lastErrorMsg || 'Unknown upload error' };
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

export async function checkFileExists(s3Key: string): Promise<boolean> {
  try {
    const command = new HeadObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    });
    await client.send(command);
    return true;
  } catch {
    return false;
  }
}

export { client };
