import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';
import { requireOwner } from '@/app/api/admin/_requireOwner';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Список доставок (статусы) + ответы продавцов (петля обратной связи) для страницы владельца.
//  GET ?branch_id=&period_from=  → доставки филиала за период + их ответы.
export async function GET(req: Request) {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const sb = getSupabaseAdmin();
    const url = new URL(req.url);
    const branchId = url.searchParams.get('branch_id');
    const periodFrom = url.searchParams.get('period_from');

    let q = sb
      .from('recap_deliveries')
      .select('id, employee_id, branch_id, period, period_from, period_to, coshift, coshift_names, status, publish_on, test_anytime, confirmed_at, seen_at')
      .neq('status', 'revoked')
      .order('confirmed_at', { ascending: false })
      .limit(200);
    if (branchId) q = q.eq('branch_id', Number(branchId));
    if (periodFrom) q = q.eq('period_from', periodFrom);

    const { data: deliveries, error } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const ids = (deliveries || []).map((d: any) => d.id);
    let responsesByDelivery: Record<string, any[]> = {};
    if (ids.length) {
      const { data: responses } = await sb
        .from('recap_responses')
        .select('delivery_id, card_key, clarity, agree, question_text, question_transcript, comment, focus_choice, updated_at')
        .in('delivery_id', ids);
      for (const r of responses || []) {
        (responsesByDelivery[r.delivery_id] ||= []).push(r);
      }
    }

    // Имена сотрудников для подписи строк.
    const empIds = [...new Set((deliveries || []).map((d: any) => Number(d.employee_id)))];
    let nameById: Record<number, string> = {};
    if (empIds.length) {
      const { data: emps } = await sb.from('employees').select('id, full_name').in('id', empIds);
      for (const e of emps || []) nameById[Number(e.id)] = e.full_name;
    }

    const rows = (deliveries || []).map((d: any) => {
      const resp = responsesByDelivery[d.id] || [];
      const clarities = resp.map((r) => Number(r.clarity)).filter((n) => n > 0);
      const avgClarity = clarities.length ? Math.round((clarities.reduce((a, b) => a + b, 0) / clarities.length) * 10) / 10 : null;
      const agrees = [...new Set(resp.map((r) => r.agree).filter(Boolean))];
      const hasObjection = agrees.includes('no'); // 'partial' (частично) — не возражение
      return {
        ...d,
        employee_name: nameById[Number(d.employee_id)] || `#${d.employee_id}`,
        responses: resp,
        avg_clarity: avgClarity,
        agree_summary: agrees,
        has_objection: hasObjection,
        questions: resp.filter((r) => r.question_text || r.question_transcript),
        comments: resp.filter((r) => r.comment),
        focus_choice: resp.find((r) => r.focus_choice)?.focus_choice || null,
      };
    });

    return NextResponse.json({ deliveries: rows });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

// POST { action: 'revoke', id } — отозвать доставку (перестанет показываться на кассе).
export async function POST(req: Request) {
  try {
    const gate = await requireOwner();
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const body = await req.json().catch(() => ({} as any));
    if (body.action === 'revoke' && body.id) {
      const sb = getSupabaseAdmin();
      const { error } = await sb.from('recap_deliveries').update({ status: 'revoked' }).eq('id', String(body.id));
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, id: body.id });
    }
    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
