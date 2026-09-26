import type { ReactNode } from "react";
import { Link } from "react-router";
import { ArrowLeftIcon, EllipsisIcon } from "lucide-react";
import { Button } from "../components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { uiCopy } from "../copy";
import { useDocumentTitle } from "./document-title";

export interface PageAction {
  label: string;
  /** Router path; renders a link. */
  to?: string;
  onSelect?: () => void;
  disabled?: boolean;
  testId?: string;
}

export interface PageHeaderProps {
  title: string;
  backTo?: { to: string; label: string };
  badges?: ReactNode;
  /** More than two are collapsed into the "更多動作" menu (01 §6.2). */
  secondaryActions?: PageAction[];
  primaryAction?: PageAction;
}

function ActionButton({ action, variant }: { action: PageAction; variant: "default" | "outline" }) {
  if (action.to) {
    return (
      <Button asChild variant={variant} data-testid={action.testId}>
        <Link to={action.to}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button variant={variant} onClick={action.onSelect} disabled={action.disabled} data-testid={action.testId}>
      {action.label}
    </Button>
  );
}

export function PageHeader({ title, backTo, badges, secondaryActions = [], primaryAction }: PageHeaderProps) {
  useDocumentTitle(title);
  const collapse = secondaryActions.length > 2;
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3" data-testid="page-header">
      <div className="flex min-w-0 flex-col gap-1">
        {backTo ? (
          <Link to={backTo.to} className="inline-flex items-center gap-1 text-subdued hover:underline">
            <ArrowLeftIcon className="size-4" aria-hidden="true" />
            {backTo.label}
          </Link>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-page-title">{title}</h1>
          {badges}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {collapse ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" data-testid="page-more-actions">
                <EllipsisIcon aria-hidden="true" />
                {uiCopy["ui.actions.more"]}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {secondaryActions.map((action) => (
                <DropdownMenuItem
                  key={action.label}
                  disabled={action.disabled}
                  onSelect={action.onSelect}
                  data-testid={action.testId}
                  asChild={Boolean(action.to)}
                >
                  {action.to ? <Link to={action.to}>{action.label}</Link> : action.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          secondaryActions.map((action) => <ActionButton key={action.label} action={action} variant="outline" />)
        )}
        {primaryAction ? <ActionButton action={primaryAction} variant="default" /> : null}
      </div>
    </header>
  );
}
