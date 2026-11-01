import { useEffect, useState } from "react";
import { SearchIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/tabs";
import { fill, uiCopy } from "../copy";

export interface FilterOption {
  value: string;
  label: string;
}

export interface IndexFilter {
  key: string;
  label: string;
  options: FilterOption[];
  /** "" means no filter. */
  value: string;
}

export interface IndexFiltersProps {
  tabs: FilterOption[];
  tab: string;
  onTabChange: (value: string) => void;
  query: string;
  /** Called 300ms after the user stops typing (01 §6.2). */
  onQueryChange: (value: string) => void;
  filters: IndexFilter[];
  onFilterChange: (key: string, value: string) => void;
  sortOptions: FilterOption[];
  sort: string;
  onSortChange: (value: string) => void;
  /** Shown when any filter or query is set. */
  onClear?: () => void;
}

const ANY = "__any__";

/** 01 §6.2: state tabs, debounced search, enum filters and sort; the page keeps all of them in the URL. */
export function IndexFilters(props: IndexFiltersProps) {
  const { tabs, tab, onTabChange, query, onQueryChange, filters, onFilterChange, sortOptions, sort, onSortChange, onClear } = props;
  const [text, setText] = useState(query);
  useEffect(() => setText(query), [query]);
  useEffect(() => {
    if (text === query) return undefined;
    const timer = setTimeout(() => onQueryChange(text), 300);
    return () => clearTimeout(timer);
  }, [text, query, onQueryChange]);
  return (
    <div className="flex flex-col gap-3 rounded-t-xl border border-b-0 bg-surface p-3" data-testid="index-filters">
      <Tabs value={tab} onValueChange={onTabChange}>
        <TabsList>
          {tabs.map((option) => (
            // No TabsContent: the tabs filter the table below, so the generated aria-controls would point nowhere (axe).
            <TabsTrigger key={option.value} value={option.value} aria-controls={undefined} data-testid={`tab-${option.value}`}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-subdued" aria-hidden="true" />
          <Input
            aria-label={uiCopy["ui.index.search"]}
            placeholder={uiCopy["ui.index.search"]}
            className="pl-8"
            value={text}
            onChange={(event) => setText(event.target.value)}
            data-testid="index-search"
          />
        </div>
        {filters.map((filter) => (
          <Select key={filter.key} value={filter.value || ANY} onValueChange={(value) => onFilterChange(filter.key, value === ANY ? "" : value)}>
            <SelectTrigger aria-label={filter.label} className="w-40" data-testid={`filter-${filter.key}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY}>{fill(uiCopy["ui.index.filterAll"], { label: filter.label })}</SelectItem>
              {filter.options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
        <Select value={sort} onValueChange={onSortChange}>
          <SelectTrigger aria-label={uiCopy["ui.index.sort"]} className="w-40" data-testid="index-sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sortOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {onClear ? (
          <Button type="button" variant="ghost" onClick={onClear} data-testid="index-clear">
            {uiCopy["ui.index.clear"]}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
