import { Component, type ReactNode } from "react";
import { detectLocale, translate } from "../copy";
import { Button } from "../ui/Button";

type State = { failed: boolean };

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: Error): void {
    // Only the name: the message may carry server text.
    console.error("render error", error.name);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    const locale = detectLocale();
    return (
      <div
        data-testid="error-boundary"
        role="alert"
        className="min-h-dvh bg-bg flex flex-col items-center justify-center gap-4 px-4"
      >
        <p className="text-lg font-semibold text-ink">{translate(locale, "error.boundary.title")}</p>
        <Button variant="primary" data-testid="error-boundary-reload" onClick={() => window.location.reload()}>
          {translate(locale, "error.boundary.reload")}
        </Button>
      </div>
    );
  }
}
