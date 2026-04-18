'use client';

import React, { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  MessageCircle, Send, ArrowLeft,
  Bell, Building2, Paperclip, Image, FileText, X,
} from 'lucide-react';

interface Branch { id: number; name: string; }
interface Attachment { url: string; name: string; type: string; size: number; }
interface Message { id: number; branch_id: number; sender: string; body: string; priority: string; is_read: boolean; created_at: string; attachments?: Attachment[]; }

const fmtTime = (s: string) => {
  const d = new Date(s);
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bishkek' });
};

export default function FranchiseChatPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [unreadCounts, setUnreadCounts] = useState<Map<number, number>>(new Map());
  const [loading, setLoading] = useState(true);
  const [msgLoading, setMsgLoading] = useState(false);
  const [newMsg, setNewMsg] = useState('');
  const [priority, setPriority] = useState<'normal' | 'warning' | 'critical'>('normal');
  const [sending, setSending] = useState(false);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showNotif, setShowNotif] = useState(false);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  const [notifPriority, setNotifPriority] = useState<'normal' | 'warning' | 'critical'>('normal');
  const [notifBranch, setNotifBranch] = useState<number | null>(null);

  function sb() { return getBrowserSupabase(); }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = getBrowserSupabase();
      const { data: fuData } = await s.from('franchise_users').select('branch_id').eq('is_active', true);
      const branchIds = [...new Set((fuData || []).map((f: any) => f.branch_id))];
      if (branchIds.length > 0) {
        const { data: brData } = await s.from('branches').select('id, name').in('id', branchIds).order('name');
        setBranches(brData || []);
      }
      const { data: allMsgs } = await s.from('franchise_messages').select('branch_id, is_read, sender').eq('sender', 'franchise').eq('is_read', false);
      const counts = new Map<number, number>();
      for (const m of allMsgs || []) counts.set(m.branch_id, (counts.get(m.branch_id) || 0) + 1);
      setUnreadCounts(counts);
      setLoading(false);
    })();
  }, []);

  const loadMessages = useCallback(async (branchId: number) => {
    setMsgLoading(true);
    const s = getBrowserSupabase();
    const { data } = await s.from('franchise_messages').select('*').eq('branch_id', branchId).order('created_at', { ascending: true }).limit(300);
    setMessages((data || []) as Message[]);
    const unread = (data || []).filter((m: any) => m.sender === 'franchise' && !m.is_read).map((m: any) => m.id);
    if (unread.length > 0) {
      await s.from('franchise_messages').update({ is_read: true }).in('id', unread);
      setUnreadCounts((prev) => { const n = new Map(prev); n.delete(branchId); return n; });
    }
    setMsgLoading(false);
  }, []);

  useEffect(() => { if (selectedBranch) loadMessages(selectedBranch); }, [selectedBranch, loadMessages]);

  useEffect(() => {
    const s = getBrowserSupabase();
    const channel = s.channel('crm-franchise-messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'franchise_messages' }, (payload: any) => {
        const msg = payload.new as Message;
        if (msg.sender === 'franchise') {
          if (selectedBranch === msg.branch_id) {
            setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
            s.from('franchise_messages').update({ is_read: true }).eq('id', msg.id).then(() => {});
          } else {
            setUnreadCounts((prev) => { const n = new Map(prev); n.set(msg.branch_id, (n.get(msg.branch_id) || 0) + 1); return n; });
          }
        }
        if (msg.sender === 'hq' && selectedBranch === msg.branch_id) {
          setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
        }
      }).subscribe();
    return () => { s.removeChannel(channel); };
  }, [selectedBranch]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function uploadFiles(): Promise<Attachment[]> {
    if (pendingFiles.length === 0) return [];
    setUploading(true);
    const s = getBrowserSupabase();
    const attachments: Attachment[] = [];
    for (const file of pendingFiles) {
      const ext = file.name.split('.').pop() || 'bin';
      const path = `${selectedBranch}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await s.storage.from('franchise-chat').upload(path, file);
      if (error) { console.error(error); continue; }
      const { data: urlData } = s.storage.from('franchise-chat').getPublicUrl(path);
      attachments.push({ url: urlData.publicUrl, name: file.name, type: file.type, size: file.size });
    }
    setUploading(false);
    return attachments;
  }

  async function sendMessage() {
    if (!selectedBranch || (!newMsg.trim() && pendingFiles.length === 0)) return;
    setSending(true);
    const attachments = await uploadFiles();
    const { data, error } = await sb().from('franchise_messages').insert({
      branch_id: selectedBranch, sender: 'hq',
      body: newMsg.trim() || (attachments.length > 0 ? `📎 ${attachments.map((a) => a.name).join(', ')}` : ''),
      priority, attachments,
    }).select().single();
    if (error) { toast.error('Ошибка отправки'); setSending(false); return; }
    setMessages((prev) => [...prev, data as Message]);
    setNewMsg(''); setPriority('normal'); setPendingFiles([]); setSending(false);
  }

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []);
    if (files.some((f) => f.size > 10 * 1024 * 1024)) { toast.error('Максимум 10 МБ'); return; }
    setPendingFiles((prev) => [...prev, ...files]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendNotification() {
    if (!notifTitle.trim()) { toast.error('Введите заголовок'); return; }
    const { error } = await sb().from('franchise_notifications').insert({
      branch_id: notifBranch, title: notifTitle.trim(), body: notifBody.trim() || null, priority: notifPriority,
    });
    if (error) { toast.error('Ошибка'); return; }
    toast.success(notifBranch ? 'Уведомление отправлено' : 'Уведомление отправлено всем');
    setNotifTitle(''); setNotifBody(''); setShowNotif(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const selectedBranchName = branches.find((b) => b.id === selectedBranch)?.name || '';
  const totalUnread = Array.from(unreadCounts.values()).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl px-5 pt-8 pb-10">

      {/* ═══ Header ═══ */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/franchise-map" className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 transition-colors">
            <ArrowLeft size={16} className="text-slate-400" />
          </Link>
          <div>
            <h1 className="text-[20px] font-bold text-white tracking-tight">Сообщения</h1>
            <p className="text-[12px] text-slate-400">{branches.length} филиалов{totalUnread > 0 ? ` · ${totalUnread} непрочитанных` : ''}</p>
          </div>
        </div>
        <button onClick={() => setShowNotif(!showNotif)}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[13px] font-semibold transition-all ${
            showNotif
              ? 'bg-[#22d3ee] text-[#0f172a] shadow-[0_4px_16px_rgba(34,211,238,0.3)]'
              : 'bg-white/10 text-slate-300 hover:bg-white/15'
          }`}>
          <Bell size={15} />
          Уведомление
        </button>
      </div>

      {/* ═══ Notification form ═══ */}
      {showNotif && (
        <div className="mb-5 rounded-2xl bg-white ring-1 ring-slate-200 p-5">
          <div className="text-[13px] font-semibold text-slate-900 mb-3">Отправить уведомление</div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Кому</label>
              <select value={notifBranch ?? ''} onChange={(e) => setNotifBranch(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-sm text-slate-900 outline-none focus:ring-[#22d3ee]/50">
                <option value="">Всем франчайзи</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Важность</label>
              <div className="flex gap-1">
                {(['normal', 'warning', 'critical'] as const).map((p) => (
                  <button key={p} onClick={() => setNotifPriority(p)}
                    className={`flex-1 py-2 rounded-xl text-[11px] font-semibold transition-all ${notifPriority === p
                      ? p === 'critical' ? 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30' : p === 'warning' ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30' : 'bg-[#22d3ee]/15 text-[#22d3ee] ring-1 ring-[#22d3ee]/30'
                      : 'bg-slate-100 text-slate-500 hover:text-slate-700'}`}>
                    {p === 'critical' ? 'Важно' : p === 'warning' ? 'Внимание' : 'Инфо'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-1 block">Заголовок</label>
              <input type="text" value={notifTitle} onChange={(e) => setNotifTitle(e.target.value)} placeholder="Заголовок..."
                className="w-full px-3 py-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-sm text-slate-900 placeholder:text-slate-600 outline-none focus:ring-[#22d3ee]/50" />
            </div>
          </div>
          <div className="flex gap-2">
            <input type="text" value={notifBody} onChange={(e) => setNotifBody(e.target.value)} placeholder="Текст (необязательно)"
              className="flex-1 px-3 py-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-sm text-slate-900 placeholder:text-slate-600 outline-none focus:ring-[#22d3ee]/50" />
            <button onClick={sendNotification}
              className="px-4 py-2 rounded-xl bg-[#22d3ee] text-[#0f172a] font-semibold text-[13px] hover:brightness-110 transition-all">
              Отправить
            </button>
            <button onClick={() => setShowNotif(false)} className="px-3 py-2 rounded-xl bg-slate-100 text-slate-500 text-[13px] hover:text-slate-700 transition-colors">Отмена</button>
          </div>
        </div>
      )}

      {/* ═══ Main layout ═══ */}
      <div className="flex gap-4" style={{ height: 'calc(100vh - 220px)', minHeight: '500px' }}>

        {/* ── Branch list ── */}
        <div className="w-[240px] shrink-0 rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden flex flex-col">
          <div className="px-4 py-3 text-[11px] font-bold uppercase tracking-wider text-slate-500">Филиалы</div>
          {loading ? (
            <div className="p-4 text-sm text-slate-500 text-center">Загрузка...</div>
          ) : branches.length === 0 ? (
            <div className="p-4 text-sm text-slate-500 text-center">Нет франчайзи</div>
          ) : (
            <div className="flex-1 overflow-y-auto">
              {branches.map((b) => {
                const unread = unreadCounts.get(b.id) || 0;
                const isSelected = selectedBranch === b.id;
                return (
                  <button key={b.id} onClick={() => setSelectedBranch(b.id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left transition-all ${isSelected ? 'bg-cyan-50' : 'hover:bg-slate-50'}`}>
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-lg text-[12px] font-bold shrink-0 ${isSelected ? 'bg-[#22d3ee] text-[#0f172a]' : 'bg-slate-700 text-slate-400'}`}>
                        {b.name[0]}
                      </div>
                      <span className={`text-[13px] font-medium truncate ${isSelected ? 'text-slate-900' : 'text-slate-600'}`}>{b.name}</span>
                    </div>
                    {unread > 0 && (
                      <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white px-1.5 shrink-0">{unread}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Chat area ── */}
        <div className="flex-1 rounded-2xl bg-white ring-1 ring-slate-200 overflow-hidden flex flex-col">
          {!selectedBranch ? (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500 gap-3">
              <MessageCircle size={32} className="text-slate-600" />
              <span className="text-sm">Выберите филиал</span>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="px-5 py-3 border-b border-slate-100 flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#22d3ee] shrink-0">
                  <Building2 size={14} className="text-[#0f172a]" />
                </div>
                <div>
                  <div className="text-[13px] font-semibold text-slate-900">{selectedBranchName}</div>
                  <div className="text-[10px] text-slate-500">{messages.length} сообщений</div>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
                {msgLoading ? (
                  <div className="text-center text-sm text-slate-500 py-10">Загрузка...</div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-sm text-slate-500 py-10">Нет сообщений — напишите первым</div>
                ) : (
                  messages.map((m) => {
                    const isHQ = m.sender === 'hq';
                    return (
                      <div key={m.id} className={`flex ${isHQ ? 'justify-end' : 'justify-start'}`}>
                        <div className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                          isHQ
                            ? m.priority === 'critical'
                              ? 'bg-red-50 text-red-800 ring-1 ring-red-200'
                              : m.priority === 'warning'
                                ? 'bg-amber-50 text-amber-800 ring-1 ring-amber-200'
                                : 'bg-cyan-50 text-slate-800 ring-1 ring-cyan-200'
                            : 'bg-slate-50 ring-1 ring-slate-200 text-slate-900'
                        }`}>
                          <div className="text-[13px] leading-relaxed">{m.body}</div>
                          {m.attachments && m.attachments.length > 0 && (
                            <div className="mt-2 space-y-1">
                              {m.attachments.map((att, ai) => (
                                att.type?.startsWith('image/') ? (
                                  <a key={ai} href={att.url} target="_blank" rel="noopener" className="block">
                                    <img src={att.url} alt={att.name} className="max-w-[240px] max-h-[180px] rounded-xl object-cover opacity-90 hover:opacity-100 transition-opacity" />
                                  </a>
                                ) : (
                                  <a key={ai} href={att.url} target="_blank" rel="noopener"
                                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 text-[11px] font-medium text-slate-600 hover:text-slate-800 transition-colors">
                                    <FileText size={12} />{att.name}
                                    <span className="opacity-50">({Math.round(att.size / 1024)} КБ)</span>
                                  </a>
                                )
                              ))}
                            </div>
                          )}
                          <div className="text-[10px] mt-1.5 text-slate-500">
                            {isHQ ? 'HQ' : selectedBranchName} · {fmtTime(m.created_at)}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Input */}
              <div className="px-4 py-3 border-t border-slate-100">
                <div className="flex items-center gap-1.5 mb-2">
                  {(['normal', 'warning', 'critical'] as const).map((p) => (
                    <button key={p} onClick={() => setPriority(p)}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${priority === p
                        ? p === 'critical' ? 'bg-red-500/20 text-red-400' : p === 'warning' ? 'bg-amber-500/20 text-amber-400' : 'bg-[#22d3ee]/15 text-[#22d3ee]'
                        : 'text-slate-600 hover:text-slate-400'}`}>
                      {p === 'critical' ? 'Важно' : p === 'warning' ? 'Внимание' : 'Обычное'}
                    </button>
                  ))}
                </div>
                {pendingFiles.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {pendingFiles.map((f, i) => (
                      <div key={i} className="flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-100 text-[10px] text-slate-600">
                        {f.type.startsWith('image/') ? <Image size={10} /> : <FileText size={10} />}
                        <span className="max-w-[80px] truncate">{f.name}</span>
                        <button onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))} className="text-slate-600 hover:text-red-400"><X size={10} /></button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <input ref={fileInputRef} type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt" onChange={handleFileSelect} className="hidden" />
                  <button onClick={() => fileInputRef.current?.click()}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:text-slate-700 transition-colors">
                    <Paperclip size={15} />
                  </button>
                  <textarea value={newMsg} onChange={(e) => setNewMsg(e.target.value)} onKeyDown={handleKeyDown}
                    placeholder="Сообщение..." rows={1}
                    className="flex-1 resize-none px-3 py-2 rounded-xl bg-slate-50 ring-1 ring-slate-200 text-sm text-slate-900 placeholder:text-slate-600 outline-none focus:ring-[#22d3ee]/30" style={{ maxHeight: '100px' }} />
                  <button onClick={sendMessage} disabled={(sending || uploading) || (!newMsg.trim() && pendingFiles.length === 0)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#22d3ee] text-[#0f172a] hover:brightness-110 transition-all disabled:opacity-30">
                    {uploading ? <div className="h-3.5 w-3.5 border-2 border-[#0f172a]/30 border-t-[#0f172a] rounded-full animate-spin" /> : <Send size={15} />}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
