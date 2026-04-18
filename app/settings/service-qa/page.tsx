'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import {
  AlertTriangle,
  AudioLines,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Copy,
  Plus,
  Save,
  ShieldAlert,
  Trash2,
  Trophy,
  UserRound,
  Users,
  Cpu,
  Cloud,
} from 'lucide-react';

type DailyReportRow = {
  id: number;
  report_date: string;
  branch_id: number | null;
  employee_id: number | null;
  chunks_total: number;
  analyzed_chunks: number;
  overall_score: number | null;
  greeting_score: number | null;
  needs_discovery_score: number | null;
  explanation_score: number | null;
  price_explanation_score: number | null;
  closing_score: number | null;
  rude_count: number;
  pushy_count: number;
  interrupted_count: number;
  strengths: string[] | null;
  weaknesses: string[] | null;
  recommendations: string[] | null;
  summary: string | null;
};

type HistoricalReportRow = {
  report_date: string;
  branch_id: number | null;
  employee_id: number | null;
  overall_score: number | null;
  analyzed_chunks: number | null;
  rude_count: number | null;
  pushy_count: number | null;
  interrupted_count: number | null;
};

type AudioChunkRow = {
  id: number;
  branch_id: number | null;
  employee_id: number | null;
  attendance_session_id: number | null;
  terminal_code: string | null;
  chunk_started_at: string | null;
  chunk_ended_at: string | null;
  uploaded_at: string | null;
  transcript_status: string;
  analysis_status: string;
  processing_error: string | null;
  recording_mode: string;
  test_note: string | null;
};

type ChunkScoreRow = {
  id: number;
  chunk_id: number;
  provider: string | null;
  model: string | null;
  status: string;
  overall_score: number | null;
  greeting_score: number | null;
  needs_discovery_score: number | null;
  explanation_score: number | null;
  price_explanation_score: number | null;
  closing_score: number | null;
  was_rude: boolean | null;
  was_pushy: boolean | null;
  interrupted_client: boolean | null;
  strengths: string[] | null;
  weaknesses: string[] | null;
  recommendations: string[] | null;
  summary: string | null;
  processing_error: string | null;
  speaker_roles: unknown;
  labeled_segments: unknown;
};

type TranscriptRow = {
  id: number;
  chunk_id: number;
  provider: string | null;
  model: string | null;
  status: string;
  text_full: string | null;
  speaker_segments: unknown;
};

type RuntimeSettingsRow = {
  test_mode_enabled: boolean;
  allow_without_active_shift: boolean;
  allow_outside_recording_window: boolean;
  include_test_chunks_in_daily_reports: boolean;
  test_device_token: string | null;
  test_terminal_id: number | null;
  test_terminal_code: string | null;
  test_branch_id: number | null;
  test_device_name: string | null;
  test_note: string | null;
  recording_window_enabled: boolean;
  recording_window_start_local: string | null;
  recording_window_end_local: string | null;
  recording_timezone: string | null;
  processing_provider: string;
  updated_at: string | null;
};

type EnrichedChunk = AudioChunkRow & {
  score: ChunkScoreRow | null;
  transcript: TranscriptRow | null;
};

type LookupRow = Record<string, unknown> & {
  id?: number | string | null;
};

type BranchOption = {
  id: number;
  label: string;
};

type EmployeeOption = {
  id: number;
  label: string;
  branch_id: number | null;
};

type RankingRow = {
  employee_id: number;
  employee_label: string;
  branch_id: number | null;
  branch_label: string;
  total_points: number;
  today_points: number;
  report_days: number;
  avg_score: number | null;
  analyzed_chunks_total: number;
  rude_count_total: number;
  pushy_count_total: number;
  interrupted_count_total: number;
};

type ModeFilter = 'all' | 'test' | 'production';

type ChunkSignal = {
  tone: 'ok' | 'warn' | 'bad' | 'neutral';
  title: string;
  detail: string;
};

type SpeakerRole = 'seller' | 'customer' | 'unknown';

type ParsedSpeakerSegment = {
  speakerLabel: string;
  sourceLabel: string | null;
  role: SpeakerRole;
  roleLabel: string;
  text: string;
  startSec: number | null;
  endSec: number | null;
};

type ScheduleRangeRow = {
  plan_id: number;
  plan_date: string;
  day_enabled: boolean;
  timezone: string | null;
  note: string | null;
  interval_id: number | null;
  start_local: string | null;
  end_local: string | null;
  interval_enabled: boolean | null;
};

type ScheduleIntervalInput = {
  id: string;
  start: string;
  end: string;
  is_enabled: boolean;
};

type ScheduleDayCard = {
  plan_id: number;
  plan_date: string;
  day_enabled: boolean;
  intervals: ScheduleIntervalInput[];
};

type AdviceCountItem = {
  text: string;
  count: number;
};

type WeeklyAdviceRow = {
  id: number;
  week_start: string;
  week_end: string;
  branch_id: number | null;
  branch_name: string | null;
  employee_id: number | null;
  employee_name: string | null;
  recording_mode: string;
  status: string;
  source_chunks_total: number;
  source_analyzed_chunks: number;
  source_days_with_data: number;
  overall_score: number | null;
  greeting_score: number | null;
  needs_discovery_score: number | null;
  explanation_score: number | null;
  price_explanation_score: number | null;
  closing_score: number | null;
  rude_count: number;
  pushy_count: number;
  interrupted_count: number;
  top_strengths: AdviceCountItem[] | null;
  top_weaknesses: AdviceCountItem[] | null;
  top_recommendations: AdviceCountItem[] | null;
  manager_summary: string | null;
  action_points: string[] | null;
  message_for_employee: string | null;
  generated_at: string | null;
  created_at: string;
  updated_at: string;
};

const RU_MONTHS = [
  'января',
  'февраля',
  'марта',
  'апреля',
  'мая',
  'июня',
  'июля',
  'августа',
  'сентября',
  'октября',
  'ноября',
  'декабря',
];

function getTodayInBishkek(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Bishkek',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function formatDateRuLong(dateStr?: string | null) {
  if (!dateStr) return '—';
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return dateStr;
  return `${day} ${RU_MONTHS[month - 1]} ${year}`;
}

function addDaysYmd(dateStr: string, days: number) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day + days, 0, 0, 0, 0));
  return dt.toISOString().slice(0, 10);
}

function getWeekBounds(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = dt.getUTCDay();
  const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const weekStartDate = new Date(Date.UTC(year, month - 1, day - diffToMonday));
  const weekStart = weekStartDate.toISOString().slice(0, 10);
  const weekEnd = addDaysYmd(weekStart, 6);
  return { weekStart, weekEnd };
}

function formatWeekRange(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  if (!start) return formatDateRuLong(end);
  if (!end) return formatDateRuLong(start);
  return `${formatDateRuLong(start)} — ${formatDateRuLong(end)}`;
}

function getBishkekUtcBounds(dateStr: string) {
  const [year, month, day] = dateStr.split('-').map(Number);

  const startUtc = new Date(Date.UTC(year, month - 1, day, -6, 0, 0, 0));
  const endUtc = new Date(Date.UTC(year, month - 1, day + 1, -6, 0, 0, 0));

  return {
    startIso: startUtc.toISOString(),
    endIso: endUtc.toISOString(),
  };
}

function formatDateTime(value?: string | null, withSeconds = false) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Bishkek',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(value));
}

function formatTimeOnly(value?: string | null, withSeconds = false) {
  if (!value) return '—';

  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Asia/Bishkek',
    hour: '2-digit',
    minute: '2-digit',
    second: withSeconds ? '2-digit' : undefined,
    hour12: false,
  }).format(new Date(value));
}

function formatConversationMoment(start?: string | null, end?: string | null) {
  if (!start && !end) return '—';
  if (start && end) {
    return `${formatDateTime(start, true)} — ${formatTimeOnly(end, true)}`;
  }
  return formatDateTime(start ?? end, true);
}

function formatScore(value?: number | null) {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(1);
}

function formatShortToken(value?: string | null) {
  if (!value) return '—';
  if (value.length <= 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function normalizeTimeText(value?: string | null) {
  if (!value) return '';
  return value.slice(0, 5);
}

function scoreTone(value?: number | null) {
  if (value === null || value === undefined) {
    return 'bg-slate-100 text-slate-700 ring-slate-200';
  }
  if (value >= 8) {
    return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  }
  if (value >= 5) {
    return 'bg-amber-50 text-amber-700 ring-amber-200';
  }
  return 'bg-rose-50 text-rose-700 ring-rose-200';
}

function chipTone(kind: 'ok' | 'warn' | 'bad' | 'neutral') {
  if (kind === 'ok') return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (kind === 'warn') return 'bg-amber-50 text-amber-700 ring-amber-200';
  if (kind === 'bad') return 'bg-rose-50 text-rose-700 ring-rose-200';
  return 'bg-slate-100 text-slate-700 ring-slate-200';
}

function signalCardTone(kind: 'ok' | 'warn' | 'bad' | 'neutral') {
  if (kind === 'ok') return 'bg-emerald-50/85 ring-emerald-200';
  if (kind === 'warn') return 'bg-amber-50/85 ring-amber-200';
  if (kind === 'bad') return 'bg-rose-50/85 ring-rose-200';
  return 'bg-slate-50/85 ring-slate-200';
}

function roleTone(role: SpeakerRole) {
  if (role === 'seller') return 'bg-teal-50/90 ring-teal-200';
  if (role === 'customer') return 'bg-sky-50/90 ring-sky-200';
  return 'bg-slate-50/90 ring-slate-200';
}

function roleLabel(role: SpeakerRole) {
  if (role === 'seller') return 'Продавец';
  if (role === 'customer') return 'Покупатель';
  return 'Не определено';
}

function weeklyStatusTone(status?: string | null): 'ok' | 'warn' | 'bad' | 'neutral' {
  if (status === 'done') return 'ok';
  if (status === 'processing') return 'warn';
  if (status === 'error') return 'bad';
  return 'neutral';
}

function weeklyStatusLabel(status?: string | null) {
  if (status === 'done') return 'Готово';
  if (status === 'processing') return 'Генерация';
  if (status === 'error') return 'Ошибка';
  if (status === 'pending') return 'В очереди';
  return status || '—';
}

function asNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function asText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim();
}

function firstNonEmpty(...values: unknown[]) {
  for (const value of values) {
    const text = asText(value);
    if (text) return text;
  }
  return '';
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

function normalizeAdviceCountItems(value: unknown): AdviceCountItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Record<string, unknown>;
      const text = firstNonEmpty(row.text, row.label, row.name, row.title);
      if (!text) return null;
      const count = Number(row.count ?? 0);
      return {
        text,
        count: Number.isFinite(count) ? count : 0,
      } as AdviceCountItem;
    })
    .filter(Boolean) as AdviceCountItem[];
}

function buildFullName(row: LookupRow) {
  const direct = firstNonEmpty(
    row.full_name,
    row.name,
    row.fio,
    row.display_name,
    row.employee_name,
    row.title,
  );
  if (direct) return direct;

  const first = firstNonEmpty(row.first_name, row.given_name, row.name_first);
  const last = firstNonEmpty(row.last_name, row.surname, row.family_name);
  const middle = firstNonEmpty(row.middle_name, row.patronymic);

  const joined = [last, first, middle].filter(Boolean).join(' ').trim();
  return joined;
}

function getBranchLabel(raw: LookupRow) {
  const id = asNumber(raw.id);
  const main = firstNonEmpty(
    raw.name,
    raw.title,
    raw.branch_name,
    raw.display_name,
    raw.short_name,
    raw.code,
  );
  if (main) return main;
  return id !== null ? `Филиал #${id}` : 'Филиал';
}

function getEmployeeLabel(raw: LookupRow) {
  const id = asNumber(raw.id);
  const full = buildFullName(raw);
  if (full) return full;
  return id !== null ? `Сотрудник #${id}` : 'Сотрудник';
}

function uniqueStrings(items: (string | null | undefined)[]) {
  const map = new Map<string, string>();
  for (const item of items) {
    const value = (item ?? '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (!map.has(key)) map.set(key, value);
  }
  return Array.from(map.values());
}

function firstSentence(text?: string | null) {
  const safe = (text ?? '').trim();
  if (!safe) return '';
  const match = safe.match(/.+?[.!?](\s|$)/);
  return (match?.[0] ?? safe).trim();
}

function extractSeconds(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function normalizeSpeakerLabel(raw: unknown) {
  const text = `${raw ?? ''}`.trim();
  if (!text) return 'Спикер';

  const normalized = text
    .replace(/^speaker[_\s-]*/i, '')
    .replace(/^spk[_\s-]*/i, '')
    .trim();

  const asNum = Number(normalized);
  if (Number.isFinite(asNum)) {
    return `Спикер ${asNum + 1}`;
  }

  if (/^\d+$/.test(normalized)) {
    return `Спикер ${Number(normalized) + 1}`;
  }

  return text
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function normalizeRole(value: unknown): SpeakerRole {
  const raw = `${value ?? ''}`.trim().toLowerCase();
  if (raw === 'seller' || raw === 'employee' || raw === 'staff' || raw === 'agent') {
    return 'seller';
  }
  if (raw === 'customer' || raw === 'client' || raw === 'buyer') {
    return 'customer';
  }
  return 'unknown';
}

function formatSegmentTime(sec: number | null) {
  if (sec === null || Number.isNaN(sec)) return null;
  const total = Math.max(0, Math.floor(sec));
  const mm = String(Math.floor(total / 60)).padStart(2, '0');
  const ss = String(total % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

function formatSegmentRange(startSec: number | null, endSec: number | null) {
  const start = formatSegmentTime(startSec);
  const end = formatSegmentTime(endSec);

  if (start && end) return `${start}–${end}`;
  if (start) return start;
  if (end) return end;
  return null;
}

function parseSpeakerRolesMap(raw: unknown): Record<string, SpeakerRole> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const map: Record<string, SpeakerRole> = {};

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const normalizedKey = normalizeSpeakerLabel(key);
    map[normalizedKey] = normalizeRole(value);
  }

  return map;
}

function parseSpeakerSegments(chunk: EnrichedChunk): ParsedSpeakerSegment[] {
  const score = chunk.score;
  const transcript = chunk.transcript;

  if (Array.isArray(score?.labeled_segments) && score!.labeled_segments.length > 0) {
    return (score!.labeled_segments as Array<Record<string, unknown>>)
      .map((row) => {
        const text = firstNonEmpty(row.text, row.transcript, row.content, row.utterance);
        if (!text) return null;

        const sourceLabel = firstNonEmpty(
          row.speaker_label,
          row.speaker,
          row.speaker_id,
          row.speaker_name,
        );

        const normalizedLabel = normalizeSpeakerLabel(sourceLabel);
        const role = normalizeRole(row.role);

        return {
          speakerLabel: roleLabel(role),
          sourceLabel: sourceLabel || normalizedLabel,
          role,
          roleLabel: roleLabel(role),
          text,
          startSec:
            extractSeconds(row.start_sec) ??
            extractSeconds(row.start) ??
            extractSeconds(row.start_time) ??
            null,
          endSec:
            extractSeconds(row.end_sec) ??
            extractSeconds(row.end) ??
            extractSeconds(row.end_time) ??
            null,
        } as ParsedSpeakerSegment;
      })
      .filter(Boolean) as ParsedSpeakerSegment[];
  }

  const speakerRolesMap = parseSpeakerRolesMap(score?.speaker_roles);
  const raw = transcript?.speaker_segments;
  const fallbackText = (transcript?.text_full ?? '').trim();

  if (!Array.isArray(raw) || raw.length === 0) {
    return fallbackText
      ? [
          {
            speakerLabel: 'Текст',
            sourceLabel: null,
            role: 'unknown',
            roleLabel: 'Текст',
            text: fallbackText,
            startSec: null,
            endSec: null,
          },
        ]
      : [];
  }

  const segments: ParsedSpeakerSegment[] = [];

  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const row = item as Record<string, unknown>;
    const text = firstNonEmpty(row.text, row.transcript, row.content, row.utterance);
    if (!text) continue;

    const sourceLabel = firstNonEmpty(
      row.speaker,
      row.speaker_id,
      row.speaker_label,
      row.speaker_name,
      row.role,
      row.channel,
      row.voice,
    );

    const normalizedLabel = normalizeSpeakerLabel(sourceLabel);
    const role = speakerRolesMap[normalizedLabel] ?? 'unknown';

    const startSec =
      extractSeconds(row.start) ??
      extractSeconds(row.start_time) ??
      extractSeconds(row.start_seconds) ??
      (extractSeconds(row.start_ms) !== null ? extractSeconds(row.start_ms)! / 1000 : null);

    const endSec =
      extractSeconds(row.end) ??
      extractSeconds(row.end_time) ??
      extractSeconds(row.end_seconds) ??
      (extractSeconds(row.end_ms) !== null ? extractSeconds(row.end_ms)! / 1000 : null);

    segments.push({
      speakerLabel: roleLabel(role),
      sourceLabel: sourceLabel || normalizedLabel,
      role,
      roleLabel: roleLabel(role),
      text,
      startSec,
      endSec,
    });
  }

  if (segments.length === 0 && fallbackText) {
    return [
      {
        speakerLabel: 'Текст',
        sourceLabel: null,
        role: 'unknown',
        roleLabel: 'Текст',
        text: fallbackText,
        startSec: null,
        endSec: null,
      },
    ];
  }

  return segments;
}

function buildChunkSignals(chunk: EnrichedChunk): ChunkSignal[] {
  const signals: ChunkSignal[] = [];
  const score = chunk.score;

  const push = (signal: ChunkSignal) => {
    const key = `${signal.title}|${signal.detail}`.toLowerCase();
    const exists = signals.some(
      (x) => `${x.title}|${x.detail}`.toLowerCase() === key,
    );
    if (!exists) signals.push(signal);
  };

  if (!score) {
    push({
      tone: 'neutral',
      title: 'Анализ не готов',
      detail: 'По этому чанку ещё нет готовой оценки модели.',
    });
    return signals;
  }

  if (score.was_rude) {
    push({
      tone: 'bad',
      title: 'Обнаружена грубость',
      detail: 'Модель посчитала тон разговора резким или неуважительным.',
    });
  }

  if (score.was_pushy) {
    push({
      tone: 'warn',
      title: 'Обнаружено давление',
      detail: 'Есть признаки продавливания решения вместо спокойного ведения клиента.',
    });
  }

  if (score.interrupted_client) {
    push({
      tone: 'warn',
      title: 'Есть перебивания',
      detail: 'Во время разговора сотрудник мог перебивать клиента и забирать инициативу слишком рано.',
    });
  }

  if (score.greeting_score !== null && score.greeting_score < 6) {
    push({
      tone: 'warn',
      title: 'Слабое приветствие',
      detail: 'Начало разговора выглядит недостаточно тёплым или собранным.',
    });
  } else if (score.greeting_score !== null && score.greeting_score >= 8) {
    push({
      tone: 'ok',
      title: 'Хороший старт',
      detail: 'Вступление в разговор выглядит уверенным и корректным.',
    });
  }

  if (score.needs_discovery_score !== null && score.needs_discovery_score < 6) {
    push({
      tone: 'warn',
      title: 'Плохо выявлена потребность',
      detail: 'Сотрудник мог слишком быстро перейти к продаже, не раскрыв задачу клиента.',
    });
  } else if (
    score.needs_discovery_score !== null &&
    score.needs_discovery_score >= 8
  ) {
    push({
      tone: 'ok',
      title: 'Потребность раскрыта',
      detail: 'В разговоре заметна попытка понять, что именно нужно клиенту.',
    });
  }

  if (score.explanation_score !== null && score.explanation_score < 6) {
    push({
      tone: 'warn',
      title: 'Слабое объяснение решения',
      detail: 'Пояснение по товару или услуге могло быть слишком коротким или неубедительным.',
    });
  } else if (score.explanation_score !== null && score.explanation_score >= 8) {
    push({
      tone: 'ok',
      title: 'Объяснение сильное',
      detail: 'Подача решения выглядит понятной и структурированной.',
    });
  }

  if (
    score.price_explanation_score !== null &&
    score.price_explanation_score < 6
  ) {
    push({
      tone: 'warn',
      title: 'Цена объяснена слабо',
      detail: 'В разговоре могло не хватить аргументации, почему цена именно такая.',
    });
  } else if (
    score.price_explanation_score !== null &&
    score.price_explanation_score >= 8
  ) {
    push({
      tone: 'ok',
      title: 'Цена объяснена уверенно',
      detail: 'Стоимость объясняется через ценность, а не просто озвучивается.',
    });
  }

  if (score.closing_score !== null && score.closing_score < 6) {
    push({
      tone: 'warn',
      title: 'Слабое завершение',
      detail: 'Финал разговора мог остаться незакрытым или без ясного следующего шага.',
    });
  } else if (score.closing_score !== null && score.closing_score >= 8) {
    push({
      tone: 'ok',
      title: 'Сильное завершение',
      detail: 'Разговор заканчивается логично и с понятным действием.',
    });
  }

  const transcriptText = (chunk.transcript?.text_full ?? '').trim();
  if (transcriptText.length > 0 && transcriptText.length < 80) {
    push({
      tone: 'neutral',
      title: 'Короткий диалог',
      detail: 'Текст разговора очень короткий, выводы по нему менее надёжны.',
    });
  }

  if (signals.length === 0) {
    push({
      tone: 'ok',
      title: 'Критичных сигналов нет',
      detail: 'По этому чанку модель не нашла явных проблемных триггеров.',
    });
  }

  return signals.slice(0, 8);
}

function buildChunkActionPlan(chunk: EnrichedChunk) {
  const score = chunk.score;
  const items: string[] = [];

  if (!score) {
    return ['Дождаться завершения анализа по этому чанку.'];
  }

  if (score.greeting_score !== null && score.greeting_score < 7) {
    items.push('Начинать разговор с короткого приветствия и спокойного входа в контакт.');
  }
  if (score.needs_discovery_score !== null && score.needs_discovery_score < 7) {
    items.push('Перед предложением решения задать больше уточняющих вопросов по запросу клиента.');
  }
  if (score.explanation_score !== null && score.explanation_score < 7) {
    items.push('Чётче объяснять, почему предлагается именно этот вариант, а не просто озвучивать его.');
  }
  if (
    score.price_explanation_score !== null &&
    score.price_explanation_score < 7
  ) {
    items.push('Объяснять цену через пользу, качество, удобство и результат для клиента.');
  }
  if (score.closing_score !== null && score.closing_score < 7) {
    items.push('Заканчивать разговор конкретным следующим шагом: примерка, заказ, запись, оплата, повторный визит.');
  }
  if (score.was_rude) {
    items.push('Снизить жёсткость тона и убрать резкие формулировки, даже если клиент затягивает разговор.');
  }
  if (score.was_pushy) {
    items.push('Меньше давления, больше ведения клиента через аргументы и спокойные уточнения.');
  }
  if (score.interrupted_client) {
    items.push('Давать клиенту договорить мысль до конца и только потом переводить к решению.');
  }

  const modelRecs = uniqueStrings(score.recommendations ?? []);
  for (const rec of modelRecs) {
    items.push(rec);
  }

  const finalItems = uniqueStrings(items);
  return finalItems.length > 0
    ? finalItems.slice(0, 8)
    : ['Продолжать в том же стиле и держать стабильный уровень сервиса.'];
}

function createIntervalInput(
  start = '12:00',
  end = '13:00',
  is_enabled = true,
): ScheduleIntervalInput {
  const id =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return { id, start, end, is_enabled };
}

function groupScheduleRows(rows: ScheduleRangeRow[]): ScheduleDayCard[] {
  const map = new Map<string, ScheduleDayCard>();

  for (const row of rows) {
    const existing = map.get(row.plan_date) ?? {
      plan_id: row.plan_id,
      plan_date: row.plan_date,
      day_enabled: row.day_enabled,
      intervals: [],
    };

    if (row.interval_id !== null && row.start_local && row.end_local) {
      existing.intervals.push({
        id: String(row.interval_id),
        start: normalizeTimeText(row.start_local),
        end: normalizeTimeText(row.end_local),
        is_enabled: row.interval_enabled ?? true,
      });
    }

    map.set(row.plan_date, existing);
  }

  return Array.from(map.values()).sort((a, b) => a.plan_date.localeCompare(b.plan_date));
}

function TinyChip({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'ok' | 'warn' | 'bad' | 'neutral';
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${chipTone(
        tone,
      )}`}
    >
      {children}
    </span>
  );
}

function ListPills({
  items,
  tone = 'sky',
}: {
  items?: string[] | null;
  tone?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  if (!items || items.length === 0) return <span className="text-slate-400">—</span>;

  const toneMap = {
    sky: 'bg-white/90 text-slate-700 ring-sky-200',
    emerald: 'bg-emerald-50/85 text-emerald-800 ring-emerald-200',
    amber: 'bg-amber-50/85 text-amber-800 ring-amber-200',
    rose: 'bg-rose-50/85 text-rose-800 ring-rose-200',
  } as const;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={`${item}-${index}`}
          className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ${toneMap[tone]}`}
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function AdviceCountPills({
  items,
  tone = 'sky',
}: {
  items?: AdviceCountItem[] | null;
  tone?: 'sky' | 'emerald' | 'amber' | 'rose';
}) {
  if (!items || items.length === 0) return <span className="text-slate-400">—</span>;

  const toneMap = {
    sky: 'bg-white/90 text-slate-700 ring-sky-200',
    emerald: 'bg-emerald-50/85 text-emerald-800 ring-emerald-200',
    amber: 'bg-amber-50/85 text-amber-800 ring-amber-200',
    rose: 'bg-rose-50/85 text-rose-800 ring-rose-200',
  } as const;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={`${item.text}-${item.count}-${index}`}
          className={`rounded-full px-2.5 py-1 text-[11px] ring-1 ${toneMap[tone]}`}
        >
          {item.text} · {item.count}
        </span>
      ))}
    </div>
  );
}

function MiniKv({
  label,
  value,
  valueClassName = 'text-slate-900',
}: {
  label: string;
  value: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/90 p-3.5 ring-1 ring-sky-200">
      <div className="text-[11px] uppercase tracking-[0.14em] text-slate-500">{label}</div>
      <div className={`mt-1.5 text-base font-semibold ${valueClassName}`}>{value}</div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <div className="h-2.5 rounded-full bg-slate-200/80">
      <div
        className="h-2.5 rounded-full bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 transition-all"
        style={{ width: `${safe}%` }}
      />
    </div>
  );
}

function TimeSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const [hourValue = '12', minuteValue = '00'] = (value || '12:00').split(':');

  const hours = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));

  return (
    <div className="flex items-center gap-2">
      <select
        value={hourValue}
        onChange={(e) => onChange(`${e.target.value}:${minuteValue}`)}
        className="w-full rounded-[14px] bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
      >
        {hours.map((hour) => (
          <option key={hour} value={hour}>
            {hour}
          </option>
        ))}
      </select>

      <span className="text-sm font-semibold text-slate-500">:</span>

      <select
        value={minuteValue}
        onChange={(e) => onChange(`${hourValue}:${e.target.value}`)}
        className="w-full rounded-[14px] bg-white px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
      >
        {minutes.map((minute) => (
          <option key={minute} value={minute}>
            {minute}
          </option>
        ))}
      </select>
    </div>
  );
}

export default function ServiceQaPage() {
  const [selectedDate, setSelectedDate] = useState<string>(getTodayInBishkek());
  const [branchFilter, setBranchFilter] = useState<string>('');
  const [employeeFilter, setEmployeeFilter] = useState<string>('');
  const [modeFilter, setModeFilter] = useState<ModeFilter>('all');
  const [expandedChunkIds, setExpandedChunkIds] = useState<number[]>([]);
  const [copiedKey, setCopiedKey] = useState<string>('');

  const [reports, setReports] = useState<DailyReportRow[]>([]);
  const [historyReports, setHistoryReports] = useState<HistoricalReportRow[]>([]);
  const [chunks, setChunks] = useState<EnrichedChunk[]>([]);
  const [weeklyAdvice, setWeeklyAdvice] = useState<WeeklyAdviceRow[]>([]);
  const [branchRows, setBranchRows] = useState<LookupRow[]>([]);
  const [employeeRows, setEmployeeRows] = useState<LookupRow[]>([]);
  const [runtimeSettings, setRuntimeSettings] = useState<RuntimeSettingsRow | null>(null);

  const [scheduleDays, setScheduleDays] = useState<ScheduleDayCard[]>([]);
  const [scheduleLoading, setScheduleLoading] = useState<boolean>(false);
  const [scheduleSaving, setScheduleSaving] = useState<boolean>(false);
  const [scheduleError, setScheduleError] = useState<string>('');
  const [scheduleSuccess, setScheduleSuccess] = useState<string>('');

  const [editorDate, setEditorDate] = useState<string>(getTodayInBishkek());
  const [editorEnabled, setEditorEnabled] = useState<boolean>(true);
  const [editorIntervals, setEditorIntervals] = useState<ScheduleIntervalInput[]>([
    createIntervalInput(),
  ]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [lookupWarning, setLookupWarning] = useState<string>('');

  const supabase = useMemo(() => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) return null;
    return createClient(url, key);
  }, []);

  const scheduleRangeEnd = useMemo(() => addDaysYmd(selectedDate, 14), [selectedDate]);
  const selectedWeekBounds = useMemo(() => getWeekBounds(selectedDate), [selectedDate]);

  const copyText = useCallback(async (key: string, value?: string | null) => {
    const text = (value ?? '').trim();
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? '' : prev));
      }, 1600);
    } catch {
      // молча
    }
  }, []);

  const toggleChunk = (chunkId: number) => {
    setExpandedChunkIds((prev) =>
      prev.includes(chunkId) ? prev.filter((id) => id !== chunkId) : [...prev, chunkId],
    );
  };

  const resetScheduleEditor = useCallback((dateValue?: string) => {
    setEditorDate(dateValue ?? getTodayInBishkek());
    setEditorEnabled(true);
    setEditorIntervals([createIntervalInput('12:00', '13:00')]);
    setScheduleError('');
    setScheduleSuccess('');
  }, []);

  const fillScheduleEditorFromDay = useCallback(
    (planDate: string) => {
      const day = scheduleDays.find((x) => x.plan_date === planDate);

      if (!day) {
        setEditorDate(planDate);
        setEditorEnabled(true);
        setEditorIntervals([createIntervalInput('12:00', '13:00')]);
        setScheduleError('');
        setScheduleSuccess('');
        return;
      }

      setEditorDate(day.plan_date);
      setEditorEnabled(day.day_enabled);
      setEditorIntervals(
        day.intervals.length > 0
          ? day.intervals.map((item) => ({
              id: item.id,
              start: normalizeTimeText(item.start),
              end: normalizeTimeText(item.end),
              is_enabled: item.is_enabled,
            }))
          : [createIntervalInput('12:00', '13:00')],
      );
      setScheduleError('');
      setScheduleSuccess('');
    },
    [scheduleDays],
  );

  const loadScheduleRange = useCallback(async () => {
    if (!supabase) return;

    setScheduleLoading(true);
    setScheduleError('');

    try {
      const { data, error: rpcError } = await supabase
        .schema('service_qa')
        .rpc('get_recording_schedule_range', {
          p_date_from: selectedDate,
          p_date_to: scheduleRangeEnd,
        });

      if (rpcError) throw rpcError;

      const grouped = groupScheduleRows((data as ScheduleRangeRow[] | null) ?? []);
      setScheduleDays(grouped);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка загрузки расписания';
      setScheduleError(message);
    } finally {
      setScheduleLoading(false);
    }
  }, [scheduleRangeEnd, selectedDate, supabase]);

  const toggleProcessingProvider = useCallback(async () => {
    if (!supabase || !runtimeSettings) return;
    const newProvider = runtimeSettings.processing_provider === 'local' ? 'openai' : 'local';
    try {
      await supabase
        .schema('service_qa')
        .from('runtime_settings')
        .update({ processing_provider: newProvider })
        .eq('singleton_key', true);
      setRuntimeSettings({ ...runtimeSettings, processing_provider: newProvider });
    } catch (err) {
      console.error('Failed to toggle processing provider:', err);
    }
  }, [supabase, runtimeSettings]);

  const loadData = useCallback(
    async (options?: { silentRebuild?: boolean }) => {
      if (!supabase) {
        setError('Нет NEXT_PUBLIC_SUPABASE_URL или NEXT_PUBLIC_SUPABASE_ANON_KEY');
        setLoading(false);
        return;
      }

      setError('');
      setLookupWarning('');

      const shouldRunSilentRebuild = options?.silentRebuild ?? true;

      if (shouldRunSilentRebuild) {
        try {
          await supabase.schema('service_qa').rpc('rebuild_daily_employee_reports', {
            p_report_date: selectedDate,
            p_branch_id: branchFilter.trim() ? Number(branchFilter.trim()) : null,
            p_employee_id: employeeFilter.trim() ? Number(employeeFilter.trim()) : null,
          });
        } catch {
          // вспомогательно
        }
      }

      const { startIso, endIso } = getBishkekUtcBounds(selectedDate);

      let reportsQuery = supabase
        .schema('service_qa')
        .from('daily_employee_reports')
        .select('*')
        .eq('report_date', selectedDate)
        .order('overall_score', { ascending: false, nullsFirst: false });

      if (branchFilter.trim()) {
        reportsQuery = reportsQuery.eq('branch_id', Number(branchFilter.trim()));
      }

      if (employeeFilter.trim()) {
        reportsQuery = reportsQuery.eq('employee_id', Number(employeeFilter.trim()));
      }

      let chunksQuery = supabase
        .schema('service_qa')
        .from('audio_chunks')
        .select(
          'id, branch_id, employee_id, attendance_session_id, terminal_code, chunk_started_at, chunk_ended_at, uploaded_at, transcript_status, analysis_status, processing_error, recording_mode, test_note',
        )
        .gte('chunk_started_at', startIso)
        .lt('chunk_started_at', endIso)
        .order('chunk_started_at', { ascending: false });

      if (branchFilter.trim()) {
        chunksQuery = chunksQuery.eq('branch_id', Number(branchFilter.trim()));
      }

      if (employeeFilter.trim()) {
        chunksQuery = chunksQuery.eq('employee_id', Number(employeeFilter.trim()));
      }

      let historyQuery = supabase
        .schema('service_qa')
        .from('daily_employee_reports')
        .select(
          'report_date, branch_id, employee_id, overall_score, analyzed_chunks, rude_count, pushy_count, interrupted_count',
        )
        .order('report_date', { ascending: false });

      if (branchFilter.trim()) {
        historyQuery = historyQuery.eq('branch_id', Number(branchFilter.trim()));
      }

      if (employeeFilter.trim()) {
        historyQuery = historyQuery.eq('employee_id', Number(employeeFilter.trim()));
      }

      const weeklyRecordingMode = modeFilter === 'all' ? null : modeFilter;

      const [
        { data: reportsData, error: reportsError },
        { data: chunksData, error: chunksError },
        { data: historyData, error: historyError },
        { data: runtimeData, error: runtimeError },
        { data: weeklyData, error: weeklyError },
      ] = await Promise.all([
        reportsQuery,
        chunksQuery,
        historyQuery,
        supabase.schema('service_qa').from('runtime_settings').select('*').single(),
        supabase.schema('service_qa').rpc('get_weekly_employee_advice_range', {
          p_week_from: selectedWeekBounds.weekStart,
          p_week_to: selectedWeekBounds.weekEnd,
          p_branch_id: branchFilter.trim() ? Number(branchFilter.trim()) : null,
          p_employee_id: employeeFilter.trim() ? Number(employeeFilter.trim()) : null,
          p_recording_mode: weeklyRecordingMode,
        }),
      ]);

      if (reportsError) throw reportsError;
      if (chunksError) throw chunksError;
      if (historyError) throw historyError;
      if (weeklyError) throw weeklyError;
      if (!runtimeError) {
        setRuntimeSettings((runtimeData as RuntimeSettingsRow) ?? null);
      }

      const chunkIds = (chunksData ?? []).map((x) => x.id);

      let scoreRows: ChunkScoreRow[] = [];
      let transcriptRows: TranscriptRow[] = [];

      if (chunkIds.length > 0) {
        const [
          { data: fetchedScores, error: scoreError },
          { data: fetchedTranscripts, error: transcriptError },
        ] = await Promise.all([
          supabase
            .schema('service_qa')
            .from('chunk_scores')
            .select(
              'id, chunk_id, provider, model, status, overall_score, greeting_score, needs_discovery_score, explanation_score, price_explanation_score, closing_score, was_rude, was_pushy, interrupted_client, strengths, weaknesses, recommendations, summary, processing_error, speaker_roles, labeled_segments',
            )
            .in('chunk_id', chunkIds),
          supabase
            .schema('service_qa')
            .from('transcripts')
            .select('id, chunk_id, provider, model, status, text_full, speaker_segments')
            .in('chunk_id', chunkIds),
        ]);

        if (scoreError) throw scoreError;
        if (transcriptError) throw transcriptError;

        scoreRows = (fetchedScores as ChunkScoreRow[]) ?? [];
        transcriptRows = (fetchedTranscripts as TranscriptRow[]) ?? [];
      }

      try {
        const [
          { data: fetchedBranches, error: branchesError },
          { data: fetchedEmployees, error: employeesError },
        ] = await Promise.all([
          supabase.from('branches').select('*').order('id', { ascending: true }),
          supabase.from('employees').select('*').order('id', { ascending: true }),
        ]);

        if (!branchesError) {
          setBranchRows((fetchedBranches as LookupRow[]) ?? []);
        }

        if (!employeesError) {
          setEmployeeRows((fetchedEmployees as LookupRow[]) ?? []);
        }

        if (branchesError || employeesError) {
          setLookupWarning(
            'Справочники филиалов или сотрудников не удалось прочитать. Часть подписей может показываться по ID.',
          );
        }
      } catch {
        setLookupWarning(
          'Справочники филиалов или сотрудников не удалось прочитать. Часть подписей может показываться по ID.',
        );
      }

      const scoreMap = new Map<number, ChunkScoreRow>();
      for (const row of scoreRows) scoreMap.set(row.chunk_id, row);

      const transcriptMap = new Map<number, TranscriptRow>();
      for (const row of transcriptRows) transcriptMap.set(row.chunk_id, row);

      const enriched: EnrichedChunk[] =
        (chunksData as AudioChunkRow[] | null | undefined)?.map((chunk) => ({
          ...chunk,
          score: scoreMap.get(chunk.id) ?? null,
          transcript: transcriptMap.get(chunk.id) ?? null,
        })) ?? [];

      const normalizedWeekly: WeeklyAdviceRow[] = (
        ((weeklyData as Array<Record<string, unknown>> | null) ?? []) as Array<Record<string, unknown>>
      ).map((row) => ({
        id: Number(row.id),
        week_start: String(row.week_start ?? ''),
        week_end: String(row.week_end ?? ''),
        branch_id: asNumber(row.branch_id),
        branch_name: firstNonEmpty(row.branch_name) || null,
        employee_id: asNumber(row.employee_id),
        employee_name: firstNonEmpty(row.employee_name) || null,
        recording_mode: firstNonEmpty(row.recording_mode) || 'production',
        status: firstNonEmpty(row.status) || 'pending',
        source_chunks_total: Number(row.source_chunks_total ?? 0),
        source_analyzed_chunks: Number(row.source_analyzed_chunks ?? 0),
        source_days_with_data: Number(row.source_days_with_data ?? 0),
        overall_score: asNumber(row.overall_score),
        greeting_score: asNumber(row.greeting_score),
        needs_discovery_score: asNumber(row.needs_discovery_score),
        explanation_score: asNumber(row.explanation_score),
        price_explanation_score: asNumber(row.price_explanation_score),
        closing_score: asNumber(row.closing_score),
        rude_count: Number(row.rude_count ?? 0),
        pushy_count: Number(row.pushy_count ?? 0),
        interrupted_count: Number(row.interrupted_count ?? 0),
        top_strengths: normalizeAdviceCountItems(row.top_strengths),
        top_weaknesses: normalizeAdviceCountItems(row.top_weaknesses),
        top_recommendations: normalizeAdviceCountItems(row.top_recommendations),
        manager_summary: firstNonEmpty(row.manager_summary) || null,
        action_points: normalizeStringArray(row.action_points),
        message_for_employee: firstNonEmpty(row.message_for_employee) || null,
        generated_at: firstNonEmpty(row.generated_at) || null,
        created_at: String(row.created_at ?? ''),
        updated_at: String(row.updated_at ?? ''),
      }));

      setReports((reportsData as DailyReportRow[]) ?? []);
      setHistoryReports((historyData as HistoricalReportRow[]) ?? []);
      setChunks(enriched);
      setWeeklyAdvice(normalizedWeekly);
      setLoading(false);
    },
    [
      branchFilter,
      employeeFilter,
      modeFilter,
      selectedDate,
      selectedWeekBounds.weekEnd,
      selectedWeekBounds.weekStart,
      supabase,
    ],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (!cancelled) {
          await loadData({ silentRebuild: true });
        }
      } catch (err) {
        if (!cancelled) {
          const message = err instanceof Error ? err.message : 'Ошибка загрузки';
          setError(message);
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadData]);

  useEffect(() => {
    void loadScheduleRange();
  }, [loadScheduleRange]);

  useEffect(() => {
    if (!supabase) return;

    const timer = window.setInterval(async () => {
      try {
        await loadData({ silentRebuild: false });
      } catch {
        // автообновление молча
      }
    }, 30000);

    return () => window.clearInterval(timer);
  }, [loadData, supabase]);

  useEffect(() => {
    fillScheduleEditorFromDay(selectedDate);
  }, [selectedDate, fillScheduleEditorFromDay]);

  const branchOptions = useMemo<BranchOption[]>(() => {
    const map = new Map<number, string>();

    for (const row of branchRows) {
      const id = asNumber(row.id);
      if (id !== null) map.set(id, getBranchLabel(row));
    }

    for (const row of reports) {
      if (row.branch_id !== null && !map.has(row.branch_id)) {
        map.set(row.branch_id, `Филиал #${row.branch_id}`);
      }
    }

    for (const row of historyReports) {
      if (row.branch_id !== null && !map.has(row.branch_id)) {
        map.set(row.branch_id, `Филиал #${row.branch_id}`);
      }
    }

    for (const row of chunks) {
      if (row.branch_id !== null && !map.has(row.branch_id)) {
        map.set(row.branch_id, `Филиал #${row.branch_id}`);
      }
    }

    for (const row of weeklyAdvice) {
      if (row.branch_id !== null && !map.has(row.branch_id)) {
        map.set(row.branch_id, row.branch_name || `Филиал #${row.branch_id}`);
      }
    }

    return Array.from(map.entries())
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [branchRows, chunks, historyReports, reports, weeklyAdvice]);

  const employeeOptions = useMemo<EmployeeOption[]>(() => {
    const map = new Map<number, EmployeeOption>();

    for (const row of employeeRows) {
      const id = asNumber(row.id);
      if (id === null) continue;

      const branchId = asNumber(row.branch_id);
      map.set(id, {
        id,
        label: getEmployeeLabel(row),
        branch_id: branchId,
      });
    }

    for (const row of reports) {
      if (row.employee_id !== null && !map.has(row.employee_id)) {
        map.set(row.employee_id, {
          id: row.employee_id,
          label: `Сотрудник #${row.employee_id}`,
          branch_id: row.branch_id,
        });
      }
    }

    for (const row of historyReports) {
      if (row.employee_id !== null && !map.has(row.employee_id)) {
        map.set(row.employee_id, {
          id: row.employee_id,
          label: `Сотрудник #${row.employee_id}`,
          branch_id: row.branch_id,
        });
      }
    }

    for (const row of chunks) {
      if (row.employee_id !== null && !map.has(row.employee_id)) {
        map.set(row.employee_id, {
          id: row.employee_id,
          label: `Сотрудник #${row.employee_id}`,
          branch_id: row.branch_id,
        });
      }
    }

    for (const row of weeklyAdvice) {
      if (row.employee_id !== null && !map.has(row.employee_id)) {
        map.set(row.employee_id, {
          id: row.employee_id,
          label: row.employee_name || `Сотрудник #${row.employee_id}`,
          branch_id: row.branch_id,
        });
      }
    }

    const selectedBranchId = branchFilter.trim() ? Number(branchFilter.trim()) : null;

    return Array.from(map.values())
      .filter((item) => {
        if (selectedBranchId === null) return true;
        if (item.branch_id === null) return true;
        return item.branch_id === selectedBranchId;
      })
      .sort((a, b) => a.label.localeCompare(b.label, 'ru'));
  }, [branchFilter, chunks, employeeRows, historyReports, reports, weeklyAdvice]);

  const branchLabelMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const item of branchOptions) map.set(item.id, item.label);
    return map;
  }, [branchOptions]);

  const employeeMap = useMemo(() => {
    const map = new Map<number, EmployeeOption>();
    for (const item of employeeOptions) map.set(item.id, item);
    for (const row of employeeRows) {
      const id = asNumber(row.id);
      if (id === null || map.has(id)) continue;
      map.set(id, {
        id,
        label: getEmployeeLabel(row),
        branch_id: asNumber(row.branch_id),
      });
    }
    return map;
  }, [employeeOptions, employeeRows]);

  const rankingRows = useMemo<RankingRow[]>(() => {
    const map = new Map<number, RankingRow & { score_count: number }>();

    for (const row of historyReports) {
      if (row.employee_id === null) continue;

      const employeeLabel =
        employeeMap.get(row.employee_id)?.label ?? `Сотрудник #${row.employee_id}`;
      const branchLabel =
        row.branch_id !== null
          ? branchLabelMap.get(row.branch_id) ?? `Филиал #${row.branch_id}`
          : 'Не указан';

      const existing = map.get(row.employee_id) ?? {
        employee_id: row.employee_id,
        employee_label: employeeLabel,
        branch_id: row.branch_id,
        branch_label: branchLabel,
        total_points: 0,
        today_points: 0,
        report_days: 0,
        avg_score: null,
        analyzed_chunks_total: 0,
        rude_count_total: 0,
        pushy_count_total: 0,
        interrupted_count_total: 0,
        score_count: 0,
      };

      const score = row.overall_score ?? 0;

      existing.total_points += score;
      if (row.report_date === selectedDate) {
        existing.today_points += score;
      }

      existing.report_days += 1;
      existing.analyzed_chunks_total += Number(row.analyzed_chunks ?? 0);
      existing.rude_count_total += Number(row.rude_count ?? 0);
      existing.pushy_count_total += Number(row.pushy_count ?? 0);
      existing.interrupted_count_total += Number(row.interrupted_count ?? 0);

      if (row.overall_score !== null && row.overall_score !== undefined) {
        existing.score_count += 1;
      }

      map.set(row.employee_id, existing);
    }

    const rows = Array.from(map.values()).map((row) => ({
      employee_id: row.employee_id,
      employee_label: row.employee_label,
      branch_id: row.branch_id,
      branch_label: row.branch_label,
      total_points: row.total_points,
      today_points: row.today_points,
      report_days: row.report_days,
      avg_score: row.score_count > 0 ? row.total_points / row.score_count : null,
      analyzed_chunks_total: row.analyzed_chunks_total,
      rude_count_total: row.rude_count_total,
      pushy_count_total: row.pushy_count_total,
      interrupted_count_total: row.interrupted_count_total,
    }));

    rows.sort((a, b) => {
      if (b.total_points !== a.total_points) return b.total_points - a.total_points;
      if (b.today_points !== a.today_points) return b.today_points - a.today_points;
      if ((b.avg_score ?? 0) !== (a.avg_score ?? 0)) return (b.avg_score ?? 0) - (a.avg_score ?? 0);
      return a.employee_label.localeCompare(b.employee_label, 'ru');
    });

    return rows;
  }, [branchLabelMap, employeeMap, historyReports, selectedDate]);

  const rankingMap = useMemo(() => {
    const map = new Map<number, RankingRow>();
    for (const row of rankingRows) map.set(row.employee_id, row);
    return map;
  }, [rankingRows]);

  const visibleChunks = useMemo(() => {
    if (modeFilter === 'all') return chunks;
    return chunks.filter((x) => x.recording_mode === modeFilter);
  }, [chunks, modeFilter]);

  const diagnosticStats = useMemo(() => {
    const total = visibleChunks.length;
    const linked = visibleChunks.filter(
      (x) => x.employee_id !== null && x.attendance_session_id !== null,
    ).length;
    const withoutEmployee = visibleChunks.filter((x) => x.employee_id === null).length;
    const withoutSession = visibleChunks.filter((x) => x.attendance_session_id === null).length;
    const transcriptDone = visibleChunks.filter((x) => x.transcript_status === 'done').length;
    const analysisDone = visibleChunks.filter((x) => x.analysis_status === 'done').length;
    const skippedBySilence = visibleChunks.filter((x) =>
      (x.processing_error ?? '').toLowerCase().includes('silence filter'),
    ).length;

    let status: 'ok' | 'warn' | 'bad' = 'warn';
    if (total === 0) status = 'warn';
    else if (linked === total) status = 'ok';
    else if (linked === 0) status = 'bad';

    return {
      total,
      linked,
      withoutEmployee,
      withoutSession,
      transcriptDone,
      analysisDone,
      skippedBySilence,
      status,
      linkedPercent: total > 0 ? (linked / total) * 100 : 0,
    };
  }, [visibleChunks]);

  const reportCards = useMemo(() => {
    return reports.map((row) => {
      const employeeLabel =
        row.employee_id !== null
          ? employeeMap.get(row.employee_id)?.label ?? `Сотрудник #${row.employee_id}`
          : 'Не привязан';
      const branchLabel =
        row.branch_id !== null
          ? branchLabelMap.get(row.branch_id) ?? `Филиал #${row.branch_id}`
          : 'Не указан';
      const ranking = row.employee_id !== null ? rankingMap.get(row.employee_id) ?? null : null;

      return {
        ...row,
        employeeLabel,
        branchLabel,
        totalPoints: ranking?.total_points ?? null,
      };
    });
  }, [branchLabelMap, employeeMap, rankingMap, reports]);

  const weeklyCards = useMemo(() => {
    return weeklyAdvice.map((row) => {
      const employeeLabel =
        row.employee_name ||
        (row.employee_id !== null
          ? employeeMap.get(row.employee_id)?.label ?? `Сотрудник #${row.employee_id}`
          : 'Не привязан');

      const branchLabel =
        row.branch_name ||
        (row.branch_id !== null
          ? branchLabelMap.get(row.branch_id) ?? `Филиал #${row.branch_id}`
          : 'Не указан');

      return {
        ...row,
        employeeLabel,
        branchLabel,
        actionPointsText: (row.action_points ?? []).map((item, index) => `${index + 1}. ${item}`).join('\n'),
      };
    });
  }, [branchLabelMap, employeeMap, weeklyAdvice]);

  const enrichedChunksForUi = useMemo(() => {
    return visibleChunks.map((chunk) => {
      const employeeLabel =
        chunk.employee_id !== null
          ? employeeMap.get(chunk.employee_id)?.label ?? `Сотрудник #${chunk.employee_id}`
          : 'Не привязано';
      const branchLabel =
        chunk.branch_id !== null
          ? branchLabelMap.get(chunk.branch_id) ?? `Филиал #${chunk.branch_id}`
          : 'Не указан';

      return {
        ...chunk,
        employeeLabel,
        branchLabel,
      };
    });
  }, [branchLabelMap, employeeMap, visibleChunks]);

  const updateIntervalField = (id: string, field: 'start' | 'end', value: string) => {
    setEditorIntervals((prev) =>
      prev.map((item) => (item.id === id ? { ...item, [field]: value } : item)),
    );
  };

  const addInterval = () => {
    setEditorIntervals((prev) => [...prev, createIntervalInput('12:00', '13:00')]);
  };

  const removeInterval = (id: string) => {
    setEditorIntervals((prev) => {
      const next = prev.filter((item) => item.id !== id);
      return next.length > 0 ? next : [createIntervalInput('12:00', '13:00')];
    });
  };

  const saveScheduleDay = async () => {
    if (!supabase) return;

    setScheduleSaving(true);
    setScheduleError('');
    setScheduleSuccess('');

    try {
      if (!editorDate) {
        throw new Error('Выбери дату.');
      }

      const intervalsForSave = editorEnabled
        ? editorIntervals.map((item) => ({
            start: item.start,
            end: item.end,
            is_enabled: item.is_enabled,
          }))
        : [];

      if (editorEnabled) {
        for (const item of intervalsForSave) {
          if (!item.start || !item.end) {
            throw new Error('У каждого интервала должны быть указаны начало и конец.');
          }
          if (item.end <= item.start) {
            throw new Error('Конец интервала должен быть позже начала.');
          }
        }

        const sorted = [...intervalsForSave].sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < sorted.length; i++) {
          if (sorted[i].start < sorted[i - 1].end) {
            throw new Error('Интервалы не должны пересекаться.');
          }
        }
      }

      const { error: rpcError } = await supabase
        .schema('service_qa')
        .rpc('set_recording_day_schedule', {
          p_plan_date: editorDate,
          p_timezone: 'Asia/Bishkek',
          p_is_enabled: editorEnabled,
          p_note: null,
          p_intervals: intervalsForSave,
        });

      if (rpcError) throw rpcError;

      setScheduleSuccess('Расписание сохранено.');
      await loadScheduleRange();
      fillScheduleEditorFromDay(editorDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка сохранения';
      setScheduleError(message);
    } finally {
      setScheduleSaving(false);
    }
  };

  const deleteScheduleDay = async (dateToDelete?: string) => {
    if (!supabase) return;

    const targetDate = dateToDelete || editorDate;
    if (!targetDate) return;

    const confirmed = window.confirm(`Удалить расписание на ${formatDateRuLong(targetDate)}?`);
    if (!confirmed) return;

    setScheduleSaving(true);
    setScheduleError('');
    setScheduleSuccess('');

    try {
      const { error: rpcError } = await supabase
        .schema('service_qa')
        .rpc('delete_recording_day_schedule', {
          p_plan_date: targetDate,
        });

      if (rpcError) throw rpcError;

      setScheduleSuccess('День удалён из расписания.');
      await loadScheduleRange();
      resetScheduleEditor(targetDate);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Ошибка удаления';
      setScheduleError(message);
    } finally {
      setScheduleSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-transparent text-slate-900">
      <div className="mx-auto max-w-7xl px-5 pb-10 pt-8">
        <section className="mb-6 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_14px_40px_rgba(6,182,212,0.35)]">
                <ShieldAlert className="h-5 w-5" />
              </div>

              <div>
                <h1 className="text-[30px] font-semibold tracking-tight text-slate-900">
                  Контроль сервиса
                </h1>
                <p className="mt-1 text-sm text-slate-600">
                  Дата:{' '}
                  <span className="font-semibold text-slate-900">{formatDateRuLong(selectedDate)}</span>
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:min-w-[460px]">
              <div className="rounded-[28px] bg-white/85 p-4 ring-1 ring-sky-200">
                <div className="mb-3 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-teal-600" />
                  <div className="text-sm font-semibold text-slate-900">Тестовый режим</div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <TinyChip tone={runtimeSettings?.test_mode_enabled ? 'ok' : 'neutral'}>
                    {runtimeSettings?.test_mode_enabled ? 'Включён' : 'Выключен'}
                  </TinyChip>
                  <TinyChip tone={runtimeSettings?.allow_without_active_shift ? 'ok' : 'neutral'}>
                    Без смены: {runtimeSettings?.allow_without_active_shift ? 'Да' : 'Нет'}
                  </TinyChip>
                  <TinyChip
                    tone={runtimeSettings?.allow_outside_recording_window ? 'ok' : 'neutral'}
                  >
                    Вне окна: {runtimeSettings?.allow_outside_recording_window ? 'Да' : 'Нет'}
                  </TinyChip>
                </div>

                <div className="mt-3 space-y-1.5 text-xs text-slate-600">
                  <div>Устройство: {runtimeSettings?.test_device_name || '—'}</div>
                  <div>Терминал: {runtimeSettings?.test_terminal_code || '—'}</div>
                  <div>Токен: {formatShortToken(runtimeSettings?.test_device_token)}</div>
                </div>
              </div>

              <div className="rounded-[28px] bg-white/85 p-4 ring-1 ring-sky-200">
                <div className="mb-3 flex items-center gap-2">
                  {runtimeSettings?.processing_provider === 'local' ? (
                    <Cpu className="h-4 w-4 text-emerald-600" />
                  ) : (
                    <Cloud className="h-4 w-4 text-violet-600" />
                  )}
                  <div className="text-sm font-semibold text-slate-900">Обработка аудио</div>
                </div>

                <button
                  onClick={toggleProcessingProvider}
                  className={`w-full rounded-[14px] px-3.5 py-2.5 text-sm font-medium transition ring-1 outline-none ${
                    runtimeSettings?.processing_provider === 'local'
                      ? 'bg-emerald-50 text-emerald-800 ring-emerald-300 hover:bg-emerald-100'
                      : 'bg-violet-50 text-violet-800 ring-violet-300 hover:bg-violet-100'
                  }`}
                >
                  {runtimeSettings?.processing_provider === 'local'
                    ? 'Локально (Whisper + Ollama)'
                    : 'OpenAI API'}
                </button>

                <div className="mt-3 text-xs text-slate-500">
                  {runtimeSettings?.processing_provider === 'local'
                    ? 'GPU этого ПК, бесплатно'
                    : 'Облако OpenAI, платно'}
                </div>
              </div>

              <div className="rounded-[28px] bg-white/85 p-4 ring-1 ring-sky-200">
                <div className="mb-3 flex items-center gap-2">
                  <AudioLines className="h-4 w-4 text-sky-600" />
                  <div className="text-sm font-semibold text-slate-900">Фильтр записей</div>
                </div>

                <label className="block">
                  <select
                    value={modeFilter}
                    onChange={(e) => setModeFilter(e.target.value as ModeFilter)}
                    className="w-full rounded-[14px] bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
                  >
                    <option value="all">Все записи</option>
                    <option value="test">Только тестовые</option>
                    <option value="production">Только боевые</option>
                  </select>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-cyan-100 text-cyan-700">
                <CalendarDays className="h-4 w-4" />
              </div>
              <div>
                <div className="text-base font-semibold text-slate-900">Расписание записи</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  По умолчанию каждый день работает окно{' '}
                  <span className="font-semibold text-slate-700">12:00–13:00</span>.
                  Для отдельной даты можно задать своё время.
                </div>
              </div>
            </div>
          </div>

          {scheduleError ? (
            <div className="mb-4 flex items-start gap-3 rounded-2xl bg-rose-50/90 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{scheduleError}</span>
            </div>
          ) : null}

          {scheduleSuccess ? (
            <div className="mb-4 rounded-2xl bg-emerald-50/90 p-4 text-sm text-emerald-700 ring-1 ring-emerald-200">
              {scheduleSuccess}
            </div>
          ) : null}

          <div className="grid gap-5 xl:grid-cols-[1.04fr_0.96fr]">
            <div className="rounded-[28px] bg-white/90 p-5 ring-1 ring-sky-200">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">Редактор дня</div>
                <TinyChip tone={editorEnabled ? 'ok' : 'warn'}>
                  {editorEnabled ? 'Запись включена' : 'День отключён'}
                </TinyChip>
              </div>

              <label className="block">
                <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                  Дата
                </div>
                <input
                  type="date"
                  value={editorDate}
                  onChange={(e) => fillScheduleEditorFromDay(e.target.value)}
                  className="w-full rounded-[14px] bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
                />
                <div className="mt-2 text-sm font-medium text-slate-700">
                  {formatDateRuLong(editorDate)}
                </div>
              </label>

              <div className="mt-4 flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3.5 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                  <input
                    type="checkbox"
                    checked={editorEnabled}
                    onChange={(e) => setEditorEnabled(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-cyan-600 focus:ring-cyan-500"
                  />
                  День записи включён
                </label>
              </div>

              <div className="mt-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-900">Интервалы</div>
                  <button
                    type="button"
                    onClick={addInterval}
                    disabled={!editorEnabled}
                    className="inline-flex items-center gap-2 rounded-2xl bg-cyan-50 px-3 py-2 text-sm font-medium text-cyan-700 ring-1 ring-cyan-200 transition hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Plus className="h-4 w-4" />
                    Добавить
                  </button>
                </div>

                {!editorEnabled ? (
                  <div className="rounded-2xl bg-amber-50/90 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
                    В этот день запись отключена.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {editorIntervals.map((item, index) => (
                      <div
                        key={item.id}
                        className="grid gap-3 rounded-2xl bg-slate-50/90 p-4 ring-1 ring-slate-200 md:grid-cols-[1fr_1fr_auto]"
                      >
                        <label className="block">
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                            Начало #{index + 1}
                          </div>
                          <TimeSelect
                            value={item.start}
                            onChange={(next) => updateIntervalField(item.id, 'start', next)}
                          />
                        </label>

                        <label className="block">
                          <div className="mb-1 text-[11px] font-medium uppercase tracking-[0.16em] text-slate-500">
                            Конец #{index + 1}
                          </div>
                          <TimeSelect
                            value={item.end}
                            onChange={(next) => updateIntervalField(item.id, 'end', next)}
                          />
                        </label>

                        <div className="flex items-end">
                          <button
                            type="button"
                            onClick={() => removeInterval(item.id)}
                            className="inline-flex items-center gap-2 rounded-2xl bg-rose-50 px-3.5 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
                          >
                            <Trash2 className="h-4 w-4" />
                            Убрать
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => void saveScheduleDay()}
                  disabled={scheduleSaving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_14px_35px_rgba(6,182,212,0.35)] transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Save className="h-4 w-4" />
                  {scheduleSaving ? 'Сохранение...' : 'Сохранить день'}
                </button>

                <button
                  type="button"
                  onClick={() => void deleteScheduleDay()}
                  disabled={scheduleSaving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-white/90 px-4 py-2.5 text-sm font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Trash2 className="h-4 w-4" />
                  Удалить день
                </button>
              </div>
            </div>

            <div className="rounded-[28px] bg-white/90 p-5 ring-1 ring-sky-200">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-900">Настроенные дни</div>
                <TinyChip tone={scheduleDays.length > 0 ? 'ok' : 'warn'}>
                  {scheduleLoading ? 'Загрузка...' : scheduleDays.length}
                </TinyChip>
              </div>

              {scheduleLoading ? (
                <div className="space-y-3">
                  {Array.from({ length: 4 }).map((_, index) => (
                    <div
                      key={index}
                      className="animate-pulse rounded-2xl bg-slate-100/90 p-4 ring-1 ring-slate-200"
                    >
                      <div className="h-4 w-28 rounded bg-slate-200" />
                      <div className="mt-3 h-8 rounded bg-slate-200" />
                    </div>
                  ))}
                </div>
              ) : scheduleDays.length === 0 ? (
                <div className="rounded-2xl bg-slate-50/90 p-6 text-center text-sm text-slate-600 ring-1 ring-slate-200">
                  Отдельных настроек пока нет. Работает дефолт 12:00–13:00.
                </div>
              ) : (
                <div className="space-y-3">
                  {scheduleDays.map((day) => (
                    <div
                      key={day.plan_date}
                      className="rounded-2xl bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-4 ring-1 ring-sky-200"
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-900">
                          {formatDateRuLong(day.plan_date)}
                        </div>

                        <TinyChip tone={day.day_enabled ? 'ok' : 'warn'}>
                          {day.day_enabled ? 'Включено' : 'Выключено'}
                        </TinyChip>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {day.day_enabled && day.intervals.length > 0 ? (
                          day.intervals.map((item) => (
                            <TinyChip key={item.id} tone="neutral">
                              {normalizeTimeText(item.start)}–{normalizeTimeText(item.end)}
                            </TinyChip>
                          ))
                        ) : (
                          <TinyChip tone="warn">Запись отключена</TinyChip>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => fillScheduleEditorFromDay(day.plan_date)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-sky-200 transition hover:bg-slate-50"
                        >
                          Редактировать
                        </button>

                        <button
                          type="button"
                          onClick={() => void deleteScheduleDay(day.plan_date)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700 ring-1 ring-rose-200 transition hover:bg-rose-100"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Удалить
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>

        <div className="mb-6 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/80 p-5 shadow-[0_22px_70px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <label className="block">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <CalendarDays className="h-3.5 w-3.5" />
                Дата
              </div>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full rounded-[14px] bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
              />
              <div className="mt-2 text-sm font-medium text-slate-700">
                {formatDateRuLong(selectedDate)}
              </div>
            </label>

            <label className="block">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <Users className="h-3.5 w-3.5" />
                Филиал
              </div>
              <select
                value={branchFilter}
                onChange={(e) => {
                  setBranchFilter(e.target.value);
                  setEmployeeFilter('');
                }}
                className="w-full rounded-[14px] bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
              >
                <option value="">Все филиалы</option>
                {branchOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <div className="mb-1.5 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">
                <UserRound className="h-3.5 w-3.5" />
                Сотрудник
              </div>
              <select
                value={employeeFilter}
                onChange={(e) => setEmployeeFilter(e.target.value)}
                className="w-full rounded-[14px] bg-white/90 px-3.5 py-2.5 text-sm text-slate-900 ring-1 ring-sky-200 outline-none transition focus:ring-2 focus:ring-cyan-400"
              >
                <option value="">Все сотрудники</option>
                {employeeOptions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {lookupWarning ? (
            <div className="mt-4 rounded-2xl bg-amber-50/90 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
              {lookupWarning}
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 flex items-start gap-3 rounded-2xl bg-rose-50/90 p-4 text-sm text-rose-700 ring-1 ring-rose-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <section className="mb-8 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
              </div>
              <div className="text-base font-semibold text-slate-900">Диагностика привязки</div>
            </div>

            <TinyChip tone={diagnosticStats.status}>
              {diagnosticStats.status === 'ok'
                ? 'Все привязаны'
                : diagnosticStats.status === 'bad'
                ? 'Привязки нет'
                : 'Частично'}
            </TinyChip>
          </div>

          <div className="mb-4 grid gap-4 md:grid-cols-2 xl:grid-cols-6">
            <MiniKv label="Всего" value={diagnosticStats.total} />
            <MiniKv label="Привязано" value={diagnosticStats.linked} valueClassName="text-emerald-700" />
            <MiniKv label="Без employee" value={diagnosticStats.withoutEmployee} valueClassName="text-rose-700" />
            <MiniKv label="Без session" value={diagnosticStats.withoutSession} valueClassName="text-rose-700" />
            <MiniKv label="Transcript done" value={diagnosticStats.transcriptDone} />
            <MiniKv label="Analysis done" value={diagnosticStats.analysisDone} />
          </div>

          <div className="rounded-[28px] bg-white/90 p-4 ring-1 ring-sky-200">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-sm font-semibold text-slate-800">Покрытие</div>
              <div className="text-sm font-semibold text-slate-900">
                {formatScore(diagnosticStats.linkedPercent)}%
              </div>
            </div>
            <ProgressBar value={diagnosticStats.linkedPercent} />
            <div className="mt-3 text-xs text-slate-500">
              Пропусков по фильтру тишины: {diagnosticStats.skippedBySilence}
            </div>
          </div>
        </section>

        <section className="mb-8 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-amber-100 text-amber-700">
                <Trophy className="h-4 w-4" />
              </div>
              <div className="text-base font-semibold text-slate-900">Рейтинг сотрудников</div>
            </div>

            <TinyChip tone={rankingRows.length > 0 ? 'ok' : 'warn'}>
              {rankingRows.length}
            </TinyChip>
          </div>

          {loading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-2xl bg-slate-100/90 p-5 ring-1 ring-slate-200"
                >
                  <div className="h-5 w-40 rounded bg-slate-200" />
                  <div className="mt-4 h-20 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : rankingRows.length === 0 ? (
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-slate-700 ring-1 ring-sky-200">
              Пока нет рейтинга.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {rankingRows.map((row, index) => {
                const topPoints = rankingRows[0]?.total_points ?? 0;
                const percent = topPoints > 0 ? (row.total_points / topPoints) * 100 : 0;

                return (
                  <div
                    key={row.employee_id}
                    className="rounded-[28px] bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.10)] ring-1 ring-sky-200"
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <div className="text-base font-semibold text-slate-900">
                          #{index + 1} · {row.employee_label}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">{row.branch_label}</div>
                      </div>

                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${scoreTone(
                          row.avg_score,
                        )}`}
                      >
                        Ср. балл: {formatScore(row.avg_score)}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <MiniKv label="Всего" value={formatScore(row.total_points)} />
                      <MiniKv label="Сегодня" value={formatScore(row.today_points)} />
                      <MiniKv label="Дней" value={row.report_days} />
                      <MiniKv label="Чанков" value={row.analyzed_chunks_total} />
                    </div>

                    <div className="mt-4 rounded-[24px] bg-white/90 p-4 ring-1 ring-sky-200">
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-slate-800">Позиция</div>
                        <div className="text-xs text-slate-500">{formatScore(percent)}%</div>
                      </div>
                      <ProgressBar value={percent} />
                    </div>

                    <div className="mt-4 flex flex-wrap gap-2">
                      {row.rude_count_total > 0 ? (
                        <TinyChip tone="bad">Грубость: {row.rude_count_total}</TinyChip>
                      ) : (
                        <TinyChip tone="ok">Грубость: 0</TinyChip>
                      )}
                      {row.pushy_count_total > 0 ? (
                        <TinyChip tone="warn">Давление: {row.pushy_count_total}</TinyChip>
                      ) : (
                        <TinyChip tone="ok">Давление: 0</TinyChip>
                      )}
                      {row.interrupted_count_total > 0 ? (
                        <TinyChip tone="warn">Перебивания: {row.interrupted_count_total}</TinyChip>
                      ) : (
                        <TinyChip tone="ok">Перебивания: 0</TinyChip>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="mb-8 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-violet-100 text-violet-700">
                <Clock3 className="h-4 w-4" />
              </div>
              <div>
                <div className="text-base font-semibold text-slate-900">Недельные советы по сотрудникам</div>
                <div className="mt-0.5 text-xs text-slate-500">
                  Неделя: <span className="font-semibold text-slate-700">{formatWeekRange(selectedWeekBounds.weekStart, selectedWeekBounds.weekEnd)}</span>
                </div>
              </div>
            </div>

            <TinyChip tone={weeklyCards.length > 0 ? 'ok' : 'warn'}>
              {weeklyCards.length}
            </TinyChip>
          </div>

          {loading ? (
            <div className="grid gap-4 xl:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-2xl bg-slate-100/90 p-5 ring-1 ring-slate-200"
                >
                  <div className="h-5 w-48 rounded bg-slate-200" />
                  <div className="mt-4 h-24 rounded bg-slate-200" />
                  <div className="mt-4 h-16 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : weeklyCards.length === 0 ? (
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-slate-700 ring-1 ring-sky-200">
              За выбранную неделю готовых недельных советов пока нет.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {weeklyCards.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[28px] bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.10)] ring-1 ring-sky-200"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900">{row.employeeLabel}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.branchLabel} · {formatWeekRange(row.week_start, row.week_end)}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-end gap-2">
                      <TinyChip tone={weeklyStatusTone(row.status)}>{weeklyStatusLabel(row.status)}</TinyChip>
                      {row.recording_mode === 'test' ? (
                        <TinyChip tone="warn">test</TinyChip>
                      ) : (
                        <TinyChip tone="neutral">production</TinyChip>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MiniKv label="Записей" value={row.source_chunks_total} />
                    <MiniKv label="Анализ" value={row.source_analyzed_chunks} />
                    <MiniKv label="Дней" value={row.source_days_with_data} />
                    <MiniKv label="Балл недели" value={formatScore(row.overall_score)} />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <MiniKv label="Приветствие" value={formatScore(row.greeting_score)} />
                    <MiniKv label="Потребность" value={formatScore(row.needs_discovery_score)} />
                    <MiniKv label="Объяснение" value={formatScore(row.explanation_score)} />
                    <MiniKv label="Цена" value={formatScore(row.price_explanation_score)} />
                    <MiniKv label="Завершение" value={formatScore(row.closing_score)} />
                    <MiniKv label="Перебивания" value={row.interrupted_count} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {row.rude_count > 0 ? (
                      <TinyChip tone="bad">Грубость: {row.rude_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Грубость: 0</TinyChip>
                    )}
                    {row.pushy_count > 0 ? (
                      <TinyChip tone="warn">Давление: {row.pushy_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Давление: 0</TinyChip>
                    )}
                    {row.interrupted_count > 0 ? (
                      <TinyChip tone="warn">Перебивания: {row.interrupted_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Перебивания: 0</TinyChip>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Сильные стороны недели</div>
                      <AdviceCountPills items={row.top_strengths} tone="emerald" />
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Слабые стороны недели</div>
                      <AdviceCountPills items={row.top_weaknesses} tone="rose" />
                    </div>

                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Повторяющиеся рекомендации</div>
                      <AdviceCountPills items={row.top_recommendations} tone="amber" />
                    </div>
                  </div>

                  {row.manager_summary ? (
                    <div className="mt-4 rounded-[24px] bg-white/90 p-4 ring-1 ring-sky-200">
                      <div className="mb-2 text-sm font-semibold text-slate-900">Вывод для владельца</div>
                      <div className="text-sm leading-6 text-slate-700">{row.manager_summary}</div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-[24px] bg-slate-50/90 p-4 text-sm text-slate-600 ring-1 ring-slate-200">
                      Краткий недельный вывод пока не сгенерирован.
                    </div>
                  )}

                  <div className="mt-4 rounded-[24px] bg-white/90 p-4 ring-1 ring-sky-200">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Что контролировать</div>

                      {row.action_points && row.action_points.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => void copyText(`weekly-actions-${row.id}`, row.actionPointsText)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-slate-200 transition hover:bg-slate-100"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedKey === `weekly-actions-${row.id}` ? 'Скопировано' : 'Копировать'}
                        </button>
                      ) : null}
                    </div>

                    {row.action_points && row.action_points.length > 0 ? (
                      <div className="space-y-2.5">
                        {row.action_points.map((item, index) => (
                          <div
                            key={`${item}-${index}`}
                            className="rounded-2xl bg-amber-50/85 p-3.5 text-sm leading-6 text-amber-900 ring-1 ring-amber-200"
                          >
                            {index + 1}. {item}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">Список действий пока пуст.</div>
                    )}
                  </div>

                  <div className="mt-4 rounded-[24px] bg-gradient-to-br from-sky-50/95 to-cyan-50/95 p-4 ring-1 ring-sky-200">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-slate-900">Текст для сотрудника</div>

                      {row.message_for_employee ? (
                        <button
                          type="button"
                          onClick={() => void copyText(`weekly-message-${row.id}`, row.message_for_employee)}
                          className="inline-flex items-center gap-2 rounded-2xl bg-white/90 px-3 py-2 text-xs font-medium text-slate-700 ring-1 ring-sky-200 transition hover:bg-white"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          {copiedKey === `weekly-message-${row.id}` ? 'Скопировано' : 'Копировать'}
                        </button>
                      ) : null}
                    </div>

                    {row.message_for_employee ? (
                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                        {row.message_for_employee}
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500">
                        Текст для отправки сотруднику пока не сгенерирован.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 text-xs text-slate-500">
                    Сгенерировано: {formatDateTime(row.generated_at, true)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mb-8 rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                <UserRound className="h-4 w-4" />
              </div>
              <div className="text-base font-semibold text-slate-900">Дневные отчёты по сотрудникам</div>
            </div>

            <TinyChip tone={reports.length > 0 ? 'ok' : 'warn'}>
              {reports.length > 0 ? reports.length : '0'}
            </TinyChip>
          </div>

          {loading ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {Array.from({ length: 2 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-2xl bg-slate-100/90 p-5 ring-1 ring-slate-200"
                >
                  <div className="h-5 w-40 rounded bg-slate-200" />
                  <div className="mt-4 h-20 rounded bg-slate-200" />
                  <div className="mt-4 h-10 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : reportCards.length === 0 ? (
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-slate-700 ring-1 ring-sky-200">
              Для этой даты отчётов пока нет.
            </div>
          ) : (
            <div className="grid gap-4 xl:grid-cols-2">
              {reportCards.map((row) => (
                <div
                  key={row.id}
                  className="rounded-[28px] bg-gradient-to-br from-white via-slate-50 to-sky-50/70 p-5 shadow-[0_18px_50px_rgba(15,23,42,0.10)] ring-1 ring-sky-200"
                >
                  <div className="mb-4 flex items-start justify-between gap-3">
                    <div>
                      <div className="text-base font-semibold text-slate-900">{row.employeeLabel}</div>
                      <div className="mt-1 text-xs text-slate-500">
                        {row.branchLabel} · {formatDateRuLong(row.report_date)}
                      </div>
                    </div>

                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ${scoreTone(
                        row.overall_score,
                      )}`}
                    >
                      Балл дня: {formatScore(row.overall_score)}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    <MiniKv label="Чанки" value={row.chunks_total} />
                    <MiniKv label="Анализ" value={row.analyzed_chunks} />
                    <MiniKv label="Балл дня" value={formatScore(row.overall_score)} />
                    <MiniKv label="Балл всего" value={formatScore(row.totalPoints)} />
                  </div>

                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    <MiniKv label="Приветствие" value={formatScore(row.greeting_score)} />
                    <MiniKv label="Потребность" value={formatScore(row.needs_discovery_score)} />
                    <MiniKv label="Объяснение" value={formatScore(row.explanation_score)} />
                    <MiniKv label="Цена" value={formatScore(row.price_explanation_score)} />
                    <MiniKv label="Завершение" value={formatScore(row.closing_score)} />
                    <MiniKv label="Перебивания" value={row.interrupted_count} />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    {row.rude_count > 0 ? (
                      <TinyChip tone="bad">Грубость: {row.rude_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Грубость: 0</TinyChip>
                    )}
                    {row.pushy_count > 0 ? (
                      <TinyChip tone="warn">Давление: {row.pushy_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Давление: 0</TinyChip>
                    )}
                    {row.interrupted_count > 0 ? (
                      <TinyChip tone="warn">Перебивания: {row.interrupted_count}</TinyChip>
                    ) : (
                      <TinyChip tone="ok">Перебивания: 0</TinyChip>
                    )}
                  </div>

                  <div className="mt-4 space-y-3">
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Сильные стороны</div>
                      <ListPills items={row.strengths} tone="emerald" />
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Слабые стороны</div>
                      <ListPills items={row.weaknesses} tone="rose" />
                    </div>
                    <div>
                      <div className="mb-2 text-sm font-semibold text-slate-800">Рекомендации</div>
                      <ListPills items={row.recommendations} tone="amber" />
                    </div>
                  </div>

                  {row.summary ? (
                    <div className="mt-4 rounded-[24px] bg-white/90 p-4 text-sm leading-6 text-slate-700 ring-1 ring-sky-200">
                      {row.summary}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="rounded-[34px] bg-gradient-to-br from-white via-slate-50 to-sky-50/85 p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-sky-200 backdrop-blur-xl">
          <div className="mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-teal-100 text-teal-700">
                <AudioLines className="h-4 w-4" />
              </div>
              <div className="text-base font-semibold text-slate-900">Проанализированные чанки</div>
            </div>

            <TinyChip tone="neutral">{enrichedChunksForUi.length}</TinyChip>
          </div>

          {loading ? (
            <div className="space-y-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="animate-pulse rounded-2xl bg-slate-100/90 p-5 ring-1 ring-slate-200"
                >
                  <div className="h-5 w-36 rounded bg-slate-200" />
                  <div className="mt-3 h-16 rounded bg-slate-200" />
                </div>
              ))}
            </div>
          ) : enrichedChunksForUi.length === 0 ? (
            <div className="rounded-[28px] bg-white/90 p-8 text-center text-slate-700 ring-1 ring-sky-200">
              На выбранную дату записей нет.
            </div>
          ) : (
            <div className="space-y-4">
              {enrichedChunksForUi.map((chunk) => {
                const signals = buildChunkSignals(chunk);
                const actionPlan = buildChunkActionPlan(chunk);
                const strengthItems = uniqueStrings(chunk.score?.strengths ?? []);
                const weaknessItems = uniqueStrings(chunk.score?.weaknesses ?? []);
                const modelSummary =
                  firstSentence(chunk.score?.summary) ||
                  firstSentence(chunk.transcript?.text_full) ||
                  'Нет краткого вывода.';
                const transcriptText =
                  (chunk.transcript?.text_full ?? '').trim() || 'Нет текста';
                const parsedSegments = parseSpeakerSegments(chunk);
                const isExpanded = expandedChunkIds.includes(chunk.id);
                const exactMoment = formatConversationMoment(
                  chunk.chunk_started_at ?? chunk.uploaded_at,
                  chunk.chunk_ended_at,
                );

                return (
                  <div
                    key={chunk.id}
                    className="rounded-[30px] bg-gradient-to-br from-white via-slate-50 to-sky-50/70 shadow-[0_20px_55px_rgba(15,23,42,0.10)] ring-1 ring-sky-200"
                  >
                    <button
                      type="button"
                      onClick={() => toggleChunk(chunk.id)}
                      className="w-full rounded-[30px] p-5 text-left transition hover:bg-white/30 sm:p-6"
                    >
                      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isExpanded ? (
                              <ChevronDown className="h-4 w-4 text-slate-500" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-slate-500" />
                            )}
                            <div className="truncate text-sm font-medium text-slate-500">
                              Терминал {chunk.terminal_code ?? '—'}
                            </div>
                          </div>

                          <div className="mt-2 text-[18px] font-semibold leading-tight text-slate-900 sm:text-[20px]">
                            {exactMoment}
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                            <span>{chunk.branchLabel}</span>
                            {chunk.recording_mode === 'test' ? (
                              <TinyChip tone="warn">test</TinyChip>
                            ) : (
                              <TinyChip tone="neutral">production</TinyChip>
                            )}
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-3 xl:justify-end">
                          <TinyChip tone={chunk.transcript_status === 'done' ? 'ok' : 'warn'}>
                            transcript: {chunk.transcript_status}
                          </TinyChip>
                          <TinyChip tone={chunk.analysis_status === 'done' ? 'ok' : 'warn'}>
                            analysis: {chunk.analysis_status}
                          </TinyChip>

                          <div
                            className={`rounded-[22px] px-4 py-3 text-center ring-1 ${scoreTone(
                              chunk.score?.overall_score,
                            )}`}
                          >
                            <div className="text-[11px] font-medium uppercase tracking-[0.16em] opacity-80">
                              Балл
                            </div>
                            <div className="mt-1 text-[28px] font-bold leading-none sm:text-[34px]">
                              {formatScore(chunk.score?.overall_score)}
                            </div>
                          </div>
                        </div>
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-sky-100 px-5 pb-5 sm:px-6 sm:pb-6">
                        <div className="mt-5 flex flex-wrap gap-2">
                          <TinyChip
                            tone={
                              chunk.employee_id !== null && chunk.attendance_session_id !== null
                                ? 'ok'
                                : 'bad'
                            }
                          >
                            {chunk.employee_id !== null && chunk.attendance_session_id !== null
                              ? 'привязан'
                              : 'не привязан'}
                          </TinyChip>
                          {chunk.score?.was_rude ? <TinyChip tone="bad">грубость</TinyChip> : null}
                          {chunk.score?.was_pushy ? <TinyChip tone="warn">давление</TinyChip> : null}
                          {chunk.score?.interrupted_client ? (
                            <TinyChip tone="warn">перебивания</TinyChip>
                          ) : null}
                        </div>

                        {chunk.test_note ? (
                          <div className="mt-4 rounded-[22px] bg-white/85 p-3.5 text-xs text-slate-600 ring-1 ring-sky-200">
                            {chunk.test_note}
                          </div>
                        ) : null}

                        <div className="mt-5 grid gap-4 xl:grid-cols-[1.16fr_0.94fr]">
                          <div className="space-y-4">
                            <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                              <div className="mb-3 text-sm font-semibold text-slate-900">
                                Что происходило в разговоре
                              </div>
                              <div className="text-sm leading-7 text-slate-700">{modelSummary}</div>
                            </div>

                            <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-slate-900">Транскрипт</div>
                                <div className="flex flex-wrap gap-2">
                                  <TinyChip tone="ok">Продавец</TinyChip>
                                  <TinyChip tone="neutral">Покупатель</TinyChip>
                                </div>
                              </div>

                              {parsedSegments.length > 0 ? (
                                <div className="max-h-[480px] space-y-3 overflow-auto pr-1">
                                  {parsedSegments.map((segment, index) => (
                                    <div
                                      key={`${segment.speakerLabel}-${segment.text}-${index}`}
                                      className={`rounded-2xl p-3.5 ring-1 ${roleTone(segment.role)}`}
                                    >
                                      <div className="mb-1 flex flex-wrap items-center gap-2">
                                        <span className="text-sm font-semibold text-slate-900">
                                          {segment.speakerLabel}
                                        </span>
                                        {segment.sourceLabel &&
                                        segment.sourceLabel !== segment.speakerLabel ? (
                                          <span className="text-xs text-slate-500">
                                            {segment.sourceLabel}
                                          </span>
                                        ) : null}
                                        {formatSegmentRange(segment.startSec, segment.endSec) ? (
                                          <span className="text-xs text-slate-500">
                                            {formatSegmentRange(segment.startSec, segment.endSec)}
                                          </span>
                                        ) : null}
                                      </div>
                                      <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                        {segment.text}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              ) : (
                                <div className="whitespace-pre-wrap text-sm leading-7 text-slate-700">
                                  {transcriptText}
                                </div>
                              )}
                            </div>

                            <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                              <div className="mb-3 text-sm font-semibold text-slate-900">Сигналы</div>
                              <div className="grid gap-3 md:grid-cols-2">
                                {signals.map((signal, index) => (
                                  <div
                                    key={`${signal.title}-${index}`}
                                    className={`rounded-2xl p-3.5 ring-1 ${signalCardTone(signal.tone)}`}
                                  >
                                    <div className="text-sm font-semibold text-slate-900">
                                      {signal.title}
                                    </div>
                                    <div className="mt-1 text-sm leading-6 text-slate-700">
                                      {signal.detail}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            {chunk.score ? (
                              <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                                <div className="mb-3 text-sm font-semibold text-slate-900">
                                  Оценки
                                </div>
                                <div className="grid grid-cols-2 gap-3">
                                  <MiniKv label="Приветствие" value={formatScore(chunk.score.greeting_score)} />
                                  <MiniKv label="Потребность" value={formatScore(chunk.score.needs_discovery_score)} />
                                  <MiniKv label="Объяснение" value={formatScore(chunk.score.explanation_score)} />
                                  <MiniKv label="Цена" value={formatScore(chunk.score.price_explanation_score)} />
                                  <MiniKv label="Завершение" value={formatScore(chunk.score.closing_score)} />
                                  <MiniKv label="Общий балл" value={formatScore(chunk.score.overall_score)} />
                                </div>
                              </div>
                            ) : null}

                            <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                              <div className="mb-3 text-sm font-semibold text-slate-900">
                                Как усилить разговор
                              </div>
                              <div className="space-y-2.5">
                                {actionPlan.map((item, index) => (
                                  <div
                                    key={`${item}-${index}`}
                                    className="rounded-2xl bg-amber-50/85 p-3.5 text-sm leading-6 text-amber-900 ring-1 ring-amber-200"
                                  >
                                    {item}
                                  </div>
                                ))}
                              </div>
                            </div>

                            <div className="rounded-[26px] bg-white/90 p-5 ring-1 ring-sky-200">
                              <div className="mb-3 text-sm font-semibold text-slate-900">
                                Сильные стороны
                              </div>
                              <ListPills items={strengthItems} tone="emerald" />

                              <div className="mb-3 mt-5 text-sm font-semibold text-slate-900">
                                Слабые стороны
                              </div>
                              <ListPills items={weaknessItems} tone="rose" />
                            </div>
                          </div>
                        </div>

                        {chunk.processing_error ? (
                          <div className="mt-4 rounded-[24px] bg-amber-50/90 p-4 text-sm text-amber-700 ring-1 ring-amber-200">
                            {chunk.processing_error}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}