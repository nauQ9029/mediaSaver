import { apiClient } from './client';
import { refreshAccessToken as refreshSession, setAccessToken } from '../lib/api';

export const loginUser = async (email, password) => {
  const { data } = await apiClient.post('/auth/login', { email, password });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  return data;
};

export const registerUser = async (email, password) => {
  const { data } = await apiClient.post('/auth/register', { email, password });
  if (data.accessToken) {
    setAccessToken(data.accessToken);
  }
  return data;
};

export const refreshAccessToken = () => refreshSession();

export const requestPasswordReset = async (email) => {
  const { data } = await apiClient.post('/auth/forgot-password', { email });
  return data;
};

export const verifyResetToken = async (token) => {
  const response = await axios.get(`/api/auth/verify-reset-token/${token}`);
  return response.data;
};

export const submitPasswordReset = async (token, newPassword) => {
  const { data } = await apiClient.post('/auth/reset-password', { token, newPassword });
  return data;
};

export const fetchProfile = async () => {
  const { data } = await apiClient.get('/auth/me');
  return data;
};

export const logoutUser = async () => {
  try {
    await apiClient.post('/auth/logout');
  } finally {
    // Clear the in-memory access token even if the API request fails.
    setAccessToken(null);
  }
};
