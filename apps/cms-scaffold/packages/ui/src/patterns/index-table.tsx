import type { ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Skeleton } from "../components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

export interface IndexColumn<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

export interface IndexTableProps<T> {
  columns: IndexColumn<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  /** Link target of a row. The first column renders it as a real <a>; clicking elsewhere in the row navigates too. */
  rowHref: (row: T) => string;
  /** Title of the first column's link, for example the entry title. */
  rowLabel: (row: T) => ReactNode;
  loading: boolean;
  /** Shown instead of the table when loaded with zero rows. */
  empty: ReactNode;
}

/** 01 §6.2: a table whose rows open a resource. Loading shows skeleton rows; never the empty slot (C-02). */
export function IndexTable<T>({ columns, rows, rowKey, rowHref, rowLabel, loading, empty }: IndexTableProps<T>) {
  const navigate = useNavigate();
  if (!loading && rows && rows.length === 0) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-xl border bg-surface" data-testid="index-table">
      <Table className="text-table">
        <TableHeader className="bg-surface-subdued">
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.className}>
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading || !rows
            ? Array.from({ length: 5 }, (_, i) => (
                <TableRow key={i} data-testid="index-row-loading">
                  {columns.map((column) => (
                    <TableCell key={column.key}>
                      <Skeleton className="h-4 w-full" />
                    </TableCell>
                  ))}
                </TableRow>
              ))
            : rows.map((row) => (
                <TableRow
                  key={rowKey(row)}
                  className="cursor-pointer"
                  data-testid="index-row"
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("a,button,input,select")) return;
                    navigate(rowHref(row));
                  }}
                >
                  {columns.map((column, index) => (
                    <TableCell key={column.key} className={column.className}>
                      {index === 0 ? (
                        <Link to={rowHref(row)} className="font-semibold hover:underline">
                          {rowLabel(row)}
                        </Link>
                      ) : (
                        column.cell(row)
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
        </TableBody>
      </Table>
    </div>
  );
}
