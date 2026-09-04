import { create } from 'zustand';
import { type Bookmark, type Category, type Tag, type PaginationState } from '../types/bookmark';
import { bookmarkApi } from '../services/api';
import { getFaviconUrl } from '../lib/utils';

interface BookmarkStore {
  bookmarks: Bookmark[];
  categories: Category[];
  tags: Tag[];
  searchQuery: string;
  selectedCategory: string | null;
  selectedTags: string[];
  pagination: PaginationState;
  setSearchQuery: (query: string) => void;
  setSelectedCategory: (categoryId: string | null) => void;
  toggleTag: (tagId: string) => void;
  addBookmark: (bookmark: Bookmark) => void;
  removeBookmark: (id: string) => void;
  updateBookmark: (id: string, bookmark: Partial<Bookmark>) => void;
  setPagination: (pagination: PaginationState) => void;
  fetchBookmarks: (page: number) => Promise<void>;
  addCategory: (category: Category) => void;
  removeCategory: (id: string) => void;
  updateCategory: (id: string, category: Partial<Category>) => void;
}

export const useBookmarkStore = create<BookmarkStore>((set, get) => ({
  bookmarks: [],
  categories: [
    { id: '1', name: 'Work', icon: 'briefcase' },
    { id: '2', name: 'Personal', icon: 'home' },
    { id: '3', name: 'Learning', icon: 'book' },
  ],
  tags: [
    { id: '1', name: 'Important', color: 'red' },
    { id: '2', name: 'Read Later', color: 'blue' },
    { id: '3', name: 'Reference', color: 'green' },
  ],
  searchQuery: '',
  selectedCategory: null,
  selectedTags: [],
  pagination: {
    page: 1,
    limit: 10,
    hasMore: true,
    isLoading: false,
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setSelectedCategory: (categoryId) => set({ selectedCategory: categoryId }),
  toggleTag: (tagId) =>
    set((state) => ({
      selectedTags: state.selectedTags.includes(tagId)
        ? state.selectedTags.filter((id) => id !== tagId)
        : [...state.selectedTags, tagId],
    })),

  setPagination: (pagination) => set({ pagination }),

  fetchBookmarks: async (page: number) => {
    try {
      set((state) => ({
        pagination: { ...state.pagination, isLoading: true },
      }));

      const bookmarks = await bookmarkApi.getAll();

      set({
        bookmarks,
        pagination: {
          page,
          limit: get().pagination.limit,
          hasMore: bookmarks.length >= get().pagination.limit,
          isLoading: false,
        },
      });
    } catch (error) {
      console.error('Failed to fetch bookmarks:', error);
      set((state) => ({
        pagination: { ...state.pagination, isLoading: false },
      }));
    }
  },

  addBookmark: async (bookmark: Bookmark) => {
    try {
      const newBookmark = {
        ...bookmark,
        createdAt: new Date().toISOString(),
        lastVisited: new Date().toISOString(),
        favicon: getFaviconUrl(bookmark.url || '')
      };
      
      const created = await bookmarkApi.create(newBookmark);
      set((state) => ({
        bookmarks: [...state.bookmarks, created],
      }));
    } catch (error) {
      console.error('Failed to add bookmark:', error);
    }
  },

  removeBookmark: async (id) => {
    try {
      await bookmarkApi.delete(id);
      set((state) => ({
        bookmarks: state.bookmarks.filter((b) => b.id !== id),
      }));
    } catch (error) {
      console.error('Failed to remove bookmark:', error);
    }
  },

  updateBookmark: async (id: string, updatedBookmark: Partial<Bookmark>) => {
    try {
      const currentBookmark = get().bookmarks.find(b => b.id === id);
      const bookmarkToUpdate = {
        ...currentBookmark, // Preserve all existing fields
        ...updatedBookmark, // Apply updates
        createdAt: currentBookmark?.createdAt || new Date().toISOString(),
        lastVisited: new Date().toISOString(),
        // Keep existing favicon or generate new one if URL changed
        favicon: updatedBookmark.url !== currentBookmark?.url
          ? getFaviconUrl(updatedBookmark.url || '')
          : currentBookmark?.favicon
      };
      
      const updatedData = await bookmarkApi.update(id, bookmarkToUpdate);
      
      set((state) => ({
        bookmarks: state.bookmarks.map((bookmark) =>
          bookmark.id === id ? { ...bookmark, ...updatedData } : bookmark
        ),
      }));
    } catch (error) {
      console.error('Failed to update bookmark:', error);
    }
  },

  addCategory: (category) =>
    set((state) => ({ categories: [...state.categories, category] })),
  removeCategory: (id) =>
    set((state) => ({
      categories: state.categories.filter((category) => category.id !== id),
      // Reset selected category if it's being removed
      selectedCategory: state.selectedCategory === id ? null : state.selectedCategory,
      // Update bookmarks to move them to uncategorized
      bookmarks: state.bookmarks.map((bookmark) =>
        bookmark.category?.id === id
          ? { ...bookmark, category: { id: 'uncategorized', name: 'Uncategorized', icon: 'folder' } }
          : bookmark
      ),
    })),
  updateCategory: (id, updatedCategory) =>
    set((state) => ({
      categories: state.categories.map((category) =>
        category.id === id ? { ...category, ...updatedCategory } : category
      ),
      // Update bookmarks with the new category data
      bookmarks: state.bookmarks.map((bookmark) =>
        bookmark.category?.id === id
          ? { ...bookmark, category: { ...bookmark.category, ...updatedCategory } }
          : bookmark
      ),
    })),
}));