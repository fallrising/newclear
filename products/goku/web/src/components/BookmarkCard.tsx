import React from 'react';
import { type Bookmark } from '../types/bookmark';
import { cn } from '../lib/utils';
import { Edit, Trash2, MessageCircle } from 'lucide-react';
import { useBookmarkStore } from '../store/bookmarkStore';

interface BookmarkCardProps {
  bookmark: Bookmark;
  onEdit: (bookmark: Bookmark) => void;
}

export function BookmarkCard({ bookmark, onEdit }: BookmarkCardProps) {
  const { removeBookmark } = useBookmarkStore();
  const [showNotes, setShowNotes] = React.useState(false);
  const notes = Array.isArray(bookmark.notes) ? bookmark.notes : [];

  return (
    <div
      className={cn(
        'group relative bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4',
        'border border-gray-200'
      )}
      style={bookmark.customStyle?.container}
    >
      <div className="flex items-start gap-3">
        {bookmark.favicon && (
          <img
            src={bookmark.favicon}
            alt=""
            className="w-6 h-6 rounded"
          />
        )}
        
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-gray-900 truncate" style={bookmark.customStyle?.title}>
            <a href={bookmark.url} target="_blank" rel="noopener noreferrer">
              {bookmark.title}
            </a>
          </h3>
          
          {bookmark.description && (
            <p 
              className="mt-1 text-sm text-gray-500 line-clamp-2" 
              style={bookmark.customStyle?.description}
            >
              {bookmark.description}
            </p>
          )}

          {bookmark.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {bookmark.tags.map(tag => (
                <span
                  key={tag.id}
                  className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: tag.color + '20', color: tag.color }}
                >
                  {tag.name}
                </span>
              ))}
            </div>
          )}
          
          {notes.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowNotes(!showNotes)}
                className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
              >
                <MessageCircle className="w-4 h-4" />
                {notes.length} note{notes.length !== 1 ? 's' : ''}
              </button>
              
              {showNotes && (
                <div className="mt-2 space-y-2">
                  {notes.map(note => (
                    <div key={note.id} className="bg-gray-50 rounded p-2">
                      <h4 className="text-sm font-medium">{note.title}</h4>
                      <p className="text-sm text-gray-600 mt-1">{note.content}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={() => onEdit(bookmark)}
          className="p-1 text-gray-400 hover:text-gray-600"
        >
          <Edit className="w-4 h-4" />
        </button>
        <button
          onClick={() => removeBookmark(bookmark.id)}
          className="p-1 text-gray-400 hover:text-red-600"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}