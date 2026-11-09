/* Оценка сотрудника «Команда 360» — чистые функции (без React), переиспользуются на сервере
   (генератор личных отчётов) и в UI. Источник сырых чисел — RPC rpc_employee_360(from,to).
   Формула 1:1 со старой страницей /admin/team (computeScores). */

export type Team360Row = {
  audio_avg_score: number | string | null;
  wa_avg_score: number | string | null;
  ig_avg_score: number | string | null;
  revenue_total: number | string | null;
  hours_worked: number | string | null;
  avg_check: number | string | null;
  orders_count: number | null;
  sessions_count: number | null;
  late_minutes_total: number | null;
  penalty_count: number | null;
  is_voice_pilot: boolean | null;
  feedback_avg_mood: number | string | null;
};

export type Team360Scores = {
  service: number | null;
  sales: number | null;
  discipline: number | null;
  voice: number | null;
  final360: number | null;
};

const N = (v: any) => Number(v || 0);

/** 4 подскора 0..10 + итог 0..10. periodDays: неделя=7, месяц=30, квартал=90. */
export function computeScores(r: Team360Row, periodDays: number): Team360Scores {
  // Service: аудио 50 / WhatsApp 30 / Instagram 20 с перераспределением весов по ненулевым каналам.
  const parts: Array<{ weight: number; value: number }> = [];
  if (r.audio_avg_score != null) parts.push({ weight: 50, value: N(r.audio_avg_score) });
  if (r.wa_avg_score != null) parts.push({ weight: 30, value: N(r.wa_avg_score) });
  if (r.ig_avg_score != null) parts.push({ weight: 20, value: N(r.ig_avg_score) });
  const wSvc = parts.reduce((s, p) => s + p.weight, 0);
  const service = wSvc > 0 ? parts.reduce((s, p) => s + (p.weight * p.value) / wSvc, 0) : null;

  // Sales: выручка/час 70% + средний чек 30%. Таргеты 1300 KGS/час и 3000 чек = 10.
  const REV_PER_HOUR_TARGET = 1300, AVG_CHECK_TARGET = 3000;
  const revPerHour = N(r.hours_worked) > 0 ? N(r.revenue_total) / N(r.hours_worked) : 0;
  const revPerHourScore = Math.min(10, Math.max(0, (revPerHour / REV_PER_HOUR_TARGET) * 10));
  const avgCheckScore = Math.min(10, Math.max(0, (N(r.avg_check) / AVG_CHECK_TARGET) * 10));
  const enoughSalesData = N(r.hours_worked) >= 4 && N(r.orders_count) >= 3;
  const sales = !enoughSalesData ? null : revPerHourScore * 0.7 + avgCheckScore * 0.3;

  // Discipline: опоздания на смену (грейс 10 мин, далее −1 за 4 мин) минус штрафы.
  const LATE_GRACE_MIN = 10, LATE_MIN_PER_POINT = 4;
  const avgLatePerShift = N(r.sessions_count) > 0 ? N(r.late_minutes_total) / N(r.sessions_count) : 0;
  const lateScore = Math.max(0, 10 - Math.max(0, avgLatePerShift - LATE_GRACE_MIN) / LATE_MIN_PER_POINT);
  const penaltyPerWeek = N(r.penalty_count) * (7 / periodDays);
  const discipline = N(r.sessions_count) === 0 ? null : Math.max(0, lateScore - penaltyPerWeek * 2);

  // Voice (настроение) — только voice-пилот (Токмок).
  const voice = r.is_voice_pilot && r.feedback_avg_mood != null ? Math.min(10, (N(r.feedback_avg_mood) / 5) * 10) : null;

  // Итог: Service 40 / Sales 30 / Discipline 15 / Voice 15; «сиротский» вес результативных осей → продажам.
  const wDiscipline = discipline != null ? 15 : 0;
  const wVoice = voice != null ? 15 : 0;
  const wPerf = 100 - wDiscipline - wVoice;
  const perfNominal = (service != null ? 40 : 0) + (sales != null ? 30 : 0);
  const finalParts: Array<{ weight: number; value: number }> = [];
  if (perfNominal > 0) {
    if (service != null) finalParts.push({ weight: (wPerf * 40) / perfNominal, value: service });
    if (sales != null) finalParts.push({ weight: (wPerf * 30) / perfNominal, value: sales });
  }
  if (discipline != null) finalParts.push({ weight: wDiscipline, value: discipline });
  if (voice != null) finalParts.push({ weight: wVoice, value: voice });
  const hasCore = service != null || sales != null;
  const wTotal = finalParts.reduce((s, p) => s + p.weight, 0);
  const final360 = hasCore && wTotal > 0 ? finalParts.reduce((s, p) => s + (p.weight * p.value) / wTotal, 0) : null;

  return { service, sales, discipline, voice, final360 };
}

/** Цвет/ярлык по баллу — для бейджа в карточке. */
export function scoreLabel(score: number | null): { label: string; tone: 'emerald' | 'cyan' | 'amber' | 'orange' | 'rose' | 'slate' } {
  if (score == null) return { label: 'мало данных', tone: 'slate' };
  if (score >= 8.5) return { label: 'Топ', tone: 'emerald' };
  if (score >= 7) return { label: 'Хорошо', tone: 'cyan' };
  if (score >= 5) return { label: 'Средне', tone: 'amber' };
  if (score >= 3) return { label: 'Ниже', tone: 'orange' };
  return { label: 'Риск', tone: 'rose' };
}

export const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
