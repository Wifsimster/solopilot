import * as React from 'react';
import {
  type ColumnDef,
  type ColumnFiltersState,
  type FilterFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

// Generic sortable + faceted-filter table on TanStack Table v8 — see ADR-0021.

export interface FacetedFilter {
  columnId: string;
  title: string;
  options: { label: string; value: string }[];
}

// Faceted filter: the column filter value is a string[]; a row matches when its
// value is in the selected set (empty set = no filtering).
const arrIncludes: FilterFn<unknown> = (row, columnId, filterValue: string[]) =>
  !filterValue?.length || filterValue.includes(String(row.getValue(columnId)));

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  emptyMessage?: React.ReactNode;
  initialSorting?: SortingState;
  facetedFilters?: FacetedFilter[];
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  emptyMessage = 'Aucune donnée.',
  initialSorting = [],
  facetedFilters,
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([]);

  // Wire the faceted columns to the array filter fn without burdening callers.
  const facetedIds = React.useMemo(
    () => new Set(facetedFilters?.map((f) => f.columnId)),
    [facetedFilters],
  );
  const resolvedColumns = React.useMemo(
    () =>
      columns.map((col) => {
        const id = (col as { accessorKey?: string; id?: string }).accessorKey ?? col.id;
        return id && facetedIds.has(id)
          ? { ...col, filterFn: arrIncludes as FilterFn<TData> }
          : col;
      }),
    [columns, facetedIds],
  );

  const table = useReactTable({
    data,
    columns: resolvedColumns,
    state: { sorting, columnFilters },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  return (
    <div className={cn('space-y-3', className)}>
      {facetedFilters && facetedFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {facetedFilters.map((filter) => {
            const column = table.getColumn(filter.columnId);
            const selected = new Set((column?.getFilterValue() as string[]) ?? []);
            return (
              <div key={filter.columnId} className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{filter.title} :</span>
                {filter.options.map((option) => {
                  const active = selected.has(option.value);
                  return (
                    <Button
                      key={option.value}
                      type="button"
                      size="sm"
                      variant={active ? 'secondary' : 'outline'}
                      aria-pressed={active}
                      className="h-7 px-2.5 text-xs"
                      onClick={() => {
                        const next = new Set(selected);
                        if (active) next.delete(option.value);
                        else next.add(option.value);
                        column?.setFilterValue(next.size ? [...next] : undefined);
                      }}
                    >
                      {option.label}
                    </Button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const sorted = header.column.getIsSorted();
                  return (
                    <TableHead key={header.id} className={cn(canSort && 'p-0')}>
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="flex h-12 w-full items-center gap-1 px-4 text-left font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={`Trier par ${String(header.column.columnDef.header)}`}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {sorted === 'asc' ? (
                            <ArrowUp className="h-3.5 w-3.5" />
                          ) : sorted === 'desc' ? (
                            <ArrowDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center text-muted-foreground">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
