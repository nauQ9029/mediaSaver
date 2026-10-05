import { apiClient } from '../api/client';

export class MultipartUploadCancelledError extends Error {
  constructor() {
    super('Upload cancelled.');
    this.name = 'MultipartUploadCancelledError';
  }
}

type MultipartSession = {
  key: string;
  uploadId: string;
};

type UploadedPart = {
  PartNumber: number;
  ETag: string;
};

interface ChunkedUploadOptions {
  file: File;
  onProgress?: (progress: number) => void;
  maxRetries?: number;
  signal?: AbortSignal;
  onSession?: (session: MultipartSession | null) => void;
}

class PartUploadError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'PartUploadError';
  }
}

const CHUNK_SIZE = 10 * 1024 * 1024;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024 * 1024;

const activeMultipartSessions = new Map<symbol, MultipartSession>();

const isCancelled = (
  signal?: AbortSignal,
  cancelled = false,
) => cancelled || Boolean(signal?.aborted);

const throwIfCancelled = (
  signal?: AbortSignal,
  cancelled = false,
) => {
  if (isCancelled(signal, cancelled)) {
    throw new MultipartUploadCancelledError();
  }
};

const sleep = (
  ms: number,
  signal?: AbortSignal,
  isLocallyCancelled?: () => boolean,
) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted || isLocallyCancelled?.()) {
      reject(new MultipartUploadCancelledError());
      return;
    }

    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, ms);

    const abort = () => {
      clearTimeout(timeout);
      reject(new MultipartUploadCancelledError());
    };

    signal?.addEventListener('abort', abort, { once: true });
  });

const getErrorStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object') return undefined;

  if ('status' in error && typeof error.status === 'number') {
    return error.status;
  }

  if ('response' in error && error.response && typeof error.response === 'object') {
    const response = error.response;

    if ('status' in response && typeof response.status === 'number') {
      return response.status;
    }
  }

  return undefined;
};

const isInvalidMultipartSession = (error: unknown) => {
  const status = getErrorStatus(error);
  return status === 404 || status === 409 || status === 410;
};

const isRetryableError = (error: unknown) => {
  const status = getErrorStatus(error);

  // Network errors have no HTTP status. A 403 may indicate an expired
  // presigned URL, so retry it with a newly generated URL.
  if (status === undefined) return true;

  return status === 403 ||
    status === 408 ||
    status === 429 ||
    status >= 500;
};

const getRemoteState = async (
  session: MultipartSession,
): Promise<{ parts: UploadedPart[]; completed?: boolean; session: { fileName: string; fileType: string; fileSize: number } }> => {
  const response = await apiClient.get('/upload/r2/multipart/parts', {
    params: {
      key: session.key,
      uploadId: session.uploadId,
    },
  });

  return response.data.data;
};

export const getSavedMultipartProgress = async (file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>) => {
  const storageKey = `upload_session_${file.name}_${file.size}_${file.lastModified}_${file.type}`;
  const savedSession = localStorage.getItem(storageKey);
  if (!savedSession) return null;

  let session: MultipartSession;
  try {
    session = JSON.parse(savedSession) as MultipartSession;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }

  if (!session.key || !session.uploadId) {
    localStorage.removeItem(storageKey);
    return null;
  }

  let remote;
  try {
    remote = await getRemoteState(session);
  } catch (error) {
    const status = getErrorStatus(error);
    if (status === 404 || status === 409 || status === 410) {
      localStorage.removeItem(storageKey);
      return null;
    }
    throw error;
  }

  if (
    remote.session.fileName !== file.name ||
    remote.session.fileType !== file.type ||
    remote.session.fileSize !== file.size
  ) {
    localStorage.removeItem(storageKey);
    return null;
  }
  if (remote.completed) return 100;

  const uploadedBytes = (remote.parts || []).reduce((total, part) => {
    const index = part.PartNumber - 1;
    if (!Number.isInteger(part.PartNumber) || index < 0) return total;
    return total + Math.max(0, Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE));
  }, 0);
  return Math.min(100, Math.floor((uploadedBytes / file.size) * 100));
};

export const abortSavedMultipartUpload = async (file: Pick<File, 'name' | 'size' | 'lastModified' | 'type'>) => {
  const storageKey = `upload_session_${file.name}_${file.size}_${file.lastModified}_${file.type}`;
  const savedSession = localStorage.getItem(storageKey);
  if (!savedSession) return;

  let session: MultipartSession;
  try {
    session = JSON.parse(savedSession) as MultipartSession;
  } catch {
    localStorage.removeItem(storageKey);
    return;
  }
  if (!session.key || !session.uploadId) {
    localStorage.removeItem(storageKey);
    return;
  }

  try {
    await apiClient.post('/upload/r2/multipart/abort', session);
  } catch (error) {
    const status = getErrorStatus(error);
    if (status !== 404 && status !== 409 && status !== 410) throw error;
  }

  localStorage.removeItem(storageKey);
};

export const abortActiveMultipartUploads = async () => {
  const persistedSessions: MultipartSession[] = [];
  for (let index = 0; index < localStorage.length; index++) {
    const storageKey = localStorage.key(index);
    if (!storageKey?.startsWith('upload_session_')) continue;
    try {
      const storedSession = localStorage.getItem(storageKey);
      if (!storedSession) continue;

      const session = JSON.parse(storedSession);
      if (session.key && session.uploadId) persistedSessions.push(session);
    } catch {
      localStorage.removeItem(storageKey);
      index--;
    }
  }

  const sessions = [...activeMultipartSessions.entries()];
  const allSessions = new Map<string, MultipartSession>();
  sessions.forEach(([, session]) => allSessions.set(session.uploadId, session));
  persistedSessions.forEach((session) => allSessions.set(session.uploadId, session));

  const results = await Promise.allSettled(
    [...allSessions.values()].map((session) =>
      apiClient.post('/upload/r2/multipart/abort', session),
    ),
  );

  results.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const abortedId = [...allSessions.keys()][index];
      sessions.forEach(([token, session]) => {
        if (session.uploadId === abortedId) activeMultipartSessions.delete(token);
      });
      for (let storageIndex = localStorage.length - 1; storageIndex >= 0; storageIndex--) {
        const storageKey = localStorage.key(storageIndex);
        if (!storageKey?.startsWith('upload_session_')) continue;
        try {
          const storedSession = localStorage.getItem(storageKey);
          if (!storedSession) continue;

          const session = JSON.parse(storedSession);

          if (session.uploadId === abortedId) {
            localStorage.removeItem(storageKey);
          }
        } catch {
          localStorage.removeItem(storageKey);
        }
      }
    } else {
      console.error(
        'Failed to abort multipart upload before logout:',
        result.reason,
      );
    }
  });
};

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

  if (!Number.isInteger(maxRetries) || maxRetries < 1) {
    throw new Error('maxRetries must be a positive integer.');
  }

  const storageKey =
    `upload_session_${file.name}_${file.size}_${file.lastModified}_${file.type}`;

  const sessionToken = Symbol('multipart-upload');
  const activeRequests = new Set<XMLHttpRequest>();

  let uploadId = '';
  let key = '';
  let completedParts: UploadedPart[] = [];
  let alreadyCompleted = false;
  let activeSession: MultipartSession | null = null;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    activeRequests.forEach((xhr) => xhr.abort());
  };

  const checkCancelled = () => throwIfCancelled(signal, cancelled);

  const setSession = (session: MultipartSession | null) => {
    activeSession = session;

    if (session) {
      activeMultipartSessions.set(sessionToken, session);
    } else {
      activeMultipartSessions.delete(sessionToken);
    }

    onSession?.(session);
  };

  const persistSession = (session: MultipartSession) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  };

  const clearSession = () => {
    localStorage.removeItem(storageKey);
    setSession(null);
  };

  signal?.addEventListener('abort', cancel, { once: true });

  try {
    checkCancelled();

    // Resume a saved session only if the backend still recognizes it.
    const savedSession = localStorage.getItem(storageKey);

    if (savedSession) {
      let session: MultipartSession | null = null;

      try {
        const parsed = JSON.parse(savedSession);

        if (!parsed.key || !parsed.uploadId) {
          throw new Error('Invalid saved multipart session.');
        }

        session = {
          key: parsed.key,
          uploadId: parsed.uploadId,
        };
      } catch {
        // The local session data itself is malformed.
        localStorage.removeItem(storageKey);
      }

      if (session) {
        try {
          const remoteState = await getRemoteState(session);

          if (
            remoteState.session.fileName !== file.name ||
            remoteState.session.fileType !== file.type ||
            remoteState.session.fileSize !== file.size
          ) {
            throw new Error('The saved upload session belongs to a different file. Select the original file to resume.');
          }

          checkCancelled();

          key = session.key;
          uploadId = session.uploadId;
          completedParts = remoteState.parts || [];
          alreadyCompleted = remoteState.completed === true;
          setSession(session);
        } catch (error) {
          if (
            cancelled ||
            signal?.aborted ||
            error instanceof MultipartUploadCancelledError
          ) {
            throw new MultipartUploadCancelledError();
          }

          if (isInvalidMultipartSession(error)) {
            localStorage.removeItem(storageKey);
            uploadId = '';
            key = '';
            completedParts = [];
          } else {
            // Preserve the session for retry after network/server errors.
            throw error;
          }
        }
      }
    }

    // Create a session if no valid saved session was found.
    if (!uploadId || !key) {
      checkCancelled();

      const initRes = await apiClient.post(
        '/upload/r2/multipart/initiate',
        {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        },
      );

      uploadId = initRes.data.data.uploadId;
      key = initRes.data.data.key;

      const session = { key, uploadId };

      // Register and persist immediately. Cancellation may have occurred
      // while the initiation request was in flight.
      setSession(session);
      persistSession(session);

      if (isCancelled(signal, cancelled)) {
        throw new MultipartUploadCancelledError();
      }
    }

    const session = { key, uploadId };
    const completedPartNumbers = new Set(
      completedParts.map((part) => part.PartNumber),
    );

    let totalUploadedBytes = completedParts.reduce((total, part) => {
      const index = part.PartNumber - 1;

      if (
        !Number.isInteger(part.PartNumber) ||
        part.PartNumber < 1 ||
        part.PartNumber > totalChunks
      ) {
        return total;
      }

      return total + Math.max(
        0,
        Math.min(CHUNK_SIZE, file.size - index * CHUNK_SIZE),
      );
    }, 0);

    // Immediately show progress restored from the remote part list.
    onProgress?.(
      Math.min(100, Math.round((totalUploadedBytes / file.size) * 100)),
    );

    if (alreadyCompleted) {
      const completeRes = await apiClient.post('/upload/r2/multipart/complete', {
        key,
        uploadId,
        parts: [],
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      });
      clearSession();
      onProgress?.(100);
      return completeRes.data.data;
    }

    for (let index = 0; index < totalChunks; index++) {
      checkCancelled();

      const partNumber = index + 1;

      if (completedPartNumbers.has(partNumber)) continue;

      const start = index * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);

      let etag = '';
      let uploaded = false;
      let lastError: unknown;

      // Each attempt gets a fresh presigned URL.
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        checkCancelled();

        try {
          const partRes = await apiClient.post(
            '/upload/r2/multipart/presign-part',
            {
              key,
              uploadId,
              partNumber,
            },
          );

          checkCancelled();

          const { presignedUrl } = partRes.data.data;

          etag = await new Promise<string>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            activeRequests.add(xhr);

            const cleanup = () => {
              activeRequests.delete(xhr);
              xhr.onload = null;
              xhr.onerror = null;
              xhr.onabort = null;
              xhr.upload.onprogress = null;
            };

            xhr.open('PUT', presignedUrl, true);
            xhr.setRequestHeader(
              'Content-Type',
              file.type || 'application/octet-stream',
            );

            xhr.upload.onprogress = (event) => {
              if (!event.lengthComputable || !onProgress) return;

              onProgress(
                Math.min(
                  99,
                  Math.round(
                    ((totalUploadedBytes + event.loaded) / file.size) * 100,
                  ),
                ),
              );
            };

            xhr.onload = () => {
              const status = xhr.status;
              const etagHeader = xhr.getResponseHeader('ETag');

              cleanup();

              if (status === 200 || status === 204) {
                if (!etagHeader) {
                  reject(
                    new PartUploadError(
                      `Missing ETag on part ${partNumber}`,
                    ),
                  );
                  return;
                }

                resolve(etagHeader.replace(/"/g, ''));
                return;
              }

              reject(
                new PartUploadError(
                  `HTTP ${status} on part ${partNumber}`,
                  status,
                ),
              );
            };

            xhr.onerror = () => {
              cleanup();
              reject(new PartUploadError(
                `Network error on part ${partNumber}`,
              ));
            };

            xhr.onabort = () => {
              cleanup();
              reject(new MultipartUploadCancelledError());
            };

            xhr.send(chunk);
          });

          uploaded = true;
          break;
        } catch (error) {
          if (
            cancelled ||
            signal?.aborted ||
            error instanceof MultipartUploadCancelledError
          ) {
            throw new MultipartUploadCancelledError();
          }

          lastError = error;

          // The request may have reached R2 even if the browser did not
          // receive its response. Reconcile before uploading this part again.
          try {
            const remoteState = await getRemoteState(session);
            const remotePart = remoteState.parts.find(
              (part) => part.PartNumber === partNumber && part.ETag,
            );

            if (remotePart) {
              etag = remotePart.ETag;
              uploaded = true;
              break;
            }
          } catch (reconcileError) {
            if (
              cancelled ||
              signal?.aborted ||
              reconcileError instanceof MultipartUploadCancelledError
            ) {
              throw new MultipartUploadCancelledError();
            }

            // Continue with retry classification for the original failure.
          }

          if (!isRetryableError(error) || attempt === maxRetries - 1) {
            throw error;
          }

          await sleep(
            1000 * 2 ** attempt,
            signal,
            () => cancelled,
          );
        }
      }

      if (!uploaded) {
        throw lastError || new Error(`Part ${partNumber} was not uploaded.`);
      }

      totalUploadedBytes += chunk.size;

      completedParts = completedParts.filter(
        (part) => part.PartNumber !== partNumber,
      );

      completedParts.push({
        PartNumber: partNumber,
        ETag: etag,
      });

      completedParts.sort((a, b) => a.PartNumber - b.PartNumber);

      completedPartNumbers.add(partNumber);
      persistSession(session);

      onProgress?.(
        Math.min(99, Math.round((totalUploadedBytes / file.size) * 100)),
      );
    }

    checkCancelled();

    const completeRes = await apiClient.post(
      '/upload/r2/multipart/complete',
      {
        key,
        uploadId,
        parts: completedParts,
        fileName: file.name,
        mimeType: file.type,
        fileSize: file.size,
      },
    );

    clearSession();
    onProgress?.(100);

    return completeRes.data.data;
  } catch (error) {
    // cancellation cleanup
    if (
      cancelled ||
      signal?.aborted ||
      error instanceof MultipartUploadCancelledError
    ) {
      // Keep the active R2 session and its local key so a later attempt can
      // list completed parts and resume. Logout remains an explicit abort.
      throw new MultipartUploadCancelledError();
    }

    throw error;
  } finally {
    signal?.removeEventListener('abort', cancel);

    activeRequests.forEach((xhr) => xhr.abort());
    activeRequests.clear();

    if (!activeSession) {
      activeMultipartSessions.delete(sessionToken);
    }
  }
};
