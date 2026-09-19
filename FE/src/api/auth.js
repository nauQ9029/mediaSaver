import { apiClient } from './client';
import { setAccessToken } from '../lib/api';

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

export const refreshAccessToken = async () => {
  const { data } = await apiClient.post('/auth/refresh');
  if (!data.accessToken) {
    throw new Error('Access token was not returned by the refresh endpoint');
  }
  setAccessToken(data.accessToken);
  return data.accessToken;
};

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

export const logoutUser = () => {
  setAccessToken(null);
};