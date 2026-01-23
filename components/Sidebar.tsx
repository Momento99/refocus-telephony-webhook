"use client";

import Link from "next/link";
import Image from "next/image";
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
  Wallet,
  Boxes,
  FileText,
  Settings2,
  Timer,
  PackageCheck,
  Users,
  ShoppingCart,
} from "lucide-react";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import { Role } from "@/lib/access";

/* =============================
   Настройки UI
============================= */
const LOGO_SRC = "/brand/refocus-logo.png"; // /public/brand/refocus-logo.png
const NEW_BADGE_TTL_DAYS = 14; // "NEW" исчезает через N дней с момента первого показа

/* =============================
   Типы меню
============================= */
type MenuItem = {
  label: string;
  href: string;
  icon: ElementType;
  badgeText?: string;
  badgeKey?: string;
};

type MenuSection = {
  title: string;
  items: MenuItem[];
};

/* =============================
   Меню (секции)
============================= */
const MENU_SECTIONS: MenuSection[] = [
  {
    title: "Операции",
    items: [
      { label: "Сверка выручки", href: "/finance/reconciliation", icon: ReceiptText },
      { label: "Заказы", href: "/orders", icon: PackageCheck },
      { label: "Клиенты", href: "/customers", icon: Users },
    ],
  },
  {
    title: "Персонал",
    items: [
      { label: "Зарплаты", href: "/settings/payroll", icon: WalletCards },
      { label: "Посещаемость", href: "/settings/attendance", icon: Timer },
    ],
  },
  {
    title: "Склад и закуп",
    items: [
      {
        label: "Закуп линз",
        href: "/admin/lens-procurement",
        icon: ShoppingCart,
        badgeText: "NEW",
        badgeKey: "lens-procurement",
      },
      { label: "Склад", href: "/warehouse", icon: Boxes },
    ],
  },
  {
    title: "Аналитика",
    items: [
      { label: "Статистика", href: "/admin/stats", icon: LineChart },
      { label: "Финансы", href: "/finance/overview", icon: Wallet },
    ],
  },
  {
    title: "Настройки",
    items: [
      { label: "Оправы и штрих-коды", href: "/settings/barcodes/overview", icon: FileText },
      { label: "Цены на линзы", href: "/settings/lens-prices", icon: LineChart },
      { label: "Настройки", href: "/settings", icon: Settings2 },
    ],
  },
];

/* =============================
   Sidebar
============================= */
export default function Sidebar({ role }: { role: Role }) {
  void role;

  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const [logoError, setLogoError] = useState(false);

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
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "5rem" : "18rem");
  }, [collapsed]);

  const avatarLetter = useMemo(() => {
    if (!userEmail) return "G";
    const ch = userEmail.trim()[0] ?? "U";
    return ch.toUpperCase();
  }, [userEmail]);

  async function handleLogout() {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setUserEmail(null);
    router.push("/login");
  }

  function isActiveHref(href: string) {
    const isBarcodes = href === "/settings/barcodes/overview";
    return pathname === href || (isBarcodes && pathname.startsWith("/settings/barcodes"));
  }

  // "NEW" авто-скрытие по TTL (с момента первого показа)
  function shouldShowBadge(badgeKey?: string) {
    if (!hydrated) return false;
    if (!badgeKey) return false;

    const firstSeenKey = `refocus.badge.${badgeKey}.firstSeenAt`;
    const raw = localStorage.getItem(firstSeenKey);
    let firstSeenAt = raw ? Number(raw) : 0;

    if (!firstSeenAt || Number.isNaN(firstSeenAt)) {
      firstSeenAt = Date.now();
      localStorage.setItem(firstSeenKey, String(firstSeenAt));
    }

    const ttlMs = NEW_BADGE_TTL_DAYS * 24 * 60 * 60 * 1000;
    return Date.now() - firstSeenAt < ttlMs;
  }

  return (
    <aside
      className={[
        // ✅ ФИКС: убрали "relative", оставили только fixed → сайдбар реально фиксированный при любом скролле
        "fixed left-0 top-0 z-50 isolate h-screen",
        collapsed ? "w-20" : "w-72",
        "text-slate-100 shadow-2xl flex flex-col rounded-none rounded-r-2xl",
        "border-r border-sky-500/20",
      ].join(" ")}
      style={{
        backgroundImage: `
          radial-gradient(1100px 700px at -10% 0%, rgba(56,189,248,0.30), transparent 65%),
          radial-gradient(900px 600px at 115% 110%, rgba(79,70,229,0.30), transparent 65%),
          linear-gradient(180deg, #020617 0%, #02091f 45%, #020617 100%)
        `,
        backgroundRepeat: "no-repeat",
        backgroundColor: "#020617",
      }}
    >
      {/* top highlight */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

      {/* ❌ УДАЛЕНО: именно это давало “боковую штучку/полоску” */}
      {/*
      <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-gradient-to-b from-white/14 via-white/6 to-transparent" />
      */}

      {/* grain */}
      <div className="pointer-events-none absolute inset-0 opacity-[0.055] mix-blend-overlay [background-size:3px_3px] bg-[radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.45)_1px,transparent_0)]" />

      {/* Шапка */}
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3">
          {/* Logo tile */}
          <div className="relative h-10 w-10 rounded-2xl ring-1 ring-sky-200/65 bg-gradient-to-br from-sky-500/35 via-indigo-500/20 to-cyan-400/25 grid place-items-center shadow-[0_10px_30px_rgba(56,189,248,0.55)] overflow-hidden">
            {/* glossy highlight */}
            <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-br from-white/18 via-transparent to-transparent" />

            {!logoError ? (
              <Image
                src={LOGO_SRC}
                alt="Refocus"
                fill
                priority
                onError={() => setLogoError(true)}
                className="object-cover scale-[0.90]"
                style={{ objectPosition: "32% 20%" }}
              />
            ) : (
              <Store size={20} strokeWidth={1.8} className="relative text-slate-900" />
            )}

            {/* ❌ УДАЛЕНО: это “штучка” в углу плитки */}
            {/*
            <span
              className={[
                "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950",
                userEmail
                  ? "bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)]"
                  : "bg-slate-400/70",
              ].join(" ")}
            />
            */}
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

        {/* ✅ Новый “не страшный” разделитель: мягкий блик вместо тёмной линии */}
        <div className="mt-4">
          <div className="h-px bg-gradient-to-r from-transparent via-sky-200/20 to-transparent" />
          <div className="-mt-px h-px bg-gradient-to-r from-transparent via-cyan-300/10 to-transparent blur-[0.6px]" />
        </div>
      </div>

      {/* Навигация */}
      <div className="relative flex-1">
        {/* fade masks */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-b from-slate-950/80 to-transparent z-10" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-slate-950/80 to-transparent z-10" />

        <nav className="h-full px-3 py-4 overflow-y-auto">
          {!hydrated ? (
            <div className="space-y-2">
              {Array.from({ length: 10 }).map((_, i) => (
                <div key={i} className="h-11 rounded-2xl bg-white/10 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {MENU_SECTIONS.map((section, si) => (
                <div key={section.title} className={si === 0 ? "" : "pt-1"}>
                  {!collapsed && (
                    <div className="px-3 pb-2">
                      <div className="text-[11px] uppercase tracking-[0.24em] text-sky-200/70">
                        {section.title}
                      </div>
                      <div className="mt-2 h-px bg-gradient-to-r from-white/10 via-white/5 to-transparent" />
                    </div>
                  )}

                  <div className="space-y-2">
                    {section.items.map((it) => {
                      const Icon = it.icon;
                      const active = isActiveHref(it.href);

                      const base =
                        "group relative flex items-center rounded-2xl ring-1 focus:outline-none transition-all duration-200 select-none";
                      const pad = collapsed ? "h-11 px-0 justify-center" : "h-11 px-3";

                      const normal =
                        "bg-white/[0.02] hover:bg-white/[0.06] ring-white/6 hover:ring-sky-300/30 " +
                        "hover:-translate-y-0.5 active:translate-y-0 " +
                        "shadow-[0_0_0_rgba(0,0,0,0)] hover:shadow-[0_14px_30px_rgba(2,6,23,0.65)]";

                      const activeCls =
                        "ring-cyan-200/55 shadow-[0_16px_40px_rgba(2,6,23,0.80)] " +
                        "bg-gradient-to-r from-cyan-400/18 via-sky-500/10 to-indigo-500/22 " +
                        "before:content-[''] before:absolute before:inset-0 before:rounded-2xl before:pointer-events-none " +
                        "before:bg-[radial-gradient(140px_70px_at_18%_50%,rgba(34,211,238,0.20),transparent_72%)]";

                      const indicator =
                        !collapsed && (
                          <>
                            <span
                              className={[
                                "absolute left-1.5 top-2.5 bottom-2.5 w-[3px] rounded-full transition-colors",
                                active
                                  ? "bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.70)]"
                                  : "bg-slate-400/0 group-hover:bg-slate-200/70",
                              ].join(" ")}
                            />
                            {active && (
                              <span className="absolute left-1 top-2.5 bottom-2.5 w-[6px] rounded-full bg-cyan-300/20 blur-[7px]" />
                            )}
                          </>
                        );

                      const iconWrapBase =
                        "relative grid place-items-center w-9 h-9 rounded-2xl ring-1 transition-all";
                      const iconWrap = active
                        ? `${iconWrapBase} bg-white/10 ring-cyan-200/25 shadow-[0_0_0_1px_rgba(34,211,238,0.10)]`
                        : `${iconWrapBase} bg-white/5 ring-white/10 group-hover:bg-white/10 group-hover:ring-sky-200/20`;

                      const iconClass = active ? "text-sky-50" : "text-sky-200";
                      const labelClass = active ? "text-sky-50" : "text-slate-100/90";

                      const showBadge = it.badgeText && shouldShowBadge(it.badgeKey);

                      const rightDecor =
                        !collapsed && (
                          <div className="ml-auto flex items-center gap-2">
                            {showBadge && (
                              <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] tracking-[0.18em] uppercase border border-sky-300/25 bg-white/5 text-sky-100/90">
                                {it.badgeText}
                              </span>
                            )}
                            {active && (
                              <span className="h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.8)]" />
                            )}
                          </div>
                        );

                      const collapsedActiveDot =
                        collapsed && active ? (
                          <span className="absolute -bottom-0.5 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.85)]" />
                        ) : null;

                      return (
                        <Link
                          key={it.href}
                          href={it.href}
                          aria-current={active ? "page" : undefined}
                          title={collapsed ? it.label : undefined}
                          className={[
                            base,
                            pad,
                            active ? activeCls : normal,
                            "focus-visible:ring-2 focus-visible:ring-cyan-300/45",
                          ].join(" ")}
                        >
                          {indicator}

                          <div className={collapsed ? iconWrap : `${iconWrap} mr-3`}>
                            <Icon size={18} strokeWidth={1.7} className={iconClass} />
                            {collapsedActiveDot}
                          </div>

                          {!collapsed && (
                            <span className={`truncate text-[14px] font-medium ${labelClass}`}>
                              {it.label}
                            </span>
                          )}

                          {rightDecor}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </nav>
      </div>

      {/* Низ */}
      <div className="px-3 py-3 border-t border-white/10 space-y-3 bg-gradient-to-t from-black/55 via-slate-900/0 to-transparent">
        {/* Блок пользователя */}
        <div className="rounded-2xl px-3 py-2 bg-white/5 ring-1 ring-sky-300/30 backdrop-blur-sm">
          {!collapsed ? (
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-center gap-2">
                <div className="relative h-9 w-9 rounded-2xl grid place-items-center bg-gradient-to-br from-sky-500/25 via-indigo-600/20 to-cyan-400/25 ring-1 ring-white/10">
                  <span className="text-[13px] font-semibold text-sky-50">{avatarLetter}</span>
                  <span
                    className={[
                      "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950",
                      userEmail
                        ? "bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)]"
                        : "bg-slate-400/70",
                    ].join(" ")}
                  />
                </div>

                <div className="min-w-0">
                  <div className="text-[13px] font-medium truncate text-sky-50">
                    {userEmail || "Гость"}
                  </div>
                  <div className="text-[11px] text-slate-300/90">
                    {userEmail ? "Аккаунт активен" : "Требуется вход"}
                  </div>
                </div>
              </div>

              {userEmail ? (
                <button
                  onClick={handleLogout}
                  className={[
                    "group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]",
                    "border border-sky-300/30 bg-white/0 hover:bg-white/10 transition-all",
                    "hover:-translate-y-0.5 active:translate-y-0",
                  ].join(" ")}
                >
                  <LogOut size={12} className="text-sky-200" />
                  <span className="text-sky-50 group-hover:text-white">Выйти</span>
                </button>
              ) : (
                <Link
                  href="/login"
                  className={[
                    "group inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px]",
                    "border border-sky-300/30 bg-white/0 hover:bg-white/10 transition-all",
                    "hover:-translate-y-0.5 active:translate-y-0",
                  ].join(" ")}
                >
                  <LogIn size={12} className="text-sky-200" />
                  <span className="text-sky-50 group-hover:text-white">Войти</span>
                </Link>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <div className="relative h-9 w-9 rounded-2xl grid place-items-center bg-gradient-to-br from-sky-500/25 via-indigo-600/20 to-cyan-400/25 ring-1 ring-white/10">
                <span className="text-[13px] font-semibold text-sky-50">{avatarLetter}</span>
                <span
                  className={[
                    "absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-slate-950",
                    userEmail
                      ? "bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)]"
                      : "bg-slate-400/70",
                  ].join(" ")}
                />
              </div>
            </div>
          )}
        </div>

        {/* Кнопка свернуть */}
        <button
          onClick={() => setCollapsed((v) => !v)}
          className={[
            "w-full inline-flex items-center justify-center gap-2 rounded-2xl",
            "bg-white/5 hover:bg-white/10 ring-1 ring-sky-300/30 px-3 py-2",
            "transition-all duration-200 text-sky-50 shadow-md shadow-sky-900/60",
            "hover:-translate-y-0.5 active:translate-y-0",
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
