import React from 'react';
import { useLayoutStore } from '../store/layoutStore';
import { Sidebar } from '../components/Sidebar';
import { cn } from '../lib/utils';

interface CoreLayoutProps {
  children: React.ReactNode;
}

export function CoreLayout({ children }: CoreLayoutProps) {
  const { config, setSidebarWidth } = useLayoutStore();
  const sidebarRef = React.useRef<HTMLDivElement>(null);
  const [isResizing, setIsResizing] = React.useState(false);

  const startResizing = React.useCallback((mouseDownEvent: React.MouseEvent) => {
    setIsResizing(true);
  }, []);

  const stopResizing = React.useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = React.useCallback(
    (mouseMoveEvent: MouseEvent) => {
      if (isResizing && sidebarRef.current) {
        const newWidth = mouseMoveEvent.clientX;
        if (newWidth >= 200 && newWidth <= 600) {
          setSidebarWidth(newWidth);
        }
      }
    },
    [isResizing, setSidebarWidth]
  );

  React.useEffect(() => {
    window.addEventListener('mousemove', resize);
    window.addEventListener('mouseup', stopResizing);
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [resize, stopResizing]);

  return (
    <div className="h-screen flex overflow-hidden">
      <div
        ref={sidebarRef}
        style={{ width: config.sidebarCollapsed ? 0 : config.sidebarWidth }}
        className={cn(
          'shrink-0 border-r border-gray-200 bg-white transition-all duration-300',
          config.sidebarCollapsed && 'w-0'
        )}
      >
        <Sidebar />
      </div>
      
      {/* Resizer */}
      <div
        className={cn(
          'w-1 bg-gray-200 cursor-col-resize hover:bg-blue-500 transition-colors',
          isResizing && 'bg-blue-500',
          config.sidebarCollapsed && 'hidden'
        )}
        onMouseDown={startResizing}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gray-50">
        {children}
      </main>
    </div>
  );
}
