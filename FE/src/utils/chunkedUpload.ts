import { apiClient } from '../api/client';

interface ChunkedUploadOptions {
  file: File;
  onProgress?: (progress: number) => void;
  maxRetries?: number;
}

const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

export const uploadLargeFileInChunks = async ({
  file,
  onProgress,
  maxRetries = 3,
}: ChunkedUploadOptions) => {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  if (file.size <= CHUNK_SIZE || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Multipart uploads must be between 10 MB and 50 GB.');
  }
  const storageKey = `upload_session_${file.name}_${file.size}_${file.lastModified}_${file.type}`;

  let uploadId = '';
  let key = '';
  let completedParts: { PartNumber: number; ETag: string }[] = [];

  // Check local session and verify against R2 remote state
  const savedSession = localStorage.getItem(storageKey);
  if (savedSession) {
    try {
      const parsed = JSON.parse(savedSession);
      const cachedKey = parsed.key || '';
      const cachedUploadId = parsed.uploadId || '';

      if (cachedKey && cachedUploadId) {
        // Query backend for existing parts on Cloudflare R2
        const verifyRes = await apiClient.get('/upload/r2/multipart/parts', {
          params: { key: cachedKey, uploadId: cachedUploadId },
        });

        uploadId = cachedUploadId;
        key = cachedKey;
        completedParts = verifyRes.data.data.parts || [];
      }
    } catch {
      localStorage.removeItem(storageKey);
      uploadId = '';
      key = '';
      completedParts = [];
    }
  }

  // Initiate session if no valid remote upload session exists
  if (!uploadId || !key) {
    const initRes = await apiClient.post('/upload/r2/multipart/initiate', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    uploadId = initRes.data.data.uploadId;
    key = initRes.data.data.key;

    localStorage.setItem(
      storageKey,
      JSON.stringify({ uploadId, key })
    );
  }

  const completedPartNumbers = new Set(completedParts.map((p) => p.PartNumber));
  let totalUploadedBytes = completedParts.reduce((total, part) => {
    const index = part.PartNumber - 1;
    return total + Math.max(0, Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE));
  }, 0);

  // Sequential part upload with retries
  for (let index = 0; index < totalChunks; index++) {
    const partNumber = index + 1;
    if (completedPartNumbers.has(partNumber)) continue;

    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);

    const partRes = await apiClient.post('/upload/r2/multipart/presign-part', {
      key,
      uploadId,
      partNumber,
    });
    const { presignedUrl } = partRes.data.data;

    let attempt = 0;
    let etag = '';
    while (attempt < maxRetries) {
      try {
        etag = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', presignedUrl, true);
          xhr.setRequestHeader(
            'Content-Type',
            file.type || 'application/octet-stream'
          );

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
              const currentProgress = Math.min(
                100,
                Math.round(((totalUploadedBytes + e.loaded) / file.size) * 100)
              );
              onProgress(currentProgress);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200 || xhr.status === 204) {
              const etagHeader = xhr.getResponseHeader('ETag');
              if (!etagHeader) {
                return reject(new Error(`Missing ETag on part ${partNumber}`));
              }
              resolve(etagHeader.replace(/"/g, ''));
            } else {
              reject(new Error(`HTTP ${xhr.status} on part ${partNumber}`));
            }
          };

          xhr.onerror = () => reject(new Error(`Network error on part ${partNumber}`));
          xhr.send(chunk);
        });

        break;
      } catch (err) {
        attempt++;
        if (attempt >= maxRetries) throw err;
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }

    totalUploadedBytes += chunk.size;
    completedParts = completedParts.filter((part) => part.PartNumber !== partNumber);
    completedParts.push({ PartNumber: partNumber, ETag: etag });
    completedParts.sort((a, b) => a.PartNumber - b.PartNumber);
    localStorage.setItem(storageKey, JSON.stringify({ uploadId, key }));
  }

  // Finalize upload
  const completeRes = await apiClient.post('/upload/r2/multipart/complete', {
    key,
    uploadId,
    parts: completedParts,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });

  localStorage.removeItem(storageKey);
  return completeRes.data.data;
};
