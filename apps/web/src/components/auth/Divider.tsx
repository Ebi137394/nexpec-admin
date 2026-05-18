export function Divider({ label = 'or' }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-4" aria-hidden>
      <span className="h-px flex-1 bg-white/10" />
      <span className="text-[10px] font-semibold uppercase tracking-industrial text-zinc-500">
        {label}
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}
