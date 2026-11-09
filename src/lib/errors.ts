export class PayPalUnavailableError extends Error {
  constructor(message = "PayPal Sandbox is temporarily unavailable", options?: ErrorOptions) {
    super(message, options);
    this.name = "PayPalUnavailableError";
  }
}

