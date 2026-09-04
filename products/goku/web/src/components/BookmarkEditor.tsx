import React from 'react';
import { cn } from '../lib/utils';
import { type Bookmark } from '../types/bookmark';
import { useBookmarkStore } from '../store/bookmarkStore';

interface BookmarkEditorProps {
  bookmark: Bookmark;
  onClose: () => void;
}

export function BookmarkEditor({ bookmark, onClose }: BookmarkEditorProps) {
  const { categories, tags, updateBookmark } = useBookmarkStore();
  const [formData, setFormData] = React.useState({
    title: bookmark.title,
    url: bookmark.url,
    description: bookmark.description,
    category: bookmark.category?.id ?? categories[0]?.id,
    tags: bookmark.tags?.map(t => t.id) ?? [],
    notes: Array.isArray(bookmark.notes) ? bookmark.notes : []
  });

  const [noteTitle, setNoteTitle] = React.useState('');
  const [noteContent, setNoteContent] = React.useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const selectedCategory = categories.find(c => c.id === formData.category);
    const selectedTags = tags.filter(t => formData.tags.includes(t.id));
    
    updateBookmark(bookmark.id, {
      title: formData.title,
      url: formData.url,
      description: formData.description,
      category: selectedCategory!,
      tags: selectedTags,
      notes: formData.notes
    });
    
    onClose();
  };

  const addNote = () => {
    if (noteTitle && noteContent) {
      const newNote = {
        id: crypto.randomUUID(),
        title: noteTitle,
        content: noteContent,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      setFormData(prev => ({
        ...prev,
        notes: [...prev.notes, newNote]
      }));
      setNoteTitle('');
      setNoteContent('');
    }
  };

  const removeNote = (noteId: string) => {
    setFormData(prev => ({
      ...prev,
      notes: prev.notes.filter(note => note.id !== noteId)
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <div className="border-b border-gray-200 p-4">
            <h2 className="text-lg font-semibold">Edit Bookmark</h2>
          </div>

          <div className="p-4 space-y-4">
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700">
                Title
              </label>
              <input
                type="text"
                id="title"
                value={formData.title}
                onChange={e => setFormData(prev => ({ ...prev, title: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* URL */}
            <div>
              <label htmlFor="url" className="block text-sm font-medium text-gray-700">
                URL
              </label>
              <input
                type="url"
                id="url"
                value={formData.url}
                onChange={e => setFormData(prev => ({ ...prev, url: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                required
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700">
                Description
              </label>
              <textarea
                id="description"
                value={formData.description}
                onChange={e => setFormData(prev => ({ ...prev, description: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={3}
              />
            </div>

            {/* Category */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                id="category"
                value={formData.category}
                onChange={e => setFormData(prev => ({ ...prev, category: e.target.value }))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {categories.map(category => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Tags */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {tags.map(tag => (
                  <label
                    key={tag.id}
                    className={cn(
                      'inline-flex items-center px-3 py-1 rounded-full text-sm cursor-pointer transition-colors',
                      formData.tags.includes(tag.id)
                        ? 'bg-blue-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    )}
                  >
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={formData.tags.includes(tag.id)}
                      onChange={() => {
                        setFormData(prev => ({
                          ...prev,
                          tags: prev.tags.includes(tag.id)
                            ? prev.tags.filter(id => id !== tag.id)
                            : [...prev.tags, tag.id]
                        }));
                      }}
                    />
                    {tag.name}
                  </label>
                ))}
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Notes
              </label>
              
              {/* Existing Notes */}
              <div className="space-y-2 mb-4">
                {formData.notes.map(note => (
                  <div key={note.id} className="bg-gray-50 rounded p-3 relative">
                    <button
                      type="button"
                      onClick={() => removeNote(note.id)}
                      className="absolute top-2 right-2 text-gray-400 hover:text-red-500"
                    >
                      ×
                    </button>
                    <h4 className="font-medium">{note.title}</h4>
                    <p className="text-gray-600 mt-1">{note.content}</p>
                  </div>
                ))}
              </div>

              {/* Add New Note */}
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Note Title"
                  value={noteTitle}
                  onChange={e => setNoteTitle(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
                <textarea
                  placeholder="Note Content"
                  value={noteContent}
                  onChange={e => setNoteContent(e.target.value)}
                  className="block w-full rounded-md border border-gray-300 px-3 py-2 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  rows={3}
                />
                <button
                  type="button"
                  onClick={addNote}
                  className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Add Note
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-200 p-4 flex justify-end space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}