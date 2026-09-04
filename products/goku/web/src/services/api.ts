import axios from 'axios';
import { Bookmark } from '../types/bookmark';

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const bookmarkApi = {
  // Get all bookmarks
  getAll: async () => {
    const response = await api.get<Bookmark[]>('/bookmarks');
    return response.data;
  },

  // Get a single bookmark
  getById: async (id: string) => {
    const response = await api.get<Bookmark>(`/bookmarks/${id}`);
    return response.data;
  },

  // Create a new bookmark
  create: async (bookmark: Omit<Bookmark, 'id'>) => {
    const response = await api.post<Bookmark>('/bookmarks', bookmark);
    return response.data;
  },

  // Update a bookmark
  update: async (id: string, bookmark: Partial<Bookmark>) => {
    const response = await api.put<Bookmark>(`/bookmarks/${id}`, bookmark);
    return response.data;
  },

  // Delete a bookmark
  delete: async (id: string) => {
    await api.delete(`/bookmarks/${id}`);
  },
};
