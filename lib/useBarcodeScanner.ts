import { useEffect, useRef } from 'react';

/** Считывает «струйку» клавиш от ручного сканера как единую строку */
export function useBarcodeScanner(onCode: (code: string) => void, timeoutMs = 120) {
  const buff = useRef('');
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (timer.current) window.clearTimeout(timer.current);

      if (e.key === 'Enter') {
        const code = buff.current.trim();
        buff.current = '';
        if (code) onCode(code);
        return;
      }

      // пропускаем служебные
      if (e.key.length === 1) buff.current += e.key;

      timer.current = window.setTimeout(() => (buff.current = ''), timeoutMs);
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCode, timeoutMs]);
}
