import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const branchId = Number(url.searchParams.get('branch_id') || '5');
    const from = url.searchParams.get('from');
    const to = url.searchParams.get('to');

    if (!from || !to) {
      return NextResponse.json({ ok: false, error: 'from and to required (YYYY-MM-DD)' }, { status: 400 });
    }

    // Employees map (чтобы подставить имена к daily/weekly)
    const { data: emps } = await supabaseAdmin
      .from('employees')
      .select('id, full_name')
      .eq('branch_id', branchId);
    const nameById = new Map<number, string>((emps || []).map((e: any) => [Number(e.id), String(e.full_name)]));

    // Daily + вопрос дня (joinим по question_id)
    const { data: dailyRows } = await supabaseAdmin
      .from('feedback_daily_responses')
      .select('id, employee_id, day, mood, question_id, answer_text, answer_voice_url, extra_text, extra_voice_url, postponed_count, submitted_at')
      .eq('branch_id', branchId)
      .gte('day', from)
      .lte('day', to)
      .order('day', { ascending: false });

    const qIds = Array.from(new Set((dailyRows || []).map((r: any) => r.question_id).filter(Boolean)));
    const { data: qRows } = qIds.length
      ? await supabaseAdmin.from('feedback_daily_questions').select('id, topic_key, question_text').in('id', qIds)
      : { data: [] as any[] };
    const qById = new Map<number, { topic_key: string; question_text: string }>(
      (qRows || []).map((q: any) => [Number(q.id), { topic_key: q.topic_key, question_text: q.question_text }]),
    );

    const daily = (dailyRows || [])
      .filter((r: any) => r.mood != null) // постповедные без mood не показываем
      .map((r: any) => ({
        id: r.id,
        employee_id: r.employee_id,
        employee_name: nameById.get(Number(r.employee_id)) || '—',
        day: r.day,
        mood: r.mood,
        topic_key: qById.get(Number(r.question_id))?.topic_key || null,
        question_text: qById.get(Number(r.question_id))?.question_text || null,
        answer_text: r.answer_text,
        answer_voice_url: r.answer_voice_url,
        extra_text: r.extra_text,
        extra_voice_url: r.extra_voice_url,
        postponed_count: r.postponed_count,
        submitted_at: r.submitted_at,
      }));

    const { data: weeklyRows } = await supabaseAdmin
      .from('feedback_weekly_responses')
      .select('id, employee_id, week_start, mood, week_text, week_voice_url, helped_text, helped_voice_url, submitted_at')
      .eq('branch_id', branchId)
      .gte('week_start', from)
      .lte('week_start', to)
      .order('week_start', { ascending: false });

    const weekly = (weeklyRows || []).map((r: any) => ({
      id: r.id,
      employee_id: r.employee_id,
      employee_name: nameById.get(Number(r.employee_id)) || '—',
      week_start: r.week_start,
      mood: r.mood,
      week_text: r.week_text,
      week_voice_url: r.week_voice_url,
      helped_text: r.helped_text,
      helped_voice_url: r.helped_voice_url,
      submitted_at: r.submitted_at,
    }));

    const { data: anonRows } = await supabaseAdmin
      .from('feedback_weekly_anonymous')
      .select('id, week_start, anon_topic, transcript, voice_url, submitted_at')
      .eq('branch_id', branchId)
      .gte('week_start', from)
      .lte('week_start', to)
      .order('submitted_at', { ascending: false });

    const anonymous = (anonRows || []).map((r: any) => ({
      id: r.id,
      week_start: r.week_start,
      anon_topic: r.anon_topic,
      transcript: r.transcript,
      voice_url: r.voice_url,
      submitted_at: r.submitted_at,
    }));

    // Агрегат по mood для графика
    const moodByDay = new Map<string, { sum: number; count: number }>();
    for (const r of daily) {
      const key = r.day;
      const acc = moodByDay.get(key) || { sum: 0, count: 0 };
      acc.sum += r.mood;
      acc.count += 1;
      moodByDay.set(key, acc);
    }
    const moodChart = Array.from(moodByDay.entries())
      .map(([day, v]) => ({ day, avg: +(v.sum / v.count).toFixed(2), count: v.count }))
      .sort((a, b) => a.day.localeCompare(b.day));

    return NextResponse.json({ ok: true, daily, weekly, anonymous, moodChart });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'server error' }, { status: 500 });
  }
}
