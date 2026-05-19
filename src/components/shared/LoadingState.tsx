export function LoadingState({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#050505] text-slate-300">
      <div className="rounded-lg border border-white/10 bg-[#151515] px-4 py-3 text-sm">
        {label}
      </div>
    </div>
  );
}

