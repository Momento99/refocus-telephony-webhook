export {};

declare global {
  interface Window {
    RefocusPrinter?: {
      printReceipt: (args: { orderId: number }) => Promise<void>;
    };
  }
}
