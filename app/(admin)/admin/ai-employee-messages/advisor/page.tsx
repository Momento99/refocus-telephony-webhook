'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Brain,
  Loader2,
  MessageSquarePlus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  CalendarDays,
  CalendarRange,
  CalendarCheck2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';

type Conversation = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

type Message = {
  id: number;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tool_calls?: Array<{ name: string; input: unknown; output_preview?: string }> | null;
  used_chunks?: Array<{ book_title: string; book_author: string; similarity: number; chunk_index: number }> | null;
  model?: string | null;
  cost_usd?: number | null;
  created_at: string;
};

type UsageRow = {
  month: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  requests_count: number;
  cap_usd: number;
  cap_pct: number;
};

const QUICK_PROMPTS: Array<{ icon: React.ComponentType<{ className?: string }>; label: string; prompt: string }> = [
  {
    icon: CalendarDays,
    label: 'Сводка за день',
    prompt: 'Сделай короткую сводку по сети за вчерашний день: выручка по филиалам, проблемы, на что обратить внимание сегодня.',
  },
  {
    icon: CalendarRange,
    label: 'Сводка за месяц',
    prompt: 'Сделай разбор текущего месяца: динамика выручки и среднего чека по каждому филиалу, лучшие и худшие сотрудники, ключевые риски, 3 главных действия на остаток месяца.',
  },
  {
    icon: CalendarCheck2,
    label: 'Сводка за год',
    prompt: 'Сделай стратегический разбор за последние 12 месяцев: динамика сети, какие филиалы растут, какие деградируют, структура выручки, главные стратегические выводы на следующий год.',
  },
];

function classNames(...items: Array<string | false | null | undefined>) {
  return items.filter(Boolean).join(' ');
}

function formatMoney(usd: number | null | undefined) {
  const value = Number(usd ?? 0);
  if (value >= 1) return `$${value.toFixed(2)}`;
  if (value >= 0.01) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(4)}`;
}

function formatDate(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(d);
}

function MarkdownMessage({ text }: { text: string }) {
  return (
    <div className="prose-like text-[13.5px] leading-6 text-slate-700">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="mt-4 mb-2 text-base font-bold text-slate-900 first:mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-4 mb-2 text-[15px] font-bold text-slate-900 first:mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-3 mb-1.5 text-[14px] font-semibold text-slate-900 first:mt-0">{children}</h3>,
          h4: ({ children }) => <h4 className="mt-3 mb-1 text-[13px] font-semibold text-slate-800 first:mt-0">{children}</h4>,
          p:  ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => <ul className="my-2 list-disc pl-5 space-y-1 first:mt-0 last:mb-0">{children}</ul>,
          ol: ({ children }) => <ol className="my-2 list-decimal pl-5 space-y-1 first:mt-0 last:mb-0">{children}</ol>,
          li: ({ children }) => <li className="leading-5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          code: ({ children }) => <code className="rounded bg-slate-100 px-1 py-0.5 text-[12px] font-mono text-slate-800">{children}</code>,
          blockquote: ({ children }) => <blockquote className="my-2 border-l-2 border-cyan-300 pl-3 italic text-slate-600">{children}</blockquote>,
          hr: () => <hr className="my-3 border-slate-200" />,
          a: ({ children, href }) => <a href={href} target="_blank" rel="noreferrer" className="text-cyan-700 underline">{children}</a>,
          table: ({ children }) => (
            <div className="my-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
          tbody: ({ children }) => <tbody>{children}</tbody>,
          tr: ({ children }) => <tr className="border-b border-slate-200">{children}</tr>,
          th: ({ children }) => <th className="px-2 py-1.5 text-left font-semibold text-slate-800">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1.5 align-top text-slate-700">{children}</td>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function AdvisorPage() {
  const supabase = useMemo(() => getBrowserSupabase(), []);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [deepAnalysis, setDeepAnalysis] = useState(false);
  const [usage, setUsage] = useState<UsageRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  // ------- loaders -------
  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from('ai_advisor_conversations')
      .select('id, title, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) {
      setError(error.message);
      return;
    }
    setConversations((data ?? []) as Conversation[]);
  }, [supabase]);

  const loadMessages = useCallback(async (convId: string) => {
    const { data, error } = await supabase
      .from('ai_advisor_messages')
      .select('id, role, content, tool_calls, used_chunks, model, cost_usd, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true });
    if (error) {
      setError(error.message);
      return;
    }
    setMessages((data ?? []) as Message[]);
  }, [supabase]);

  const loadUsage = useCallback(async () => {
    const { data, error } = await supabase.rpc('fn_ai_advisor_current_month_usage');
    if (error) return;
    const row = Array.isArray(data) ? data[0] : data;
    if (row) setUsage(row as UsageRow);
  }, [supabase]);

  useEffect(() => {
    void loadConversations();
    void loadUsage();
  }, [loadConversations, loadUsage]);

  useEffect(() => {
    if (!activeConvId) {
      setMessages([]);
      return;
    }
    void loadMessages(activeConvId);
  }, [activeConvId, loadMessages]);

  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, sending]);

  // ------- actions -------
  const handleNewConversation = () => {
    setActiveConvId(null);
    setMessages([]);
    setInput('');
    setError(null);
  };

  const handleDeleteConversation = async (id: string) => {
    if (!confirm('Удалить разговор? Историю будет не восстановить.')) return;
    const { error } = await supabase.from('ai_advisor_conversations').delete().eq('id', id);
    if (error) {
      setError(error.message);
      return;
    }
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
    void loadConversations();
  };

  const sendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    setSending(true);
    setError(null);

    // Optimistic user bubble
    const optimisticUser: Message = {
      id: -Date.now(),
      role: 'user',
      content: trimmed,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimisticUser]);
    setInput('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error('Нет авторизации — перелогиньтесь.');

      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const res = await fetch(`${supabaseUrl}/functions/v1/ai-advisor-chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          conversationId: activeConvId,
          message: trimmed,
          deepAnalysis,
        }),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        if (json.error === 'monthly_cap_reached') {
          throw new Error(`Месячный лимит ${json.cap_usd}$ исчерпан. Потрачено: $${Number(json.spent_usd).toFixed(2)}.`);
        }
        if (json.error === 'forbidden_owner_only') {
          throw new Error('Доступ только для роли owner.');
        }
        throw new Error(json.error ?? `HTTP ${res.status}`);
      }

      const newConvId = json.conversationId as string;
      if (!activeConvId) setActiveConvId(newConvId);

      // Reload messages (simpler than patching state)
      await loadMessages(newConvId);
      await loadConversations();
      await loadUsage();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Ошибка отправки';
      setError(msg);
      // Roll back optimistic user bubble
      setMessages((prev) => prev.filter((m) => m.id !== optimisticUser.id));
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void sendMessage(input);
  };

  const capPct = Math.min(Number(usage?.cap_pct ?? 0), 100);
  const capColor =
    capPct >= 100 ? 'bg-rose-500'
    : capPct >= 80 ? 'bg-amber-500'
    : 'bg-emerald-500';

  return (
    <div className="mx-auto w-full max-w-7xl px-5 pb-6 pt-4">
      <div className="grid grid-cols-1 md:grid-cols-[260px_1fr] gap-4">
        {/* Sidebar: conversations */}
        <aside className="rounded-2xl bg-white p-3 ring-1 ring-slate-200/80 shadow-sm h-[calc(100vh-160px)] flex flex-col">
          <button
            type="button"
            onClick={handleNewConversation}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 px-3 py-2 text-sm font-medium text-white shadow-[0_8px_20px_rgba(14,165,233,0.25)] hover:brightness-105"
          >
            <MessageSquarePlus className="h-4 w-4" />
            Новый разговор
          </button>

          <div className="mt-3 flex-1 overflow-y-auto pr-1 space-y-1">
            {conversations.length === 0 && (
              <div className="px-2 py-6 text-center text-[11px] text-slate-400">История появится после первого сообщения</div>
            )}
            {conversations.map((c) => (
              <div
                key={c.id}
                className={classNames(
                  'group flex items-center gap-1 rounded-lg px-2 py-2 text-[12px] cursor-pointer transition',
                  activeConvId === c.id ? 'bg-cyan-50 text-cyan-900 ring-1 ring-cyan-200' : 'text-slate-700 hover:bg-slate-50',
                )}
                onClick={() => setActiveConvId(c.id)}
              >
                <span className="flex-1 truncate">{c.title || 'Без названия'}</span>
                <span className="text-[10px] text-slate-400 whitespace-nowrap">{formatDate(c.updated_at)}</span>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); void handleDeleteConversation(c.id); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-rose-500 transition"
                  title="Удалить"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>

          {/* Usage indicator */}
          <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 ring-1 ring-slate-200/70">
            <div className="flex items-center justify-between text-[11px] text-slate-600">
              <span>Бюджет месяца</span>
              <span className="font-medium text-slate-800">
                {formatMoney(usage?.cost_usd)} / ${Number(usage?.cap_usd ?? 20).toFixed(0)}
              </span>
            </div>
            <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div className={classNames('h-full transition-all', capColor)} style={{ width: `${capPct}%` }} />
            </div>
            <div className="mt-1 text-[10px] text-slate-500">
              {usage?.requests_count ?? 0} запросов, {((usage?.tokens_out ?? 0) + (usage?.tokens_in ?? 0)).toLocaleString('ru-RU')} токенов
            </div>
          </div>
        </aside>

        {/* Main chat */}
        <section className="rounded-2xl bg-white ring-1 ring-slate-200/80 shadow-sm h-[calc(100vh-160px)] flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm">
              <Brain className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900">Бизнес-советник</div>
              <div className="text-[11px] text-slate-500">RAG по 30 книгам + прямой доступ к статистике CRM</div>
            </div>
            <label className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 ring-1 ring-slate-200 cursor-pointer hover:bg-slate-100">
              <input
                type="checkbox"
                checked={deepAnalysis}
                onChange={(e) => setDeepAnalysis(e.target.checked)}
                className="h-3.5 w-3.5 accent-cyan-500"
              />
              <span className="text-[12px] text-slate-700">Глубокий анализ (Opus)</span>
            </label>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
            {messages.length === 0 && !sending && (
              <div className="h-full flex flex-col items-center justify-center text-center">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-white shadow-[0_14px_40px_rgba(14,165,233,0.35)]">
                  <Sparkles className="h-5 w-5" />
                </div>
                <div className="mt-3 text-sm font-semibold text-slate-900">Спроси что угодно про сеть</div>
                <div className="mt-1 text-[12px] text-slate-500 max-w-md">
                  Ассистент видит все данные CRM, твои заметки по филиалам и библиотеку из 30 бизнес-книг. Начни с одной из кнопок ниже или напиши свой вопрос.
                </div>
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-3 gap-2 max-w-3xl w-full">
                  {QUICK_PROMPTS.map((q) => {
                    const Icon = q.icon;
                    return (
                      <button
                        key={q.label}
                        type="button"
                        onClick={() => void sendMessage(q.prompt)}
                        disabled={sending}
                        className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2.5 text-left ring-1 ring-slate-200 hover:bg-white hover:shadow-sm transition disabled:opacity-50"
                      >
                        <Icon className="h-4 w-4 text-cyan-600 shrink-0" />
                        <span className="text-[12px] font-medium text-slate-800">{q.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div key={m.id} className={classNames('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                <div
                  className={classNames(
                    'max-w-[85%] rounded-2xl px-4 py-3 ring-1 shadow-sm',
                    m.role === 'user'
                      ? 'bg-gradient-to-br from-teal-50 to-cyan-50 ring-cyan-200/70 text-slate-800'
                      : 'bg-white ring-slate-200/80',
                  )}
                >
                  {m.role === 'assistant' && m.tool_calls && m.tool_calls.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-1">
                      {m.tool_calls.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                          <Wrench className="h-2.5 w-2.5" />
                          {t.name}
                        </span>
                      ))}
                    </div>
                  )}

                  <MarkdownMessage text={m.content} />

                  {m.role === 'assistant' && (
                    <div className="mt-2 flex items-center gap-2 text-[10px] text-slate-400">
                      {m.model && <span>{m.model}</span>}
                      {m.cost_usd != null && <span>· {formatMoney(m.cost_usd)}</span>}
                      {m.used_chunks && m.used_chunks.length > 0 && (
                        <span>· {m.used_chunks.length} фрагментов из книг</span>
                      )}
                      <span className="ml-auto">{formatDate(m.created_at)}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/80 shadow-sm inline-flex items-center gap-2 text-[12px] text-slate-500">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan-500" />
                  Ассистент думает, проверяет данные и книги…
                </div>
              </div>
            )}

            {error && (
              <div className="rounded-xl bg-rose-50 px-3 py-2 ring-1 ring-rose-200 text-[12px] text-rose-700 inline-flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                {error}
              </div>
            )}
          </div>

          {/* Composer */}
          <form onSubmit={handleSubmit} className="border-t border-slate-100 px-3 py-3">
            <div className="flex gap-2 items-end">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void sendMessage(input);
                  }
                }}
                rows={Math.min(Math.max(input.split('\n').length, 1), 6)}
                placeholder="Например: почему в Канте упали продажи? Что делать?"
                disabled={sending}
                className="flex-1 resize-none rounded-xl bg-slate-50 px-3.5 py-2.5 text-[13px] text-slate-900 ring-1 ring-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-400/80 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 px-4 py-2.5 text-sm font-medium text-white shadow-[0_10px_25px_rgba(14,165,233,0.28)] hover:brightness-105 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Отправить
              </button>
            </div>
            <div className="mt-1.5 text-[10px] text-slate-400">
              Enter — отправить · Shift+Enter — перенос строки
            </div>
          </form>
        </section>
      </div>
    </div>
  );
}
