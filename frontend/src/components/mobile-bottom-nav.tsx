import { NavLink } from 'react-router-dom';
import { Gauge, Receipt, CalendarDays, Users, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileBottomNavProps {
  onMore: () => void;
}

// Ordered by daily priority: the briefing first, then the modules with
// time-sensitive daily actions (overdue invoices, today's events, stale deals).
const ITEMS = [
  { to: '/cockpit', label: 'Cockpit', icon: Gauge },
  { to: '/facturation', label: 'Facturation', icon: Receipt },
  { to: '/agenda', label: 'Agenda', icon: CalendarDays },
  { to: '/crm', label: 'CRM', icon: Users },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-2xs font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
  );
}

export function MobileBottomNav({ onMore }: MobileBottomNavProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/90 backdrop-blur-md pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Navigation mobile"
    >
      <div className="flex items-stretch">
        {ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} className={itemClass}>
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
                    isActive && 'bg-accent',
                  )}
                >
                  <item.icon className="size-5" aria-hidden="true" />
                </span>
                <span className="max-w-[68px] truncate">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-1 flex-col items-center justify-center gap-1 py-2 text-2xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Plus d'options"
        >
          <span className="flex h-7 w-12 items-center justify-center rounded-full">
            <Menu className="size-5" aria-hidden="true" />
          </span>
          <span>Plus</span>
        </button>
      </div>
    </nav>
  );
}
