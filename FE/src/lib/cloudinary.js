export function getMediaUrl(item) {
  if (item.secureUrl || item.url) return item.secureUrl || item.url;

  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !item.publicId) return '';

  const resourceType = item.mediaType === 'VIDEO' || item.mimeType === 'video' ? 'video' : 'image';
  return `https://res.cloudinary.com/${cloudName}/${resourceType}/upload/f_auto,q_auto/${item.publicId}`;
}

export function getVideoPosterUrl(item) {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;
  if (!cloudName || !item.publicId) return '';

  return `https://res.cloudinary.com/${cloudName}/video/upload/so_0/${item.publicId}.jpg`;
}
