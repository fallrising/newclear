import { useInView } from 'react-intersection-observer';
import { Loader2 } from 'lucide-react';
import { BookmarkCard } from './BookmarkCard';
import { BookmarkEditor } from './BookmarkEditor';
import { useBookmarkPagination } from '../hooks/useBookmarkPagination';
import { useBookmarkStore } from '../store/bookmarkStore';
import { type Bookmark } from '../types/bookmark';
import { useState } from 'react';

export function BookmarkGrid() {
  const { bookmarks } = useBookmarkStore();
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
      {bookmarks.length === 0 && !pagination.isLoading && (
        <div className="text-center text-gray-500 py-16">
          No bookmarks found
        </div>
      )}
    </div>
  );
}