'use client';

import { useMemo, type CSSProperties } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { buildFramePurchasePlan, isValidPurchaseTarget, modelPurchaseNeed } from '@/lib/framePurchasePlan';
import { MANUAL_FRAME_TYPES, modelQuantity, type ManualDraft, type ManualModel } from '@/lib/frameManualProcurement';
import styles from './model-purchase-progress.module.css';

const number = (n: number) => n.toLocaleString('ru-RU');
const percent = (n: number) => n.toLocaleString('ru-RU', { maximumFractionDigits: 1 });

export default function ModelPurchaseProgress({ target, draft, model }: {
  target: number; draft: ManualDraft; model: ManualModel;
}) {
  const plan = useMemo(() => isValidPurchaseTarget(target)
    ? buildFramePurchasePlan(target, draft.models, draft.purchaseMix) : null, [target, draft.models, draft.purchaseMix]);
  if (!plan) return <section className={styles.panel} aria-label="План заказа в карточке">
    <p className={styles.hint}>Укажи цель заказа от 1 до 100 000 штук на основной странице.</p>
  </section>;
  const need = modelPurchaseNeed(plan, model);
  const label = need ? need.sections.length === 1 ? need.sections[0].label
    : `${MANUAL_FRAME_TYPES[model.typeCode!]} · унисекс` : null;
  const color = need?.sections.find(row => row.enabled)?.color || need?.sections[0].color || '#4263d8';
  let offset = 0;

  return <section className={styles.panel} aria-label="План заказа в карточке" style={{ '--need-color': color } as CSSProperties}>
    <div className={styles.overview}>
      <div className={styles.chart}>
        <svg viewBox="0 0 120 120" role="img" aria-label={`План заказа: набрано ${number(plan.fulfilled)} из ${number(plan.target)}. Ещё по видам: ${number(plan.remaining)}.`}>
          <circle cx="60" cy="60" r="49" fill="none" stroke="#e9eef6" strokeWidth="10" />
          {plan.sections.map(row => {
            const start = offset; offset += row.percent;
            if (!row.planned) return null;
            const gap = Math.min(.8, row.percent * .16);
            const length = row.percent - gap;
            const filled = length * Math.min(1, row.selected / row.planned);
            const current = need?.sections.some(section => section.key === row.key);
            return <g key={row.key}>
              <title>{`${row.label}: ${row.selected} из ${row.planned}, ещё ${row.remaining}${row.excess ? `, сверх плана ${row.excess}` : ''}`}</title>
              <circle cx="60" cy="60" r="49" fill="none" pathLength="100" transform="rotate(-90 60 60)"
                stroke={row.color} strokeWidth={current ? 13 : 10} opacity=".25"
                strokeDasharray={`${length} ${100 - length}`} strokeDashoffset={-start - gap / 2} />
              {filled > 0 && <circle cx="60" cy="60" r="49" fill="none" pathLength="100" transform="rotate(-90 60 60)"
                stroke={row.color} strokeWidth={current ? 13 : 10}
                strokeDasharray={`${filled} ${100 - filled}`} strokeDashoffset={-start - gap / 2} />}
            </g>;
          })}
        </svg>
        <div className={styles.center} aria-hidden="true"><span>ПО ПЛАНУ</span><strong>{number(plan.fulfilled)}</strong><small>из {number(plan.target)}</small></div>
      </div>
      <div className={styles.current} aria-live="polite" aria-atomic="true">
        {need ? <>
          <h3>{label}</h3>
          {need.excluded ? <p className={styles.warning} data-need-status="excluded">Вид выключен из заказа</p> : <>
            <dl className={styles.metrics}>
              <div><dt>План вида</dt><dd data-need="planned">{number(need.planned)}</dd></div>
              <div><dt>Выбрано</dt><dd data-need="selected">{number(need.selected)}</dd></div>
              <div className={need.remaining ? styles.remaining : styles.complete}><dt>Ещё нужно</dt><dd data-need="remaining">{number(need.remaining)}</dd></div>
            </dl>
            {need.excess > 0 ? <p className={styles.warning} data-need-status="excess">Сверх плана: {number(need.excess)} шт.</p>
              : !need.remaining ? <p className={styles.complete} data-need-status="complete"><Check size={12} /> {need.planned ? 'План этого вида набран' : 'По плану этот вид сейчас не нужен'}</p>
              : <p className={styles.caption}>Можно добрать ещё {number(need.remaining)} шт. этого вида</p>}
          </>}
        </> : <><h3>План заказа · {number(plan.target)} шт.</h3><p className={styles.hint} data-need-status="unclassified">
          {!model.typeCode || !model.gender ? 'Выбери тип и пол — покажем, сколько ещё нужно этого вида.' : 'Для этого типа и пола отдельная доля в плане не задана.'}
        </p></>}
      </div>
    </div>
    {modelQuantity(model) > 0 && <p className={styles.included}>Количество этой модели уже учтено: {number(modelQuantity(model))} шт.</p>}
    <details className={styles.allTypes}>
      <summary tabIndex={0}><span>Все виды <small>· ещё {number(plan.remaining)} шт.</small></span><ChevronDown size={14} /></summary>
      <div className={styles.tableWrap}><table>
        <thead><tr><th scope="col">Вид</th><th scope="col">Выбрано / план</th><th scope="col">Ещё</th></tr></thead>
        <tbody>{plan.sections.map(row => <tr key={row.key} data-model-section={row.key}
          className={need?.sections.some(section => section.key === row.key) ? styles.currentRow : undefined}
          style={{ '--row-color': row.color } as CSSProperties}>
          <th scope="row"><span className={styles.rowLabel}><i />{row.label}</span>
            <span className={styles.track} aria-hidden="true"><i style={{ width: `${row.planned ? Math.min(100, row.selected / row.planned * 100) : 0}%` }} /></span></th>
          <td>{row.enabled ? <>{number(row.selected)} <span>/ {number(row.planned)}</span><small>{percent(row.percent)}%</small></> : <span className={styles.off}>Выключен</span>}</td>
          <td>{!row.enabled ? '—' : row.remaining ? <strong>{number(row.remaining)}</strong> : <span className={styles.complete}>0</span>}
            {row.excess > 0 && <small className={styles.warning}>+{number(row.excess)} лишних</small>}</td>
        </tr>)}</tbody>
      </table></div>
      {(plan.excess > 0 || plan.unassigned > 0) && <p className={styles.footnote}>
        {plan.excess > 0 && <>Сверх плана отдельных видов: {number(plan.excess)} шт. </>}
        {plan.unassigned > 0 && <>Без подходящего вида в плане: {number(plan.unassigned)} шт.</>}
      </p>}
    </details>
  </section>;
}
