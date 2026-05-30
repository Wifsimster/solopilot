import { NavLink } from 'react-router-dom';
import { LayoutDashboard, FileText, Target, Wand2, MoreHorizontal } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileBottomNavProps {
  onMore: () => void;
}

const ITEMS = [
  { to: '/', label: 'Accueil', icon: LayoutDashboard, end: true },
  { to: '/summaries', label: 'Synthèses', icon: FileText },
  { to: '/leads', label: 'Opportunités', icon: Target },
  { to: '/studio', label: 'Studio', icon: Wand2 },
];

function itemClass({ isActive }: { isActive: boolean }) {
  return cn(
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition-colors',
    isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
  );
}

export function MobileBottomNav({ onMore }: MobileBottomNavProps) {
  return (
    <nav
      className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 pb-[env(safe-area-inset-bottom)]"
      aria-label="Navigation mobile"
    >
      <div className="flex items-stretch">
        {ITEMS.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={itemClass}>
            {({ isActive }) => (
              <>
                <item.icon
                  className={cn('size-5', isActive && 'scale-110')}
                  aria-hidden="true"
                />
                <span className="truncate max-w-[64px]">{item.label}</span>
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          onClick={onMore}
          className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Plus d'options"
        >
          <MoreHorizontal className="size-5" aria-hidden="true" />
          <span>Plus</span>
        </button>
      </div>
    </nav>
  );
}
