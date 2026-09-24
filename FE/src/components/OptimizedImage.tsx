import React, { useState } from 'react';
import { buildOptimizedUrl, getBlurPlaceholderUrl } from '../utils/cloudinaryTransform';

interface OptimizedImageProps {
    publicId: string;
    cloudName: string;
    alt: string;
    width?: number;
    height?: number;
    className?: string;
}

export const OptimizedImage: React.FC<OptimizedImageProps> = ({
    publicId,
    cloudName,
    alt,
    width = 800,
    height,
    className = '',
}) => {
    const [isLoaded, setIsLoaded] = useState(false);

    const lqipUrl = getBlurPlaceholderUrl(publicId, cloudName);
    const mainUrl = buildOptimizedUrl(publicId, cloudName, {
        width,
        height,
        quality: 'auto',
        format: 'auto',
    });

    return (
        <div className={`relative overflow-hidden ${className}`} style={{ width, height }}>
            {/* Low-res blur background placeholder */}
            {!isLoaded && (
                <img
                    src={lqipUrl}
                    alt={alt}
                    className="absolute inset-0 w-full h-full object-cover filter blur-md transform scale-105 transition-opacity duration-500"
                />
            )}

            {/* Auto-negotiated modern image (WebP/AVIF via Cloudinary f_auto) */}
            <img
                src={mainUrl}
                alt={alt}
                loading="lazy"
                onLoad={() => setIsLoaded(true)}
                className={`w-full h-full object-cover transition-opacity duration-500 ${isLoaded ? 'opacity-100' : 'opacity-0'
                    }`}
            />
        </div>
    );
};