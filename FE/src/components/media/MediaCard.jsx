import React, { forwardRef, useState } from 'react';
import { OptimizedImage } from '../OptimizedImage';

const MediaCard = forwardRef(({ item, onClick, onEdit, onDelete }, ref) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const isVideo = item.mediaType === 'VIDEO' || item.mimeType?.startsWith('video/');

  // Resolve media URL directly from item properties
  const mediaUrl = item.deliveryUrl || item.secureUrl || item.url || null;

  const handleMenuAction = (e, action) => {
    e.stopPropagation();
    setMenuOpen(false);
    if (action === 'edit') onEdit?.(item);
    if (action === 'delete') onDelete?.(item);
  };

  const handleMouseEnter = (e) => {
    const playPromise = e.currentTarget.play();
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Suppress browser autoplay restrictions on quick hover
      });
    }
  };

  const handleMouseLeave = (e) => {
    e.currentTarget.pause();
    e.currentTarget.currentTime = 0;
  };

  return (
    <div
      ref={ref}
      onClick={() => onClick(item)}
      className="group relative aspect-square bg-slate-900 rounded-xl overflow-hidden border border-slate-800 hover:border-slate-700 transition cursor-pointer"
    >
      {/* Media Display */}
      {mediaUrl ? (
        isVideo ? (
          <video
            src={mediaUrl}
            preload="metadata"
            className="w-full h-full object-cover"
            muted
            playsInline
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
          />
        ) : (
          <OptimizedImage
            src={mediaUrl}
            alt={item.originalFilename || 'Media asset'}
            width={400}
            className="w-full h-full transition duration-300 group-hover:scale-105"
          />
        )
      ) : (
        /* Safe Fallback Card for Legacy Rows Without URL */
        <div className="flex h-full w-full flex-col items-center justify-center p-4 text-center">
          <span className="text-xs font-mono text-slate-400 truncate max-w-full">
            {item.originalFilename || 'Unnamed file'}
          </span>
          <span className="mt-1 text-[10px] text-slate-500">Missing R2 URL</span>
        </div>
      )}

      {/* Video Badge */}
      {isVideo && (
        <div className="absolute top-2 left-2 bg-slate-950/70 text-slate-200 px-2 py-0.5 rounded text-[10px] font-bold tracking-wider uppercase border border-slate-700/50 z-10">
          Video
        </div>
      )}

      {/* 3 Dots Menu Button */}
      <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition z-20">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((prev) => !prev);
          }}
          className="bg-slate-950/80 hover:bg-slate-900 text-slate-300 w-7 h-7 rounded-lg flex items-center justify-center border border-slate-700/50 transition"
        >
          •••
        </button>

        {/* Dropdown Options */}
        {menuOpen && (
          <div
            className="absolute right-0 mt-1 w-28 bg-slate-900 border border-slate-800 rounded-lg shadow-xl overflow-hidden text-xs py-1 z-30"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={(e) => handleMenuAction(e, 'edit')}
              className="w-full text-left px-3 py-1.5 text-slate-300 hover:bg-slate-800 transition"
            >
              Rename
            </button>
            <button
              onClick={(e) => handleMenuAction(e, 'delete')}
              className="w-full text-left px-3 py-1.5 text-rose-400 hover:bg-rose-500/10 transition"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {/* Hover Info Overlay */}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition p-3 flex flex-col justify-end pointer-events-none z-10">
        <p className="text-xs font-semibold text-slate-200 truncate">{item.originalFilename}</p>
        <p className="text-[10px] text-slate-400">
          {item.bytes ? `${(item.bytes / (1024 * 1024)).toFixed(1)} MB` : '0 MB'}
        </p>
      </div>
    </div>
  );
});

MediaCard.displayName = 'MediaCard';
export default MediaCard;