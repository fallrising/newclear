import React, { useState } from 'react';
import {Bookmark, FolderOpen, Hash, Plus, ChevronDown, ChevronRight, X, Edit2, Check} from 'lucide-react';
import { useBookmarkStore } from '../store/bookmarkStore';
import { cn } from '../lib/utils';

export function Sidebar() {
  const { 
    categories, 
    tags, 
    selectedCategory, 
    selectedTags, 
    setSelectedCategory, 
    toggleTag,
    addCategory,
    removeCategory,
    updateCategory 
  } = useBookmarkStore();

  const [isCategoriesOpen, setIsCategoriesOpen] = useState(true);
  const [isTagsOpen, setIsTagsOpen] = useState(true);
  const [editingCategory, setEditingCategory] = useState<string | null>(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (newCategoryName.trim()) {
      addCategory({
        id: crypto.randomUUID(),
        name: newCategoryName.trim(),
        icon: 'folder',
      });
      setNewCategoryName('');
      setIsAddingCategory(false);
    }
  };

  const handleUpdateCategory = (id: string, newName: string) => {
    if (newName.trim()) {
      updateCategory(id, { name: newName.trim() });
      setEditingCategory(null);
    }
  };

  return (
    <aside className="w-64 h-screen bg-white border-r border-gray-200 p-4 fixed left-0 top-0">
      <div className="flex items-center gap-2 mb-8">
        <Bookmark className="w-6 h-6 text-blue-600" />
        <h1 className="text-xl font-bold">Bookmarks</h1>
      </div>

      <button className="w-full bg-blue-600 text-white rounded-lg p-2 flex items-center justify-center gap-2 mb-6 hover:bg-blue-700 transition-colors">
        <Plus className="w-4 h-4" />
        Add Bookmark
      </button>

      <div className="space-y-6">
        {/* Categories Section */}
        <div>
          <button
            onClick={() => setIsCategoriesOpen(!isCategoriesOpen)}
            className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 mb-2 hover:text-gray-700"
          >
            <div className="flex items-center gap-2">
              <FolderOpen className="w-4 h-4" />
              Categories
            </div>
            {isCategoriesOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {isCategoriesOpen && (
            <div className="space-y-1">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between group"
                >
                  {editingCategory === category.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleUpdateCategory(category.id, newCategoryName);
                      }}
                      className="flex-1 flex items-center"
                    >
                      <input
                        type="text"
                        value={newCategoryName}
                        onChange={(e) => setNewCategoryName(e.target.value)}
                        className="flex-1 px-2 py-1 text-sm border rounded-md"
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="ml-1 p-1 text-green-600 hover:text-green-700"
                      >
                        <Check className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingCategory(null)}
                        className="p-1 text-gray-400 hover:text-gray-600"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </form>
                  ) : (
                    <>
                      <button
                        onClick={() => setSelectedCategory(category.id)}
                        className={cn(
                          "flex-1 text-left px-2 py-1.5 rounded-md text-sm transition-colors",
                          selectedCategory === category.id
                            ? "bg-blue-50 text-blue-600"
                            : "hover:bg-gray-100"
                        )}
                      >
                        {category.name}
                      </button>
                      <div className="hidden group-hover:flex items-center">
                        <button
                          onClick={() => {
                            setEditingCategory(category.id);
                            setNewCategoryName(category.name);
                          }}
                          className="p-1 text-gray-400 hover:text-gray-600"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeCategory(category.id)}
                          className="p-1 text-gray-400 hover:text-red-600"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}

              {isAddingCategory ? (
                <form onSubmit={handleAddCategory} className="flex items-center mt-2">
                  <input
                    type="text"
                    value={newCategoryName}
                    onChange={(e) => setNewCategoryName(e.target.value)}
                    placeholder="New category"
                    className="flex-1 px-2 py-1 text-sm border rounded-md"
                    autoFocus
                  />
                  <button
                    type="submit"
                    className="ml-1 p-1 text-green-600 hover:text-green-700"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddingCategory(false);
                      setNewCategoryName('');
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </form>
              ) : (
                <button
                  onClick={() => setIsAddingCategory(true)}
                  className="w-full text-left px-2 py-1.5 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add Category
                </button>
              )}
            </div>
          )}
        </div>

        {/* Tags Section */}
        <div>
          <button
            onClick={() => setIsTagsOpen(!isTagsOpen)}
            className="w-full flex items-center justify-between text-sm font-semibold text-gray-500 mb-2 hover:text-gray-700"
          >
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4" />
              Tags
            </div>
            {isTagsOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>

          {isTagsOpen && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <button
                  key={tag.id}
                  onClick={() => toggleTag(tag.id)}
                  className={cn(
                    "px-2 py-1 rounded-full text-xs font-medium transition-colors",
                    selectedTags.includes(tag.id)
                      ? `bg-${tag.color}-100 text-${tag.color}-600`
                      : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {tag.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}