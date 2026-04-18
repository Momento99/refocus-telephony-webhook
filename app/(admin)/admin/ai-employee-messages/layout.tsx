import AICenterTabs from './AICenterTabs';

export default function AICenterLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[100dvh] bg-transparent text-slate-900">
      <div className="pointer-events-none fixed inset-0 -z-10">
        <div className="absolute -left-24 -top-20 h-72 w-72 rounded-full bg-gradient-to-br from-teal-300/30 via-cyan-300/22 to-sky-300/18 blur-3xl" />
        <div className="absolute -right-28 top-24 h-80 w-80 rounded-full bg-gradient-to-br from-sky-300/22 via-indigo-300/16 to-violet-300/16 blur-3xl" />
      </div>

      <div className="mx-auto w-full max-w-7xl px-5 pt-5">
        <AICenterTabs />
      </div>

      {children}
    </div>
  );
}
