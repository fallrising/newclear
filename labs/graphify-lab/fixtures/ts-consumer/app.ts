import { InvoiceClient } from "@lab/invoice-sdk";

export class CheckoutApp {
  constructor(private invoices: InvoiceClient) {}

  run(): void {
    this.invoices.issue();
  }
}
