import React, { useEffect } from 'react';
import { getMediaUrl } from '../../lib/cloudinary';

export default function MediaViewer({ item, onClose }) {
  // Close modal on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && item) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [item, onClose]);

  if (!item) return null;

  const isVideo = item.mediaType === 'VIDEO' || item.mimeType === 'video';
  const mediaUrl = getMediaUrl(item);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 md:p-8">
      {/* Background Overlay Click to Close */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Lightbox Window */}
      <div className="relative z-10 flex flex-col lg:flex-row w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden shadow-2xl">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 z-20 bg-slate-800/80 hover:bg-slate-700 text-slate-300 w-8 h-8 rounded-full flex items-center justify-center transition"
        >
          ✕
        </button>

        {/* Media Content Stage */}
        <div className="flex-1 bg-black flex items-center justify-center min-h-[300px] lg:min-h-[500px]">
          {isVideo ? (
            <video
              src={mediaUrl}
              controls
              autoPlay
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <img
              src={mediaUrl}
              alt={item.originalFilename}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          )}
        </div>

        {/* Sidebar Metadata */}
        <div className="w-full lg:w-80 p-6 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900">
          <div>
            <h3 className="text-lg font-bold text-slate-100 truncate mb-1">
              {item.originalFilename || 'Untitled'}
            </h3>
            <p className="text-xs text-sky-400 uppercase tracking-wider font-semibold mb-6">
              {item.mediaType} • {item.format || 'N/A'}
            </p>

            <div className="space-y-4 text-xs text-slate-300">
              <div>
                <span className="block text-slate-500 font-medium">Dimensions</span>
                <span className="font-mono">{item.width} × {item.height} px</span>
              </div>

              <div>
                <span className="block text-slate-500 font-medium">File Size</span>
                <span className="font-mono">{(item.bytes / (1024 * 1024)).toFixed(2)} MB</span>
              </div>

              <div>
                <span className="block text-slate-500 font-medium">Date Uploaded</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </div>

              {item.takenAt && (
                <div>
                  <span className="block text-slate-500 font-medium">Date Taken</span>
                  <span>{new Date(item.takenAt).toLocaleString()}</span>
                </div>
              )}
            </div>
          </div>

          <a
            href={mediaUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg text-center transition"
          >
            Open Original File
          </a>
        </div>
      </div>
    </div>
  );
}
