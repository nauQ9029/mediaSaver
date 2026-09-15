import React, { useState, useEffect } from 'react';
import { getMediaUrl } from '../../lib/cloudinary';
import { updateMediaMetadata, getMediaDownloadUrl } from '../../api/media';

export default function MediaViewer({ item, deleting, onClose, onDelete, onUpdateSuccess }) {
  const [isEditing, setIsEditing] = useState(false);
  const [filename, setFilename] = useState('');
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (item) {
      setFilename(item.originalFilename || '');
      setIsEditing(false);
      setError(null);
    }
  }, [item]);

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

  const handleSaveFilename = async (e) => {
    e.preventDefault();
    if (!filename.trim() || filename === item.originalFilename) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    setError(null);

    try {
      const updated = await updateMediaMetadata(item.id, { 
        originalFilename: filename.trim() 
      });

      // 1. Immediately sync local component state
      setFilename(updated.originalFilename || filename.trim());
      item.originalFilename = updated.originalFilename || filename.trim();

      // 2. Safely notify parent component if callback exists
      onUpdateSuccess?.(updated);
      setIsEditing(false);
    } catch (err) {
      console.error('Frontend error caught:', err);
      setError(err.response?.data?.error || 'Failed to update filename');
    } finally {
      setSaving(false);
    }
  };

  const handleDownload = async () => {
    setDownloading(true);
    setError(null);
    try {
      const { downloadUrl, filename: downloadName } = await getMediaDownloadUrl(item.id);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.setAttribute('download', downloadName || 'download');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (err) {
      setError('Failed to fetch download link.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 md:p-8">
      {/* Backdrop Click */}
      <div className="absolute inset-0" onClick={onClose} />

      {/* Lightbox Container */}
      <div className="relative z-10 flex flex-col lg:flex-row w-full max-w-5xl max-h-[90vh] bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl">
        
        {/* Floating Close Button */}
        <button
          onClick={onClose}
          className="absolute -top-3 -right-3 z-30 bg-slate-800 hover:bg-slate-700 text-slate-300 w-8 h-8 rounded-full flex items-center justify-center text-xs border border-slate-700 shadow-md transition"
        >
          ✕
        </button>

        {/* Media Stage */}
        <div className="flex-1 bg-black flex items-center justify-center min-h-[300px] lg:min-h-[500px] rounded-t-2xl lg:rounded-tr-none lg:rounded-l-2xl overflow-hidden">
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
        <div className="w-full lg:w-80 p-6 flex flex-col justify-between border-t lg:border-t-0 lg:border-l border-slate-800 bg-slate-900 rounded-b-2xl lg:rounded-bl-none lg:rounded-r-2xl">
          <div>
            {/* Header: Title and Inline Edit Button */}
            <div className="flex items-center justify-between gap-2 mb-1">
              {isEditing ? (
                <form onSubmit={handleSaveFilename} className="w-full space-y-2">
                  <input
                    type="text"
                    value={filename}
                    onChange={(e) => setFilename(e.target.value)}
                    className="w-full px-2 py-1 bg-slate-950 border border-slate-700 rounded text-sm text-slate-100 focus:outline-none focus:border-sky-500"
                    autoFocus
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="px-2 py-1 bg-sky-500 text-slate-950 text-xs font-semibold rounded hover:bg-sky-400"
                    >
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditing(false)}
                      className="px-2 py-1 bg-slate-800 text-slate-300 text-xs rounded"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              ) : (
                <>
                  <h3 className="text-lg font-bold text-slate-100 truncate flex-1 pr-2">
                    {item.originalFilename || 'Untitled'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    className="text-xs text-sky-400 hover:text-sky-300 font-medium shrink-0"
                  >
                    Edit
                  </button>
                </>
              )}
            </div>

            <p className="text-xs text-sky-400 uppercase tracking-wider font-semibold mb-4">
              {item.mediaType} • {item.mimeType?.split('/')[1] || 'N/A'}
            </p>

            {error && (
              <div className="p-2 mb-4 bg-rose-500/10 border border-rose-500/30 rounded text-rose-400 text-xs">
                {error}
              </div>
            )}

            <div className="space-y-4 text-xs text-slate-300">
              <div>
                <span className="block text-slate-500 font-medium">Dimensions</span>
                <span className="font-mono">
                  {item.width && item.height ? `${item.width} × ${item.height} px` : 'N/A'}
                </span>
              </div>

              <div>
                <span className="block text-slate-500 font-medium">File Size</span>
                <span className="font-mono">{(item.bytes / (1024 * 1024)).toFixed(2)} MB</span>
              </div>

              <div>
                <span className="block text-slate-500 font-medium">Date Uploaded</span>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
              </div>
            </div>
          </div>

          <div className="space-y-2 mt-6">
            <button
              type="button"
              onClick={handleDownload}
              disabled={downloading}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-lg text-center transition disabled:opacity-50"
            >
              {downloading ? 'Preparing Download...' : 'Download Original'}
            </button>
            <button
              type="button"
              onClick={() => onDelete(item)}
              disabled={deleting}
              className="w-full py-2 border border-rose-500/40 text-rose-300 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-60 text-xs font-semibold rounded-lg transition"
            >
              {deleting ? 'Deleting…' : 'Delete Media'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}