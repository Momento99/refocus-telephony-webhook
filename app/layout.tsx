// /app/layout.tsx — неоновая рамка + прозрачный внутренний лист (Вариант 4: нейросетка)
import "./globals.css";
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

      <body
        className="
          relative min-h-screen antialiased
          text-slate-50
          bg-slate-950
          pos-autozoom
        "
      >
        {/* Глобальный задний фон */}
        <div
          className="pointer-events-none fixed inset-0 -z-20"
          style={{
            backgroundImage: `
              radial-gradient(1900px 1200px at -8% -10%, rgba(34,211,238,0.95), transparent 68%),
              radial-gradient(1700px 1000px at 110% 115%, rgba(59,130,246,0.9), transparent 72%),
              radial-gradient(1300px 900px at 50% 120%, rgba(56,189,248,0.75), transparent 75%),
              linear-gradient(180deg, #022542 0%, #031227 40%, #020617 100%)
            `,
            backgroundRepeat: "no-repeat",
            backgroundColor: "#031227",
          }}
        />

        {/* Диагональный шимер поверх фона */}
        <div
          className="
            pointer-events-none fixed -z-10
            top-[-22%] left-[-24%] h-[155%] w-[68%]
            rotate-[9deg] opacity-[0.4]
          "
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, rgba(56,189,248,0.28) 30%, rgba(129,140,248,0.6) 50%, rgba(56,189,248,0.28) 70%, transparent 100%)",
          }}
        />

        <div className="flex relative z-10">
          <PosAwareSidebar role={role} />

          <main
            className="flex-1 min-h-screen px-6 py-6 transition-all duration-300"
            style={{ marginLeft: "var(--sidebar-width, 18rem)" }}
          >
            <div className="mx-auto max-w-7xl">
              {/* Внешняя неоновая рамка страницы */}
              <div
                className="
                  relative rounded-[28px] overflow-hidden
                  backdrop-blur-2xl
                  border border-cyan-300/55
                  bg-slate-950/40
                "
                style={{
                  boxShadow: `
                    0 0 0 1px rgba(56,189,248,0.45),
                    0 0 40px rgba(56,189,248,0.55),
                    0 28px 90px rgba(15,23,42,0.96)
                  `,
                  backgroundImage: `
                    radial-gradient(1100px 650px at 0% 0%, rgba(56,189,248,0.26), transparent 70%),
                    radial-gradient(1100px 650px at 100% 0%, rgba(129,140,248,0.22), transparent 70%),
                    radial-gradient(900px 620px at 50% 120%, rgba(2,6,23,0.98), rgba(2,6,23,1))
                  `,
                  backgroundColor: "#020617",
                }}
              >
                {/* Декоративный фон вокруг рамки — Вариант 4: нейросетка */}
                <div className="pointer-events-none absolute inset-0 -z-10 opacity-95">
                  {/* Диагональная сетка линий */}
                  <div
                    className="absolute inset-[18px] rounded-[24px]"
                    style={{
                      backgroundImage: `
                        repeating-linear-gradient(
                          135deg,
                          rgba(15,23,42,0.0),
                          rgba(15,23,42,0.0) 14px,
                          rgba(30,64,175,0.35) 14px,
                          rgba(30,64,175,0.35) 15px
                        ),
                        repeating-linear-gradient(
                          315deg,
                          rgba(15,23,42,0.0),
                          rgba(15,23,42,0.0) 18px,
                          rgba(8,47,73,0.45) 18px,
                          rgba(8,47,73,0.45) 19px
                        )
                      `,
                      opacity: 0.35,
                    }}
                  />

                  {/* Узлы-соединения */}
                  <div
                    className="absolute inset-0"
                    style={{ filter: "blur(0.5px)" }}
                  >
                    {/* Левый верхний узел */}
                    <div
                      className="absolute left-[8%] top-[16%] h-3 w-3 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(56,189,248,0.95), transparent 70%)",
                        boxShadow:
                          "0 0 20px rgba(56,189,248,0.8), 0 0 55px rgba(59,130,246,0.9)",
                      }}
                    />
                    {/* Правый верхний узел */}
                    <div
                      className="absolute right-[10%] top-[22%] h-3 w-3 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(129,140,248,0.95), transparent 70%)",
                        boxShadow:
                          "0 0 20px rgba(129,140,248,0.9), 0 0 55px rgba(30,64,175,0.9)",
                      }}
                    />
                    {/* Центр-смещение */}
                    <div
                      className="absolute left-[46%] top-[46%] h-3 w-3 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(34,211,238,0.95), transparent 70%)",
                        boxShadow:
                          "0 0 22px rgba(34,211,238,0.85), 0 0 60px rgba(8,47,73,0.9)",
                      }}
                    />
                    {/* Нижний левый узел */}
                    <div
                      className="absolute left-[14%] bottom-[18%] h-3 w-3 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(56,189,248,0.9), transparent 70%)",
                        boxShadow:
                          "0 0 18px rgba(56,189,248,0.8), 0 0 48px rgba(15,23,42,0.9)",
                      }}
                    />
                    {/* Нижний правый узел */}
                    <div
                      className="absolute right-[14%] bottom-[16%] h-3 w-3 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle, rgba(129,140,248,0.9), transparent 70%)",
                        boxShadow:
                          "0 0 18px rgba(129,140,248,0.85), 0 0 48px rgba(15,23,42,0.9)",
                      }}
                    />
                  </div>

                  {/* Мягкий общий туман, чтобы связать всё вместе */}
                  <div
                    className="absolute inset-x-[5%] top-[18%] h-[60%] blur-3xl"
                    style={{
                      backgroundImage: `
                        radial-gradient(circle at 15% 20%, rgba(56,189,248,0.26), transparent 60%),
                        radial-gradient(circle at 80% 70%, rgba(129,140,248,0.26), transparent 60%),
                        radial-gradient(circle at 50% 40%, rgba(15,23,42,0.9), transparent 70%)
                      `,
                    }}
                  />
                </div>

                {/* Внутренний контейнер */}
                <div
                  className="
                    relative m-[18px] sm:m-6 rounded-[24px]
                    overflow-visible
                  "
                >
                  <div className="relative p-6 sm:p-7">
                    <ClientShell>{children}</ClientShell>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </div>

        <Toaster
          position="top-right"
          toastOptions={{
            style: {
              borderRadius: 10,
              background: "#020617",
              color: "#e5f2ff",
              border: "1px solid rgba(56,189,248,0.45)",
              boxShadow: "0 18px 40px rgba(15,23,42,0.9)",
            },
          }}
        />
      </body>
    </html>
  );
}
