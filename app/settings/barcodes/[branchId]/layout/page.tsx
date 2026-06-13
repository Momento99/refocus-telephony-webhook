'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, LayoutGrid, AlertTriangle, RefreshCw, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { toBlob } from 'html-to-image';
import getSupabase from '@/lib/supabaseClient';
import {
  isBranchUsingFormula,
  setBranchTotalSlots,
  getBranchTotalSlots,
  type SectionKey,
  type FrameTypeCode,
  type GenderCode,
} from '@/lib/framePricingFormula';
import {
  computeBranchLayout,
  computeFourCaseLayoutFromFrames,
  isFourCaseBranch,
  SECTION_VISUAL,
  type BranchLayout,
  type CellAssignment,
  type ZoneLayout,
  type FrameInput,
} from '@/lib/shelfLayoutPlan';

/** Карта активных ценников: section → price → count. Совпадает по структуре
 * со страницей штрих-кодов, чтобы layout видел те же цены, что печатает /[branchId]/page. */
type PrintedMap = Record<string, Record<number, number>>;

/* ───────────── Цветовая полоска-ключ (вверху страницы) ───────────── */
// Один взгляд — и продавец понимает «жёлтое = дети, фиолетовое = БО» и т.д.
// 7 категорий, скомпонованных в горизонтальный ряд chip-ов.

const COLOR_KEY: Array<{ section: SectionKey; short: string }> = [
  { section: 'PA_F', short: 'Пласт Ж' },
  { section: 'MA_F', short: 'Мет Ж' },
  { section: 'PA_M', short: 'Пласт М' },
  { section: 'MA_M', short: 'Мет М' },
  { section: 'RP_F', short: 'Чтение пл' },
  { section: 'RM_F', short: 'Чтение мет' },
  { section: 'KD_F', short: 'Дети' },
  { section: 'RL_F', short: 'Безопр.' },
];

function ColorKeyStrip() {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1.5 rounded-2xl bg-white/95 ring-1 ring-sky-100 p-2.5 shadow-[0_4px_16px_rgba(15,23,42,0.30)]">
      <span className="px-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        Цвета зон
      </span>
      {COLOR_KEY.map(({ section, short }) => {
        const v = SECTION_VISUAL[section];
        return (
          <span
            key={section}
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${v.bg} ${v.text} ring-1 ${v.ring}`}
          >
            {short}
          </span>
        );
      })}
    </div>
  );
}

type Branch = { id: number; name: string; code: string | null };

/* ───────────── ячейка ───────────── */

function Cell({
  cell,
  size = 'md',
  printedCount = 0,
}: {
  cell: CellAssignment | null;
  size?: 'sm' | 'md';
  /** Сколько активных ценников этой секции+цены сейчас на полке. 0 = ничего нет, 1 = норма, >1 = дубль. */
  printedCount?: number;
}) {
  const heights = { sm: 'h-[52px]', md: 'h-[64px]' };
  const fontSize = { sm: 'text-[11px]', md: 'text-[13px]' };
  const fontSizePremium = { sm: 'text-[12px]', md: 'text-[15px]' };
  const labelSize = { sm: 'text-[8px]', md: 'text-[9px]' };

  if (!cell) {
    return (
      <div className={`flex ${heights[size]} w-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50/50 text-[10px] text-slate-300`}>
        —
      </div>
    );
  }
  const v = SECTION_VISUAL[cell.section];
  const isPremium = cell.isPremium;
  const isAnchor = cell.bucket === 'anchor';
  const isPrinted = printedCount > 0;
  const isDuplicate = printedCount > 1;

  // Premium-ценники: жирный price + bold weight + cyan top-border.
  // Anchor (13к) — rose-ring (декой-якорь).
  // Напечатано — opacity+grayscale (затемнение «слот заполнен»), маленькая зелёная галка.
  // Дубль (>1) — amber ring как предупреждение «нарушение 1 цена = 1 ценник».
  const title =
    `${v.full} · ${cell.price}с · ${cell.bucket}` +
    (isAnchor ? ' (decoy-якорь 13к)' : '') +
    (isPremium ? ' [премиум]' : '') +
    (isPrinted
      ? ` · напечатано${isDuplicate ? ` ×${printedCount} (ДУБЛЬ!)` : ''}`
      : ' · НЕ напечатано');

  return (
    <div
      title={title}
      className={`relative flex ${heights[size]} w-full flex-col items-center justify-center rounded-md ${v.bg} ${v.text} ring-1 ${v.ring} transition-opacity ${
        isPremium ? 'border-t-2 border-t-cyan-500' : ''
      } ${
        isAnchor ? 'shadow-[0_0_0_2px_rgba(244,63,94,0.55)]' : ''
      } ${
        isPrinted ? 'opacity-40 grayscale' : ''
      } ${
        isDuplicate ? '!ring-2 !ring-amber-500' : ''
      }`}
    >
      <div className={`${labelSize[size]} font-semibold uppercase tracking-wide opacity-55`}>{v.label}</div>
      <div className={`${isPremium ? fontSizePremium[size] : fontSize[size]} ${isPremium ? 'font-extrabold' : 'font-bold'} tabular-nums leading-tight`}>
        {cell.price}
      </div>
      {isPrinted ? (
        <span
          className={`absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full ${
            isDuplicate
              ? 'bg-amber-500 text-white'
              : 'bg-emerald-500 text-white'
          } text-[7px] font-bold leading-none px-1 py-0.5 shadow-[0_1px_2px_rgba(0,0,0,0.2)]`}
        >
          {isDuplicate ? `×${printedCount}` : '✓'}
        </span>
      ) : null}
    </div>
  );
}

/* ───────────── СХЕМА 1: Стена (1.20м + 4.84м + 2.00м одной полосой) ───────────── */

function WallView({
  wallEntry,
  wallLong,
  wallFar,
  printed,
}: {
  wallEntry: ZoneLayout;
  wallLong: ZoneLayout;
  wallFar: ZoneLayout;
  printed: PrintedMap;
}) {
  // Ряды снизу вверх: rIdx 0 = 60см, rIdx 5 = 160см. Отображаем сверху вниз.
  const rowOrder = [5, 4, 3, 2, 1, 0];
  const heights = [60, 80, 100, 120, 140, 160];
  const totalUsed = wallEntry.cells.flat().filter(Boolean).length
    + wallLong.cells.flat().filter(Boolean).length
    + wallFar.cells.flat().filter(Boolean).length;
  const totalCap = wallEntry.capacity + wallLong.capacity + wallFar.capacity;

  const pc = (c: CellAssignment | null) =>
    c ? (printed[`${c.type}_${c.gender}`]?.[c.price] || 0) : 0;

  // Длинная стена в реальности — две полки, стык посередине (cols 11|12 граница Ж/М).
  // Добавляем тонкую вертикальную линию в gridTemplate в центре длинной полки.
  const longHalf = Math.floor(wallLong.cols / 2); // 12 cols в каждой половине
  const gridCols =
    `repeat(${wallEntry.cols}, minmax(0, 1fr)) ` +     // 7 cols входа
    `12px ` +                                          // gap между входом и длинной
    `repeat(${longHalf}, minmax(0, 1fr)) ` +           // левая половина длинной (Ж)
    `4px ` +                                           // СТЫК ПОЛОК — тонкая центральная линия
    `repeat(${wallLong.cols - longHalf}, minmax(0, 1fr)) ` + // правая половина длинной (М)
    `12px ` +                                          // gap между длинной и дальней
    `repeat(${wallFar.cols}, minmax(0, 1fr))`;         // дальняя

  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-base font-bold tracking-tight text-slate-900">
          СТЕНА · 6 ряд × {wallEntry.cols + wallLong.cols + wallFar.cols} кол
        </div>
        <div className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
          {totalUsed} / {totalCap}
        </div>
      </div>

      {/* Единая компактная строка-заголовок зон */}
      <div
        className="mb-2 grid items-center gap-1 text-[10px] font-bold uppercase tracking-wider"
        style={{ gridTemplateColumns: gridCols }}
      >
        <div className="text-center text-orange-700" style={{ gridColumn: `span ${wallEntry.cols} / span ${wallEntry.cols}` }}>
          Вход 1.20м
        </div>
        <div></div>
        {/* «Длинная» спанит обе половины + центральный стык (12 + 1 + 12 = 25 треков) */}
        <div className="text-center text-slate-700" style={{ gridColumn: `span ${wallLong.cols + 1} / span ${wallLong.cols + 1}` }}>
          Длинная 4.84м
        </div>
        <div></div>
        <div className="text-center text-green-700" style={{ gridColumn: `span ${wallFar.cols} / span ${wallFar.cols}` }}>
          Дальняя 2.00м
        </div>
      </div>

      {/* Ряды стены — без height-меток слева и подписей зон-материалов */}
      <div className="space-y-1">
        {rowOrder.map((rIdx) => (
          <div
            key={rIdx}
            className="grid items-center gap-1"
            style={{ gridTemplateColumns: gridCols }}
          >
            {/* Полка у входа */}
            {wallEntry.cells[rIdx].map((c, i) => <Cell key={`e${i}`} cell={c} size="sm" printedCount={pc(c)} />)}
            {/* Brand-cyan разделитель entry → long (стык полок) */}
            <div className="h-full w-[3px] justify-self-center rounded bg-cyan-300/70" />
            {/* Длинная стена — левая половина (Ж) */}
            {wallLong.cells[rIdx].slice(0, longHalf).map((c, i) => <Cell key={`lw${i}`} cell={c} size="sm" printedCount={pc(c)} />)}
            {/* СТЫК ПОЛОК ДЛИННОЙ СТЕНЫ — тонкая вертикальная линия */}
            <div className="h-full w-px justify-self-center bg-slate-300/80" />
            {/* Длинная стена — правая половина (М) */}
            {wallLong.cells[rIdx].slice(longHalf).map((c, i) => <Cell key={`lm${i}`} cell={c} size="sm" printedCount={pc(c)} />)}
            {/* Brand-cyan разделитель long → far (стык полок) */}
            <div className="h-full w-[3px] justify-self-center rounded bg-cyan-300/70" />
            {/* Дальняя */}
            {wallFar.cells[rIdx].map((c, i) => <Cell key={`f${i}`} cell={c} size="sm" printedCount={pc(c)} />)}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ───────────── СХЕМА 2: Островок 2×2 (back-to-back) ───────────── */

function IslandView({
  b1,
  b2,
  b3,
  b4,
  printed,
}: {
  b1: ZoneLayout;
  b2: ZoneLayout;
  b3: ZoneLayout;
  b4: ZoneLayout;
  printed: PrintedMap;
}) {
  const totalUsed = [b1, b2, b3, b4].reduce((s, z) => s + z.cells.flat().filter(Boolean).length, 0);
  const totalCap = b1.capacity + b2.capacity + b3.capacity + b4.capacity;

  const pc = (c: CellAssignment | null) =>
    c ? (printed[`${c.type}_${c.gender}`]?.[c.price] || 0) : 0;

  function renderBlock(
    zone: ZoneLayout,
    blockNum: number,
    sectionName: string,
    position: 'top' | 'bottom',
  ) {
    const used = zone.cells.flat().filter(Boolean).length;
    const rowOrder = Array.from({ length: zone.rows }, (_, i) => zone.rows - 1 - i);
    // Тонкая cyan полоска вдоль ребра «спины»:
    //   top-блоки: спина снизу (data row 0) — полоска под блоком.
    //   bottom-блоки: спина сверху (data row 4) — полоска над блоком.
    const spineLine = (
      <div className="h-[2px] w-full rounded bg-cyan-300/60" />
    );
    return (
      <div className="rounded-xl bg-slate-50/50 ring-1 ring-slate-200 p-3">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              Блок {blockNum}
            </span>
            <span className="ml-2 text-[12px] font-bold text-slate-800">{sectionName}</span>
          </div>
          <div className="text-[10px] tabular-nums text-slate-500">{used}/{zone.capacity}</div>
        </div>

        {position === 'bottom' ? spineLine : null}

        <div className="space-y-1 my-1">
          {rowOrder.map((rIdx) => (
            <div
              key={rIdx}
              className="grid gap-1"
              style={{ gridTemplateColumns: `repeat(${zone.cols}, minmax(0, 1fr))` }}
            >
              {zone.cells[rIdx].map((c, i) => <Cell key={i} cell={c} size="sm" printedCount={pc(c)} />)}
            </div>
          ))}
        </div>

        {position === 'top' ? spineLine : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-base font-bold tracking-tight text-slate-900">
          ОСТРОВОК · 4 блока × 7×5 (вид сверху)
        </div>
        <div className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
          {totalUsed} / {totalCap}
        </div>
      </div>

      {/* Лейбл: блоки 1+2 смотрят на стену */}
      <div className="mb-2 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        ↑ к длинной стене
      </div>

      {/* Верхний ряд: блоки 1 и 2 */}
      <div className="grid grid-cols-2 gap-3">
        {renderBlock(b1, 1, 'Металл Ж', 'top')}
        {renderBlock(b2, 2, 'Мужское (PA + MA)', 'top')}
      </div>

      {/* Тонкая cyan линия back-to-back: пик пирамиды */}
      <div className="my-2.5 h-[2px] w-full rounded bg-gradient-to-r from-transparent via-cyan-400 to-transparent" />

      {/* Нижний ряд: блоки 3 и 4 */}
      <div className="grid grid-cols-2 gap-3">
        {renderBlock(b3, 3, 'Пластик Ж', 'bottom')}
        {renderBlock(b4, 4, 'Безоправные (унисекс)', 'bottom')}
      </div>

      {/* Лейбл: блоки 3+4 смотрят в зал */}
      <div className="mt-2 text-center text-[9px] font-semibold uppercase tracking-wider text-slate-400">
        ↓ к залу
      </div>
    </div>
  );
}

/* ───────────── СХЕМА: Две стены (Кант) ───────────── */
// Обобщённый рендер для двухстенных филиалов: каждая стена — сетка 6 рядов × N колонок
// с тонкими разделителями физических секций каждые sectionCols колонок.

function TwoWallView({ walls, printed }: { walls: ZoneLayout[]; printed: PrintedMap }) {
  const pc = (c: CellAssignment | null) =>
    c ? (printed[`${c.type}_${c.gender}`]?.[c.price] || 0) : 0;

  // Ряды сверху вниз: row 5 (верх ~160см) → row 0 (низ ~60см).
  const rowOrder = [5, 4, 3, 2, 1, 0];

  return (
    <div className="space-y-5">
      {walls.map((wall) => {
        const used = wall.cells.flat().filter(Boolean).length;
        const sectionCols = wall.sectionCols || 7;

        // gridTemplateColumns: колонки + тонкие разделители физических секций.
        const parts: string[] = [];
        for (let c = 0; c < wall.cols; c++) {
          parts.push('minmax(0, 1fr)');
          if ((c + 1) % sectionCols === 0 && c < wall.cols - 1) parts.push('4px');
        }
        const gridCols = parts.join(' ');

        return (
          <div key={wall.id} className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div className="text-base font-bold tracking-tight text-slate-900">{wall.name}</div>
              <div className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700">
                {used} / {wall.capacity}
              </div>
            </div>

            <div className="space-y-1">
              {rowOrder.map((rIdx) => (
                <div key={rIdx} className="grid items-center gap-1" style={{ gridTemplateColumns: gridCols }}>
                  {wall.cells[rIdx].map((c, i) => (
                    <React.Fragment key={i}>
                      <Cell cell={c} size="sm" printedCount={pc(c)} />
                      {(i + 1) % sectionCols === 0 && i < wall.cols - 1 ? (
                        <div className="h-full w-[3px] justify-self-center rounded bg-cyan-300/70" />
                      ) : null}
                    </React.Fragment>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ───────────── СХЕМА: 4 витрины (Беловодск) ───────────── */
// 4 одинаковые витрины 6 кол × 5 ряд. Ряды сверху вниз (ряд 4 — eye-level наверху,
// ряд 0 — нижняя полка). Ячейки в полном цвете (схема = реальные оправы), без затемнения.

function FourCaseView({ zones }: { zones: ZoneLayout[] }) {
  const rowOrder = [4, 3, 2, 1, 0]; // сверху (eye-level) вниз

  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="mb-1 text-sm font-bold tracking-tight text-slate-900">
        4 витрины в одну линию · каждая 6 кол × 5 ряд
      </div>
      <div className="mb-3 text-[11px] text-slate-500">
        Стоят в ряд: В1 → В2 → В3 → В4. Цена в каждой растёт снизу вверх; короны (топ-металл) — на верхней полке.
      </div>

      {/* 4 витрины в ряд, на всю ширину — без горизонтальной прокрутки. */}
      <div className="grid grid-cols-4 gap-2">
        {zones.map((z) => {
          const used = z.cells.flat().filter(Boolean).length;
          return (
            <div key={z.id} className="rounded-xl bg-slate-50/60 ring-1 ring-slate-200 p-2">
              <div className="mb-1.5 flex items-center justify-between gap-1">
                <div className="truncate text-[10px] font-bold text-slate-700" title={z.name}>
                  {z.name}
                </div>
                <div className="shrink-0 rounded bg-white px-1 py-0.5 text-[9px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  {used}/{z.capacity}
                </div>
              </div>
              <div className="space-y-1">
                {rowOrder.map((rIdx) => (
                  <div
                    key={rIdx}
                    className="grid gap-1"
                    style={{ gridTemplateColumns: `repeat(${z.cols}, minmax(0, 1fr))` }}
                  >
                    {z.cells[rIdx].map((c, i) => (
                      <Cell key={i} cell={c} size="sm" printedCount={0} />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-2 text-[10px] text-slate-400">
        ↑ верх = уровень глаз (дорого) · низ = нижняя полка (дёшево) · между витринами категории продолжаются (чтение, дети)
      </div>
    </div>
  );
}

/* ───────────── Компактная легенда статусов ячеек ───────────── */
// 4 примера: regular / premium / якорь / напечатано. Цвет зон не объясняем —
// для этого есть ColorKeyStrip наверху страницы.

function CompactStatusLegend() {
  const Pill = ({
    children,
    cell,
  }: {
    children: React.ReactNode;
    cell: React.ReactNode;
  }) => (
    <span className="inline-flex items-center gap-2">
      {cell}
      <span className="text-slate-600">{children}</span>
    </span>
  );
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_4px_16px_rgba(15,23,42,0.30)]">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[11px]">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">
          Статусы ячеек
        </span>
        <Pill
          cell={
            <span className="inline-flex h-[36px] w-[56px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-1 ring-rose-300">
              <span className="text-[10px] font-bold">1820</span>
            </span>
          }
        >
          обычная (нужно напечатать)
        </Pill>
        <Pill
          cell={
            <span className="inline-flex h-[36px] w-[56px] flex-col items-center justify-center rounded-md border-t-2 border-t-cyan-500 bg-rose-300 text-rose-900 ring-1 ring-rose-500">
              <span className="text-[12px] font-extrabold">4000</span>
            </span>
          }
        >
          <b>премиум</b> (cyan-полоска)
        </Pill>
        <Pill
          cell={
            <span className="inline-flex h-[36px] w-[56px] flex-col items-center justify-center rounded-md border-t-2 border-t-cyan-500 bg-blue-300 text-blue-900 ring-1 ring-blue-600 shadow-[0_0_0_2px_rgba(244,63,94,0.6)]">
              <span className="text-[12px] font-extrabold">13к</span>
            </span>
          }
        >
          <b>якорь 13к</b> (розовая обводка)
        </Pill>
        <Pill
          cell={
            <span className="relative inline-flex h-[36px] w-[56px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-1 ring-rose-300 opacity-40 grayscale">
              <span className="text-[10px] font-bold">1820</span>
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[7px] font-bold leading-none px-1 py-0.5">✓</span>
            </span>
          }
        >
          <b>напечатано</b> (тусклое + ✓)
        </Pill>
        <Pill
          cell={
            <span className="relative inline-flex h-[36px] w-[56px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-2 ring-amber-500 opacity-40 grayscale">
              <span className="text-[10px] font-bold">1820</span>
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[7px] font-bold leading-none px-1 py-0.5">×2</span>
            </span>
          }
        >
          <b>дубль</b> (amber-обводка)
        </Pill>
      </div>
    </div>
  );
}

/* ───────────── (старая) подробная легенда — не используется ───────────── */

function MiniLegend() {
  // Группы по категориям — для лёгкого восприятия продавцом
  const groups: Array<{ title: string; sections: SectionKey[] }> = [
    { title: 'ВЗРОСЛЫЕ ЖЕНСКИЕ', sections: ['PA_F', 'MA_F'] },
    { title: 'ВЗРОСЛЫЕ МУЖСКИЕ', sections: ['PA_M', 'MA_M'] },
    { title: 'ЧТЕНИЕ (для бабушек)', sections: ['RP_F', 'RM_F'] },
    { title: 'ДЕТСКИЕ', sections: ['KD_F', 'KD_M'] },
    // Безоправные — унисекс: один пример, RL_F и RL_M визуально слитны.
    { title: 'БЕЗОПРАВНЫЕ (УНИСЕКС)', sections: ['RL_F'] },
  ];

  const renderSampleCell = (s: SectionKey, samplePrice: string) => {
    const v = SECTION_VISUAL[s];
    return (
      <div className={`flex h-[60px] w-[88px] flex-col items-center justify-center rounded-md ${v.bg} ${v.text} ring-1 ${v.ring}`}>
        <div className="text-[10px] font-semibold uppercase tracking-wide opacity-80">{v.label}</div>
        <div className="text-[14px] font-bold tabular-nums leading-tight">{samplePrice}</div>
      </div>
    );
  };

  // Примерные цены для каждой секции (репрезентативно)
  const samplePrices: Record<SectionKey, string> = {
    PA_F: '1820', MA_F: '2160', PA_M: '1700', MA_M: '2100',
    RP_F: '1280', RM_F: '1350', KD_F: '1200', KD_M: '1180',
    RL_F: '6020', RL_M: '6080',
    RP_M: '—', RM_M: '—',
  };

  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-5 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="mb-3 text-base font-bold tracking-tight text-slate-900">
        Легенда — где какая оправа
      </div>
      <div className="mb-1 text-[11px] text-slate-500">
        Каждая секция имеет уникальный цвет. Внутри пары: <b>пластик светлее</b>, <b>металл темнее/насыщеннее</b>.
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {groups.map((group) => (
          <div key={group.title}>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
              {group.title}
            </div>
            <div className="flex flex-wrap gap-2">
              {group.sections.map((s) => {
                const v = SECTION_VISUAL[s];
                return (
                  <div key={s} className="flex flex-col items-center gap-1">
                    {renderSampleCell(s, samplePrices[s])}
                    <div className="text-[10px] font-semibold text-slate-600 text-center max-w-[88px] leading-tight">
                      {v.full}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 border-t border-slate-200 pt-4">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-500">
          ОСОБЫЕ ПОМЕТКИ ЦЕННИКОВ
        </div>
        <div className="flex flex-wrap items-center gap-4 text-[11px] text-slate-700">
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-[44px] w-[64px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-1 ring-rose-300">
              <span className="text-[8px] font-semibold">ПЛАСТ Ж</span>
              <span className="text-[12px] font-bold">1820</span>
            </span>
            обычный регуляр (нужно напечатать)
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="relative inline-flex h-[44px] w-[64px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-1 ring-rose-300 opacity-40 grayscale">
              <span className="text-[8px] font-semibold">ПЛАСТ Ж</span>
              <span className="text-[12px] font-bold">1820</span>
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-emerald-500 text-white text-[7px] font-bold leading-none px-1 py-0.5">✓</span>
            </span>
            <span><b>напечатано</b> — есть активный ценник в БД</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="relative inline-flex h-[44px] w-[64px] flex-col items-center justify-center rounded-md bg-rose-100 text-rose-800 ring-2 ring-amber-500 opacity-40 grayscale">
              <span className="text-[8px] font-semibold">ПЛАСТ Ж</span>
              <span className="text-[12px] font-bold">1820</span>
              <span className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-[7px] font-bold leading-none px-1 py-0.5">×2</span>
            </span>
            <span><b>дубль</b> — &gt;1 активный ценник на одну цену</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-[44px] w-[64px] flex-col items-center justify-center rounded-md border-t-2 border-t-cyan-500 bg-rose-300 text-rose-900 ring-1 ring-rose-500">
              <span className="text-[8px] font-semibold">МЕТ Ж</span>
              <span className="text-[14px] font-extrabold">4000</span>
            </span>
            <span><b>премиум</b> (≥4000с): жирная цена + cyan-полоса</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex h-[44px] w-[64px] flex-col items-center justify-center rounded-md border-t-2 border-t-cyan-500 bg-blue-300 text-blue-900 ring-1 ring-blue-600 shadow-[0_0_0_2px_rgba(244,63,94,0.6)]">
              <span className="text-[8px] font-semibold">МЕТ М</span>
              <span className="text-[14px] font-extrabold">13000</span>
            </span>
            <span><b>якорь 13к</b> (decoy) — премиум + розовая обводка</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
      <div className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-bold text-slate-900">{value}</div>
      {hint ? <div className="mt-1 text-[11px] text-slate-500">{hint}</div> : null}
    </div>
  );
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ───────────── страница ───────────── */

export default function ShelfLayoutPage() {
  const params = useParams<{ branchId: string }>();
  const branchId = Number(params.branchId);

  const [branch, setBranch] = useState<Branch | null>(null);
  const [branchError, setBranchError] = useState<string | null>(null);
  const [totalSlots, setTotalSlots] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [printed, setPrinted] = useState<PrintedMap>({});
  const [printedSyncedAt, setPrintedSyncedAt] = useState<Date | null>(null);
  const [printedSyncing, setPrintedSyncing] = useState(false);
  const [copying, setCopying] = useState(false);
  // Область, которую копируем картинкой в буфер (все витрины + легенда + счётчики).
  const exportRef = useRef<HTMLDivElement>(null);

  // Активные ценники из БД (sold_at IS NULL AND voided_at IS NULL).
  // Тот же фильтр, что использует [branchId]/page.tsx (typeActive).
  const loadPrinted = useCallback(async () => {
    if (!branchId || Number.isNaN(branchId)) return;
    setPrintedSyncing(true);
    try {
      const sb = getSupabase();
      const { data, error } = await sb
        .from('frame_barcodes')
        .select('type_code, gender, price')
        .eq('branch_id', branchId)
        .is('sold_at', null)
        .is('voided_at', null);
      if (error) {
        console.error('layout loadPrinted error', error.message);
        return;
      }
      const map: PrintedMap = {};
      for (const row of (data || []) as Array<{ type_code?: string; gender?: string; price?: number | string }>) {
        const t = row.type_code;
        const g = row.gender;
        const p = Number(row.price);
        if (!t || !g || !Number.isFinite(p)) continue;
        const key = `${t}_${g}`;
        if (!map[key]) map[key] = {};
        map[key][p] = (map[key][p] || 0) + 1;
      }
      setPrinted(map);
      setPrintedSyncedAt(new Date());
    } finally {
      setPrintedSyncing(false);
    }
  }, [branchId]);

  // Первая загрузка + realtime подписка на frame_barcodes для филиала.
  // Realtime обновит карту, когда страница штрих-кодов напечатает/отменит ценник.
  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) return;
    void loadPrinted();

    const sb = getSupabase();
    const channel = sb
      .channel(`barcodes_layout_branch_${branchId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'frame_barcodes',
          filter: `branch_id=eq.${branchId}`,
        },
        () => {
          void loadPrinted();
        },
      )
      .subscribe();

    return () => {
      void sb.removeChannel(channel);
    };
  }, [branchId, loadPrinted]);

  useEffect(() => {
    if (!branchId || Number.isNaN(branchId)) {
      setBranchError('Некорректный ID филиала');
      setLoading(false);
      return;
    }
    const sb = getSupabase();
    sb.from('branches').select('id, name, code').eq('id', branchId).maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          setBranchError(error.message);
          return;
        }
        if (!data) {
          setBranchError('Филиал не найден');
          return;
        }
        setBranch(data as Branch);
      });
  }, [branchId]);

  useEffect(() => {
    if (!branch?.name) return;
    if (!isBranchUsingFormula(branch.name)) {
      setTotalSlots(0);
      setLoading(false);
      return;
    }
    fetch(`/api/frame-config?branch_id=${branchId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok && Number.isFinite(j.frame_total_slots) && j.frame_total_slots > 0) {
          setBranchTotalSlots(branch.name, j.frame_total_slots);
          setTotalSlots(j.frame_total_slots);
        } else {
          const fb = getBranchTotalSlots(branch.name);
          if (fb > 0) setTotalSlots(fb);
        }
      })
      .catch(() => {
        const fb = getBranchTotalSlots(branch.name);
        if (fb > 0) setTotalSlots(fb);
      })
      .finally(() => setLoading(false));
  }, [branch?.name, branchId]);

  const isFormula = !!(branch?.name && isBranchUsingFormula(branch.name));
  const isFourCase = !!(branch?.name && isFourCaseBranch(branch.name));

  // Список реальных оправ из карты напечатанных (для раскладки «от данных»).
  const frames = useMemo<FrameInput[]>(() => {
    const out: FrameInput[] = [];
    for (const [key, byPrice] of Object.entries(printed)) {
      const us = key.indexOf('_');
      if (us < 0) continue;
      const type = key.slice(0, us) as FrameTypeCode;
      const gender = key.slice(us + 1) as GenderCode;
      for (const [priceStr, count] of Object.entries(byPrice)) {
        const price = Number(priceStr);
        if (!Number.isFinite(price)) continue;
        for (let i = 0; i < count; i++) out.push({ type, gender, price });
      }
    }
    return out;
  }, [printed]);

  const layout = useMemo<BranchLayout | null>(() => {
    if (!branch?.name) return null;
    // 4-витринные филиалы (Беловодск): раскладка строится из реальных оправ, не из формулы.
    if (isFourCase) {
      if (frames.length === 0) return null;
      return computeFourCaseLayoutFromFrames(branch.name, frames);
    }
    if (!isFormula || totalSlots <= 0) return null;
    const l = computeBranchLayout(branch.name);
    l.totalSlots = totalSlots;
    return l;
  }, [branch?.name, isFormula, isFourCase, totalSlots, frames]);

  if (branchError) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <Link
          href="/settings/barcodes/overview"
          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Назад
        </Link>
        <div className="mt-4 rounded-2xl bg-white ring-1 ring-rose-200 px-4 py-3 text-sm text-rose-700">
          {branchError}
        </div>
      </div>
    );
  }

  if (loading || !branch) {
    return <div className="p-6 text-sm text-slate-300">Загрузка…</div>;
  }

  if (!isFormula && !isFourCase) {
    return (
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-4 flex items-center gap-3">
          <Link
            href={`/settings/barcodes/${branchId}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </Link>
          <h1 className="text-base font-bold tracking-tight text-slate-50">{branch.name}</h1>
        </div>
        <div className="rounded-2xl bg-white ring-1 ring-amber-200 p-4 text-sm text-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
            <div className="font-semibold">Раскладка доступна только для формульных филиалов</div>
          </div>
        </div>
      </div>
    );
  }

  if (!layout) {
    return <div className="p-6 text-sm text-slate-300">Загрузка раскладки…</div>;
  }

  const zoneById = (id: string) => layout.zones.find((z) => z.id === id);

  const totalUsed = layout.zones.reduce(
    (s, z) => s + z.cells.flat().filter(Boolean).length,
    0,
  );
  const totalCapacity = layout.zones.reduce((s, z) => s + z.capacity, 0);

  const wallCapacity = layout.zones.filter((z) => z.kind === 'wall').reduce((s, z) => s + z.capacity, 0);
  const islandCapacity = layout.zones.filter((z) => z.kind === 'island').reduce((s, z) => s + z.capacity, 0);
  const wallCount = layout.zones.filter((z) => z.kind === 'wall').length;
  const capacityHint =
    layout.kind === 'fourCase'
      ? `${layout.zones.length} витрины в линию × ${
          layout.zones.length > 0 ? Math.round(totalCapacity / layout.zones.length) : 0
        }`
      : islandCapacity > 0
      ? `Стены ${wallCapacity} + остров ${islandCapacity}`
      : `${wallCount} стены × ${wallCount > 0 ? Math.round(wallCapacity / wallCount) : 0}`;

  // ─── Live-статистика по напечатанным ценникам ───
  // filledCells: ячеек, у которых план совпал хотя бы с одним активным ценником.
  // missingCells: ячеек без активного ценника (нужно напечатать).
  // dupCells: ячеек, где активных ценников >1 (нарушение «1 цена = 1 ценник»).
  let filledCells = 0;
  let dupCells = 0;
  if (layout.kind === 'fourCase') {
    // Раскладка построена ИЗ реальных оправ — каждая ячейка уже «на полке».
    // Overlay-сравнение с printed тут не нужно (и дало бы ложные «дубли»).
    filledCells = totalUsed;
  } else {
    for (const zone of layout.zones) {
      for (const row of zone.cells) {
        for (const cell of row) {
          if (!cell) continue;
          const n = printed[`${cell.type}_${cell.gender}`]?.[cell.price] || 0;
          if (n >= 1) filledCells += 1;
          if (n >= 2) dupCells += 1;
        }
      }
    }
  }
  const missingCells = Math.max(0, totalUsed - filledCells);
  const totalActiveBarcodes = Object.values(printed).reduce(
    (s, byPrice) => s + Object.values(byPrice).reduce((ss, c) => ss + c, 0),
    0,
  );
  const orphanBarcodes = Math.max(0, totalActiveBarcodes - filledCells - dupCells);
  // orphanBarcodes — активные ценники в БД, для которых нет ячейки в раскладке
  // (вне формулы или цены не совпали; см. подсказку под карточкой).

  // Копирование всей раскладки картинкой в буфер обмена (Ctrl+V в чат).
  // Работает для любого семейства (Токмок/Кант/Беловодск) — снимок DOM через html-to-image,
  // поэтому видны все витрины, цвета зон, счётчики и легенда, без потери качества (pixelRatio 2).
  async function copyLayoutImage() {
    const node = exportRef.current;
    if (!node) return;
    setCopying(true);
    const filename = `Раскладка ${branch?.name ?? ''}.png`.replace(/[\\/:*?"<>|]+/g, '_');
    const opts = {
      backgroundColor: '#eef2f7',
      pixelRatio: 2,
      cacheBust: true,
      width: node.scrollWidth,
      height: node.scrollHeight,
    };
    try {
      const canCopy =
        typeof window !== 'undefined' &&
        typeof (window as any).ClipboardItem !== 'undefined' &&
        !!navigator.clipboard?.write;
      if (canCopy) {
        // Промис внутри ClipboardItem сохраняет «жест пользователя» (требование Chrome).
        const blobPromise = toBlob(node, opts).then((b) => {
          if (!b) throw new Error('toBlob returned null');
          return b;
        });
        await navigator.clipboard.write([
          new (window as any).ClipboardItem({ 'image/png': blobPromise }),
        ]);
        toast.success('Скопировано — вставьте в чат (Ctrl+V)');
        return;
      }
      const blob = await toBlob(node, opts);
      if (!blob) throw new Error('toBlob returned null');
      downloadBlob(blob, filename);
      toast('Копирование не поддерживается — файл скачан');
    } catch (e: any) {
      console.error('copyLayoutImage error', e);
      try {
        const blob = await toBlob(node, opts);
        if (blob) {
          downloadBlob(blob, filename);
          toast('Скопировать не вышло — файл скачан');
        } else {
          toast.error('Не удалось сделать изображение');
        }
      } catch {
        toast.error('Не удалось сделать изображение');
      }
    } finally {
      setCopying(false);
    }
  }

  return (
    <div className="text-slate-50">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Link
            href={`/settings/barcodes/${branchId}`}
            className="inline-flex items-center gap-1.5 rounded-xl bg-slate-100 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200 transition"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Назад
          </Link>
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-cyan-500 shadow-[0_4px_20px_rgba(34,211,238,0.40)]">
            <LayoutGrid className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="text-2xl font-bold tracking-tight text-slate-50">
              Раскладка витрины — {branch.name}
            </div>
            <div className="mt-0.5 text-[12px] text-cyan-300/50">
              Live · напечатанные оправы тускнеют в реальном времени
              {printedSyncedAt ? (
                <span className="ml-2 text-cyan-300/30">
                  · обновлено {printedSyncedAt.toLocaleTimeString('ru-RU')}
                </span>
              ) : null}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void copyLayoutImage()}
            disabled={copying}
            title="Скопировать всю раскладку картинкой — вставьте в чат (Ctrl+V)"
            className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(15,23,42,0.35)] transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400/60 disabled:opacity-50"
          >
            <Copy className={`h-3.5 w-3.5 ${copying ? 'animate-pulse' : ''}`} />
            {copying ? 'Готовлю…' : 'Копировать'}
          </button>
          <button
            onClick={() => void loadPrinted()}
            disabled={printedSyncing}
            title="Перечитать активные ценники из БД (обычно подписка работает автоматически)"
            className="inline-flex items-center gap-2 rounded-xl bg-cyan-500 px-3 py-2 text-xs font-semibold text-white shadow-[0_4px_16px_rgba(34,211,238,0.28)] transition hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300/70 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${printedSyncing ? 'animate-spin' : ''}`} />
            Обновить
          </button>
        </div>
      </div>

      {/* ===== Копируемая область (всё это уходит в картинку) ===== */}
      <div ref={exportRef}>
      {/* Заголовок для картинки — тёмный текст на белом (виден на свето-сером фоне снимка) */}
      <div className="mb-5 rounded-2xl bg-white ring-1 ring-sky-100 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
        <div className="text-lg font-bold tracking-tight text-slate-900">
          Раскладка витрины — {branch.name}
        </div>
        <div className="mt-0.5 text-[12px] text-slate-500">
          {capacityHint} · всего {totalCapacity} слотов · напечатано {filledCells}/{totalUsed}
          {dupCells > 0 ? ` · дублей ${dupCells}` : ''}
        </div>
      </div>

      {/* Stats — 3 карточки (всего · напечатано · дубли) */}
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <StatCard
          label="Всего слотов"
          value={totalCapacity}
          hint={capacityHint}
        />
        <StatCard
          label="Напечатано на полке"
          value={
            <span>
              <span className={filledCells === totalUsed ? 'text-emerald-600' : 'text-cyan-600'}>
                {filledCells}
              </span>
              <span className="text-slate-400"> / {totalUsed}</span>
            </span>
          }
          hint={
            filledCells === totalUsed
              ? '✓ все слоты заполнены'
              : `${missingCells} ещё нужно напечатать`
          }
        />
        <StatCard
          label="Дубли"
          value={
            <span className={dupCells === 0 ? 'text-slate-400' : 'text-amber-600'}>
              {dupCells}
            </span>
          }
          hint={
            dupCells === 0
              ? '«1 цена = 1 ценник» соблюдено'
              : 'amber-обводка на ячейках — нарушение'
          }
        />
      </div>

      {/* Цветовой ключ — главная легенда */}
      <ColorKeyStrip />

      {/* Схемы зон — зависят от семейства раскладки */}
      {layout.kind === 'twoWall' ? (
        <div className="mb-5">
          <TwoWallView walls={layout.zones.filter((z) => z.kind === 'wall')} printed={printed} />
        </div>
      ) : layout.kind === 'fourCase' ? (
        <div className="mb-5">
          <FourCaseView zones={layout.zones} />
        </div>
      ) : (
        <>
          {/* СХЕМА 1: Стена */}
          <div className="mb-5">
            <WallView
              wallEntry={zoneById('wall_entry')!}
              wallLong={zoneById('wall_long')!}
              wallFar={zoneById('wall_far')!}
              printed={printed}
            />
          </div>

          {/* СХЕМА 2: Островок */}
          <div className="mb-5">
            <IslandView
              b1={zoneById('island_1')!}
              b2={zoneById('island_2')!}
              b3={zoneById('island_3')!}
              b4={zoneById('island_4')!}
              printed={printed}
            />
          </div>
        </>
      )}

      {/* Компактная легенда — только статусы ячеек (4 примера) */}
      <div className="mb-5">
        <CompactStatusLegend />
      </div>
      </div>{/* ===== /копируемая область ===== */}

      {/* Не уместилось — если есть */}
      {layout.unplaced.length > 0 ? (
        <div className="mb-5 rounded-2xl bg-white ring-1 ring-amber-200 p-4 shadow-[0_8px_30px_rgba(15,23,42,0.45)]">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
            <div className="flex-1">
              <div className="font-semibold text-slate-900">Не уместилось: {layout.unplaced.length} ценников</div>
              <div className="mt-1 text-[12px] text-slate-600">
                План слотов больше физической вместимости ({totalCapacity}). Уменьши totalSlots или расширь витрину.
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
