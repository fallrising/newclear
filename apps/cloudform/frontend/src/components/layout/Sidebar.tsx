import { NavLink } from 'react-router-dom';
import { Database, LayoutDashboard, Workflow } from 'lucide-react';
import { cn } from '@/lib/utils';

const items = [
  { to: '/templates', icon: Database, label: '資源模板' },
  { to: '/requests', icon: Workflow, label: '工單', disabled: true },
  { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', disabled: true },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r border-border bg-sidebar/40 backdrop-blur">
      <div className="px-5 py-5">
        <div className="gradient-text text-xl font-bold">CloudForm</div>
        <div className="text-xs text-muted-foreground mt-1">v0.1.0</div>
      </div>
      <nav className="px-2 mt-2">
        {items.map(({ to, icon: Icon, label, disabled }) =>
          disabled ? (
            <span
              key={to}
              className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground/60 cursor-not-allowed"
            >
              <Icon className="size-4" />
              {label}
            </span>
          ) : (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-smooth',
                  isActive
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-muted-foreground hover:bg-sidebar-accent/50 hover:text-foreground'
                )
              }
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          )
        )}
      </nav>
    </aside>
  );
}
