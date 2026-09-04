import { create } from 'zustand';

interface LayoutConfig {
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  contentLayout: 'grid' | 'list';
  scrollViews: ScrollView[];
}

interface ScrollView {
  id: string;
  title: string;
  keywords: string[];
  layout: 'grid' | 'list';
  pageSize: number;
}

interface LayoutStore {
  config: LayoutConfig;
  setSidebarWidth: (width: number) => void;
  toggleSidebar: () => void;
  setContentLayout: (layout: 'grid' | 'list') => void;
  addScrollView: (scrollView: Omit<ScrollView, 'id'>) => void;
  removeScrollView: (id: string) => void;
  updateScrollView: (id: string, updates: Partial<ScrollView>) => void;
}

const DEFAULT_CONFIG: LayoutConfig = {
  sidebarWidth: 280,
  sidebarCollapsed: false,
  contentLayout: 'grid',
  scrollViews: []
};

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  config: DEFAULT_CONFIG,

  setSidebarWidth: (width) => 
    set((state) => ({ 
      config: { ...state.config, sidebarWidth: width } 
    })),

  toggleSidebar: () => 
    set((state) => ({ 
      config: { ...state.config, sidebarCollapsed: !state.config.sidebarCollapsed } 
    })),

  setContentLayout: (layout) => 
    set((state) => ({ 
      config: { ...state.config, contentLayout: layout } 
    })),

  addScrollView: (scrollView) => 
    set((state) => ({
      config: {
        ...state.config,
        scrollViews: [
          ...state.config.scrollViews,
          { ...scrollView, id: crypto.randomUUID() }
        ]
      }
    })),

  removeScrollView: (id) => 
    set((state) => ({
      config: {
        ...state.config,
        scrollViews: state.config.scrollViews.filter(view => view.id !== id)
      }
    })),

  updateScrollView: (id, updates) => 
    set((state) => ({
      config: {
        ...state.config,
        scrollViews: state.config.scrollViews.map(view => 
          view.id === id ? { ...view, ...updates } : view
        )
      }
    }))
}));
