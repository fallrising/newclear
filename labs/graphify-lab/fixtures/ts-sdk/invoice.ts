export class InvoiceClient {
  issue(): void {}
}

// A matching method name on an unrelated type must not become the target.
export class IssueTracker {
  issue(): void {}
}
