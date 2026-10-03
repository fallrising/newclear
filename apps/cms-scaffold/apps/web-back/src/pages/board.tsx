import { useRef, useState } from "react";
import { Link } from "react-router";
import { DndContext, DragOverlay, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { keys, workQueries, type WorkEntry, type WorkEntryPage, type WorkField } from "@cms/api";
import { useSession } from "@cms/auth";
import { enumLabel } from "@cms/fields";
import {
  Button,
  Card,
  CardContent,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  EmptyState,
  fill,
  Input,
  Label,
  PageHeader,
  QueryBoundary,
  StatusBadge,
  Switch,
  Tabs,
  TabsList,
  TabsTrigger,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can } from "../nav";
import { dndTexts, EntrySelect, pickEntry, titleOf, useDropClickGuard, useQueryParam, VIEW_PAGE_SIZE } from "./view-common";

/** surface-back §3.3: the board's columns are the `status` enum field of issue, never the publication state. */
const STATUS = "status";

function statusOf(issue: WorkEntry): string {
  return typeof issue.payload[STATUS] === "string" ? String(issue.payload[STATUS]) : "";
}

interface CardProps {
  issue: WorkEntry;
  field: WorkField;
  busy: boolean;
  onMove: (issue: WorkEntry, status: string) => void;
}

function IssueCard({ issue, field, busy, onMove }: CardProps) {
  const me = useSession().me!;
  const draggable = useDraggable({ id: issue.id, disabled: busy || !can(me, "issue", "update") });
  const guard = useDropClickGuard(draggable.isDragging);
  const title = titleOf(issue);
  const current = statusOf(issue);
  return (
    <li
      ref={draggable.setNodeRef}
      {...draggable.listeners}
      {...guard}
      className={cn("touch-none", draggable.isDragging && "opacity-50")}
      data-testid="board-card"
      data-issue={issue.id}
    >
      <Card className="gap-2 py-3">
        <CardContent className="flex items-start justify-between gap-2 px-3">
          <div className="flex min-w-0 flex-col gap-2">
            {/* draggable={false}: the browser's own link dragging would cancel the pointer drag of the card. */}
            <Link to={`/entries/issue/${issue.id}`} draggable={false} className="font-semibold hover:underline">
              {title}
            </Link>
            <StatusBadge state={issue.publicationState} dirty={issue.dirty} requested={issue.publishRequestedAt !== null} />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" aria-label={fill(copy["board.actions"], { title })} data-testid="board-menu">
                <span aria-hidden="true">⋯</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuSub>
                <DropdownMenuSubTrigger data-testid="board-move">{copy["board.moveTo"]}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {field.enumValues.map((value) => (
                    <DropdownMenuItem key={value} disabled={value === current} onSelect={() => onMove(issue, value)} data-testid={`board-move-${value}`}>
                      {enumLabel(field, value)}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              <DropdownMenuItem asChild>
                <Link to={`/entries/issue/${issue.id}`}>{copy["board.edit"]}</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </CardContent>
      </Card>
    </li>
  );
}

function Column({ value, label, issues, field, active, busy, onMove }: { value: string; label: string; issues: WorkEntry[]; field: WorkField; active: boolean; busy: boolean; onMove: CardProps["onMove"] }) {
  const droppable = useDroppable({ id: value });
  return (
    <section
      ref={droppable.setNodeRef}
      aria-label={label}
      // U-03: below md only the active column is shown (the tabs above switch it); md and up show all columns.
      className={cn("min-w-0 flex-col gap-2 rounded-xl border bg-surface-subdued p-2 md:flex", active ? "flex" : "hidden", droppable.isOver && "border-primary")}
      data-testid={`board-column-${value}`}
    >
      <h2 className="px-1 text-table font-semibold text-subdued">{fill(copy["board.column"], { label, n: issues.length })}</h2>
      {issues.length ? (
        <ol className="flex flex-col gap-2">
          {issues.map((issue) => (
            <IssueCard key={issue.id} issue={issue} field={field} busy={busy} onMove={onMove} />
          ))}
        </ol>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-center text-subdued">{copy["board.dropHere"]}</p>
      )}
    </section>
  );
}

function Issues({ project, field }: { project: WorkEntry; field: WorkField }) {
  const queryClient = useQueryClient();
  const [archived, setArchived] = useState(false);
  const [text, setText] = useState("");
  const [tab, setTab] = useState(field.enumValues[0] ?? "");
  const writing = useRef(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  const params = { ref: { project: project.id }, sort: "sortOrder", size: VIEW_PAGE_SIZE, ...(archived ? { state: "draft,published,archived" } : {}) };
  const listKey = keys.entries.list("issue", params);
  const issues = useQuery(workQueries.entries(api.work, "issue", params));

  // 01 §4.3: optimistic move; on failure the card goes back and a toast says so (V2-AC-12).
  const move = useMutation({
    mutationFn: ({ issue, status }: { issue: WorkEntry; status: string }) => api.work.patch(issue.id, { version: issue.version, payload: { [STATUS]: status } }),
    onSettled: () => { writing.current = false; },
    onMutate: async ({ issue, status }) => {
      await queryClient.cancelQueries({ queryKey: listKey });
      const previous = queryClient.getQueryData<WorkEntryPage>(listKey);
      queryClient.setQueryData<WorkEntryPage>(listKey, (page) =>
        page ? { ...page, items: page.items.map((i) => (i.id === issue.id ? { ...i, payload: { ...i.payload, [STATUS]: status } } : i)) } : page,
      );
      return { previous };
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<WorkEntryPage>(listKey, (page) => (page ? { ...page, items: page.items.map((i) => (i.id === updated.id ? updated : i)) } : page));
      queryClient.setQueryData(keys.entries.detail(updated.id), updated);
      toast.success(fill(copy["board.moved"], { title: titleOf(updated), status: enumLabel(field, statusOf(updated)) }));
    },
    onError: (_error, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(listKey, context.previous);
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists("issue") });
      toast.error(copy["board.moveFailed"]);
    },
  });

  const onMove = (issue: WorkEntry, status: string) => {
    if (writing.current || status === statusOf(issue) || !field.enumValues.includes(status)) return;
    writing.current = true;
    move.mutate({ issue, status });
  };

  const byId = new Map((issues.data?.items ?? []).map((i) => [i.id, i]));
  function dragEnd({ active, over }: DragEndEvent) {
    setDragging(null);
    const issue = byId.get(String(active.id));
    if (issue && over) onMove(issue, String(over.id));
  }
  const name = (id: string | number) => (byId.has(String(id)) ? titleOf(byId.get(String(id))!) : "");
  const columnName = (id: string | number) => enumLabel(field, String(id));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="board-search">{copy["board.search"]}</Label>
          <Input id="board-search" type="search" className="w-56" value={text} onChange={(event) => setText(event.target.value)} />
        </div>
        <div className="flex items-center gap-2 pb-2">
          <Switch id="board-archived" checked={archived} onCheckedChange={setArchived} />
          <Label htmlFor="board-archived">{copy["board.showArchived"]}</Label>
        </div>
      </div>
      <QueryBoundary query={issues}>
        {(page) => {
          const needle = text.trim().toLowerCase();
          const shown = page.items.filter((i) => (i.title ?? "").toLowerCase().includes(needle));
          const columns = field.enumValues.map((value) => ({ value, label: enumLabel(field, value), issues: shown.filter((i) => statusOf(i) === value) }));
          return (
            <>
              <Tabs value={tab} onValueChange={setTab} className="mb-3 md:hidden">
                <TabsList aria-label={copy["board.columns"]} className="h-auto w-full flex-wrap justify-start group-data-[orientation=horizontal]/tabs:h-auto">
                  {columns.map((column) => (
                    // The tabs only switch which column is visible, so there is no tab panel to point at (axe).
                    <TabsTrigger className="h-auto" key={column.value} value={column.value} aria-controls={undefined} data-testid={`board-tab-${column.value}`}>
                      {fill(copy["board.column"], { label: column.label, n: column.issues.length })}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <DndContext
                sensors={sensors}
                onDragStart={({ active }) => setDragging(String(active.id))}
                onDragEnd={dragEnd}
                onDragCancel={() => setDragging(null)}
                accessibility={dndTexts(name, columnName)}
              >
                <div className="grid gap-3 md:grid-cols-5">
                  {columns.map((column) => (
                    <Column key={column.value} {...column} field={field} active={column.value === tab} busy={move.isPending} onMove={onMove} />
                  ))}
                </div>
                <DragOverlay>
                  {dragging ? (
                    <Card className="gap-2 py-3 shadow-lg" data-testid="board-drag-overlay">
                      <CardContent className="px-3 font-semibold">{name(dragging)}</CardContent>
                    </Card>
                  ) : null}
                </DragOverlay>
              </DndContext>
              {page.total > page.items.length ? <p className="mt-2 text-subdued">{fill(copy["board.more"], { n: page.items.length })}</p> : null}
            </>
          );
        }}
      </QueryBoundary>
    </>
  );
}

/** /views/projects.board — B-S6: the issues of `?project=` (two-way, C-10) in one column per status value. */
export function ProjectsBoardPage() {
  const me = useSession().me!;
  const projects = useQuery(workQueries.allEntries(api.work, "project"));
  const issueType = useQuery(workQueries.type(api.work, "issue"));
  const [projectId, setProjectId] = useQueryParam("project");
  const project = pickEntry(projects.data?.items, projectId);
  const field = issueType.data?.fields.find((f) => f.key === STATUS && f.type === "enum");
  return (
    <>
      <PageHeader
        title={copy["view.projects.board"]}
        secondaryActions={[{ label: copy["board.issueList"], to: "/entries/issue" }]}
        primaryAction={can(me, "issue", "create") ? { label: copy["board.newIssue"], to: "/entries/issue/new", testId: "board-new" } : undefined}
      />
      <p className="mb-4 text-subdued">{copy["board.lead"]}</p>
      <QueryBoundary
        query={projects}
        isEmpty={(page) => page.items.length === 0}
        empty={<EmptyState testId="board-no-projects" title={copy["board.noProjects"]} description={copy["board.noProjectsBody"]} />}
      >
        {(page) => (
          <>
            <div className="mb-4">
              <EntrySelect id="board-project" label={copy["board.project"]} entries={page.items} value={project!.id} onChange={setProjectId} />
            </div>
            <QueryBoundary query={issueType}>{() => (field ? <Issues key={project!.id} project={project!} field={field} /> : null)}</QueryBoundary>
          </>
        )}
      </QueryBoundary>
    </>
  );
}
