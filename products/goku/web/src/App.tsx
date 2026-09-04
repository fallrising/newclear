import { Sidebar } from './components/Sidebar';
import { SearchBar } from './components/SearchBar';
import { BookmarkGrid } from './components/BookmarkGrid';

function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Sidebar />
      <main className="ml-64 p-8">
        <div className="max-w-6xl mx-auto">
          <div className="mb-8">
            <SearchBar />
          </div>
          <BookmarkGrid />
        </div>
      </main>
    </div>
  );
}

export default App;