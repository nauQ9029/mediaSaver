import React, { useEffect, useState } from 'react';
import { apiClient } from '../api/client';

interface OptimizedImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  transformUrl?: string;
  alt: string;
  width?: number;
  quality?: number;
}

const getVariantUrl = (
  transformUrl: string | undefined,
  width: number,
  quality: number,
) => {
  if (!transformUrl) return '';

  const configuredBase = apiClient.defaults.baseURL || 'http://localhost:5000/api';
  const base = new URL(`${configuredBase.replace(/\/+$/, '')}/`, window.location.origin);
  const url = new URL(transformUrl, base);
  url.searchParams.set('width', String(width));
  url.searchParams.set('quality', String(quality));
  url.searchParams.set('format', 'webp');
  return url.toString();
};

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
  src,
  transformUrl,
  alt,
  width = 800,
  quality = 80,
  className = '',
  ...props
}) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [useOriginal, setUseOriginal] = useState(false);

  const optimizedUrl = getVariantUrl(transformUrl, width, quality);
  const placeholderUrl = getVariantUrl(transformUrl, 16, 20);

  useEffect(() => {
    setIsLoaded(false);
    setUseOriginal(false);
  }, [src, transformUrl]);

  return (
    <div className={`relative overflow-hidden bg-slate-900 ${className}`}>
      {!isLoaded && placeholderUrl && (
        <img
          src={placeholderUrl}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full scale-110 object-cover blur-md"
        />
      )}

      <img
        src={useOriginal || !optimizedUrl ? src : optimizedUrl}
        alt={alt}
        loading="lazy"
        {...props}
        onLoad={() => setIsLoaded(true)}
        onError={(event) => {
          if (!useOriginal && optimizedUrl && optimizedUrl !== src) {
            setUseOriginal(true);
            return;
          }
          setIsLoaded(true);
          props.onError?.(event);
        }}
        className={`h-full w-full object-cover transition-opacity duration-300 ${
          isLoaded ? 'opacity-100' : 'opacity-0'
        }`}
      />
    </div>
  );
};
