import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOwner } from '@/app/api/admin/_requireOwner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Подтверждение разбора к показу на кассе по выбранному филиалу.
// Создаёт/обновляет recap_deliveries для каждого переданного сотрудника.
// publish_on = ближайший понедельник (Asia/Bishkek); тест-филиал (18) = сегодня + test_anytime.

const TEST_BRANCH = 18;
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

// Дата/«ближайший понедельник» строго по Asia/Bishkek, независимо от TZ сервера (Vercel=UTC).
function todayISO(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bishkek' }).format(new Date());
}
function nextMondayISO(): string {
  const iso = todayISO();
  const dowName = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bishkek', weekday: 'short' }).format(new Date());
  const dow = DOW[dowName] ?? 1;
  const delta = (1 - dow + 7) % 7; // дней до ближайшего пн (0 если сегодня пн)
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export async function POST(req: Request) {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const body = await req.json().catch(() => ({} as any));
    const branch_id = Number(body.branch_id);
    if (!branch_id) return NextResponse.json({ error: 'branch_id обязателен' }, { status: 400 });

    const period = body.period === 'month' || body.period === 'all' ? body.period : 'week';
    const period_from = body.period_from ? String(body.period_from).slice(0, 10) : null;
    if (!period_from) return NextResponse.json({ error: 'period_from обязателен' }, { status: 400 });
    const period_to = body.period_to ? String(body.period_to).slice(0, 10) : null;
    const run_id = body.run_id || null;
    const employees: any[] = Array.isArray(body.employees) ? body.employees : [];
    if (employees.length === 0) return NextResponse.json({ error: 'Нет сотрудников для доставки' }, { status: 400 });

    const isTest = branch_id === TEST_BRANCH;
    const publish_on = isTest ? todayISO() : nextMondayISO();

    // Без status/seen_at — их выставляет/сохраняет RPC recap_confirm_delivery (B1):
    // повторное «Подтвердить» обновляет контент, но не сбрасывает «прочитал»; revoked→confirmed.
    const rows = employees
      .filter((e) => e && e.employee_id)
      .map((e) => ({
        run_id,
        employee_id: Number(e.employee_id),
        branch_id,
        period,
        period_from,
        period_to,
        coshift: !!e.coshift,
        coshift_names: Array.isArray(e.coshift_names) && e.coshift_names.length ? e.coshift_names : null,
        facts: e.facts ?? e,
        text: String(e.text ?? e.facts?.text ?? ''),
        card_order: e.card_order ?? null,
        publish_on,
        test_anytime: isTest,
        confirmed_by: body.confirmed_by ? String(body.confirmed_by) : null,
      }));
    if (rows.length === 0) return NextResponse.json({ error: 'Нет сотрудников для доставки' }, { status: 400 });

    const sb = getSupabaseAdmin();
    const { data, error } = await sb.rpc('recap_confirm_delivery', { p_rows: rows });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ count: typeof data === 'number' ? data : rows.length, publish_on, branch_id, test: isTest });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
