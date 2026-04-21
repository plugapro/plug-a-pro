'use client'

import * as React from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MoreHorizontal, Pencil, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CRUDColumn<T> {
  /** Column header label */
  label: string
  /** Key of T, or a render function */
  key?: keyof T
  render?: (row: T) => React.ReactNode
  /** Width hint (Tailwind class, e.g. 'w-40') */
  width?: string
  /** Whether this column supports inline editing */
  inlineEdit?: boolean
}

export interface CRUDRowAction<T> {
  label: string
  onClick: (row: T) => void
  /** Tailwind text colour class; defaults to standard */
  className?: string
  /** Hide action for certain rows */
  hidden?: (row: T) => boolean
}

export interface CRUDTableProps<T extends { id: string }> {
  rows: T[]
  columns: CRUDColumn<T>[]
  rowActions?: CRUDRowAction<T>[]
  /** Enable checkbox column for bulk selection */
  selectable?: boolean
  /** Max rows that can be selected at once */
  maxSelect?: number
  onSelectionChange?: (selected: T[]) => void
  /** Called when an inline-editable cell is saved */
  onSave?: (row: T, key: keyof T, value: string) => Promise<void>
  /** Loading state — disables interactions */
  loading?: boolean
  emptyMessage?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CRUDTable<T extends { id: string }>({
  rows,
  columns,
  rowActions,
  selectable,
  maxSelect,
  onSelectionChange,
  onSave,
  loading,
  emptyMessage = 'No records found.',
}: CRUDTableProps<T>) {
  const [selected, setSelected] = React.useState<Set<string>>(new Set())
  const [editingCell, setEditingCell] = React.useState<{ id: string; key: keyof T } | null>(null)
  const [editValue, setEditValue] = React.useState('')
  const [savingCell, setSavingCell] = React.useState(false)

  const toggleRow = React.useCallback(
    (row: T) => {
      setSelected((prev) => {
        const next = new Set(prev)
        if (next.has(row.id)) {
          next.delete(row.id)
        } else {
          if (maxSelect && next.size >= maxSelect) return prev
          next.add(row.id)
        }
        const selectedRows = rows.filter((r) => next.has(r.id))
        onSelectionChange?.(selectedRows)
        return next
      })
    },
    [rows, maxSelect, onSelectionChange]
  )

  const toggleAll = React.useCallback(() => {
    setSelected((prev) => {
      const allIds = rows.map((r) => r.id)
      const limit = maxSelect ? allIds.slice(0, maxSelect) : allIds
      const allSelected = limit.every((id) => prev.has(id))
      const next = allSelected ? new Set<string>() : new Set(limit)
      onSelectionChange?.(rows.filter((r) => next.has(r.id)))
      return next
    })
  }, [rows, maxSelect, onSelectionChange])

  const startEdit = (row: T, key: keyof T) => {
    setEditingCell({ id: row.id, key })
    setEditValue(String(row[key] ?? ''))
  }

  const cancelEdit = () => {
    setEditingCell(null)
    setEditValue('')
  }

  const commitEdit = async (row: T, key: keyof T) => {
    if (!onSave) return
    setSavingCell(true)
    try {
      await onSave(row, key, editValue)
    } finally {
      setSavingCell(false)
      setEditingCell(null)
      setEditValue('')
    }
  }

  const allLimitSelected =
    selectable &&
    rows.length > 0 &&
    (maxSelect ? rows.slice(0, maxSelect) : rows).every((r) => selected.has(r.id))

  return (
    <div className={cn('rounded-md border', loading && 'opacity-60 pointer-events-none')}>
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-10">
                <Checkbox checked={allLimitSelected} onCheckedChange={toggleAll} />
              </TableHead>
            )}
            {columns.map((col) => (
              <TableHead key={String(col.key ?? col.label)} className={col.width}>
                {col.label}
              </TableHead>
            ))}
            {rowActions && rowActions.length > 0 && (
              <TableHead className="w-10 text-right">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>

        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectable ? 1 : 0) + (rowActions?.length ? 1 : 0)}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id} data-selected={selected.has(row.id)}>
                {selectable && (
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.id)}
                      onCheckedChange={() => toggleRow(row)}
                    />
                  </TableCell>
                )}

                {columns.map((col) => {
                  const isEditing =
                    editingCell?.id === row.id && editingCell?.key === col.key

                  return (
                    <TableCell key={String(col.key ?? col.label)}>
                      {isEditing ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') commitEdit(row, col.key!)
                              if (e.key === 'Escape') cancelEdit()
                            }}
                            className="h-7 text-sm"
                            autoFocus
                            disabled={savingCell}
                          />
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => commitEdit(row, col.key!)}
                            disabled={savingCell}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={cancelEdit}
                            disabled={savingCell}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 group">
                          <span>{col.render ? col.render(row) : String(row[col.key!] ?? '—')}</span>
                          {col.inlineEdit && col.key && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                              onClick={() => startEdit(row, col.key!)}
                            >
                              <Pencil className="h-3 w-3" />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )
                })}

                {rowActions && rowActions.length > 0 && (
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-7 w-7">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {rowActions
                          .filter((a) => !a.hidden?.(row))
                          .map((action) => (
                            <DropdownMenuItem
                              key={action.label}
                              onClick={() => action.onClick(row)}
                              className={action.className}
                            >
                              {action.label}
                            </DropdownMenuItem>
                          ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {selectable && selected.size > 0 && (
        <div className="border-t px-4 py-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{selected.size} selected</Badge>
          {maxSelect && (
            <span className="ml-2">
              (max {maxSelect})
            </span>
          )}
        </div>
      )}
    </div>
  )
}
