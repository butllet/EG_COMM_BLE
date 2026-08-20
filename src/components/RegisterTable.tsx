import { ArrowDownToLine, ArrowUpFromLine, Loader2 } from "lucide-react";
import { fieldDisplay, fieldRawLabel, h8, isArrayDtype } from "../lib/protocol";
import { regKey } from "../lib/registers";
import type { PageDef, RegDef } from "../lib/registers";
import { Badge, Btn } from "./ui";
import { cn } from "../utils/cn";

export interface ChangedMark {
  key: string; // regKey 或 `${pageId}:all`
  ok: boolean;
  nonce: number;
}

export interface RegisterTableProps {
  page: PageDef;
  mem: Uint8Array | null;
  readKeys: Set<string>;
  setVals: Record<string, string>;
  onSetVal: (key: string, v: string) => void;
  busyRow: string | null;
  changed: ChangedMark | null;
  canComm: boolean;
  onRead: (reg: RegDef) => void;
  onWrite: (reg: RegDef) => void;
}

const TH = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500 whitespace-nowrap";

export function RegisterTable(p: RegisterTableProps) {
  const { page, mem } = p;
  const pageRead = p.readKeys.has(`${page.id}:all`);

  const valueOf = (r: RegDef): { disp: string; raw: string } | null => {
    const key = regKey(page.id, r.offset);
    if (!mem || !(pageRead || p.readKeys.has(key))) return null;
    if (r.offset + r.len > mem.length) return null;
    return {
      disp: fieldDisplay(mem, r.dtype, r.offset, r.len, r.scale),
      raw: fieldRawLabel(mem, r.dtype, r.offset, r.len),
    };
  };

  const flashCls = (key: string): string | null => {
    if (!p.changed) return null;
    const hit = p.changed.key === key || p.changed.key === `${page.id}:all` || p.changed.key === "all";
    if (!hit) return null;
    return p.changed.ok ? "animate-flash-ok" : "animate-flash-err";
  };

  return (
    <div className="overflow-hidden rounded-xl border border-white/[0.07]">
      <table className="w-full border-collapse text-[12.5px]">
        <thead className="sticky top-0 z-10">
          <tr className="border-b border-white/[0.08] bg-[#0a0f16]/95 backdrop-blur">
            <th className={TH}>偏移</th>
            <th className={TH}>寄存器名称</th>
            <th className={TH}>页面显示名称</th>
            <th className={TH}>权限</th>
            <th className={TH}>类型</th>
            <th className={cn(TH, "text-right")}>倍率</th>
            <th className={cn(TH, "text-right")}>当前值</th>
            <th className={cn(TH, "text-right")}>原始值</th>
            <th className={TH}>设定值</th>
            <th className={cn(TH, "text-center")}>操作</th>
          </tr>
        </thead>
        <tbody>
          {page.regs.map((r, i) => {
            const key = regKey(page.id, r.offset);
            const v = valueOf(r);
            const flash = flashCls(key);
            const rowBusy = p.busyRow === key;
            const writable = r.access === "W/R";
            const arrayTy = isArrayDtype(r.dtype);
            const setWide = r.dtype === "char" || r.dtype === "bytes";
            return (
              <tr
                key={r.name + r.offset}
                className={cn(
                  "border-b border-white/[0.04] transition-colors last:border-0 hover:bg-white/[0.025]",
                  i % 2 === 1 && "bg-white/[0.012]",
                )}
              >
                <td className="px-3 py-1.5">
                  <span className="hex-cell text-[11.5px] text-zinc-500">0x{h8(r.offset)}</span>
                </td>
                <td className="px-3 py-1.5">
                  <span className="hex-cell font-medium text-zinc-200">{r.name}</span>
                </td>
                <td className="px-3 py-1.5 text-zinc-400">{r.label}</td>
                <td className="px-3 py-1.5">
                  <Badge tone={writable ? "cyan" : "amber"}>{r.access}</Badge>
                </td>
                <td className="px-3 py-1.5">
                  <span className="hex-cell text-[11px] text-violet-300/80">
                    {r.dtype}{arrayTy ? `[${r.len}]` : ""}
                  </span>
                  <span className="hex-cell ml-1 text-[10px] text-zinc-600">×{r.len}B</span>
                </td>
                <td className="hex-cell px-3 py-1.5 text-right text-[11.5px] text-zinc-500">
                  {arrayTy ? "—" : r.scale}
                </td>
                <td className="px-3 py-1.5 text-right">
                  <div key={p.changed?.nonce ?? 0} className={cn("inline-block rounded-md px-2 py-0.5", flash)}>
                    {v ? (
                      <span
                        className={cn(
                          "font-semibold text-cyan-200",
                          arrayTy ? "hex-cell text-[12px]" : "hex-cell text-[14px]",
                        )}
                        title={v.disp}
                      >
                        {v.disp || "（空）"}
                      </span>
                    ) : (
                      <span className="hex-cell text-[13px] text-zinc-700">——</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {v ? (
                    <span className="hex-cell text-[11px] text-zinc-500" title={arrayTy ? "字段原始 HEX" : "未缩放原始值"}>
                      {v.raw}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-700">—</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  {writable ? (
                    <input
                      type="text"
                      inputMode={arrayTy ? "text" : "decimal"}
                      value={p.setVals[key] ?? ""}
                      onChange={(e) => p.onSetVal(key, e.target.value)}
                      placeholder={v ? v.disp : r.dtype === "char" ? "ASCII 字符串" : r.dtype === "bytes" ? "HEX" : "输入设定值"}
                      maxLength={r.dtype === "char" ? r.len : undefined}
                      className={cn(
                        "hex-cell h-7 rounded-md border border-white/10 bg-black/30 px-2 text-[12px] text-zinc-200 placeholder:text-zinc-700 focus:border-amber-400/50 focus:bg-amber-400/[0.05] focus:outline-none transition-colors",
                        setWide ? "w-48 text-left" : "w-28 text-right",
                      )}
                    />
                  ) : (
                    <span className="text-[11px] text-zinc-700">只读</span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center justify-center gap-1">
                    <Btn
                      variant="ghost"
                      className="h-7 w-7 !px-0"
                      title={`单次读：CMD 0x52 · ADDR 0x${h8(r.offset)} · ${r.len}B`}
                      disabled={!p.canComm || p.busyRow !== null}
                      onClick={() => p.onRead(r)}
                    >
                      {rowBusy ? <Loader2 size={12} className="animate-spin" /> : <ArrowDownToLine size={12} />}
                    </Btn>
                    <Btn
                      variant="ghost"
                      className="h-7 w-7 !px-0 text-amber-300/90"
                      title={writable ? `单次写：CMD 0x57 · ADDR 0x${h8(r.offset)} · ${r.len}B` : "只读寄存器"}
                      disabled={!p.canComm || p.busyRow !== null || !writable}
                      onClick={() => p.onWrite(r)}
                    >
                      <ArrowUpFromLine size={12} />
                    </Btn>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
