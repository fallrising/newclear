import { useRef, useState, type FormEvent } from "react"
import { Flag } from "lucide-react"
import { getApiErrorMessage } from "@/api/client"
import { submitReport } from "@/api/reports"
import type { AccountProfile } from "@/api/accounts"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  REPORT_REASON_LABELS,
  REPORT_REASONS,
  type ReportReason,
  type ReportTargetType,
} from "@/types/report"

interface ReportControlProps {
  targetType: ReportTargetType
  targetId: number
  sessionAccount: AccountProfile | null
  onAuthRequest: () => void
}

function isReportReason(value: string): value is ReportReason {
  return (REPORT_REASONS as readonly string[]).includes(value)
}

export function ReportControl({
  targetType,
  targetId,
  sessionAccount,
  onAuthRequest,
}: ReportControlProps) {
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const submitting = useRef(false)
  const selectId = `report-reason-${targetType.toLowerCase()}-${targetId}`

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting.current) {
      return
    }

    submitting.current = true
    setPending(true)
    setError(null)
    setSubmitted(false)
    try {
      await submitReport({ targetType, targetId, reason })
      setSubmitted(true)
    } catch (caught) {
      setError(
        getApiErrorMessage(caught, "Unable to submit the report. Please try again.")
      )
    } finally {
      submitting.current = false
      setPending(false)
    }
  }

  if (sessionAccount === null) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/30 p-3">
        <p className="text-xs text-muted-foreground">
          Sign in to report this {targetType.toLowerCase()}.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAuthRequest}
        >
          Sign in
        </Button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          Report reason
        </span>
        <Select
          value={reason}
          onValueChange={(value) => {
            if (isReportReason(value)) {
              setReason(value)
            }
          }}
        >
          <SelectTrigger
            id={selectId}
            aria-label="Report reason"
            className="h-8 w-44 text-xs"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {REPORT_REASONS.map((value) => (
              <SelectItem key={value} value={value}>
                {REPORT_REASON_LABELS[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          disabled={pending}
          aria-busy={pending}
        >
          <Flag className="size-3.5" />
          {pending ? "Submitting..." : "Report"}
        </Button>
      </div>
      {submitted ? (
        <p role="status" className="text-xs text-muted-foreground">
          Report submitted.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
