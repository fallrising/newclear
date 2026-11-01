import { useQuery } from "@tanstack/react-query";
import { workQueries } from "@cms/api";
import { Alert, AlertDescription, Card, CardContent, CardHeader, CardTitle, fill, PageHeader, Progress, QueryBoundary } from "@cms/ui";
import { api } from "../api";
import { copy } from "../copy";
import { formatBytes } from "../format";
import { QUOTA_WARNING } from "./overview";

/** /media: library usage from GET /media/quota; per-account usage, quota changes and hard delete have no API yet (§1.2). */
export function MediaPage() {
  const quota = useQuery(workQueries.mediaQuota(api.work));
  return (
    <>
      <PageHeader title={copy["media.title"]} />
      <p className="mb-4 text-subdued">{copy["media.lead"]}</p>
      <div className="flex flex-col gap-4">
        <Card data-testid="media-usage">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["media.usage"]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <QueryBoundary query={quota}>
              {(q) => {
                const ratio = q.maxLibraryBytes > 0 ? q.usedBytes / q.maxLibraryBytes : 0;
                const percent = Math.round(ratio * 1000) / 10;
                return (
                  <>
                    <Progress value={Math.min(100, ratio * 100)} aria-label={copy["media.usage"]} data-testid="media-progress" />
                    <p data-testid="media-bytes">
                      {fill(copy["media.bytes"], { used: formatBytes(q.usedBytes), max: formatBytes(q.maxLibraryBytes), percent })}
                    </p>
                    <p>{fill(copy["media.files"], { used: q.usedFiles, max: q.maxFiles })}</p>
                    <p>{fill(copy["media.maxFile"], { max: formatBytes(q.maxFileBytes) })}</p>
                    {ratio >= QUOTA_WARNING ? (
                      <Alert data-testid="media-warning">
                        <AlertDescription>{copy["media.warning"]}</AlertDescription>
                      </Alert>
                    ) : null}
                  </>
                );
              }}
            </QueryBoundary>
          </CardContent>
        </Card>
        <Card data-testid="media-backend">
          <CardHeader>
            <CardTitle className="text-card-title">{copy["media.backend"]}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <p>{copy["media.backend.local"]}</p>
            <p className="text-subdued">{copy["media.backend.s3"]}</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
