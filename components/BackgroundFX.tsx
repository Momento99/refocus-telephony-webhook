// /components/BackgroundFX.tsx
"use client";

/**
 * Vanta NET (без курсора) — исправленный dynamic import:
 * - THREE импортируем как namespace (не .default)
 * - NET берём как .default ?? модуль
 * - адаптивные параметры сетки
 * - базовый градиент и мягкая виньетка
 */

import { useEffect, useRef } from "react";

export default function BackgroundFX() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const vantaRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let instance: any | null = null;
    let canceled = false;

    (async () => {
      try {
        if (!vantaRef.current) return;

        // ВАЖНО: three как namespace, без .default
        const THREE = await import("three");
        // На всякий — некоторые сборки Vanta смотрят в window.THREE
        (window as any).THREE = THREE;

        const vantaMod = await import("vanta/dist/vanta.net.min");
        const NET = (vantaMod as any).default ?? (vantaMod as any);
        if (typeof NET !== "function" || canceled) return;

        const cfg = getAdaptiveNetConfig(window.innerWidth);

        instance = NET({
          el: vantaRef.current,
          THREE,
          color: 0x0ea5ff,
          backgroundColor: 0xf0f6ff,
          points: cfg.points,
          maxDistance: cfg.maxDist,
          spacing: cfg.spacing,
          mouseControls: false,
          touchControls: false,
          gyroControls: false,
          scale: 1.0,
          scaleMobile: 1.0,
          minHeight: 200.0,
          minWidth: 200.0,
        });

        const onResize = () => {
          if (!instance) return;
          const next = getAdaptiveNetConfig(window.innerWidth);
          instance.setOptions?.({
            points: next.points,
            maxDistance: next.maxDist,
            spacing: next.spacing,
          });
        };
        window.addEventListener("resize", onResize);
        (instance as any).__onResize = onResize;
      } catch {
        // Если Vanta снова устраивает театр, просто живём без неё.
      }
    })();

    return () => {
      canceled = true;
      try {
        if (instance?.__onResize) window.removeEventListener("resize", instance.__onResize);
        instance?.destroy?.();
      } catch {}
    };
  }, []);

  return (
    <div ref={hostRef} className="pointer-events-none fixed inset-0 -z-20">
      {/* База: мягкий вертикальный градиент */}
      <div
        className="absolute inset-0"
        style={{ background: "linear-gradient(180deg,#F2F7FF 0%,#FFFFFF 55%,#FFFFFF 100%)" }}
      />
      {/* Сама Vanta NET */}
      <div ref={vantaRef} className="absolute inset-0" />
      {/* Едва заметная виньетка/диагональ для глубины */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(120deg, rgba(26,40,78,0.06) 0%, rgba(255,255,255,0) 45%)," +
            "radial-gradient(1100px 600px at 106% 112%, rgba(91,55,255,0.05) 0%, transparent 60%)",
          mixBlendMode: "multiply",
        }}
      />
    </div>
  );
}

function getAdaptiveNetConfig(width: number) {
  if (width >= 1600) return { points: 11, maxDist: 22, spacing: 20 };
  if (width >= 1200) return { points: 10, maxDist: 20, spacing: 18 };
  if (width >= 768)  return { points: 10, maxDist: 18, spacing: 16 };
  return { points: 9, maxDist: 16, spacing: 14 };
}
