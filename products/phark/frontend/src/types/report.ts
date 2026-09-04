export type ReportReason =
  | "SPAM"
  | "HARASSMENT"
  | "HATE_OR_VIOLENCE"
  | "SEXUAL_CONTENT"
  | "OTHER"

export type ReportTargetType = "POST" | "REPLY"

export const REPORT_REASONS: readonly ReportReason[] = [
  "SPAM",
  "HARASSMENT",
  "HATE_OR_VIOLENCE",
  "SEXUAL_CONTENT",
  "OTHER",
]

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  SPAM: "Spam",
  HARASSMENT: "Harassment",
  HATE_OR_VIOLENCE: "Hate or violence",
  SEXUAL_CONTENT: "Sexual content",
  OTHER: "Other",
}

export interface CreateReportRequest {
  readonly reason: ReportReason
}

export interface Report {
  readonly id: number
  readonly targetType: ReportTargetType
  readonly targetId: number
  readonly reason: ReportReason
  readonly status: "RECEIVED"
  readonly createdAt: string
}
