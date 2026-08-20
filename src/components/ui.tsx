import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn";

/* 分区卡片 */
export function Card(props: {
  title: string;
  icon?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("panel overflow-hidden", props.className)}>
      <header className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
        <span className="text-cyan-300/80">{props.icon}</span>
        <span className="panel-label">{props.title}</span>
        <div className="ml-auto flex items-center gap-2">{props.right}</div>
      </header>
      <div className={cn("p-4", props.bodyClassName)}>{props.children}</div>
    </section>
  );
}

type BtnVariant = "primary" | "ghost" | "danger" | "amber";

const BTN_CLS: Record<BtnVariant, string> = {
  primary:
    "bg-cyan-400/90 text-cyan-950 hover:bg-cyan-300 shadow-[0_0_18px_-4px_rgba(34,211,238,0.55)] disabled:bg-cyan-400/25 disabled:text-cyan-100/40 disabled:shadow-none",
  amber:
    "bg-amber-400/90 text-amber-950 hover:bg-amber-300 shadow-[0_0_18px_-6px_rgba(251,191,36,0.55)] disabled:bg-amber-400/20 disabled:text-amber-100/40 disabled:shadow-none",
  ghost:
    "border border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.08] hover:text-white disabled:opacity-40",
  danger:
    "bg-rose-500/15 border border-rose-400/30 text-rose-300 hover:bg-rose-500/25 disabled:opacity-40",
};

export function Btn(
  props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: BtnVariant },
) {
  const { variant = "ghost", className, ...rest } = props;
  return (
    <button
      {...rest}
      className={cn(
        "inline-flex h-8 select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition-all duration-150 active:scale-[0.97] disabled:cursor-not-allowed disabled:active:scale-100",
        BTN_CLS[variant],
        className,
      )}
    />
  );
}

export function Badge(props: { children: ReactNode; tone?: "cyan" | "amber" | "zinc" | "green" | "red" | "violet" }) {
  const tones = {
    cyan: "border-cyan-400/30 bg-cyan-400/10 text-cyan-300",
    amber: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    zinc: "border-white/10 bg-white/[0.05] text-zinc-400",
    green: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
    red: "border-rose-400/30 bg-rose-400/10 text-rose-300",
    violet: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  } as const;
  return (
    <span className={cn("hex-cell inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10.5px] font-medium", tones[props.tone ?? "zinc"])}>
      {props.children}
    </span>
  );
}

export function Field(props: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", props.className)}>
      <span className="mb-1 block text-[11px] font-medium text-zinc-500">{props.label}</span>
      {props.children}
    </label>
  );
}

export const INPUT_CLS =
  "hex-cell h-8 w-full rounded-lg border border-white/10 bg-black/30 px-2.5 text-[12.5px] text-zinc-200 placeholder:text-zinc-600 focus:border-cyan-400/50 focus:bg-cyan-400/[0.04] focus:shadow-[0_0_0_3px_rgba(34,211,238,0.08)] transition-all";
