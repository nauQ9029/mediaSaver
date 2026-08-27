import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from './api/client';
import { fetchProfile, logoutUser } from './api/auth'
import {
  getUploadSignature,
  uploadToCloudinary,
  saveMediaMetadata,
  fetchMediaGallery,
} from './api/media';

import Header from './components/Header';
import MediaCard from './components/media/MediaCard';
import MediaViewer from './components/media/MediaViewer';
import AuthModal from './components/auth/AuthModal';

export default function App() {
  const [status, setStatus] = useState('Checking connection…');
  const [user, setUser] = useState(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);

  // health check on mount & restore session on mount
  useEffect(() => {
    apiClient
      .get('/health')
      .then(({ data }) => setStatus(data.message || 'Backend Connected'))
      .catch(() => setStatus('Unable to connect to backend'));

    const token = localStorage.getItem('token');
    if (token) {
      fetchProfile()
        .then((userData) => {
          setUser(userData);
        })
        .catch(() => {
          logoutUser();
          setUser(null);
        });
    }
  }, []);

  // Authentication Handlers
  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setIsAuthOpen(false);
    setItems([]);
    setNextCursor(null);
  };

  const handleLogout = () => {
    logoutUser();
    setUser(null);
    setItems([]);
    setNextCursor(null);
  };

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
    if (user) loadGallery();
  }, [user]);

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

    const file = files[0];
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
    ]);
    const maxBytes = 100 * 1024 * 1024;

    if (!allowedTypes.has(file.type) || file.size > maxBytes) {
      alert('Choose a supported image or video no larger than 100 MB.');
      e.target.value = '';
      return;
    }

    try {
      setUploading(true);
      const sigData = await getUploadSignature();
      const cloudRes = await uploadToCloudinary(file, sigData);
      const savedItem = await saveMediaMetadata(cloudRes);

      setItems((prev) => [savedItem, ...prev]);
    } catch (err) {
      console.error('Upload process failed:', err);
      alert('Upload failed. Check backend console.');
    } finally {
      setUploading(false);
      e.target.value = '';
    }
  };

return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        {/* Header Bar */}
        <Header
          user={user}
          status={status}
          uploading={uploading}
          onFileUpload={handleFileUpload}
          onLoginClick={() => setIsAuthOpen(true)}
          onLogout={handleLogout}
        />

        {/* Unauthenticated View */}
        {!user && (
          <section className="text-center py-20 bg-slate-900/50 border border-slate-800 rounded-2xl p-8 my-8">
            <h2 className="text-2xl font-bold">Your Private Media Vault</h2>
            <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
              Sign in or create an account to start uploading images and videos directly to your isolated cloud library.
            </p>
            <button
              onClick={() => setIsAuthOpen(true)}
              className="mt-6 bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold px-6 py-2.5 rounded-lg text-sm transition"
            >
              Get Started
            </button>
          </section>
        )}

        {/* Media Grid */}
        {user && (
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
        )}

        {/* Loading Spinner */}
        {loading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          </div>
        )}

        {/* End Feed Text */}
        {user && !nextCursor && items.length > 0 && !loading && (
          <p className="text-center text-xs text-slate-500 py-8">All media loaded</p>
        )}
      </div>

      {/* Modals */}
      <AuthModal isOpen={isAuthOpen} onSuccess={handleAuthSuccess} />
      <MediaViewer item={selectedMedia} onClose={() => setSelectedMedia(null)} />
    </main>
  );
}
