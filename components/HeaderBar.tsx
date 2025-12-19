// /components/HeaderBar.tsx
"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Store } from "lucide-react";
import { useEffect, useState } from "react";

const BRANCHES = ["Кант", "Кара-Балта", "Беловодск", "Сокулук (мастерская)"];

export default function HeaderBar() {
  const pathname = usePathname();
  const router = useRouter();
  const params = useSearchParams();
  const [branch, setBranch] = useState<string>("Кант");

  // читаем из куки при маунте
  useEffect(() => {
    const cookie = document.cookie
      .split("; ")
      .find(r => r.startsWith("branch="))
      ?.split("=")[1];
    if (cookie) setBranch(decodeURIComponent(cookie));
  }, []);

  // хлебные крошки
  const crumbs = pathname.split("/").filter(Boolean);

  // переключение филиала
  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const b = e.target.value;
    setBranch(b);
    const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `branch=${encodeURIComponent(b)}; path=/; expires=${expires}`;

    const url = new URL(window.location.href);
    url.searchParams.set("branch", b);
    router.push(url.pathname + "?" + url.searchParams.toString());
  }

  return (
    <div className="mb-4 flex items-center justify-between">
      {/* Крошки */}
      <div className="flex items-center text-sm text-neutral-600">
        {crumbs.length === 0 ? (
          <span>Главная</span>
        ) : (
          crumbs.map((c, i) => (
            <span key={i} className="flex items-center">
              {i > 0 && <ChevronRight size={16} className="mx-2 opacity-50" />}
              <span className={i === crumbs.length - 1 ? "font-semibold" : ""}>
                {decodeURIComponent(c)}
              </span>
            </span>
          ))
        )}
      </div>

      {/* Быстрый переключатель филиала */}
      <div className="flex items-center gap-2 text-sm">
        <div className="inline-flex items-center gap-2 rounded-xl px-2 py-1.5
                        bg-white/50 text-neutral-800 ring-1 ring-black/10
                        data-[theme=dark]:bg-white/10 data-[theme=dark]:text-white data-[theme=dark]:ring-white/10">
          <Store size={16} />
          <select
            value={branch}
            onChange={onChange}
            className="bg-transparent outline-none"
          >
            {BRANCHES.map(b => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}
