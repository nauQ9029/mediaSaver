import { apiClient } from './client';

export const loginUser = async (email, password) => {
  const { data } = await apiClient.post('/auth/login', { email, password });
  if (data.token) {
    localStorage.setItem('token', data.token);
  }
  return data;
};

export const registerUser = async (email, password) => {
  const { data } = await apiClient.post('/auth/register', { email, password });
  if (data.token) {
    localStorage.setItem('token', data.token);
  }
  return data;
};

export const fetchProfile = async () => {
  const { data } = await apiClient.get('/auth/me');
  return data;
};

export const logoutUser = () => {
  localStorage.removeItem('token');
};