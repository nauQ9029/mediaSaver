const DB_NAME = 'media-saver-upload-continuity';
const STORE_NAME = 'pending-uploads';
const PENDING_UPLOAD_KEY = 'pending-large-upload';

export type PendingUpload = {
  handle: FileSystemFileHandle | null;
  name: string;
  size: number;
  lastModified: number;
  type: string;
};

const openDatabase = () => new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open(DB_NAME, 1);
  request.onupgradeneeded = () => {
    request.result.createObjectStore(STORE_NAME);
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const withStore = async <T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest) => {
  const db = await openDatabase();
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const request = action(transaction.objectStore(STORE_NAME));
    let result: T | undefined;
    request.onsuccess = () => { result = request.result as T; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      db.close();
      resolve(result as T);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('Upload continuity storage transaction failed.'));
    };
  });
};

export const savePendingUpload = (pending: PendingUpload) =>
  withStore<void>('readwrite', (store) => store.put(pending, PENDING_UPLOAD_KEY));

export const getPendingUpload = () =>
  withStore<PendingUpload | undefined>('readonly', (store) => store.get(PENDING_UPLOAD_KEY));

export const clearPendingUpload = () =>
  withStore<void>('readwrite', (store) => store.delete(PENDING_UPLOAD_KEY));

export const supportsPersistentFileHandles = () =>
  typeof window !== 'undefined' && 'showOpenFilePicker' in window;

export const pickFileWithHandle = async () => {
  const [handle] = await window.showOpenFilePicker({
    multiple: false,
    types: [{
      description: 'Media files',
      accept: {
        'image/jpeg': ['.jpg', '.jpeg'],
        'image/png': ['.png'],
        'image/webp': ['.webp'],
        'image/gif': ['.gif'],
        'video/mp4': ['.mp4'],
        'video/webm': ['.webm'],
        'video/quicktime': ['.mov'],
      },
    }],
  });
  const file = await handle.getFile();
  return { handle, file };
};

export const getFileFromHandle = async (handle: FileSystemFileHandle) => {
  let permission = await handle.queryPermission({ mode: 'read' });
  if (permission !== 'granted') {
    permission = await handle.requestPermission({ mode: 'read' });
  }
  if (permission !== 'granted') throw new Error('File access permission was not granted. Select the file again to resume.');
  return handle.getFile();
};
