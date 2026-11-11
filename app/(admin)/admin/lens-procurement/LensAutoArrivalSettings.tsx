'use client';

import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Policy = {
  location_id: string;
  delivery_days: number;
  enabled: boolean;
};

function readPolicy(data: unknown): Policy | null {
  return ((Array.isArray(data) ? data[0] : data) as Policy | null | undefined) ?? null;
}

export default function LensAutoArrivalSettings({ locationId }: { locationId: string }) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [days, setDays] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const { data, error: requestError } = await getBrowserSupabase()
          .rpc('lens_purchase_auto_arrival_get', { p_location_id: locationId });
        if (!active) return;
        if (requestError) throw requestError;
        const current = readPolicy(data);
        setPolicy(current);
        setDays(String(current?.delivery_days ?? 30));
        setEnabled(current?.enabled ?? false);
      } catch (requestError: unknown) {
        if (active) setError((requestError as Error)?.message || 'Не удалось загрузить срок доставки');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [locationId]);

  const deliveryDays = Number(days);
  const validDays = days.trim() !== '' && Number.isInteger(deliveryDays) && deliveryDays >= 1 && deliveryDays <= 365;
  const changed = !policy || deliveryDays !== policy.delivery_days || enabled !== policy.enabled;

  async function save() {
    if (!validDays || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const { data, error: requestError } = await getBrowserSupabase().rpc('lens_purchase_auto_arrival_set', {
        p_location_id: locationId,
        p_delivery_days: deliveryDays,
        p_enabled: enabled,
      });
      if (requestError) throw requestError;
      const current = readPolicy(data);
      if (!current) throw new Error('Не удалось получить сохранённые настройки');
      setPolicy(current);
      setDays(String(current.delivery_days));
      setEnabled(current.enabled);
      setSaved(true);
    } catch (requestError: unknown) {
      setError((requestError as Error)?.message || 'Не удалось сохранить срок доставки');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/60 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Clock3 className="h-4 w-4 text-sky-600" />
        Автоматическое прибытие
      </div>
      {loading ? <p className="mt-2 text-sm text-slate-500">Загружаю настройки…</p> : policy ? (
        <>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="flex min-h-11 items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={enabled} disabled={saving}
                className="h-5 w-5 accent-cyan-600"
                onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }} />
              Включено
            </label>
            <label className="text-xs text-slate-600">
              Срок в календарных днях
              <input type="number" min={1} max={365} step={1} value={days} disabled={saving}
                onChange={(event) => { setDays(event.target.value); setSaved(false); }}
                className="mt-1 block min-h-11 w-32 rounded-xl border border-sky-200 bg-white px-3 py-2 text-base text-slate-900 sm:text-sm" />
            </label>
            <button type="button" onClick={() => void save()} disabled={saving || !validDays || !changed}
              className="min-h-11 rounded-xl bg-cyan-600 px-4 py-2 text-sm font-medium text-white disabled:cursor-default disabled:opacity-50">
              {saving ? 'Сохраняю…' : 'Сохранить'}
            </button>
            {saved && <span role="status" className="pb-2 text-xs text-emerald-700">Сохранено</span>}
          </div>
          <p className="mt-2 text-xs leading-relaxed text-slate-600">
            Срок отсчитывается от отметки «В пути». Проверка выполняется каждый час.
            Новый срок применяется к следующим заказам. Дату уже отправленной партии можно продлить в её меню.
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Автоматика отмечает прибытие партии. Количество линз на складе вносится после пересчёта.
          </p>
        </>
      ) : !error ? <p className="mt-2 text-sm text-slate-500">Для этого склада автоприбытие ещё не настроено.</p> : null}
      {error && <p role="alert" className="mt-2 break-words text-xs text-rose-700">{error}</p>}
    </div>
  );
}
