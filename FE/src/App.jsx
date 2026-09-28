import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from './api/client';
import { fetchProfile, logoutUser, refreshAccessToken } from './api/auth';
import { fetchMediaGallery, deleteMedia } from './api/media';
import { uploadLargeFileInChunks } from './utils/chunkedUpload';

import Header from './components/Header';
import MediaCard from './components/media/MediaCard';
import MediaViewer from './components/media/MediaViewer';
import AuthModal from './components/auth/AuthModal';
import ResetPasswordPage from './components/auth/ResetPasswordPage';

export default function App() {
  const [status, setStatus] = useState('Checking connection…');
  const [user, setUser] = useState(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const isResetPath = window.location.pathname === '/reset-password';

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);

  useEffect(() => {
    apiClient
      .get('/health')
      .then(({ data }) => setStatus(data.message || 'Backend Connected'))
      .catch(() => setStatus('Unable to connect to backend'));

    refreshAccessToken()
      .then(() => fetchProfile())
      .then((userData) => {
        setUser(userData);
      })
      .catch(() => {
        logoutUser();
        setUser(null);
      });
  }, []);

  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setIsAuthOpen(false);
    setItems([]);
    setNextCursor(null);
  };

  if (isResetPath) {
    return <ResetPasswordPage onComplete={() => (window.location.href = '/')} />;
  }

  const handleLogout = () => {
    logoutUser();
    setUser(null);
    setItems([]);
    setNextCursor(null);
  };

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

  const handleFileUpload = async (e) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
    ]);

    const maxBytes = 50 * 1024 * 1024 * 1024; // 50 GB
    const hundredMB = 100 * 1024 * 1024;

    if (!allowedTypes.has(file.type)) {
      alert('Unsupported file format.');
      e.target.value = '';
      return;
    }

    if (file.size > maxBytes) {
      alert('File exceeds the 50 GB max limit.');
      e.target.value = '';
      return;
    }

    try {
      setUploading(true);
      setUploadProgress(0);

      let savedItem;

      if (file.size > hundredMB) {
        savedItem = await uploadLargeFileInChunks({
          file,
          onProgress: (progress) => setUploadProgress(progress),
        });
      } else {
        const { data: presignRes } = await apiClient.post('/upload/r2/presign', {
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
        });

        const { uploadUrl, key } = presignRes.data;

        await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('PUT', uploadUrl, true);
          xhr.setRequestHeader('Content-Type', file.type);

          xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
              const percent = Math.round((event.loaded / event.total) * 100);
              setUploadProgress(percent);
            }
          };

          xhr.onload = () => {
            if (xhr.status === 200) resolve();
            else reject(new Error(`R2 upload failed with status ${xhr.status}`));
          };

          xhr.onerror = () => reject(new Error('Network error during R2 upload'));
          xhr.send(file);
        });

        const { data: completeRes } = await apiClient.post('/upload/r2/complete', {
          key,
          fileName: file.name,
          mimeType: file.type,
        });

        savedItem = completeRes.data;
      }

      setItems((prev) => [savedItem, ...prev]);
    } catch (err) {
      console.error('Upload process failed:', err);
      alert(err.message || 'Upload failed. Check backend/network console.');
    } finally {
      setUploading(false);
      setUploadProgress(0);
      e.target.value = '';
    }
  };

  const handleDeleteMedia = async (item) => {
    if (!window.confirm(`Delete ${item.originalFilename || 'this media'}? This cannot be undone.`)) {
      return;
    }

    try {
      setDeleting(true);
      await deleteMedia(item.id);
      setItems((previous) => previous.filter((media) => media.id !== item.id));
      setSelectedMedia(null);
    } catch (err) {
      console.error('Failed to delete media:', err);
      alert(err.response?.data?.error || 'Unable to delete this media. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100">
      <div className="mx-auto max-w-6xl">
        <Header
          user={user}
          status={status}
          uploading={uploading}
          uploadProgress={uploadProgress}
          onFileUpload={handleFileUpload}
          onLoginClick={() => setIsAuthOpen(true)}
          onLogout={handleLogout}
        />

        {uploading && uploadProgress > 0 && (
          <div className="my-4 rounded-lg bg-slate-900 p-4 border border-slate-800">
            <div className="flex justify-between text-xs text-slate-300 mb-1 font-medium">
              <span>Uploading media directly to R2...</span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
              <div
                className="bg-sky-400 h-full transition-all duration-300"
                style={{ width: `${uploadProgress}%` }}
              />
            </div>
          </div>
        )}

        {!user && (
          <section className="text-center py-20 bg-slate-900 border border-slate-800 rounded-2xl p-8 my-8">
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
                  onDelete={handleDeleteMedia}
                />
              );
            })}
          </section>
        )}

        {loading && (
          <div className="flex justify-center py-8">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-sky-400 border-t-transparent" />
          </div>
        )}

        {user && !nextCursor && items.length > 0 && !loading && (
          <p className="text-center text-xs text-slate-500 py-8">All media loaded</p>
        )}
      </div>

      <AuthModal isOpen={isAuthOpen} onSuccess={handleAuthSuccess} />
      <MediaViewer
        item={selectedMedia}
        deleting={deleting}
        onClose={() => setSelectedMedia(null)}
        onDelete={handleDeleteMedia}
      />
    </main>
  );
}