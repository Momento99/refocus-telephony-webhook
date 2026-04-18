"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  ReceiptText, LineChart, WalletCards,
  ChevronLeft, ChevronRight,
  LogOut, LogIn, Boxes, FileText, Settings2,
  PackageCheck, Users, Bell, BrainCircuit, Globe,
  Landmark, Map, MessageCircle,
} from "lucide-react";
import { useEffect, useMemo, useState, type ElementType } from "react";
import { getBrowserSupabase } from "@/lib/supabaseBrowser";
import { Role } from "@/lib/getUserRole";


type MenuItem = { label: string; href: string; icon: ElementType };
type MenuSection = { title: string; items: MenuItem[] };

const MENU_SECTIONS: MenuSection[] = [
  {
    title: "Операции",
    items: [
      { label: "Сверка выручки", href: "/finance/reconciliation", icon: ReceiptText },
      { label: "Налоги", href: "/taxes", icon: Landmark },
      { label: "Заказы", href: "/orders", icon: PackageCheck },
      { label: "Клиенты", href: "/customers", icon: Users },
    ],
  },
  {
    title: "Персонал",
    items: [
      { label: "Зарплаты и посещаемость", href: "/settings/payroll", icon: WalletCards },
    ],
  },
  {
    title: "Склад",
    items: [
      { label: "Склад", href: "/warehouse", icon: Boxes },
    ],
  },
  {
    title: "Аналитика",
    items: [
      { label: "Статистика и финансы", href: "/admin/stats", icon: LineChart },
      { label: "AI-центр", href: "/admin/ai-employee-messages", icon: BrainCircuit },
      { label: "WhatsApp контроль", href: "/admin/whatsapp-control", icon: MessageCircle },
      { label: "Карта системы", href: "/admin/system-map", icon: Map },
    ],
  },
  {
    title: "Франшиза",
    items: [
      { label: "Карта и управление", href: "/admin/franchise-map", icon: Globe },
    ],
  },
  {
    title: "Настройки",
    items: [
      { label: "Уведомления", href: "/admin/notifications", icon: Bell },
      { label: "Штрих-коды", href: "/settings/barcodes/overview", icon: FileText },
      { label: "Цены на линзы", href: "/settings/lens-prices", icon: LineChart },
      { label: "Настройки", href: "/settings", icon: Settings2 },
    ],
  },
];

export default function Sidebar({ role }: { role: Role }) {
  void role;
  const pathname = usePathname();
  const router = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [unreadFranchise, setUnreadFranchise] = useState(0);

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
    document.documentElement.style.setProperty("--sidebar-width", collapsed ? "4.5rem" : "16rem");
  }, [collapsed]);

  // Unread franchise messages
  useEffect(() => {
    const s = getBrowserSupabase();
    (async () => {
      const { count } = await s.from("franchise_messages").select("id", { count: "exact", head: true }).eq("sender", "franchise").eq("is_read", false);
      setUnreadFranchise(count || 0);
    })();
    const ch = s.channel("crm-sidebar-unread")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "franchise_messages" }, (p: any) => {
        if (p.new?.sender === "franchise") setUnreadFranchise((prev) => prev + 1);
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "franchise_messages" }, (p: any) => {
        if (p.new?.is_read && p.old && !p.old.is_read && p.new?.sender === "franchise") setUnreadFranchise((prev) => Math.max(0, prev - 1));
      })
      .subscribe();
    return () => { s.removeChannel(ch); };
  }, []);

  function isActive(href: string) {
    if (pathname === href) return true;
    if (href === "/settings/barcodes/overview" && pathname.startsWith("/settings/barcodes")) return true;
    if (href === "/admin/notifications" && pathname.startsWith("/admin/notifications")) return true;
    if (href === "/admin/ai-employee-messages" && pathname.startsWith("/admin/ai-employee-messages")) return true;
    if (href === "/admin/franchise-map" && pathname.startsWith("/admin/franchise")) return true;
    if (href === "/taxes" && pathname.startsWith("/taxes")) return true;
    return false;
  }

  async function handleLogout() {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setUserEmail(null);
    router.push("/login");
  }

  const avatarLetter = useMemo(() => {
    if (!userEmail) return "G";
    return (userEmail.trim()[0] ?? "U").toUpperCase();
  }, [userEmail]);

  return (
    <aside
      className={`fixed top-0 left-0 z-30 flex h-full flex-col border-r transition-all duration-300 ${collapsed ? "w-[4.5rem]" : "w-64"}`}
      style={{
        background: "linear-gradient(180deg, #04070e, #030509)",
        borderColor: "rgba(56,189,248,0.04)",
        boxShadow: "4px 0 32px rgba(0,0,0,0.6)",
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3.5 border-b px-4 py-5" style={{ borderColor: "rgba(56,189,248,0.06)" }}>
        <div className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 shadow-[0_2px_10px_rgba(56,189,248,0.2)] overflow-hidden">
          <Image src="/brand/refocus-logo.png" alt="Refocus" width={48} height={48} priority className="h-12 w-12 object-contain scale-110" />
        </div>
        {!collapsed && (
          <div>
            <div className="font-kiona text-[13px] uppercase tracking-[0.25em] text-cyan-400 leading-normal">
              REFOCUS
            </div>
            <div className="text-[10px] uppercase tracking-[0.15em] font-medium text-slate-600 mt-0.5">
              CRM · Управление
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-3 px-2">
        {MENU_SECTIONS.map((section) => (
          <div key={section.title} className="mb-3">
            {!collapsed && (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
                {section.title}
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item.href);
              const Icon = item.icon;
              const showBadge = item.href === "/admin/franchise-map" && unreadFranchise > 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-all duration-150 ${
                    active
                      ? "bg-cyan-500/10 text-cyan-300 shadow-[inset_3px_0_0_rgb(34,211,238),0_2px_8px_rgba(56,189,248,0.08)]"
                      : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                  }`}
                >
                  <Icon
                    className={`h-[18px] w-[18px] shrink-0 ${active ? "text-cyan-400" : "text-slate-500 group-hover:text-slate-300"}`}
                    strokeWidth={1.8}
                  />
                  {!collapsed && <span className="font-medium flex-1 truncate">{item.label}</span>}
                  {showBadge && (
                    <span className="flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 text-[11px] font-bold text-white px-1.5 shadow-[0_0_8px_rgba(239,68,68,0.4)]">
                      {unreadFranchise}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* User card + collapse */}
      <div className="border-t p-3" style={{ borderColor: "rgba(56,189,248,0.08)" }}>
        <div className={`mb-2 flex items-center gap-2 ${collapsed ? "justify-center" : ""}`}>
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-teal-400 via-cyan-400 to-sky-400 text-xs font-bold text-white shadow-sm">
            {avatarLetter}
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-200">{userEmail || "Гость"}</div>
              <div className="truncate text-[10px] text-slate-500">{userEmail ? "активен" : "войти"}</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          {userEmail ? (
            <button onClick={handleLogout}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-rose-500/10 hover:text-rose-400 transition-colors">
              <LogOut className="h-3.5 w-3.5" />
              {!collapsed && "Выйти"}
            </button>
          ) : (
            <Link href="/login"
              className="flex flex-1 items-center justify-center gap-2 rounded-lg px-2 py-1.5 text-xs text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors">
              <LogIn className="h-3.5 w-3.5" />
              {!collapsed && "Войти"}
            </Link>
          )}
          <button onClick={() => setCollapsed((v) => !v)}
            className="flex items-center justify-center rounded-lg px-2 py-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300 transition-colors">
            {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </aside>
  );
}
