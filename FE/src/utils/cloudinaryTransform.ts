interface TransformationOptions {
  width?: number;
  height?: number;
  quality?: 'auto' | 'auto:good' | 'auto:eco' | 'auto:low' | number;
  format?: 'auto' | 'webp' | 'avif' | 'png' | 'jpg';
  crop?: 'fill' | 'fit' | 'thumb' | 'scale';
  blur?: number;
}

/**
 * Builds an optimized Cloudinary delivery URL using transform flags.
 */
export const buildOptimizedUrl = (
  publicId: string,
  cloudName: string,
  options: TransformationOptions = {}
): string => {
  const {
    width,
    height,
    quality = 'auto',
    format = 'auto',
    crop = 'fill',
    blur,
  } = options;

  const transforms: string[] = [`f_${format}`, `q_${quality}`];

  if (width) transforms.push(`w_${width}`);
  if (height) transforms.push(`h_${height}`);
  if (width || height) transforms.push(`c_${crop}`);
  if (blur) transforms.push(`e_blur:${blur}`);

  const transformString = transforms.join(',');

  return `https://res.cloudinary.com/${cloudName}/image/upload/${transformString}/${publicId}`;
};

/**
 * Generates a lightweight (~1-2KB) blurred image URL for Low Quality Image Placeholders (LQIP).
 */
export const getBlurPlaceholderUrl = (publicId: string, cloudName: string): string => {
  return buildOptimizedUrl(publicId, cloudName, {
    width: 30,
    quality: 'auto:low',
    format: 'auto',
    blur: 1000,
  });
};