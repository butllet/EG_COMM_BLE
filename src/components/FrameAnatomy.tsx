import { motion } from "framer-motion";
import { FRAME_OVERHEAD, h8, h16, protoIdToHex, toHex } from "../lib/protocol";
import type { ParsedFrame } from "../lib/protocol";
import { cn } from "../utils/cn";

interface Seg {
  key: string;
  label: string;
  hex: string;
  bytes: number;
  cls: string;
  bad?: boolean;
  grow?: boolean;
}

const SEG_BASE: Record<string, string> = {
  HEAD: "border-slate-400/25 bg-slate-400/10 text-slate-300",
  ID: "border-violet-400/30 bg-violet-400/10 text-violet-300",
  CMD: "border-cyan-400/40 bg-cyan-400/15 text-cyan-200",
  PAGE: "border-teal-400/30 bg-teal-400/10 text-teal-300",
  ADDR: "border-sky-400/30 bg-sky-400/10 text-sky-300",
  LEN: "border-lime-400/30 bg-lime-400/10 text-lime-300",
  DATA: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  CRC16: "border-rose-400/30 bg-rose-400/10 text-rose-300",
  TAIL: "border-slate-400/25 bg-slate-400/10 text-slate-300",
};

function buildSegs(f: ParsedFrame): Seg[] {
  const r = f.raw;
  const len = f.len;
  const seg = (key: string, label: string, start: number, end: number, bad = false, grow = false): Seg => ({
    key, label,
    hex: end - start <= 8 ? toHex(r.slice(start, end)) : `${toHex(r.slice(start, start + 4))} …`,
    bytes: Math.max(0, end - start),
    cls: SEG_BASE[key], bad, grow,
  });
  return [
    seg("HEAD", "HEAD 帧头", 0, 2, !f.headOk),
    seg("ID", "ID 协议号", 2, 4, !f.idOk),
    seg("CMD", "CMD 命令字", 4, 5),
    seg("PAGE", "PAGE 页号", 5, 6),
    seg("ADDR", "ADDR 偏移", 6, 7),
    seg("LEN", "LEN 长度", 7, 8),
    seg("DATA", "DATA 数据区", 8, 8 + len, false, true),
    seg("CRC16", "CRC16 小端", 8 + len, 10 + len, !f.crcOk),
    seg("TAIL", "TAIL 尾帧", 10 + len, 12 + len, !f.tailOk),
  ];
}

/** 帧结构解剖图：按字节区间着色展示 */
export function FrameAnatomy({ frame, title }: { frame: ParsedFrame | null; title?: string }) {
  if (!frame) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 bg-black/20 px-4 py-6 text-center hex-cell text-[11px] text-zinc-600">
        EB 90 · {protoIdToHex()} · CMD · PAGE · ADDR · LEN · DATA(N) · CRC_L CRC_H · BE 09
      </div>
    );
  }
  const segs = buildSegs(frame);
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between">
        <span className="text-[11px] text-zinc-500">{title ?? "帧结构"}</span>
        <span className="hex-cell text-[11px] text-zinc-500">
          共 <b className="text-zinc-300">{frame.total}</b> 字节 = {FRAME_OVERHEAD} + DATA({frame.len})
        </span>
      </div>
      <div className="flex gap-1">
        {segs.map((s, i) => (
          <motion.div
            key={s.key}
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: i * 0.045, type: "spring", stiffness: 380, damping: 26 }}
            className={cn(
              "min-w-0 rounded-lg border px-2 py-1.5",
              s.cls,
              s.grow ? "flex-1" : "shrink-0",
              s.bad && "!border-rose-400/60 !bg-rose-500/15",
            )}
            title={`${s.label} · ${s.bytes}B`}
          >
            <div className="hex-cell truncate text-[10.5px] font-semibold leading-tight">
              {s.hex || <span className="text-current/40">—</span>}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-1 flex gap-1">
        {segs.map((s) => (
          <div
            key={s.key}
            className={cn("min-w-0 text-center", s.grow ? "flex-1" : "shrink-0 px-2")}
          >
            <div className={cn("hex-cell truncate text-[9px] uppercase tracking-wider", s.bad ? "text-rose-400" : "text-zinc-600")}>
              {s.key}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FrameFieldTable({ frame }: { frame: ParsedFrame }) {
  const rows: [string, string, boolean?][] = [
    ["HEAD", toHex(frame.raw.slice(0, 2)), frame.headOk],
    ["ID", toHex(frame.raw.slice(2, 4)), frame.idOk],
    ["CMD", `0x${h8(frame.cmd)}`],
    ["PAGE", `0x${h8(frame.page)}`],
    ["ADDR", `0x${h8(frame.addr)}`],
    ["LEN", `${frame.len}`],
    ["DATA", frame.len > 0 ? toHex(frame.data) : "(空)"],
    ["CRC16", `收 0x${h16(frame.crcRecv)} / 算 0x${h16(frame.crcCalc)}`, frame.crcOk],
    ["TAIL", toHex(frame.raw.slice(10 + frame.len, 12 + frame.len)), frame.tailOk],
  ];
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
      {rows.map(([k, v, ok]) => (
        <div key={k} className="flex items-baseline gap-2">
          <span className="hex-cell w-12 shrink-0 text-[10px] text-zinc-600">{k}</span>
          <span
            className={cn(
              "hex-cell truncate text-[11px]",
              ok === undefined ? "text-zinc-300" : ok ? "text-emerald-300" : "text-rose-400",
            )}
          >
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
