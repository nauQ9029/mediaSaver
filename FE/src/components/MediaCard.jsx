import React, { forwardRef } from 'react';

const MediaCard = forwardRef(({ item, onClick }, ref) => {
  const cloudName = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME || 'YOUR_ACTUAL_CLOUD_NAME';
  const isVideo = item.mediaType === 'VIDEO' || item.mimeType === 'video';

  const mediaUrl = item.secureUrl 
    || item.url 
    || `https://res.cloudinary.com/${cloudName}/${isVideo ? 'video' : 'image'}/upload/${item.publicId}`;

  const videoPosterUrl = isVideo 
    ? `https://res.cloudinary.com/${cloudName}/video/upload/${item.publicId}.jpg`
    : null;

  return (
    <div
      ref={ref}
      onClick={() => onClick(item)}
      className="group relative aspect-square bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-slate-700 transition cursor-pointer"
    >
      {isVideo ? (
        <video
          src={mediaUrl}
          poster={videoPosterUrl}
          className="w-full h-full object-cover"
          muted
          playsInline
          onMouseOver={(e) => e.currentTarget.play()}
          onMouseOut={(e) => {
            e.currentTarget.pause();
            e.currentTarget.currentTime = 0;
          }}
        />
      ) : (
        <img
          src={mediaUrl}
          alt={item.originalFilename || 'Media'}
          className="w-full h-full object-cover transition duration-300 group-hover:scale-105"
          loading="lazy"
        />
      )}

      {/* Video Badge */}
      {isVideo && (
        <div className="absolute top-2 right-2 bg-slate-950/70 text-slate-200 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-700/50">
          Video
        </div>
      )}

      {/* Hover Info Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition p-3 flex flex-col justify-end pointer-events-none">
        <p className="text-xs font-semibold text-slate-200 truncate">{item.originalFilename}</p>
        <p className="text-[10px] text-slate-400">{(item.bytes / 1024).toFixed(1)} KB</p>
      </div>
    </div>
  );
});

MediaCard.displayName = 'MediaCard';
export default MediaCard;