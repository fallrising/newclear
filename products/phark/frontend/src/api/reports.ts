import { apiRequest } from "@/api/client"
import type {
  CreateReportRequest,
  Report,
  ReportReason,
  ReportTargetType,
} from "@/types/report"

export interface SubmitReportInput {
  readonly targetType: ReportTargetType
  readonly targetId: number
  readonly reason: ReportReason
}

export function submitReport({
  targetType,
  targetId,
  reason,
}: SubmitReportInput): Promise<Report> {
  const path =
    targetType === "POST"
      ? `/api/posts/${targetId}/reports`
      : `/api/replies/${targetId}/reports`
  const request: CreateReportRequest = { reason }
  return apiRequest<Report>(path, {
    method: "POST",
    body: request,
  })
}
