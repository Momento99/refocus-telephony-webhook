import Link from 'next/link';

export default function SecurityPage() {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Безопасность</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Пароли, сессии, выход на всех устройствах. Журнал входов.
        </p>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Карточка: Активные сессии */}
        <section className="rounded-2xl border border-white/20 bg-white/50 backdrop-blur p-6">
          <h2 className="text-lg font-medium">Активные сессии</h2>
          <p className="text-sm text-neutral-600 mt-1">
            Просмотр и завершение сессий на устройствах.
          </p>

          <div className="mt-4">
            <Link
              href="/settings/security/sessions"
              className="inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800"
            >
              Открыть
            </Link>
          </div>
        </section>

        {/* Карточка: Журнал входов */}
        <section className="rounded-2xl border border-white/20 bg-white/50 backdrop-blur p-6">
          <h2 className="text-lg font-medium">Журнал входов</h2>
          <p className="text-sm text-neutral-600 mt-1">
            История входов в аккаунт с указанием времени, IP и User-Agent.
          </p>

          <div className="mt-4">
            <Link
              href="/settings/security/logs"
              className="inline-flex items-center gap-2 rounded-full bg-neutral-900 text-white px-4 py-2 text-sm hover:bg-neutral-800"
            >
              Открыть
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
