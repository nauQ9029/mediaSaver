import React, { useEffect, useState, useRef, useCallback } from 'react';
import { apiClient } from './api/client';
import { fetchProfile, logoutUser, refreshAccessToken } from './api/auth';
import { setAccessToken } from './lib/api';
import { fetchMediaGallery, deleteMedia } from './api/media';
import {
  abortSavedMultipartUpload,
  abortActiveMultipartUploads,
  getSavedMultipartProgress,
  uploadLargeFileInChunks,
} from './utils/chunkedUpload';

import Header from './components/Header';
import MediaCard from './components/media/MediaCard';
import MediaViewer from './components/media/MediaViewer';
import AuthModal from './components/auth/AuthModal';
import ResetPasswordPage from './components/auth/ResetPasswordPage';
import {
  clearPendingUpload,
  getFileFromHandle,
  getPendingUpload,
  pickFileWithHandle,
  savePendingUpload,
  supportsPersistentFileHandles,
} from './utils/uploadContinuity';

export default function App() {
  if (window.location.pathname === '/reset-password') {
    return <ResetPasswordPage onComplete={() => (window.location.href = '/')} />;
  }

  return <MediaVault />;
}

function MediaVault() {
  const [theme, setTheme] = useState(() => localStorage.getItem('media-saver-theme') || 'dark');
  const [status, setStatus] = useState('Checking connection…');
  const [user, setUser] = useState(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);

  const [items, setItems] = useState([]);
  const [nextCursor, setNextCursor] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState('');
  const [uploadName, setUploadName] = useState('');
  const [persistentHandleSupported] = useState(supportsPersistentFileHandles);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [pendingUploadProgress, setPendingUploadProgress] = useState(0);
  const [cancellingPendingUpload, setCancellingPendingUpload] = useState(false);
  const resumeFileInput = useRef(null);
  const uploadAbortController = useRef(null);
  const activeMultipartSession = useRef(null);
  const cancelRequested = useRef(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [mediaFilter, setMediaFilter] = useState('all');

  const imageCount = items.filter((item) => item.mediaType === 'IMAGE').length;
  const videoCount = items.filter((item) => item.mediaType === 'VIDEO').length;
  const storageBytes = items.reduce((total, item) => total + (item.bytes || 0), 0);
  const filteredItems = items.filter((item) => {
    const matchesType = mediaFilter === 'all' || item.mediaType === mediaFilter;
    const matchesSearch = (item.originalFilename || '').toLowerCase().includes(searchQuery.trim().toLowerCase());
    return matchesType && matchesSearch;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('media-saver-theme', theme);
  }, [theme]);

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
        // A failed restoration should not revoke a session that another
        // concurrent refresh request may just have rotated.
        setAccessToken(null);
        setUser(null);
      });
  }, []);

  const handleAuthSuccess = (userData) => {
    setUser(userData);
    setIsAuthOpen(false);
    setItems([]);
    setNextCursor(null);
  };

  const handleLogout = async () => {
    await abortActiveMultipartUploads();
    await clearPendingUpload().catch((error) => {
      console.error('Could not clear saved upload handle:', error);
    });
    try {
      await logoutUser();
    } catch (err) {
      console.error('Logout request failed:', err);
    } finally {
      setUser(null);
      setItems([]);
      setNextCursor(null);
      setSelectedMedia(null);
      setPendingUpload(null);
      setPendingUploadProgress(0);
    }
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

  const startMultipartUpload = async (file, resuming = false) => {
    uploadAbortController.current = new AbortController();
    cancelRequested.current = false;
    activeMultipartSession.current = null;
    setUploadError(resuming ? 'Resuming upload…' : '');
    setUploadName(file.name);
    setUploading(true);
    setUploadProgress(0);

    try {
      const savedItem = await uploadLargeFileInChunks({
        file,
        onProgress: (progress) => {
          setUploadProgress(progress);
          setPendingUploadProgress(progress);
        },
        signal: uploadAbortController.current.signal,
        onSession: (session) => { activeMultipartSession.current = session; },
      });
      const pending = await getPendingUpload();
      if (
        pending &&
        pending.name === file.name &&
        pending.size === file.size &&
        pending.lastModified === file.lastModified
      ) {
        await clearPendingUpload();
        setPendingUpload(null);
        setPendingUploadProgress(0);
      }
      setItems((previous) => [savedItem, ...previous]);
    } catch (error) {
      console.error('Multipart upload failed:', error);
      setUploadError(cancelRequested.current
        ? 'Upload paused. You can resume it later.'
        : (error.message || 'Upload failed.'));
    } finally {
      uploadAbortController.current = null;
      activeMultipartSession.current = null;
      setUploading(false);
      setUploadProgress(0);
    }
  };

  useEffect(() => {
    if (!user) return;

    (async () => {
      try {
        const pending = await getPendingUpload();
        if (!pending) return;
        const progress = await getSavedMultipartProgress(pending);
        if (progress === null) {
          await clearPendingUpload();
          return;
        }
        setPendingUpload(pending);
        setPendingUploadProgress(progress);
      } catch (error) {
        console.error('Could not restore pending upload details:', error);
      }
    })();
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

  const handleChooseUpload = async () => {
    if (persistentHandleSupported) {
      try {
        const { handle, file } = await pickFileWithHandle();
        await uploadSelectedFile(file, handle);
      } catch (error) {
        if (error.name !== 'AbortError') setUploadError(error.message || 'Could not open the selected file.');
      }
      return;
    }
    document.getElementById('media-upload-input')?.click();
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await uploadSelectedFile(file);
    } catch (error) {
      setUploadError(error.message || 'Could not start the upload.');
    } finally {
      event.target.value = '';
    }
  };

  const uploadSelectedFile = async (file, fileHandle = null) => {
    const allowedTypes = new Set([
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/quicktime',
    ]);

    const maxBytes = 50 * 1024 * 1024 * 1024; // 50 GB
    const multipartThreshold = 10 * 1024 * 1024;

    if (!allowedTypes.has(file.type)) {
      setUploadError('Unsupported file format.');
      return;
    }

    if (file.size > maxBytes) {
      setUploadError('File exceeds the 50 GB max limit.');
      return;
    }

    if (file.size > multipartThreshold) {
      const pending = {
        handle: fileHandle,
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
      };
      await savePendingUpload(pending);
      setPendingUpload(pending);
      setPendingUploadProgress(0);
      await startMultipartUpload(file);
      return;
    }

    try {
      uploadAbortController.current = new AbortController();
      cancelRequested.current = false;
      activeMultipartSession.current = null;
      setUploadError('');
      setUploading(true);
      setUploadProgress(0);

      let savedItem;

      {
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

          xhr.onerror = () => reject(new Error(
            'Could not reach R2. Check the bucket CORS policy for this app origin and confirm R2 credentials are configured.',
          ));
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
      if (cancelRequested.current) {
        if (!activeMultipartSession.current) {
          setUploadError('Upload cancelled.');
        } else {
          setUploadError(`Could not cancel upload: ${err.message || 'abort failed'}`);
        }
      } else {
        alert(err.message || 'Upload failed. Check backend/network console.');
      }
    } finally {
      uploadAbortController.current = null;
      activeMultipartSession.current = null;
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const handleSelectToResume = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const pending = await getPendingUpload();
      if (
        !pending ||
        file.name !== pending.name ||
        file.size !== pending.size ||
        file.lastModified !== pending.lastModified ||
        file.type !== pending.type
      ) {
        throw new Error(`Select the original file${pending ? `: ${pending.name}` : ''}.`);
      }
      await startMultipartUpload(file, true);
    } catch (error) {
      setUploadError(error.message || 'Could not resume upload.');
    } finally {
      event.target.value = '';
    }
  };

  const handleResumePendingUpload = async () => {
    if (!pendingUpload) return;
    try {
      let file;
      let replacementHandle = null;
      if (pendingUpload.handle) {
        try {
          file = await getFileFromHandle(pendingUpload.handle);
        } catch {
          if (!persistentHandleSupported) throw new Error('Select the original file to resume.');
          const selected = await pickFileWithHandle();
          file = selected.file;
          replacementHandle = selected.handle;
        }
      } else if (persistentHandleSupported) {
        const selected = await pickFileWithHandle();
        file = selected.file;
        replacementHandle = selected.handle;
      } else {
        resumeFileInput.current?.click();
        return;
      }

      if (
        file.name !== pendingUpload.name ||
        file.size !== pendingUpload.size ||
        file.lastModified !== pendingUpload.lastModified ||
        file.type !== pendingUpload.type
      ) {
        throw new Error(`Select the original file: ${pendingUpload.name}.`);
      }
      if (replacementHandle) {
        const updatedPending = { ...pendingUpload, handle: replacementHandle };
        await savePendingUpload(updatedPending);
        setPendingUpload(updatedPending);
      }
      await startMultipartUpload(file, true);
    } catch (error) {
      if (error.name !== 'AbortError') setUploadError(error.message || 'Could not resume upload.');
    }
  };

  const handleCancelPendingUpload = async () => {
    if (!pendingUpload || cancellingPendingUpload) return;
    setCancellingPendingUpload(true);
    setUploadError('');
    try {
      await abortSavedMultipartUpload(pendingUpload);
      await clearPendingUpload();
      setPendingUpload(null);
      setPendingUploadProgress(0);
      setUploadError('Unfinished upload cancelled.');
    } catch (error) {
      console.error('Could not cancel unfinished upload:', error);
      setUploadError(error.response?.data?.error || error.message || 'Could not cancel the unfinished upload.');
    } finally {
      setCancellingPendingUpload(false);
    }
  };

  const handleCancelUpload = () => {
    if (!uploadAbortController.current) return;

    cancelRequested.current = true;
    setUploadError('Stopping upload…');
    uploadAbortController.current.abort();
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
    <main className="app-shell min-h-screen px-5 py-8 text-slate-100 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <Header
          user={user}
          status={status}
          uploading={uploading}
          onChooseUpload={handleChooseUpload}
          onCancelUpload={handleCancelUpload}
          uploadProgress={uploadProgress}
          onFileUpload={handleFileUpload}
          onLoginClick={() => setIsAuthOpen(true)}
          onLogout={handleLogout}
          theme={theme}
          onToggleTheme={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
        />

        {uploading && uploadProgress > 0 && (
          <div className="surface-card my-4 rounded-xl p-4">
            <div className="flex justify-between text-xs text-slate-300 mb-1 font-medium">
              <span>{uploadError || `Uploading ${uploadName || 'media'} directly to R2...`}</span>
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

        {uploading && (
          <div className="surface-card my-4 flex items-center justify-between rounded-xl p-4">
            <span className="text-sm text-slate-300">{uploadError || `Upload in progress: ${uploadName}`}</span>
          </div>
        )}
        {!uploading && uploadError && (
          <p role="status" className="my-4 text-sm text-amber-300">{uploadError}</p>
        )}
        {pendingUpload && user && !uploading && (
          <section className="my-5 rounded-xl border border-amber-700/60 bg-amber-950/30 p-5">
            <h2 className="font-semibold text-amber-100">Unfinished upload found</h2>
            <p className="mt-2 text-sm text-slate-200">
              {pendingUpload.name} — {pendingUploadProgress}% uploaded
            </p>
            <p className="mt-1 text-sm text-slate-400">
              Your browser needs access to the original file to continue.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleResumePendingUpload}
                className="rounded-lg bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-300"
              >
                Resume upload
              </button>
              <button
                type="button"
                onClick={handleCancelPendingUpload}
                disabled={cancellingPendingUpload}
                className="rounded-lg border border-rose-700 px-4 py-2 text-sm font-semibold text-rose-200 hover:bg-rose-950 disabled:opacity-50"
              >
                {cancellingPendingUpload ? 'Cancelling…' : 'Cancel upload'}
              </button>
            </div>
            <input
              ref={resumeFileInput}
              type="file"
              accept="image/*,video/*"
              onChange={handleSelectToResume}
              className="hidden"
            />
          </section>
        )}

        {!user && (
          <section className="surface-card my-10 rounded-2xl px-6 py-16 text-center sm:px-12">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-500">A quieter place for your media</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Your library, all in one place.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-slate-400">
              Keep your photos and videos together in a private cloud library that is yours to browse and manage.
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
          <>
            <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="surface-card rounded-xl p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-400">Library items</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{items.length}</p>
              </div>
              <div className="surface-card rounded-xl p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-400">Images</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{imageCount}</p>
              </div>
              <div className="surface-card rounded-xl p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-400">Videos</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{videoCount}</p>
              </div>
              <div className="surface-card rounded-xl p-4 sm:p-5">
                <p className="text-xs font-medium text-slate-400">Storage used</p>
                <p className="mt-2 text-2xl font-semibold tracking-tight">{storageBytes >= 1024 ** 3 ? `${(storageBytes / 1024 ** 3).toFixed(1)} GB` : `${(storageBytes / 1024 ** 2).toFixed(1)} MB`}</p>
              </div>
            </section>

            <section className="mb-5 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Your collection</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight">Recent media</h2>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <label className="sr-only" htmlFor="media-search">Search files</label>
                <input id="media-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Search files" className="surface-muted min-w-52 rounded-lg px-3 py-2 text-sm outline-none placeholder:text-slate-500 focus:border-sky-500" />
                <label className="sr-only" htmlFor="media-filter">Filter media type</label>
                <select id="media-filter" value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value)} className="surface-muted rounded-lg px-3 py-2 text-sm text-slate-300 outline-none focus:border-sky-500">
                  <option value="all">All media</option>
                  <option value="IMAGE">Images</option>
                  <option value="VIDEO">Videos</option>
                </select>
              </div>
            </section>

            {filteredItems.length ? <section className="grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 md:grid-cols-4">
            {filteredItems.map((item) => {
              const isLast = items[items.length - 1]?.id === item.id;
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
            </section> : items.length === 0 ? <div className="surface-card rounded-xl px-6 py-12 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800 text-xl text-slate-300">＋</div>
              <p className="mt-4 font-medium">Your library is ready</p>
              <p className="mx-auto mt-1 max-w-sm text-sm leading-6 text-slate-400">Upload a photo or video to start building your collection.</p>
              <button type="button" onClick={handleChooseUpload} className="mt-5 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-sky-400">Upload your first file</button>
            </div> : <div className="surface-card rounded-xl px-6 py-12 text-center">
              <p className="font-medium">No matching media</p>
              <p className="mt-1 text-sm text-slate-400">Try another name or filter.</p>
            </div>}
          </>
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
        onUpdateSuccess={(updated) => {
          setItems((previous) => previous.map((media) => (
            media.id === updated.id ? updated : media
          )));
          setSelectedMedia(updated);
        }}
      />
    </main>
  );
}
