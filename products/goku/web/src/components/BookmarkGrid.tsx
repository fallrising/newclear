import { useInView } from 'react-intersection-observer';
import { Loader2 } from 'lucide-react';
import { BookmarkCard } from './BookmarkCard';
import { BookmarkEditor } from './BookmarkEditor';
import { useBookmarkPagination } from '../hooks/useBookmarkPagination';
import { useBookmarkStore } from '../store/bookmarkStore';
import { type Bookmark } from '../types/bookmark';
import { useState } from 'react';

export function BookmarkGrid() {
  const { bookmarks, error, fetchBookmarks } = useBookmarkStore();
  const { loadMore, pagination } = useBookmarkPagination();
  const [editingBookmark, setEditingBookmark] = useState<Bookmark | null>(null);
  
  const { ref } = useInView({
    threshold: 0,
    onChange: (inView) => {
      if (inView && !pagination.isLoading && pagination.hasMore) {
        loadMore();
      }
    },
  });

  return (
    <div className="space-y-8">
      {error && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => fetchBookmarks(1)}
            disabled={pagination.isLoading}
            className="mt-2 rounded px-3 py-1 border border-red-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50"
          >
            Retry
          </button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {bookmarks.map((bookmark) => (
          <BookmarkCard 
            key={bookmark.id} 
            bookmark={bookmark} 
            onEdit={setEditingBookmark}
          />
        ))}
      </div>

      {editingBookmark && (
        <BookmarkEditor 
          bookmark={editingBookmark} 
          onClose={() => setEditingBookmark(null)} 
        />
      )}

      {/* Loading indicator and infinite scroll trigger */}
      <div
        ref={ref}
        className="flex justify-center py-8"
      >
        {pagination.isLoading && (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Loading more bookmarks...</span>
          </div>
        )}
      </div>

      {/* End of list message */}
      {!pagination.hasMore && bookmarks.length > 0 && (
        <div className="text-center text-gray-500 py-8">
          No more bookmarks to load
        </div>
      )}

      {/* Empty state */}
      {bookmarks.length === 0 && !pagination.isLoading && !error && (
        <div className="text-center text-gray-500 py-16">
          No bookmarks found
        </div>
      )}
    </div>
  );
}