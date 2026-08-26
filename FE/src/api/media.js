import axios from 'axios';
import { apiClient } from './client';

// 1. Fetch upload signature from Express backend
export const getUploadSignature = async () => {
  const { data } = await apiClient.get('/upload/signature');
  return data;
};

// 2. Direct binary upload to Cloudinary (bypasses backend proxy)
export const uploadToCloudinary = async (file, signatureData) => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('api_key', signatureData.apiKey);
  formData.append('timestamp', signatureData.timestamp);
  formData.append('signature', signatureData.signature);
  formData.append('folder', signatureData.folder);

  const cloudinaryUrl = `https://api.cloudinary.com/v1_1/${signatureData.cloudName}/auto/upload`;
  const { data } = await axios.post(cloudinaryUrl, formData);
  return data;
};

// 3. Save post-upload metadata into PostgreSQL via Express
export const saveMediaMetadata = async (cloudinaryRes, file) => {
  const payload = {
    publicId: cloudinaryRes.public_id,
    cloudinaryAssetId: cloudinaryRes.asset_id,
    secureUrl: cloudinaryRes.secure_url,
    originalFilename: file.name.replace(/\.[^/.]+$/, ''),
    mimeType: cloudinaryRes.resource_type,
    mediaType: cloudinaryRes.resource_type.toUpperCase() === 'VIDEO' ? 'VIDEO' : 'IMAGE',
    bytes: cloudinaryRes.bytes,
    width: cloudinaryRes.width,
    height: cloudinaryRes.height,
  };

  const { data } = await apiClient.post('/media', payload);
  return data;
};

// 4. Fetch media gallery with cursor pagination
export const fetchMediaGallery = async (limit = 12, cursor = null) => {
  const params = new URLSearchParams({ limit });
  if (cursor) params.append('cursor', cursor);

  const { data } = await apiClient.get(`/media?${params.toString()}`);
  return data;
};
