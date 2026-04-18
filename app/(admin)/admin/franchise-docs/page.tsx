'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { getBrowserSupabase } from '@/lib/supabaseBrowser';
import toast from 'react-hot-toast';
import {
  FileText, ArrowLeft, Upload, Trash2, ExternalLink,
  Shield, Building2, Users, Key, FolderOpen, AlertTriangle,
  Calendar,
} from 'lucide-react';

const fmtDate = (s: string) => new Date(s).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' });
const fmtSize = (b: number) => b > 1048576 ? `${(b / 1048576).toFixed(1)} МБ` : `${Math.round(b / 1024)} КБ`;

const CATEGORIES: Record<string, { label: string; icon: any; color: string; bg: string }> = {
  franchise_agreement: { label: 'Договор франшизы', icon: Shield, color: 'text-teal-700', bg: 'bg-teal-50 ring-teal-200' },
  lease: { label: 'Договор аренды', icon: Building2, color: 'text-sky-700', bg: 'bg-sky-50 ring-sky-200' },
  employment: { label: 'Трудовой договор', icon: Users, color: 'text-indigo-700', bg: 'bg-indigo-50 ring-indigo-200' },
  license: { label: 'Лицензия', icon: Key, color: 'text-amber-700', bg: 'bg-amber-50 ring-amber-200' },
  registration: { label: 'Регистрация ИП', icon: FileText, color: 'text-emerald-700', bg: 'bg-emerald-50 ring-emerald-200' },
  other: { label: 'Прочее', icon: FolderOpen, color: 'text-slate-600', bg: 'bg-slate-50 ring-slate-200' },
};

interface Doc {
  id: number; branch_id: number | null; uploaded_by: string; category: string;
  title: string; file_url: string; file_name: string; file_size: number;
  expires_at: string | null; notes: string | null; created_at: string;
  branch_name?: string;
}

interface Branch { id: number; name: string; }

const cardCls = "rounded-2xl bg-white/95 backdrop-blur-sm shadow-[0_4px_20px_rgba(0,0,0,0.15)] ring-1 ring-sky-200/40";

export default function FranchiseDocsPage() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterBranch, setFilterBranch] = useState<number | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('franchise_agreement');
  const [targetBranch, setTargetBranch] = useState<number | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  function sb() { return getBrowserSupabase(); }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const s = getBrowserSupabase();
      const [{ data: docsData }, { data: brData }] = await Promise.all([
        s.from('franchise_documents').select('*').order('created_at', { ascending: false }),
        s.from('branches').select('id, name').order('name'),
      ]);
      const bMap = new Map((brData || []).map((b: any) => [b.id, b.name]));
      setDocs((docsData || []).map((d: any) => ({ ...d, branch_name: d.branch_id ? bMap.get(d.branch_id) || `#${d.branch_id}` : 'Все филиалы' })));
      setBranches(brData || []);
      setLoading(false);
    })();
  }, []);

  async function uploadDoc() {
    if (!file || !title.trim()) { toast.error('Заполните название и файл'); return; }
    setUploading(true);
    const s = getBrowserSupabase();
    const ext = file.name.split('.').pop() || 'pdf';
    const path = `documents/hq/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;
    const { error: upErr } = await s.storage.from('franchise-chat').upload(path, file);
    if (upErr) { toast.error('Ошибка загрузки'); setUploading(false); return; }
    const { data: urlData } = s.storage.from('franchise-chat').getPublicUrl(path);
    await s.from('franchise_documents').insert({
      branch_id: targetBranch, uploaded_by: 'hq', category, title: title.trim(),
      file_url: urlData.publicUrl, file_name: file.name, file_size: file.size,
    });
    toast.success('Документ загружен');
    setTitle(''); setFile(null); setShowUpload(false); setUploading(false);
    const { data } = await s.from('franchise_documents').select('*').order('created_at', { ascending: false });
    const bMap = new Map(branches.map((b) => [b.id, b.name]));
    setDocs((data || []).map((d: any) => ({ ...d, branch_name: d.branch_id ? bMap.get(d.branch_id) || `#${d.branch_id}` : 'Все филиалы' })));
  }

  async function deleteDoc(id: number) {
    if (!confirm('Удалить документ?')) return;
    await sb().from('franchise_documents').delete().eq('id', id);
    setDocs((prev) => prev.filter((d) => d.id !== id));
    toast.success('Удалён');
  }

  const filtered = filterBranch ? docs.filter((d) => d.branch_id === filterBranch || d.branch_id === null) : docs;
  const today = new Date();
  const alerts = docs.filter((d) => d.expires_at && new Date(d.expires_at) < today);

  return (
    <div className="mx-auto max-w-5xl px-5 pt-8 pb-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <Link href="/admin/franchise-map" className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/10 hover:bg-white/20 transition-colors">
            <ArrowLeft size={18} className="text-slate-300" />
          </Link>
          <div className="flex items-center gap-3.5">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_4px_20px_rgba(56,189,248,0.35)]">
              <FileText size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">Документы франчайзи</h1>
              <p className="text-[12px] text-slate-400">{docs.length} документов{alerts.length > 0 && ` · ${alerts.length} просроченных`}</p>
            </div>
          </div>
        </div>
        <button onClick={() => setShowUpload(!showUpload)}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white font-semibold text-sm shadow-[0_4px_16px_rgba(56,189,248,0.3)] hover:shadow-[0_6px_20px_rgba(56,189,248,0.4)] transition-all">
          <Upload size={16} /> Загрузить от HQ
        </button>
      </div>

      {/* Alerts */}
      {alerts.length > 0 && (
        <div className="mb-5 rounded-2xl ring-1 ring-red-300/50 bg-red-50/90 backdrop-blur-sm px-5 py-3 flex items-center gap-3 shadow-sm">
          <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
          <div className="text-sm text-red-700"><span className="font-bold">{alerts.length} документов с истёкшим сроком.</span> Проверьте и обновите.</div>
        </div>
      )}

      {/* Upload form */}
      {showUpload && (
        <div className={`mb-5 ${cardCls} p-5`}>
          <div className="text-sm font-bold text-slate-800 mb-4">Загрузить документ от HQ</div>
          <div className="grid grid-cols-2 gap-4 mb-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Название</label>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Договор франшизы"
                className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Для кого</label>
              <select value={targetBranch ?? ''} onChange={(e) => setTargetBranch(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400">
                <option value="">Всем франчайзи</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Категория</label>
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-sky-200 bg-white text-sm text-slate-900 outline-none focus:ring-2 focus:ring-cyan-400">
                {Object.entries(CATEGORIES).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1.5 block">Файл</label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => document.getElementById('hq-file-input')?.click()}
                  className="px-4 py-2.5 rounded-xl bg-sky-50 ring-1 ring-sky-200 text-sky-700 text-sm font-medium hover:bg-sky-100 transition-colors">
                  {file ? file.name : 'Выбрать файл'}
                </button>
                {file && <span className="text-[12px] text-slate-500">{fmtSize(file.size)}</span>}
              </div>
              <input id="hq-file-input" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="hidden" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={uploadDoc} disabled={uploading || !file || !title.trim()}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-teal-400 to-cyan-400 text-white font-semibold text-sm shadow-sm disabled:opacity-40">
              {uploading ? '...' : 'Загрузить'}
            </button>
            <button onClick={() => setShowUpload(false)} className="px-4 py-2.5 rounded-xl bg-slate-100 text-slate-500 text-sm">Отмена</button>
          </div>
        </div>
      )}

      {/* Branch filter */}
      <div className="mb-4 flex gap-2 flex-wrap">
        <button onClick={() => setFilterBranch(null)}
          className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition-all ${!filterBranch ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm' : 'bg-white/10 text-slate-400 hover:text-white hover:bg-white/15'}`}>
          Все
        </button>
        {branches.map((b) => (
          <button key={b.id} onClick={() => setFilterBranch(b.id)}
            className={`rounded-xl px-4 py-2 text-[13px] font-semibold transition-all ${filterBranch === b.id ? 'bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 text-white shadow-sm' : 'bg-white/10 text-slate-400 hover:text-white hover:bg-white/15'}`}>
            {b.name}
          </button>
        ))}
      </div>

      {/* Documents */}
      {loading ? (
        <div className={`${cardCls} p-10 text-center text-slate-400`}>Загрузка...</div>
      ) : filtered.length === 0 ? (
        <div className={`${cardCls} p-10 text-center text-slate-400`}>Нет документов</div>
      ) : (
        <div className={`${cardCls} overflow-hidden`}>
          {filtered.map((doc, i) => {
            const cat = CATEGORIES[doc.category] || CATEGORIES.other;
            const CatIcon = cat.icon;
            const isExpired = doc.expires_at && new Date(doc.expires_at) < today;
            return (
              <div key={doc.id} className={`flex items-center gap-4 px-5 py-3.5 hover:bg-sky-50/50 transition-colors ${i > 0 ? 'border-t border-sky-100/50' : ''}`}>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cat.bg} ring-1`}>
                  <CatIcon className={`h-5 w-5 ${cat.color}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">{doc.title}</div>
                  <div className="flex items-center gap-3 mt-0.5 text-[11px]">
                    <span className={cat.color}>{cat.label}</span>
                    <span className="text-slate-400">{doc.branch_name}</span>
                    <span className="text-slate-400">{doc.uploaded_by === 'hq' ? 'HQ' : 'Франчайзи'}</span>
                    <span className="text-slate-400">{fmtSize(doc.file_size)}</span>
                  </div>
                  {doc.expires_at && (
                    <div className={`flex items-center gap-1 mt-0.5 text-[11px] font-medium ${isExpired ? 'text-red-600' : 'text-slate-400'}`}>
                      <Calendar className="h-3 w-3" />
                      {isExpired ? `Истёк ${fmtDate(doc.expires_at)}` : `До ${fmtDate(doc.expires_at)}`}
                    </div>
                  )}
                </div>
                <a href={doc.file_url} target="_blank" rel="noopener"
                  className="flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] font-semibold text-white bg-gradient-to-r from-teal-400 via-cyan-400 to-sky-400 shadow-sm hover:shadow-md transition-all shrink-0">
                  <ExternalLink className="h-3.5 w-3.5" /> Открыть
                </a>
                <button onClick={() => deleteDoc(doc.id)}
                  className="px-2.5 py-2 rounded-xl text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors shrink-0">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
