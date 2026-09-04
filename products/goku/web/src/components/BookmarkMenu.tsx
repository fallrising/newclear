import { Edit, Trash, EyeOff, FolderOpen } from 'lucide-react';
import { useBookmarkStore } from '../store/bookmarkStore';

interface BookmarkMenuProps {
  bookmarkId: string;
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
}

export function BookmarkMenu({ bookmarkId, isOpen, onClose, onEdit }: BookmarkMenuProps) {
  const { removeBookmark, categories, updateBookmark } = useBookmarkStore();

  if (!isOpen) return null;

  const handleDelete = () => {
    removeBookmark(bookmarkId);
    onClose();
  };

  const handleHide = () => {
    updateBookmark(bookmarkId, { hidden: true });
    onClose();
  };

  return (
    <div className="absolute right-0 top-8 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
      <button
        onClick={() => {
          onEdit();
          onClose();
        }}
        className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2"
      >
        <Edit className="w-4 h-4" />
        Edit
      </button>
      
      <div className="relative group">
        <button
          className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2 justify-between"
        >
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4" />
            Move to
          </div>
          <span className="text-gray-400">›</span>
        </button>
        
        <div className="absolute left-full top-0 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 hidden group-hover:block">
          {categories.map((category) => (
            <button
              key={category.id}
              onClick={() => {
                updateBookmark(bookmarkId, { category });
                onClose();
              }}
              className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50"
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleHide}
        className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-50 flex items-center gap-2"
      >
        <EyeOff className="w-4 h-4" />
        Hide
      </button>

      <div className="border-t border-gray-200 my-1" />

      <button
        onClick={handleDelete}
        className="w-full px-4 py-2 text-sm text-left text-red-600 hover:bg-red-50 flex items-center gap-2"
      >
        <Trash className="w-4 h-4" />
        Delete
      </button>
    </div>
  );
}