'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div style={{ padding: 16 }}>
      <h2>Что-то пошло не так</h2>
      <pre style={{ whiteSpace: 'pre-wrap' }}>{error.message}</pre>
      <button onClick={() => reset()} style={{ padding: '8px 12px' }}>
        Перезагрузить раздел
      </button>
    </div>
  );
}
