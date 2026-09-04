import { useCallback, useEffect } from 'react';
import { useBookmarkStore } from '../store/bookmarkStore';

export function useBookmarkPagination() {
  const {
    fetchBookmarks,
    pagination,
    setPagination,
    searchQuery,
    selectedCategory,
    selectedTags,
  } = useBookmarkStore();

  const loadMore = useCallback(async () => {
    if (pagination.isLoading || !pagination.hasMore) return;

    setPagination({ ...pagination, isLoading: true });
    await fetchBookmarks(pagination.page + 1);
  }, [pagination, fetchBookmarks, setPagination]);

  // Reset pagination when filters change
  useEffect(() => {
    setPagination({
      page: 1,
      limit: 12,
      hasMore: true,
      isLoading: false,
    });
    fetchBookmarks(1);
  }, [searchQuery, selectedCategory, selectedTags, fetchBookmarks, setPagination]);

  return { loadMore, pagination };
}