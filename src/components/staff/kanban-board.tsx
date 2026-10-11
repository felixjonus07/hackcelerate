"use client";
/**
 * Counseling Kanban (§8.2) with dnd-kit: pointer and keyboard sensors with
 * screen-reader announcements (§12.4). Every move is also available from a
 * plain select, so dragging is never required.
 */
import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { AlertCircle, Clock } from "lucide-react";
import Link from "next/link";
import { useId, useOptimistic, useRef, useState, useTransition } from "react";
import { moveCounselingCard } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { relativeDays } from "@/lib/format";
import { COLUMN_LABELS } from "@/lib/labels";

type ColumnKey = "REFERRED" | "SCHEDULED" | "IN_CONVERSATION" | "PLAN_ACTIVE" | "FOLLOW_UP_DUE" | "CLOSED";
interface KCard {
  id: string;
  studentId: string;
  pseudonymousId: string;
  departmentCode: string;
  nextDate: string | null;
  stale: boolean;
  quests: { done: number; total: number };
}
interface KColumn {
  column: ColumnKey;
  cards: KCard[];
}
const ORDER: ColumnKey[] = ["REFERRED", "SCHEDULED", "IN_CONVERSATION", "PLAN_ACTIVE", "FOLLOW_UP_DUE", "CLOSED"];

export function KanbanBoard({
  columns,
  wipLimit,
  openCount,
}: {
  columns: KColumn[];
  wipLimit: number;
  openCount: number;
}) {
  const dndId = useId();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [backward, setBackward] = useState<{
    card: KCard;
    from: ColumnKey;
    to: ColumnKey;
  } | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [optimistic, applyMove] = useOptimistic(columns, (cols: KColumn[], m: { id: string; to: ColumnKey }) => {
    const card = cols.flatMap((c) => c.cards).find((c) => c.id === m.id);
    if (!card) return cols;
    return cols.map((c) => ({
      ...c,
      cards: c.column === m.to ? [...c.cards.filter((k) => k.id !== m.id), card] : c.cards.filter((k) => k.id !== m.id),
    }));
  });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const commit = (card: KCard, to: ColumnKey, reason?: string) =>
    start(async () => {
      applyMove({ id: card.id, to });
      const r = await moveCounselingCard({ cardId: card.id, to, reason });
      setMessage(r.ok ? `${card.pseudonymousId} moved to ${COLUMN_LABELS[to]}.` : r.message);
    });

  const request = (card: KCard, from: ColumnKey, to: ColumnKey) => {
    if (from === to) return;
    if (ORDER.indexOf(to) < ORDER.indexOf(from)) {
      setBackward({ card, from, to });
      dialogRef.current?.showModal();
    } else commit(card, to);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const to = e.over?.id as ColumnKey | undefined;
    const from = e.active.data.current?.column as ColumnKey;
    const card = optimistic.flatMap((c) => c.cards).find((c) => c.id === e.active.id);
    if (to && card) request(card, from, to);
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "tabular rounded-full px-3 py-1.5 text-sm font-bold",
            openCount > wipLimit ? "bg-crit-bg text-crit" : "bg-sand-2 text-ink-2",
          )}
        >
          {openCount} of {wipLimit} open cards
        </span>
        {openCount > wipLimit ? (
          <span className="text-sm font-semibold text-crit">
            You're over your work-in-progress limit. Ask your HOD to rebalance.
          </span>
        ) : null}
        <output aria-live="polite" className="text-sm text-ink-2">
          {message}
        </output>
      </div>
      <DndContext
        id={dndId}
        sensors={sensors}
        onDragEnd={onDragEnd}
        accessibility={{
          announcements: {
            onDragStart: ({ active }) => `Picked up ${active.data.current?.label}.`,
            onDragOver: ({ over }) => (over ? `Over ${COLUMN_LABELS[String(over.id)]}.` : "Not over a column."),
            onDragEnd: ({ over, active }) =>
              over ? `Dropped ${active.data.current?.label} in ${COLUMN_LABELS[String(over.id)]}.` : "Move cancelled.",
            onDragCancel: () => "Move cancelled.",
          },
        }}
      >
        <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0 xl:grid xl:grid-cols-[repeat(6,minmax(0,1fr))] xl:overflow-visible">
          {optimistic.map((col) => (
            <Column key={col.column} col={col} onMove={request} disabled={pending} />
          ))}
        </div>
      </DndContext>

      <dialog
        ref={dialogRef}
        className="m-auto w-[min(440px,calc(100vw-2rem))] rounded-card bg-card p-6 text-ink shadow-lift backdrop:bg-ink/30"
        onClose={() => setBackward(null)}
      >
        <form
          method="dialog"
          onSubmit={(e) => {
            const reason = String(new FormData(e.currentTarget).get("reason") ?? "").trim();
            if (backward && reason) commit(backward.card, backward.to, reason);
          }}
        >
          <h2 className="text-lg font-extrabold">Why move {backward?.card.pseudonymousId} back?</h2>
          <p className="mt-1 text-sm text-ink-2">
            From {backward ? COLUMN_LABELS[backward.from] : ""} to {backward ? COLUMN_LABELS[backward.to] : ""}. The
            reason is saved with the move.
          </p>
          <textarea
            name="reason"
            required
            rows={3}
            maxLength={300}
            className="mt-4 w-full rounded-field border border-line bg-card px-3.5 py-2.5"
          />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => dialogRef.current?.close()}>
              Cancel
            </Button>
            <Button type="submit">Move card</Button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function Column({
  col,
  onMove,
  disabled,
}: {
  col: KColumn;
  onMove: (c: KCard, from: ColumnKey, to: ColumnKey) => void;
  disabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.column });
  return (
    <section
      ref={setNodeRef}
      aria-label={COLUMN_LABELS[col.column]}
      className={cn(
        "w-[240px] min-w-0 shrink-0 snap-start rounded-card bg-sand-2 p-2.5 transition-colors xl:w-auto",
        isOver && "bg-sand-3",
      )}
    >
      <h2 className="flex items-center justify-between px-1.5 pb-3 pt-1 font-extrabold">
        {COLUMN_LABELS[col.column]}
        <span className="tabular rounded-full bg-card px-2 text-sm text-ink-2">{col.cards.length}</span>
      </h2>
      <ul className="grid min-h-24 gap-2.5">
        {col.cards.length === 0 ? (
          <li className="rounded-2xl border border-dashed border-sand-3 px-3 py-5 text-center text-sm text-ink-2">
            No students here yet
          </li>
        ) : null}
        {col.cards.map((c) => (
          <KanbanCard key={c.id} card={c} column={col.column} onMove={onMove} disabled={disabled} />
        ))}
      </ul>
    </section>
  );
}

function KanbanCard({
  card,
  column,
  onMove,
  disabled,
}: {
  card: KCard;
  column: ColumnKey;
  onMove: (c: KCard, from: ColumnKey, to: ColumnKey) => void;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: card.id,
    data: { column, label: card.pseudonymousId },
  });
  return (
    <li
      ref={setNodeRef}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cn("min-w-0 rounded-2xl bg-card p-3 shadow-card", isDragging && "relative z-10 shadow-lift")}
    >
      <div {...listeners} {...attributes} className="cursor-grab touch-none rounded-lg active:cursor-grabbing">
        <p className="font-extrabold">
          {card.pseudonymousId} <span className="text-sm font-semibold text-ink-2">{card.departmentCode}</span>
        </p>
        {card.stale ? (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-mod" title="No activity for 14 days">
            <AlertCircle aria-hidden className="size-3.5" /> 14 days quiet
          </p>
        ) : null}
        <p className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          <span className="font-semibold">
            Quests {card.quests.done}/{card.quests.total}
          </span>
          {card.nextDate ? (
            <span className="inline-flex items-center gap-1 text-ink-2">
              <Clock aria-hidden className="size-3.5" />
              {relativeDays(card.nextDate)}
            </span>
          ) : null}
        </p>
      </div>
      <div className="mt-3 grid gap-2 border-t border-line pt-2.5">
        <label className="sr-only" htmlFor={`move-${card.id}`}>
          Move {card.pseudonymousId} to
        </label>
        <select
          id={`move-${card.id}`}
          disabled={disabled}
          value={column}
          onChange={(e) => onMove(card, column, e.target.value as ColumnKey)}
          className="h-8 w-full min-w-0 rounded-lg border border-line bg-card px-2 text-sm"
        >
          {ORDER.map((o) => (
            <option key={o} value={o}>
              {COLUMN_LABELS[o]}
            </option>
          ))}
        </select>
        <Link
          href={`/admin/students/${card.studentId}?reason=scheduled_mentoring`}
          className="text-sm font-bold text-act hover:underline"
        >
          Open brief
        </Link>
      </div>
    </li>
  );
}
