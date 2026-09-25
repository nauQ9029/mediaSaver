// src/utils/chunkedUpload.ts
import { apiClient } from '../api/client';

export interface ChunkUploadOptions {
  file: File;
  onProgress?: (progress: number) => void;
}

export const uploadLargeFileInChunks = async ({
  file,
  onProgress,
}: ChunkUploadOptions) => {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

  // 1. Initiate Chunk Upload Session (apiClient automatically attaches Bearer token)
  const { data: initRes } = await apiClient.post('/upload/chunk/init', {
    fileName: file.name,
    totalChunks,
    fileSize: file.size,
  });

  const uploadId = initRes.data?.uploadId || initRes.uploadId;

  // 2. Upload Chunks Sequentially
  for (let index = 0; index < totalChunks; index++) {
    const start = index * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunkBlob = file.slice(start, end);

    const formData = new FormData();
    formData.append('uploadId', uploadId);
    formData.append('chunkIndex', String(index));
    formData.append('chunk', chunkBlob, `${file.name}.part${index}`);

    await apiClient.post('/upload/chunk/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });

    if (onProgress) {
      const percentage = Math.round(((index + 1) / totalChunks) * 100);
      onProgress(percentage);
    }
  }

  // 3. Finalize and Reassemble Chunks
  const { data: completeRes } = await apiClient.post('/upload/chunk/complete', {
    uploadId,
    fileName: file.name,
    totalChunks,
  });

  return completeRes;
};