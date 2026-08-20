import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownLeft, ArrowUpRight, CircleAlert, CircleCheck, CircleDot, Download, Eraser, EyeOff, Pause, Play, Terminal } from "lucide-react";
import type { LogEntry } from "../lib/comm";
import { toHex } from "../lib/protocol";
import { FrameFieldTable } from "./FrameAnatomy";
import { cn } from "../utils/cn";

export interface LogConsoleProps {
  entries: LogEntry[];
  paused: boolean;
  onTogglePause: () => void;
  hidePoll: boolean;
  onToggleHidePoll: () => void;
  onClear: () => void;
  onExport: () => void;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

const DIR_META = {
  tx: { label: "TX", cls: "border-cyan-400/40 bg-cyan-400/10 text-cyan-300", hex: "text-cyan-200/80", icon: <ArrowUpRight size={9} /> },
  rx: { label: "RX", cls: "border-amber-400/40 bg-amber-400/10 text-amber-300", hex: "text-amber-200/75", icon: <ArrowDownLeft size={9} /> },
  sys: { label: "SYS", cls: "border-white/15 bg-white/[0.05] text-zinc-400", hex: "text-zinc-400", icon: <CircleDot size={9} /> },
} as const;

export function LogConsole(p: LogConsoleProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  const visible = useMemo(
    () => p.entries.filter((e) => !(p.hidePoll && e.poll)),
    [p.entries, p.hidePoll],
  );

  useEffect(() => {
    const el = scrollRef.current;
    if (el && !p.paused) el.scrollTop = el.scrollHeight;
  }, [visible.length, p.paused]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full min-h-0 flex-col border-t border-white/[0.07] bg-[#070b11]/95">
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
        <Terminal size={13} className="text-cyan-300/80" />
        <span className="panel-label">Console · 通信日志</span>
        <span className="hex-cell text-[10px] text-zinc-600">{visible.length} 条</span>
        <div className="ml-auto flex items-center gap-1">
          <ConsoleBtn onClick={p.onTogglePause} active={p.paused} title={p.paused ? "恢复滚动" : "暂停滚动"}>
            {p.paused ? <Play size={11} /> : <Pause size={11} />}
            {p.paused ? "已暂停" : "滚动中"}
          </ConsoleBtn>
          <ConsoleBtn onClick={p.onToggleHidePoll} active={p.hidePoll} title="隐藏轮询帧">
            <EyeOff size={11} />
            隐藏轮询
          </ConsoleBtn>
          <ConsoleBtn onClick={p.onExport} title="导出日志">
            <Download size={11} />
            导出
          </ConsoleBtn>
          <ConsoleBtn onClick={p.onClear} title="清空日志">
            <Eraser size={11} />
            清空
          </ConsoleBtn>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-1.5 py-1">
        {visible.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[12px] text-zinc-700">
            暂无日志 —— 连接设备后，帧收发将记录在此处
          </div>
        ) : (
          visible.map((e) => {
            const meta = DIR_META[e.dir];
            const open = expanded.has(e.id);
            return (
              <div key={e.id} className="log-row rounded-md" onClick={() => toggle(e.id)}>
                <div className="flex items-start gap-2 px-2 py-1">
                  <span className="hex-cell w-[92px] shrink-0 text-[10px] leading-5 text-zinc-600">{fmtTime(e.ts)}</span>
                  <span className={cn("hex-cell mt-0.5 inline-flex h-4 shrink-0 items-center gap-0.5 rounded border px-1 text-[9px] font-semibold", meta.cls)}>
                    {meta.icon}{meta.label}
                  </span>
                  {e.raw && (
                    <span className={cn("hex-cell min-w-0 flex-1 break-all text-[11px] leading-5", meta.hex)}>
                      {toHex(e.raw)}
                      <span className="text-zinc-600">　{e.msg}</span>
                    </span>
                  )}
                  {!e.raw && (
                    <span className={cn("min-w-0 flex-1 text-[11.5px] leading-5", e.level === "err" ? "text-rose-400" : e.level === "ok" ? "text-emerald-300/90" : "text-zinc-400")}>
                      {e.msg}
                    </span>
                  )}
                  {e.frame && (
                    <span className="mt-0.5 shrink-0">
                      {e.level === "err" ? <CircleAlert size={13} className="text-rose-400" /> : <CircleCheck size={13} className="text-emerald-400/80" />}
                    </span>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {open && e.frame && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.18 }}
                      className="overflow-hidden"
                    >
                      <div className="mx-2 mb-1.5 rounded-lg border border-white/[0.07] bg-black/30 px-3 py-2" onClick={(ev) => ev.stopPropagation()}>
                        <FrameFieldTable frame={e.frame} />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function ConsoleBtn(props: { children: ReactNode; onClick: () => void; active?: boolean; title?: string }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className={cn(
        "flex h-6 items-center gap-1 rounded-md border px-2 text-[10.5px] transition-colors",
        props.active
          ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-300"
          : "border-white/10 bg-white/[0.03] text-zinc-500 hover:text-zinc-300",
      )}
    >
      {props.children}
    </button>
  );
}
