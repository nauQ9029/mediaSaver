import { apiClient } from '../api/client';
import { getAccessToken } from '../lib/api';

export class MultipartUploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'MultipartUploadCancelledError';
  }
}

type MultipartSession = { key: string; uploadId: string };
const activeMultipartSessions = new Map<symbol, MultipartSession>();

export const abortActiveMultipartUploads = async () => {
  const sessions = [...activeMultipartSessions.values()];
  const results = await Promise.allSettled(
    sessions.map(({ key, uploadId }) =>
      apiClient.post('/upload/r2/multipart/abort', { key, uploadId }),
    ),
  );
  results.forEach((result) => {
    if (result.status === 'rejected') {
      console.error('Failed to abort multipart upload before logout:', result.reason);
    }
  });
};

export const abortActiveMultipartUploadsOnPageHide = () => {
  const token = getAccessToken();
  if (!token) return;
  const baseUrl = apiClient.defaults.baseURL || window.location.origin;
  for (const { key, uploadId } of activeMultipartSessions.values()) {
    void fetch(`${baseUrl.replace(/\/$/, '')}/upload/r2/multipart/abort`, {
      method: 'POST',
      keepalive: true,
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ key, uploadId }),
    }).catch((error) => console.error('Page-exit multipart abort failed:', error));
  }
};

interface ChunkedUploadOptions {
  file: File;
  onProgress?: (progress: number) => void;
  maxRetries?: number;
  signal?: AbortSignal;
  onSession?: (session: MultipartSession | null) => void;
}

const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

export const uploadLargeFileInChunks = async ({
  file,
  onProgress,
  maxRetries = 3,
  signal,
  onSession,
}: ChunkedUploadOptions) => {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  if (file.size <= CHUNK_SIZE || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Multipart uploads must be between 10 MB and 50 GB.');
  }
  const storageKey = `upload_session_${file.name}_${file.size}_${file.lastModified}_${file.type}`;

  let uploadId = '';
  let key = '';
  let completedParts: { PartNumber: number; ETag: string }[] = [];
  const sessionToken = Symbol('multipart-upload');
  let activeSession: MultipartSession | null = null;
  const activeRequests = new Set<XMLHttpRequest>();
  let cancelled = false;
  const cancel = () => {
    cancelled = true;
    activeRequests.forEach((xhr) => xhr.abort());
  };
  const throwIfCancelled = () => {
    if (cancelled || signal?.aborted) throw new MultipartUploadCancelledError();
  };
  signal?.addEventListener('abort', cancel, { once: true });
  const setSession = (session: MultipartSession | null) => {
    activeSession = session;
    if (session) activeMultipartSessions.set(sessionToken, session);
    else activeMultipartSessions.delete(sessionToken);
    onSession?.(session);
  };

  try {
  throwIfCancelled();
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
        setSession({ key, uploadId });
        completedParts = verifyRes.data.data.parts || [];
      }
    } catch {
        if (cancelled || signal?.aborted) throw new MultipartUploadCancelledError();
      localStorage.removeItem(storageKey);
      uploadId = '';
      key = '';
      completedParts = [];
    }
  }

  // Initiate session if no valid remote upload session exists
  if (!uploadId || !key) {
    throwIfCancelled();
    const initRes = await apiClient.post('/upload/r2/multipart/initiate', {
      fileName: file.name,
      fileType: file.type,
      fileSize: file.size,
    });
    uploadId = initRes.data.data.uploadId;
    key = initRes.data.data.key;
    setSession({ key, uploadId });
    throwIfCancelled();

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
    throwIfCancelled();
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
    throwIfCancelled();

    let attempt = 0;
    let etag = '';
    while (attempt < maxRetries) {
      try {
        etag = await new Promise<string>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          activeRequests.add(xhr);
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
            activeRequests.delete(xhr);
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

          xhr.onerror = () => {
            activeRequests.delete(xhr);
            reject(new Error(`Network error on part ${partNumber}`));
          };
          xhr.onabort = () => {
            activeRequests.delete(xhr);
            reject(new MultipartUploadCancelledError());
          };
          xhr.send(chunk);
        });

        break;
      } catch (err) {
        if (cancelled || signal?.aborted || err instanceof MultipartUploadCancelledError) {
          throw new MultipartUploadCancelledError();
        }
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
  throwIfCancelled();
  const completeRes = await apiClient.post('/upload/r2/multipart/complete', {
    key,
    uploadId,
    parts: completedParts,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
  });

  localStorage.removeItem(storageKey);
  setSession(null);
  return completeRes.data.data;
  } finally {
    signal?.removeEventListener('abort', cancel);
    activeRequests.forEach((xhr) => xhr.abort());
    activeRequests.clear();
    if (!activeSession) activeMultipartSessions.delete(sessionToken);
  }
};
