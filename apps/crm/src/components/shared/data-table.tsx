"use client";

import * as React from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@persia/ui/table";
import { Button } from "@persia/ui/button";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";

export type ColumnDef<T> = {
  key: string;
  header: string;
  sortable?: boolean;
  className?: string;
  render: (row: T) => React.ReactNode;
};

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
} | null;

type DataTableProps<T> = {
  columns: ColumnDef<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
};

export function DataTable<T extends { id: string }>({
  columns,
  data,
  onRowClick,
}: DataTableProps<T>) {
  const [sort, setSort] = React.useState<SortConfig>(null);

  function handleSort(key: string) {
    setSort((prev) => {
      if (prev?.key === key) {
        if (prev.direction === "asc") return { key, direction: "desc" };
        return null;
      }
      return { key, direction: "asc" };
    });
  }

  const sortedData = React.useMemo(() => {
    if (!sort) return data;

    return [...data].sort((a, b) => {
      const aVal = (a as Record<string, unknown>)[sort.key];
      const bVal = (b as Record<string, unknown>)[sort.key];

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const aStr = String(aVal);
      const bStr = String(bVal);

      const cmp = aStr.localeCompare(bStr, "pt-BR", { sensitivity: "base" });
      return sort.direction === "asc" ? cmp : -cmp;
    });
  }, [data, sort]);

  function getSortIcon(key: string) {
    if (sort?.key !== key) return <ArrowUpDown className="size-3.5" />;
    return sort.direction === "asc" ? (
      <ArrowUp className="size-3.5" />
    ) : (
      <ArrowDown className="size-3.5" />
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          {columns.map((col) => (
            <TableHead key={col.key} className={col.className}>
              {col.sortable ? (
                <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-2 gap-1"
                  onClick={() => handleSort(col.key)}
                >
                  {col.header}
                  {getSortIcon(col.key)}
                </Button>
              ) : (
                col.header
              )}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {sortedData.map((row) => (
          <TableRow
            key={row.id}
            className={onRowClick ? "cursor-pointer" : ""}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((col) => (
              <TableCell key={col.key} className={col.className}>
                {col.render(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
