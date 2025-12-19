"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Store,
  ReceiptText,
  LineChart,
  WalletCards,
  ChevronsLeft,
  ChevronsRight,
  LogOut,
  LogIn,
  Lock,
  Wallet,
  Boxes,
  FileText,
  Settings2,
  Timer,              // 👈 посещаемость
  PackageCheck,       // 👈 заказы
  Users,              // 👈 для страницы клиентов
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import { canAccess, Role } from "@/lib/access";

/* =============================
   Конфиг меню (бэк-офис)
============================= */
type MenuItem = { label: string; href: string; icon: React.ElementType; external?: boolean };

const MENU_MAIN: MenuItem[] = [
  { label: "Сверка выручки", href: "/finance/reconciliation", icon: ReceiptText },
  { label: "Заказы", href: "/orders", icon: PackageCheck },
  { label: "Клиенты", href: "/customers", icon: Users },                 // 👈 НОВЫЙ ПУНКТ
  { label: "Зарплаты", href: "/settings/payroll", icon: WalletCards },
  { label: "Посещаемость", href: "/settings/attendance", icon: Timer },
  { label: "Статистика", href: "/admin/stats", icon: LineChart },
  { label: "Финансы", href: "/finance/overview", icon: Wallet },
  { label: "Склад", href: "/warehouse", icon: Boxes },

  // ✅ ВАЖНО: ведём сразу на overview
  { label: "Оправы и штрих-коды", href: "/settings/barcodes/overview", icon: FileText },

  { label: "Цены на линзы", href: "/settings/lens-prices", icon: LineChart },
  { label: "Настройки", href: "/settings", icon: Settings2 },
];

const MENU_ALL: MenuItem[] = MENU_MAIN;

/* =============================
   Sidebar
============================= */
export default function Sidebar({ role }: { role: Role }) {
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => setHydrated(true), []);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    supabase.auth.getUser().then(({ data }) => setUserEmail(data.user?.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, sess) => {
      setUserEmail(sess?.user?.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem("refocus.sidebar.collapsed");
    if (raw) setCollapsed(raw === "1");
  }, []);
  useEffect(() => {
    localStorage.setItem("refocus.sidebar.collapsed", collapsed ? "1" : "0");
    document.documentElement.style.setProperty(
      "--sidebar-width",
      collapsed ? "5rem" : "18rem"
    );
  }, [collapsed]);

  const items = useMemo(() => MENU_ALL, []);

  async function handleLogout() {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setUserEmail(null);
    router.push("/login");
  }

  return (
    <aside
      className={[
        "fixed left-0 top-0 z-50 isolate h-screen",
        collapsed ? "w-20" : "w-72",
        "text-slate-100 shadow-2xl flex flex-col rounded-none rounded-r-2xl border-r border-sky-500/25",
      ].join(" ")}
      style={{
        backgroundImage: `
          radial-gradient(1100px 700px at -10% 0%, rgba(56,189,248,0.32), transparent 65%),
          radial-gradient(900px 600px at 115% 110%, rgba(79,70,229,0.34), transparent 65%),
          linear-gradient(180deg, #020617 0%, #02091f 45%, #020617 100%)
        `,
        backgroundRepeat: "no-repeat",
        backgroundColor: "#020617",
      }}
    >
      {/* Шапка */}
      <div className="px-4 py-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-500/60 via-sky-400/50 to-cyan-400/60 ring-1 ring-sky-200/80 grid place-items-center shadow-[0_10px_30px_rgba(56,189,248,0.85)]">
            <Store size={20} strokeWidth={1.8} className="text-slate-900" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold leading-tight font-[Kiona] text-slate-50 tracking-wide">
                REFOCUS CRM
              </div>
              <div className="mt-0.5 text-[11px] text-sky-200/95 tracking-[0.22em] uppercase">
                Центр управления сетью
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Навигация */}
      <nav className="flex-1 px-3 py-4 space-y-2 overflow-y-auto">
        {!hydrated ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-11 rounded-xl bg-white/10 animate-pulse" />
          ))
        ) : (
          <>
            {items.map((it) => {
              const Icon = it.icon;

              const isBarcodes = it.href === "/settings/barcodes/overview";
              const active =
                pathname === it.href ||
                (isBarcodes && pathname.startsWith("/settings/barcodes"));

              const allowed = canAccess(role, it.href);

              const base =
                "group relative flex items-center rounded-xl transition ring-1 focus:outline-none";
              const pad = collapsed ? "h-11 px-0 justify-center" : "h-11 px-3";

              const normal =
                "bg-white/0 hover:bg-white/5 ring-white/5 hover:ring-sky-400/30 backdrop-blur-[2px]";
              const activeCls =
                "bg-gradient-to-r from-sky-500/26 via-indigo-700/45 to-sky-400/26 " +
                "ring-1 ring-sky-300/60 shadow-[0_10px_30px_rgba(15,23,42,0.9)]";

              const iconWrap = collapsed
                ? "grid place-items-center w-9 h-9 rounded-xl bg_WHITE/8 group-hover:bg-white/14"
                : "grid place-items-center w-9 h-9 rounded-xl bg_WHITE/8 group-hover:bg-white/14 mr-3";

              const indicator =
                !collapsed && (
                  <span
                    className={[
                      "absolute left-1 top-2.5 bottom-2.5 w-[3px] rounded-full transition-colors",
                      active
                        ? "bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.85)]"
                        : "bg-slate-400/0 group-hover:bg-slate-200/70",
                    ].join(" ")}
                  />
                );

              const iconClass = active ? "text-sky-50" : "text-sky-200";
              const labelClass = active ? "text-sky-50" : "text-slate-100/90";

              const content = (
                <>
                  {indicator}
                  <div className={iconWrap}>
                    <Icon size={18} strokeWidth={1.7} className={iconClass} />
                  </div>
                  {!collapsed && (
                    <span className={`truncate text-[14px] font-medium ${labelClass}`}>
                      {it.label}
                    </span>
                  )}
                </>
              );

              if (allowed) {
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    aria-current={active ? "page" : undefined}
                    title={collapsed ? it.label : undefined}
                    className={[base, pad, active ? activeCls : normal].join(" ")}
                  >
                    {content}
                  </Link>
                );
              }

              return (
                <div
                  key={it.href}
                  className={[
                    base,
                    pad,
                    "bg-white/0 ring-white/5 opacity-60 cursor-not-allowed backdrop-blur-[2px]",
                  ].join(" ")}
                  title="Доступ ограничен"
                >
                  {indicator}
                  <div className={iconWrap}>
                    <Lock size={18} strokeWidth={1.7} className="text-slate-300" />
                  </div>
                  {!collapsed && (
                    <span className="truncate text-[14px] font-medium text-slate-300">
                      {it.label}
                    </span>
                  )}
                </div>
              );
            })}
          </>
        )}
      </nav>

      {/* Низ */}
      <div className="px-3 py-3 border-t border-white/10 space-y-3 bg-gradient-to-t from-black/55 via-slate-900/0 to-transparent">
        {/* Блок пользователя */}
        <div className="rounded-2xl px-3 py-2 bg-white/5 ring-1 ring-sky-300/60 backdrop-blur-sm">
          {!collapsed && (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[13px] font-medium truncate text-sky-50">
                  {userEmail || "Гость"}
                </div>
              </div>

              {userEmail ? (
                <button
                  onClick={handleLogout}
                  className="group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]
               border border-sky-300/60
               hover:bg_WHITE/10 transition-colors"
                >
                  <LogOut size={12} className="text-sky-200" />
                  <span className="!text-sky-50 group-hover:!text-white">Выйти</span>
                </button>
              ) : (
                <Link
                  href="/login"
                  className="group inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]
               border border-sky-300/60
               hover:bg_WHITE/10 transition-colors"
                >
                  <LogIn size={12} className="text-sky-200" />
                  <span className="!text-sky-50 group-hover:!text-white">Войти</span>
                </Link>
              )}
            </div>
          )}

          {collapsed && (
            <div className="text-center text-[11px] text-sky-100/90">
              {userEmail ? "Refocus" : "Гость"}
            </div>
          )}
        </div>

        {/* Кнопка свернуть */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className={[
            "W-full inline-flex items-center justify-center gap-2 rounded-2xl",
            "bg-white/5 hover:bg_WHITE/10 ring-1 ring-sky-300/60 px-3 py-2 transition text-sky-50 shadow-md shadow-sky-900/60",
          ].join(" ")}
          title={collapsed ? "Развернуть" : "Свернуть"}
        >
          {collapsed ? (
            <ChevronsRight size={18} className="text-sky-50" />
          ) : (
            <ChevronsLeft size={18} className="text-sky-50" />
          )}
          {!collapsed && <span className="text-sky-50 text-[13px]">Свернуть</span>}
        </button>

        {!collapsed && (
          <div className="pt-1 text-[11px] text-slate-300/90 text-center">Refocus</div>
        )}
      </div>
    </aside>
  );
}
