import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
} from '@aws-sdk/client-s3';
import { createReadStream } from 'node:fs';
import { stat as statFile } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { S3_BUCKET, S3_REGION, S3_ACCESS_KEY, S3_SECRET_KEY, S3_ENDPOINT_URL } from "astro:env/server";


const UPLOAD_MAX_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 10_000;
const MULTIPART_THRESHOLD_BYTES = 500 * 1024 * 1024;
const MULTIPART_PART_SIZE_BYTES = 500 * 1024 * 1024;

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

function createProgressTrackingStream(
  sourceStream: ReturnType<typeof createReadStream>,
  totalBytes: number,
  completedBytes: number,
  options?: UploadFileOptions
) {
  let currentChunkBytes = 0;
  return sourceStream.pipe(
    new Transform({
      transform(chunk, _encoding, callback) {
        const chunkLength = Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
        currentChunkBytes += chunkLength;
        const loadedBytes = Math.min(totalBytes, completedBytes + currentChunkBytes);
        options?.onProgress?.({
          loadedBytes,
          totalBytes,
          percent: totalBytes === 0 ? 100 : Math.min(100, (loadedBytes / totalBytes) * 100),
        });
        callback(null, chunk);
      },
    })
  );
}

async function uploadWithPutObject(
  filePath: string,
  s3Key: string,
  totalBytes: number,
  options?: UploadFileOptions
): Promise<void> {
  let fileStream: ReturnType<typeof createReadStream> | null = null;
  try {
    fileStream = createReadStream(filePath);
    const body = options?.onProgress
      ? createProgressTrackingStream(fileStream, totalBytes, 0, options)
      : fileStream;

    await client.send(
      new PutObjectCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: body,
        ContentLength: totalBytes,
      })
    );
  } finally {
    fileStream?.destroy();
  }
}

async function uploadPartWithRetry(
  filePath: string,
  s3Key: string,
  uploadId: string,
  partNumber: number,
  start: number,
  end: number,
  totalBytes: number,
  completedBytes: number,
  options?: UploadFileOptions
): Promise<string> {
  const partSize = end - start + 1;
  let lastErrorMsg = '';

  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    let fileStream: ReturnType<typeof createReadStream> | null = null;
    try {
      fileStream = createReadStream(filePath, { start, end });
      const body = options?.onProgress
        ? createProgressTrackingStream(fileStream, totalBytes, completedBytes, options)
        : fileStream;

      const uploadPartResult = await client.send(
        new UploadPartCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: body,
          ContentLength: partSize,
        })
      );

      if (!uploadPartResult.ETag) {
        throw new Error(`S3 did not return an ETag for part ${partNumber}`);
      }

      return uploadPartResult.ETag;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      lastErrorMsg = errorMsg;
      const hasRemainingAttempts = attempt < UPLOAD_MAX_ATTEMPTS;

      if (!hasRemainingAttempts) {
        throw new Error(`Part ${partNumber} failed after ${UPLOAD_MAX_ATTEMPTS} attempts: ${errorMsg}`);
      }

      const retryDelay = getRetryDelayMs(attempt);
      console.warn(
        `Multipart part ${partNumber} attempt ${attempt}/${UPLOAD_MAX_ATTEMPTS} failed: ${errorMsg}. Retrying in ${retryDelay}ms...`
      );
      await sleep(retryDelay);
    } finally {
      fileStream?.destroy();
    }
  }

  throw new Error(`Part ${partNumber} failed: ${lastErrorMsg || 'Unknown upload error'}`);
}

async function uploadWithMultipart(
  filePath: string,
  s3Key: string,
  totalBytes: number,
  options?: UploadFileOptions
): Promise<void> {
  const createResult = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    })
  );

  if (!createResult.UploadId) {
    throw new Error('Failed to start multipart upload: missing upload ID');
  }

  const uploadId = createResult.UploadId;
  let completedBytes = 0;
  const parts: Array<{ ETag: string; PartNumber: number }> = [];
  const totalParts = Math.ceil(totalBytes / MULTIPART_PART_SIZE_BYTES);

  try {
    for (let partNumber = 1; partNumber <= totalParts; partNumber += 1) {
      const start = (partNumber - 1) * MULTIPART_PART_SIZE_BYTES;
      const end = Math.min(totalBytes - 1, start + MULTIPART_PART_SIZE_BYTES - 1);
      const partSize = end - start + 1;

      const etag = await uploadPartWithRetry(
        filePath,
        s3Key,
        uploadId,
        partNumber,
        start,
        end,
        totalBytes,
        completedBytes,
        options
      );

      parts.push({ ETag: etag, PartNumber: partNumber });
      completedBytes += partSize;
      options?.onProgress?.({
        loadedBytes: Math.min(totalBytes, completedBytes),
        totalBytes,
        percent: totalBytes === 0 ? 100 : Math.min(100, (completedBytes / totalBytes) * 100),
      });
    }

    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: S3_BUCKET,
        Key: s3Key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts,
        },
      })
    );
  } catch (error) {
    try {
      await client.send(
        new AbortMultipartUploadCommand({
          Bucket: S3_BUCKET,
          Key: s3Key,
          UploadId: uploadId,
        })
      );
    } catch (abortError) {
      const abortMsg = abortError instanceof Error ? abortError.message : String(abortError);
      console.warn(`Failed to abort multipart upload for ${filePath}: ${abortMsg}`);
    }
    throw error;
  }
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

  if (options?.onProgress) {
    options.onProgress({ loadedBytes: 0, totalBytes, percent: totalBytes === 0 ? 100 : 0 });
  }

  const shouldUseMultipart = totalBytes > MULTIPART_THRESHOLD_BYTES;
  let lastErrorMsg = '';
  for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    try {
      if (shouldUseMultipart) {
        await uploadWithMultipart(filePath, s3Key, totalBytes, options);
      } else {
        await uploadWithPutObject(filePath, s3Key, totalBytes, options);
      }

      if (options?.onProgress) {
        options.onProgress({ loadedBytes: totalBytes, totalBytes, percent: 100 });
      }
      console.log(
        attempt === 1
          ? `Successfully uploaded ${filePath} to s3://${S3_BUCKET}/${s3Key}${shouldUseMultipart ? ' (multipart)' : ''}`
          : `Successfully uploaded ${filePath} to s3://${S3_BUCKET}/${s3Key} after ${attempt} attempts${shouldUseMultipart ? ' (multipart)' : ''}`
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
