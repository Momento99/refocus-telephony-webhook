'use client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div style={{ padding: 16 }}>
          <h1>Глобальная ошибка</h1>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
          <button onClick={() => reset()} style={{ padding: '8px 12px' }}>
            Обновить
          </button>
        </div>
      </body>
    </html>
  );
}
