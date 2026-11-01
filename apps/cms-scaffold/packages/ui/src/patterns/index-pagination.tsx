import { Button } from "../components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { fill, uiCopy } from "../copy";

export const PAGE_SIZES = [20, 50, 100] as const;

export interface IndexPaginationProps {
  page: number;
  size: number;
  total: number;
  onPageChange: (page: number) => void;
  onSizeChange: (size: number) => void;
}

/** "共 N 筆", previous / next and page size (surface-back §3.5: page from 1, size up to 100). */
export function IndexPagination({ page, size, total, onPageChange, onSizeChange }: IndexPaginationProps) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <nav aria-label={uiCopy["ui.pagination.size"]} className="flex flex-wrap items-center justify-end gap-3 rounded-b-xl border border-t-0 bg-surface p-3 text-table" data-testid="index-pagination">
      <span className="mr-auto text-subdued" data-testid="index-total">
        {fill(uiCopy["ui.pagination.total"], { total })}
      </span>
      <Button type="button" variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)} data-testid="page-previous">
        {uiCopy["ui.pagination.previous"]}
      </Button>
      <span data-testid="page-current">{fill(uiCopy["ui.pagination.page"], { page, pages })}</span>
      <Button type="button" variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)} data-testid="page-next">
        {uiCopy["ui.pagination.next"]}
      </Button>
      <Select value={String(size)} onValueChange={(value) => onSizeChange(Number(value))}>
        <SelectTrigger aria-label={uiCopy["ui.pagination.size"]} size="sm" className="w-24" data-testid="page-size">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAGE_SIZES.map((option) => (
            <SelectItem key={option} value={String(option)}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </nav>
  );
}
