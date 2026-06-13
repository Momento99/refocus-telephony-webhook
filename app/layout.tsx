// /app/layout.tsx
import "./globals.css";
// Onest 400 Regular + 700 Bold (cyrillic + latin) — для цены на ценниках.
// Через npm-пакет, чтобы шрифт реально попадал в document.fonts и был доступен canvas
// сразу при загрузке страницы (без runtime FontFace API + CDN fetch).
// 700 нужен для премиум-ценников (≥4000с), включая всю RL-секцию (6000-17000).
import "@fontsource/onest/cyrillic-400.css";
import "@fontsource/onest/400.css";
import "@fontsource/onest/cyrillic-700.css";
import "@fontsource/onest/700.css";
import type { Metadata } from "next";
import Script from "next/script";
import { Toaster } from "react-hot-toast";
import ClientShell from "@/components/ClientShell";
import { getUserRole } from "@/lib/getUserRole";
import PosAwareSidebar from "@/components/PosAwareSidebar";

export const metadata: Metadata = {
  title: "Refocus CRM",
  description: "Заказы оптики",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const role = await getUserRole();

  return (
    <html lang="ru">
      <head>
        <Script
          src="https://cdn.jsdelivr.net/npm/qz-tray/qz-tray.js"
          strategy="beforeInteractive"
        />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>

      <body className="relative min-h-screen antialiased text-slate-50 pos-autozoom">
        {/* Background layers in globals.css body::before and body::after */}

        <div className="flex relative">
          <PosAwareSidebar role={role} />

          <main className="app-main flex-1 min-h-screen transition-all duration-300">
            <div className="mx-auto max-w-7xl px-5 pt-8 pb-10">
              <ClientShell>{children}</ClientShell>
            </div>
          </main>
        </div>

        <Toaster
          position="top-center"
          toastOptions={{
            duration: 2800,
            style: {
              fontSize: "14px",
              background: "rgba(255,255,255,0.95)",
              color: "#0f172a",
              border: "1px solid rgba(56,189,248,0.15)",
              boxShadow: "0 12px 40px rgba(15,23,42,0.12)",
            },
          }}
        />
      </body>
    </html>
  );
}
