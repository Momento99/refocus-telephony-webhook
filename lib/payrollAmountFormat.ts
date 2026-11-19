const wholeSom = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });

export function formatPayrollAmount(value?: number | null): string {
  return wholeSom.format(value ?? 0);
}
