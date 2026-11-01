import { Navigate, useParams } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { isApiError, workQueries, type WorkContentType } from "@cms/api";
import { displayable, FieldDisplay, fieldLabel, groupFields } from "@cms/fields";
import { Alert, AlertDescription, Card, CardContent, DefaultSkeleton, ErrorState, fill, PageHeader, StatusBadge } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { TypeGate } from "../type-gate";

function PreviewBody({ type, id }: { type: WorkContentType; id: string }) {
  // Always the latest saved work copy: the editor may have saved a moment ago.
  const entry = useQuery({ ...workQueries.preview(api.work, id), staleTime: 0, enabled: type.previewable });
  const editor = `/entries/${type.key}/${id}`;
  if (!type.previewable) return <Navigate to={editor} replace />;
  if (entry.isPending) return <DefaultSkeleton />;
  if (entry.isError) {
    if (isApiError(entry.error) && entry.error.status === 404) return <Navigate to="/not-found" replace />;
    if (isApiError(entry.error) && entry.error.status === 403) return <Navigate to="/forbidden" replace />;
    return <ErrorState onRetry={entry.refetch} />;
  }
  if (entry.data.contentType !== type.key) return <Navigate to={`/entries/${entry.data.contentType}/${id}/preview`} replace />;
  const data = entry.data;
  const title = data.title || copy["index.untitled"];
  const { main, relations } = groupFields(type);
  // The title is the heading; the other fields follow in form order (main column groups, then relations).
  const fields = [...main.flatMap((g) => g.fields), ...(relations?.fields ?? [])].filter((f) => f.key !== type.titleField);
  const shown = fields.filter((f) => displayable(f, data.payload[f.key]));
  return (
    <>
      <PageHeader
        title={fill(copy["preview.title"], { title })}
        backTo={{ to: editor, label: copy["preview.back"] }}
        badges={<StatusBadge state={data.publicationState} dirty={data.dirty} requested={data.publishRequestedAt !== null} />}
      />
      <Alert className="mb-4" data-testid="preview-note">
        <AlertDescription>{copy["preview.note"]}</AlertDescription>
      </Alert>
      <Card>
        <CardContent className="flex max-w-3xl flex-col gap-4" data-testid="preview-content">
          <h2 className="text-page-title">{title}</h2>
          {shown.length === 0 ? <p className="text-subdued">{copy["preview.empty"]}</p> : null}
          {shown.map((field) => (
            <section key={field.key} aria-label={fieldLabel(field)} className="flex flex-col gap-1">
              <h3 className="text-card-title text-subdued">{fieldLabel(field)}</h3>
              <FieldDisplay field={field} value={data.payload[field.key]} />
            </section>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

/** /entries/:type/:id/preview — surface-back §3.4 in-editor preview: the saved work copy, inside Back only. */
export function EntryPreviewPage() {
  const { type = "", id = "" } = useParams();
  return <TypeGate type={type}>{(schema) => <PreviewBody type={schema} id={id} />}</TypeGate>;
}
