'use client';

// <CRUDTable> — the single table component every admin list page uses.
//
// Features:
//   - Typed columns with accessor or render fn.
//   - Optional row-level actions (edit, delete, custom).
//   - Optional bulk selection + bulk actions.
//   - Optional inline edit (see 'inlineEdit' column prop).
//   - Row click → rowHref navigation.
//   - Sticky header, responsive.
//
// Deliberately light on styling opinions — assumes Tailwind + shadcn
// primitives (Button, DropdownMenu). Swap primitives if you use a
// different library.

import * as React from 'react';
import Link from 'next/link';
import { MoreHorizontal, Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// --- Types ---------------------------------------------------------------

export interface ColumnDef<T> {
  header: string;
  /** Simple property accessor for typical cases. */
  accessor?: keyof T;
  /** Custom renderer; use when accessor isn't enough. */
  render?: (row: T) => React.ReactNode;
  /** Enable inline edit on this column. Only supported for string/number fields. */
  inlineEdit?: {
    type: 'text' | 'number';
    onSave: (row: T, newValue: string) => Promise<void> | void;
    /** Optional validator. Return string error message or null. */
    validate?: (v: string) => string | null;
  };
  /** Optional CSS class for the cell. */
  className?: string;
}

export interface RowAction<T> {
  label: string;
  onSelect: (row: T) => void;
  destructive?: boolean;
  /** Optional: hide for specific rows. */
  hidden?: (row: T) => boolean;
}

export interface BulkAction<T> {
  label: string;
  onSelect: (rows: T[]) => Promise<void> | void;
  destructive?: boolean;
}

interface Props<T extends { id: string }> {
  columns: ColumnDef<T>[];
  rows: T[];
  /** If provided, whole rows become clickable links. */
  rowHref?: (row: T) => string;
  rowActions?: RowAction<T>[];
  bulk?: {
    actions: BulkAction<T>[];
    /** Cap on selection size. Default 50. */
    maxSelect?: number;
  };
  /** Rendered when rows.length === 0. */
  emptyState?: React.ReactNode;
  /** Optional extra class on the <table>. */
  className?: string;
}

// --- Component -----------------------------------------------------------

export function CRUDTable<T extends { id: string }>({
  columns,
  rows,
  rowHref,
  rowActions,
  bulk,
  emptyState,
  className,
}: Props<T>) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const maxSelect = bulk?.maxSelect ?? 50;

  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < maxSelect) next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === rows.length) return new Set();
      return new Set(rows.slice(0, maxSelect).map((r) => r.id));
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));

  if (rows.length === 0 && emptyState) {
    return <div className="py-16 text-center text-muted-foreground">{emptyState}</div>;
  }

  return (
    <div className="space-y-3">
      {bulk && selectedRows.length > 0 && (
        <BulkBar
          count={selectedRows.length}
          actions={bulk.actions}
          onAction={async (action) => {
            await action.onSelect(selectedRows);
            setSelected(new Set());
          }}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="overflow-x-auto rounded-md border">
        <table className={cn('w-full text-sm', className)}>
          <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {bulk && (
                <th className="w-10 p-3 text-left">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === rows.length}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && selected.size < rows.length;
                    }}
                    onChange={toggleAll}
                    aria-label="Select all"
                  />
                </th>
              )}
              {columns.map((c) => (
                <th key={c.header} className="p-3 text-left font-medium">
                  {c.header}
                </th>
              ))}
              {rowActions && rowActions.length > 0 && <th className="w-12 p-3" aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Row
                key={row.id}
                row={row}
                columns={columns}
                rowHref={rowHref}
                rowActions={rowActions}
                bulk={Boolean(bulk)}
                selected={selected.has(row.id)}
                onToggle={toggleOne}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length >= maxSelect && bulk && selectedRows.length >= maxSelect && (
        <p className="text-xs text-amber-600">
          Selection capped at {maxSelect} rows per operation.
        </p>
      )}
    </div>
  );
}

// --- Row -----------------------------------------------------------------

interface RowProps<T extends { id: string }> {
  row: T;
  columns: ColumnDef<T>[];
  rowHref?: (row: T) => string;
  rowActions?: RowAction<T>[];
  bulk: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
}

function Row<T extends { id: string }>({ row, columns, rowHref, rowActions, bulk, selected, onToggle }: RowProps<T>) {
  return (
    <tr className={cn('border-t hover:bg-muted/30', selected && 'bg-muted/40')}>
      {bulk && (
        <td className="p-3">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggle(row.id)}
            aria-label={`Select row ${row.id}`}
          />
        </td>
      )}
      {columns.map((c) => (
        <td key={c.header} className={cn('p-3 align-middle', c.className)}>
          {c.inlineEdit ? (
            <InlineEditCell row={row} column={c} />
          ) : c.render ? (
            c.render(row)
          ) : c.accessor ? (
            rowHref ? (
              <Link className="hover:underline" href={rowHref(row)}>
                {String(row[c.accessor] ?? '—')}
              </Link>
            ) : (
              <span>{String(row[c.accessor] ?? '—')}</span>
            )
          ) : null}
        </td>
      ))}
      {rowActions && rowActions.length > 0 && (
        <td className="p-3">
          <RowActionsMenu row={row} actions={rowActions} />
        </td>
      )}
    </tr>
  );
}

// --- Inline edit cell ---------------------------------------------------

function InlineEditCell<T extends { id: string }>({ row, column }: { row: T; column: ColumnDef<T> }) {
  const accessor = column.accessor!;
  const initial = String(row[accessor] ?? '');
  const [editing, setEditing] = React.useState(false);
  const [value, setValue] = React.useState(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    setValue(initial);
  }, [initial]);

  const commit = async () => {
    if (column.inlineEdit!.validate) {
      const err = column.inlineEdit!.validate(value);
      if (err) {
        setError(err);
        return;
      }
    }
    if (value === initial) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await column.inlineEdit!.onSave(row, value);
      setEditing(false);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button className="text-left hover:underline" onClick={() => setEditing(true)}>
        {initial || '—'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1">
      <input
        autoFocus
        className={cn('rounded border px-2 py-1 text-sm', error && 'border-red-500')}
        type={column.inlineEdit!.type}
        value={value}
        disabled={saving}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void commit();
          if (e.key === 'Escape') {
            setValue(initial);
            setEditing(false);
          }
        }}
      />
      <button className="rounded p-1 hover:bg-muted" onClick={() => void commit()} aria-label="Save" disabled={saving}>
        <Check className="h-4 w-4" />
      </button>
      <button
        className="rounded p-1 hover:bg-muted"
        onClick={() => {
          setValue(initial);
          setEditing(false);
          setError(null);
        }}
        aria-label="Cancel"
      >
        <X className="h-4 w-4" />
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}

// --- Row actions menu ----------------------------------------------------

function RowActionsMenu<T extends { id: string }>({ row, actions }: { row: T; actions: RowAction<T>[] }) {
  const [open, setOpen] = React.useState(false);
  const visible = actions.filter((a) => !a.hidden || !a.hidden(row));
  if (visible.length === 0) return null;

  return (
    <div className="relative inline-block text-left">
      <button
        className="rounded p-1 hover:bg-muted"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md"
          onMouseLeave={() => setOpen(false)}
        >
          {visible.map((a) => (
            <button
              key={a.label}
              role="menuitem"
              className={cn(
                'block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-muted',
                a.destructive && 'text-red-600',
              )}
              onClick={() => {
                setOpen(false);
                a.onSelect(row);
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Bulk bar ------------------------------------------------------------

interface BulkBarProps<T> {
  count: number;
  actions: BulkAction<T>[];
  onAction: (action: BulkAction<T>) => void;
  onClear: () => void;
}

function BulkBar<T>({ count, actions, onAction, onClear }: BulkBarProps<T>) {
  return (
    <div className="flex items-center justify-between rounded-md border bg-muted/30 p-2">
      <div className="text-sm">
        <strong>{count}</strong> selected
        <button className="ml-2 text-xs underline" onClick={onClear}>
          clear
        </button>
      </div>
      <div className="flex gap-1">
        {actions.map((a) => (
          <button
            key={a.label}
            className={cn(
              'rounded border px-3 py-1 text-xs hover:bg-background',
              a.destructive && 'text-red-600',
            )}
            onClick={() => onAction(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
