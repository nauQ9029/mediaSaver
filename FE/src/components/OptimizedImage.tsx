import React, { useEffect, useState } from 'react';

interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
  width?: number;
  quality?: number;
}

const getCDNTransformedUrl = (url: string, width = 800, quality = 80) => {
  if (!url) return '';

  try {
    new URL(url);
    // Cloudflare Image Resizing fetches the original URL, including its short-lived
    // R2 signature, as the source. Encoding keeps its query out of the transform URL.
    return `${window.location.origin}/cdn-cgi/image/width=${width},quality=${quality},format=auto/${encodeURIComponent(url)}`;
  } catch {
    return url;
  }
};

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  alt,
  width = 800,
  quality = 80,
  className = '',
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);

  const mainUrl = getCDNTransformedUrl(src, width, quality);
  const placeholderUrl = getCDNTransformedUrl(src, 24, 25);

  useEffect(() => {
    setIsLoaded(false);
    setUseOriginal(false);
  }, [src]);

  return (
    <div className={`relative overflow-hidden bg-slate-900 ${className}`}>
      {/* Low resolution image placeholder fades out after the optimized image loads. */}
      {!isLoaded && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
        />
      )}

      {/* Main Image with Smooth Fade-in */}
      <img
        src={useOriginal ? src : mainUrl}
        alt={alt}
        loading="lazy"
        {...props}
        onLoad={() => setIsLoaded(true)}
        onError={(event) => {
          if (!useOriginal && mainUrl !== src) {
            setUseOriginal(true);
            return;
          }
          setIsLoaded(true);
          props.onError?.(event);
        }}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
