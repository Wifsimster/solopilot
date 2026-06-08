import { useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  KeyboardSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

export type Stage = 'nouveau' | 'qualifie' | 'proposition' | 'gagne' | 'perdu';

export interface Deal {
  id: string;
  contact_id: string;
  title: string;
  stage: Stage;
  amount_cents: number;
}

const STAGES: { key: Stage; label: string }[] = [
  { key: 'nouveau', label: 'Nouveau' },
  { key: 'qualifie', label: 'Qualifié' },
  { key: 'proposition', label: 'Proposition' },
  { key: 'gagne', label: 'Gagné' },
  { key: 'perdu', label: 'Perdu' },
];

const euros = (cents: number) => `${(cents / 100).toFixed(0)} €`;

function DealCard({
  deal,
  contactName,
  dragging,
}: {
  deal: Deal;
  contactName: string;
  dragging?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-md border bg-card p-2 text-xs shadow-sm',
        dragging && 'opacity-50',
      )}
    >
      <div className="font-medium">{deal.title}</div>
      <div className="text-muted-foreground">{contactName}</div>
      {deal.amount_cents > 0 && <div className="tabular-nums">{euros(deal.amount_cents)}</div>}
    </div>
  );
}

function DraggableDeal({ deal, contactName }: { deal: Deal; contactName: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: deal.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className="cursor-grab touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md"
    >
      <DealCard deal={deal} contactName={contactName} dragging={isDragging} />
    </div>
  );
}

function StageColumn({
  stage,
  label,
  deals,
  contactName,
}: {
  stage: Stage;
  label: string;
  deals: Deal[];
  contactName: (id: string) => string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const total = deals.reduce((s, d) => s + d.amount_cents, 0);
  return (
    <Card ref={setNodeRef} className={cn('transition-colors', isOver && 'ring-2 ring-ring')}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between text-sm font-semibold">
          {label}
          <Badge variant="outline" className="text-xs">
            {deals.length}
          </Badge>
        </div>
        {total > 0 && <div className="text-xs text-muted-foreground">{euros(total)}</div>}
      </CardHeader>
      <CardContent className="min-h-16 space-y-2">
        {deals.map((d) => (
          <DraggableDeal key={d.id} deal={d} contactName={contactName(d.contact_id)} />
        ))}
      </CardContent>
    </Card>
  );
}

export function DealPipeline({
  deals,
  contactName,
  onMove,
}: {
  deals: Deal[];
  contactName: (id: string) => string;
  onMove: (dealId: string, stage: Stage) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor),
  );

  const activeDeal = deals.find((d) => d.id === activeId) ?? null;

  function handleDragStart(event: DragStartEvent) {
    setActiveId(String(event.active.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const stage = over.id as Stage;
    const deal = deals.find((d) => d.id === active.id);
    if (deal && deal.stage !== stage) {
      onMove(deal.id, stage);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {STAGES.map((s) => (
          <StageColumn
            key={s.key}
            stage={s.key}
            label={s.label}
            deals={deals.filter((d) => d.stage === s.key)}
            contactName={contactName}
          />
        ))}
      </div>
      <DragOverlay>
        {activeDeal ? (
          <DealCard deal={activeDeal} contactName={contactName(activeDeal.contact_id)} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
