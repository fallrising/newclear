import { useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isApiError, keys, workQueries, type Revision, type WorkContentType, type WorkEntry } from "@cms/api";
import { useSession } from "@cms/auth";
import { formatDateTime } from "@cms/fields";
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Card,
  DefaultSkeleton,
  EmptyState,
  ErrorState,
  fill,
  PageHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { can } from "../nav";
import { TypeGate } from "../type-gate";
import { Confirm } from "./entry-form";

function RevisionTable({ entry, type, revisions }: { entry: WorkEntry; type: WorkContentType; revisions: Revision[] }) {
  const me = useSession().me!;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const writing = useRef(false);
  const [target, setTarget] = useState<number | null>(null);
  const editor = `/entries/${type.key}/${entry.id}`;
  // Same rule as the editor: reverting writes the work copy, so it needs update and a non-archived entry.
  const writable = can(me, type.key, "update") && entry.publicationState !== "archived";

  const revert = useMutation({
    mutationFn: (revisionNo: number) => api.work.revert(entry.id, revisionNo),
    onSuccess: (updated, revisionNo) => {
      queryClient.setQueryData(keys.entries.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: keys.entries.lists(type.key) });
      void queryClient.invalidateQueries({ queryKey: keys.entries.preview(updated.id) });
      toast.success(fill(copy["history.reverted"], { n: revisionNo }));
      navigate(editor);
    },
    onError: () => toast.error(copy["details.failed"]),
    onSettled: () => { writing.current = false; },
  });

  if (revisions.length === 0) {
    return <EmptyState testId="history-empty" title={copy["history.empty"]} description={copy["history.emptyBody"]} />;
  }
  return (
    <>
      {writable ? null : (
        <Alert className="mb-4" data-testid="history-read-only">
          <AlertDescription>{entry.publicationState === "archived" ? copy["details.readOnlyArchived"] : copy["details.readOnlyNoUpdate"]}</AlertDescription>
        </Alert>
      )}
      <Card className="py-0">
        <Table data-testid="history-table">
          <TableHeader>
            <TableRow>
              <TableHead>{copy["history.col.revision"]}</TableHead>
              <TableHead>{copy["history.col.publishedAt"]}</TableHead>
              <TableHead>{copy["history.col.slug"]}</TableHead>
              {writable ? <TableHead><span className="sr-only">{copy["history.revert"]}</span></TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {revisions.map((revision, index) => (
              <TableRow key={revision.revisionNo} data-testid="history-row">
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    {fill(copy["history.revision"], { n: revision.revisionNo })}
                    {index === 0 ? <Badge variant="secondary">{copy["history.latest"]}</Badge> : null}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatDateTime(revision.publishedAt)}</TableCell>
                <TableCell>{revision.slug || "—"}</TableCell>
                {writable ? (
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={revert.isPending}
                      aria-label={fill(copy["history.revertLabel"], { n: revision.revisionNo })}
                      onClick={() => setTarget(revision.revisionNo)}
                      data-testid="history-revert"
                    >
                      {copy["history.revert"]}
                    </Button>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
      <Confirm
        open={target !== null}
        title={fill(copy["history.revertTitle"], { n: target ?? 0 })}
        body={copy["history.revertBody"]}
        action={copy["history.revertConfirm"]}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (writing.current || target === null) return;
          writing.current = true;
          const revisionNo = target;
          setTarget(null);
          revert.mutate(revisionNo);
        }}
        testId="confirm-revert"
      />
    </>
  );
}

function HistoryBody({ type, id }: { type: WorkContentType; id: string }) {
  const entry = useQuery({ ...workQueries.entry(api.work, id), staleTime: 0 });
  const revisions = useQuery({ ...workQueries.revisions(api.work, id), staleTime: 0 });
  if (entry.isError || revisions.isError) {
    const failed = entry.error ?? revisions.error;
    if (isApiError(failed) && failed.status === 404) return <Navigate to="/not-found" replace />;
    if (isApiError(failed) && failed.status === 403) return <Navigate to="/forbidden" replace />;
    return <ErrorState onRetry={() => void Promise.all([entry.refetch(), revisions.refetch()])} />;
  }
  if (entry.isPending || revisions.isPending) return <DefaultSkeleton />;
  if (entry.data.contentType !== type.key) return <Navigate to={`/entries/${entry.data.contentType}/${id}/history`} replace />;
  return (
    <>
      <PageHeader title={copy["history.title"]} backTo={{ to: `/entries/${type.key}/${id}`, label: entry.data.title || copy["index.untitled"] }} />
      <p className="mb-4 text-subdued">{copy["history.lead"]}</p>
      <RevisionTable entry={entry.data} type={type} revisions={revisions.data.items} />
    </>
  );
}

/** /entries/:type/:id/history — publish snapshots, newest first, with 還原到這一版 (revert into the work copy). */
export function EntryHistoryPage() {
  const { type = "", id = "" } = useParams();
  return <TypeGate type={type}>{(schema) => <HistoryBody type={schema} id={id} />}</TypeGate>;
}
