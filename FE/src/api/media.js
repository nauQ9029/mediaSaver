import { apiClient } from './client';

// Fetch media gallery with cursor pagination
export const fetchMediaGallery = async (limit = 12, cursor = null) => {
  const params = new URLSearchParams({ limit });
  if (cursor) params.append('cursor', cursor);

  const { data } = await apiClient.get(`/media?${params.toString()}`);
  return data;
};

// Update media item metadata (e.g., rename originalFilename)
export const updateMediaMetadata = async (id, updates) => {
  const { data } = await apiClient.patch(`/media/${id}`, updates);
  return data;
};

// Fetch signed original download URL
export const getMediaDownloadUrl = async (id) => {
  const { data } = await apiClient.get(`/media/${id}/download`);
  return data;
};

// Delete media asset
export const deleteMedia = async (id) => {
  await apiClient.delete(`/media/${id}`);
};
