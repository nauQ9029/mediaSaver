import axios, {
  type AxiosError,
  type InternalAxiosRequestConfig,
} from 'axios';

let accessToken: string | null = null;

export const setAccessToken = (token: string | null) => {
  accessToken = token;
};

export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL:
    (import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env
      ?.VITE_API_BASE_URL || 'http://localhost:5000/api',
  withCredentials: true,
});

api.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

type RetriableRequestConfig = InternalAxiosRequestConfig & { _retry?: boolean };

let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((promise) => {
    if (error) {
      promise.reject(error);
    } else if (token) {
      promise.resolve(token);
    }
  });
  failedQueue = [];
};

/** Share refresh requests so StrictMode effects and 401 retries cannot rotate
 * the same one-time refresh cookie concurrently.
 */
export const refreshAccessToken = (): Promise<string> => {
  if (!refreshPromise) {
    refreshPromise = api
      .post<{ accessToken: string }>('/auth/refresh', {})
      .then(({ data }) => {
        if (!data.accessToken) {
          throw new Error('Access token was not returned by the refresh endpoint');
        }
        setAccessToken(data.accessToken);
        return data.accessToken;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as RetriableRequestConfig | undefined;
    const url = originalRequest?.url ?? '';

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry ||
      url.includes('/auth/login') ||
      url.includes('/auth/refresh') ||
      url.includes('/auth/logout')
    ) {
      return Promise.reject(error);
    }

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return api(originalRequest);
      });
    }

    originalRequest._retry = true;
    isRefreshing = true;

    try {
      const token = await refreshAccessToken();
      processQueue(null, token);
      originalRequest.headers.Authorization = `Bearer ${token}`;
      return api(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      setAccessToken(null);
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
);
