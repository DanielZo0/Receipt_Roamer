import type { ReactNode } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { MobileCardList, MobileCard, MobileCardRow, MobileCardLabel } from "@/components/ui/responsive-table";
import { Card } from "@/components/ui/card";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Omit this column from the mobile card view (e.g. a column that only
   *  makes sense in a wide table, like a secondary timestamp). */
  hideOnMobile?: boolean;
  className?: string;
};

/** Columns to render in the mobile card view — everything not marked hideOnMobile. */
export function visibleMobileColumns<T>(columns: DataTableColumn<T>[]): DataTableColumn<T>[] {
  return columns.filter((c) => !c.hideOnMobile);
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  isLoading,
  emptyMessage,
  rowActions,
}: {
  columns: DataTableColumn<T>[];
  rows: T[] | undefined;
  isLoading: boolean;
  emptyMessage: string;
  rowActions?: (row: T) => ReactNode;
}) {
  const mobileColumns = visibleMobileColumns(columns);

  return (
    <>
      <Card className="overflow-x-auto hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.className}>
                  {col.header}
                </TableHead>
              ))}
              {rowActions && <TableHead />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-8">
                  Loading…
                </TableCell>
              </TableRow>
            ) : !rows || rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + (rowActions ? 1 : 0)} className="text-center text-muted-foreground py-8">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  {columns.map((col) => (
                    <TableCell key={col.key} className={col.className}>
                      {col.cell(row)}
                    </TableCell>
                  ))}
                  {rowActions && <TableCell>{rowActions(row)}</TableCell>}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {isLoading ? (
        <p className="text-center text-muted-foreground py-8 md:hidden">Loading…</p>
      ) : !rows || rows.length === 0 ? (
        <p className="text-center text-muted-foreground py-8 md:hidden">{emptyMessage}</p>
      ) : (
        <MobileCardList>
          {rows.map((row) => (
            <MobileCard key={row.id} className="space-y-2">
              {mobileColumns.map((col) => (
                <MobileCardRow key={col.key}>
                  <MobileCardLabel>{col.header}</MobileCardLabel>
                  <span className="truncate">{col.cell(row)}</span>
                </MobileCardRow>
              ))}
              {rowActions && <div className="flex justify-end">{rowActions(row)}</div>}
            </MobileCard>
          ))}
        </MobileCardList>
      )}
    </>
  );
}
