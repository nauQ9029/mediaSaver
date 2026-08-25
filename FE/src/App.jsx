import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from './api/client';
import { getUploadSignature, uploadToCloudinary, saveMediaMetadata, fetchMediaGallery } from './api/media';

import Header from './components/Header';
import MediaCard from './components/MediaCard';
import MediaViewer from './components/MediaViewer';

export default function App() {
  const [status, setStatus] = useState('Checking connection…');
  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);

  // Health check on mount
  useEffect(() => {
    apiClient
      .get('/health')
      .then(({ data }) => setStatus(data.message || 'Backend Connected'))
      .catch(() => setStatus('Unable to connect to backend'));
  }, []);

  // Fetch gallery items
  const loadGallery = async (cursor = null) => {
    try {
      setLoading(true);
      const res = await fetchMediaGallery(12, cursor);
      setItems((prev) => (cursor ? [...prev, ...res.data] : res.data));
      setNextCursor(res.nextCursor);
    } catch (err) {
      console.error('Failed to load media gallery:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadGallery();
  }, []);

  // Infinite Scroll Trigger
  const observer = useRef();
  const lastElementRef = useCallback(
    (node) => {
      if (loading) return;
      if (observer.current) observer.current.disconnect();

      observer.current = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting && nextCursor) {
          loadGallery(nextCursor);
        }
      });

      if (node) observer.current.observe(node);
    },
    [loading, nextCursor]
  );

  // Direct Cloudinary Upload Handler
  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      setUploading(true);
      const file = files[0];
      const sigData = await getUploadSignature();
      const cloudRes = await uploadToCloudinary(file, sigData);
      const savedItem = await saveMediaMetadata(cloudRes, file);

      setItems((prev) => [savedItem, ...prev]);
    } catch (err) {
      console.error('Upload process failed:', err);
      alert('Upload failed. Check backend console.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        {/* Header Bar */}
        <Header
          status={status}
          uploading={uploading}
          onFileUpload={handleFileUpload}
        />

        {/* Media Grid */}
        <section className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
          {items.map((item, index) => {
            const isLast = items.length === index + 1;
            return (
              <MediaCard
                key={item.id}
                item={item}
                ref={isLast ? lastElementRef : null}
                onClick={setSelectedMedia}
              />
            );
          })}
        </section>

        {/* Loading Spinner */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          </div>
        )}

        {/* End Feed Text */}
        {!nextCursor && items.length > 0 && !loading && (
          <p className="text-center text-xs text-slate-500 py-8">All media loaded</p>
        )}
      </div>

      {/* Lightbox Viewer Modal */}
      <MediaViewer
        item={selectedMedia}
        onClose={() => setSelectedMedia(null)}
      />
    </main>
  );
}