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
        'rounded-lg border border-border bg-card px-3 py-2.5 text-xs shadow-xs hover:border-muted-foreground/20 transition-colors',
        dragging && 'opacity-50 shadow-md rotate-1',
      )}
    >
      <div className="font-medium text-foreground leading-snug">{deal.title}</div>
      <div className="mt-0.5 text-muted-foreground">{contactName}</div>
      {deal.amount_cents > 0 && (
        <div className="mt-1.5 tabular-nums font-semibold text-foreground/80">
          {euros(deal.amount_cents)}
        </div>
      )}
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
    <Card
      ref={setNodeRef}
      className={cn(
        'w-[260px] shrink-0 snap-start transition-colors',
        isOver && 'ring-2 ring-ring bg-accent/40',
      )}
    >
      <CardHeader className="pb-2 px-4 pt-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold tracking-tight">{label}</span>
          <Badge variant={deals.length > 0 ? 'secondary' : 'outline'} className="tabular-nums text-xs">
            {deals.length}
          </Badge>
        </div>
        {total > 0 && (
          <div className="text-xs tabular-nums text-muted-foreground font-medium">
            {euros(total)}
          </div>
        )}
      </CardHeader>
      <CardContent className="min-h-20 space-y-2 px-4 pb-4">
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
      <div className="overflow-x-auto pb-3 -mx-4 px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-3 snap-x snap-mandatory">
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
      </div>
      <DragOverlay>
        {activeDeal ? (
          <DealCard deal={activeDeal} contactName={contactName(activeDeal.contact_id)} />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
