import { useRef } from "react";
import {
  Cable, Download, FileSpreadsheet, Layers, Loader2, PlugZap, RotateCcw,
  TimerReset, TriangleAlert, Unplug, Upload,
} from "lucide-react";
import { h8, protoIdToHex } from "../lib/protocol";
import type { PageDef } from "../lib/registers";
import { Badge, Btn, Card, INPUT_CLS } from "./ui";
import { cn } from "../utils/cn";

const BAUDS = [1200, 2400, 4800, 9600, 14400, 19200, 38400, 57600, 115200, 128000, 230400, 256000, 460800, 921600];

export interface SideBarProps {
  connected: boolean;
  connecting: boolean;
  transportDesc: string;
  baud: number;
  onBaud: (b: number) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  serialSupported: boolean;
  otaBusy?: boolean;
  pages: PageDef[];
  activePage: number;
  onPage: (id: number) => void;
  onImportExcel: (file: File) => void;
  onRestorePages: () => void;
  importing: boolean;
  onBatchRead: () => void;
  onBatchWrite: () => void;
  batchBusy: string | null;
  autoPoll: boolean;
  onPoll: (v: boolean) => void;
  pollMs: number;
  onPollMs: (v: number) => void;
  protoId: [number, number];
  protoIdText: string;
  onProtoIdText: (s: string) => void;
}

export function SideBar(p: SideBarProps) {
  const page = p.pages.find((x) => x.id === p.activePage) ?? p.pages[0];
  const busy = p.batchBusy !== null || !!p.otaBusy;
  const fileRef = useRef<HTMLInputElement>(null);
  const imported = p.pages.some((pg) => pg.imported);

  return (
    <div className="flex flex-col gap-4 p-4">
      {/* ---------- 连接（仅真实串口） ---------- */}
      <Card title="Transport · 连接" icon={<Cable size={13} />}>
        <div className="space-y-2.5">
          {!p.serialSupported && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-400/25 bg-amber-400/[0.07] px-2.5 py-2 text-[11px] leading-relaxed text-amber-200/80">
              <TriangleAlert size={13} className="mt-0.5 shrink-0" />
              当前浏览器不支持 Web Serial API，请使用 Windows 版 Chrome / Edge（HTTPS 或 localhost）。
            </div>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-zinc-500">波特率</span>
            <select
              value={p.baud}
              onChange={(e) => p.onBaud(Number(e.target.value))}
              disabled={p.connected}
              className={cn(INPUT_CLS, "w-32 cursor-pointer")}
            >
              {BAUDS.map((b) => (
                <option key={b} value={b} className="bg-zinc-900">{b}</option>
              ))}
            </select>
          </div>
          <div className="hex-cell flex items-center justify-between text-[11px] text-zinc-600">
            <span>数据位/校验/停止位</span>
            <Badge>8N1 固定</Badge>
          </div>
        </div>

        <div className="mt-3">
          {p.connected ? (
            <Btn variant="danger" className="w-full" onClick={p.onDisconnect}>
              <Unplug size={13} /> {p.otaBusy ? "断开并中止 OTA" : "断开连接"}
            </Btn>
          ) : (
            <Btn variant="primary" className="w-full" onClick={p.onConnect} disabled={p.connecting || !p.serialSupported}>
              {p.connecting ? <Loader2 size={13} className="animate-spin" /> : <PlugZap size={13} />}
              {p.connecting ? "连接中…" : "选择并打开串口"}
            </Btn>
          )}
        </div>

        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-black/25 px-2.5 py-1.5">
          <span
            className={cn(
              "size-2 shrink-0 rounded-full",
              p.connected ? "bg-emerald-400 animate-pulse-dot" : p.connecting ? "bg-amber-400 animate-pulse" : "bg-zinc-600",
            )}
          />
          <span className="truncate text-[11px] text-zinc-500">
            {p.connected ? p.transportDesc : p.connecting ? "正在建立连接" : "未连接"}
          </span>
        </div>
      </Card>

      {/* ---------- 页面 ---------- */}
      <Card
        title="Pages · 寄存器页"
        icon={<Layers size={13} />}
        right={
          <div className="flex items-center gap-1">
            <input
              ref={fileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) p.onImportExcel(f);
              }}
            />
            <Btn
              variant="ghost"
              className="h-6 !px-2 text-[10.5px]"
              title="从 Excel《寄存器结构表》导入 PAGE"
              disabled={p.importing}
              onClick={() => fileRef.current?.click()}
            >
              {p.importing ? <Loader2 size={11} className="animate-spin" /> : <FileSpreadsheet size={11} />}
              导入
            </Btn>
            {imported && (
              <Btn
                variant="ghost"
                className="h-6 !px-2 text-[10.5px]"
                title="恢复内置 SysConfig / DisplayReg"
                onClick={p.onRestorePages}
              >
                <RotateCcw size={11} />
                内置
              </Btn>
            )}
          </div>
        }
      >
        <div className="space-y-2">
          {p.pages.map((pg) => (
            <button
              key={pg.id}
              onClick={() => p.onPage(pg.id)}
              className={cn(
                "group w-full rounded-xl border px-3 py-2.5 text-left transition-all",
                p.activePage === pg.id
                  ? "border-cyan-400/40 bg-cyan-400/[0.08] shadow-[0_0_24px_-10px_rgba(34,211,238,0.5)]"
                  : "border-white/[0.07] bg-black/20 hover:border-white/15",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("text-[13px] font-semibold", p.activePage === pg.id ? "text-cyan-200" : "text-zinc-300")}>
                  {pg.name}
                </span>
                <Badge tone={p.activePage === pg.id ? "cyan" : "zinc"}>PAGE 0x{h8(pg.id)}</Badge>
              </div>
              <div className="mt-1.5 flex items-center justify-between text-[10.5px] text-zinc-500">
                <span>{pg.cn} · {pg.regs.length} 个寄存器</span>
                <span className="hex-cell">共 {pg.totalLen}B · {pg.writable ? "可写页" : "只读页"}</span>
              </div>
            </button>
          ))}
        </div>
        {imported && (
          <p className="mt-2 text-[10.5px] leading-relaxed text-zinc-600">
            当前页表来自 Excel 导入，共 {p.pages.length} 页。
          </p>
        )}
      </Card>

      {/* ---------- 批量操作 ---------- */}
      <Card title="Batch · 批量操作" icon={<Download size={13} />}>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="ghost" onClick={p.onBatchRead} disabled={!p.connected || busy || !page}>
            {p.batchBusy === "read" ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
            读取整页
          </Btn>
          <Btn
            variant="amber"
            onClick={p.onBatchWrite}
            disabled={!p.connected || busy || !page?.writable}
            title={page?.writable ? "写入当前页全部成员" : "当前页为只读页"}
          >
            {p.batchBusy === "write" ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            写入整页
          </Btn>
        </div>
        <p className="mt-2 hex-cell text-[10px] leading-relaxed text-zinc-600">
          ADDR=0x00 → LEN={page?.totalLen ?? 0}B；只读字段写 0x00
        </p>

        <div className="mt-3 flex items-center justify-between border-t border-white/[0.06] pt-3">
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-zinc-400">
            <button
              role="switch"
              aria-checked={p.autoPoll}
              onClick={() => !p.otaBusy && p.onPoll(!p.autoPoll)}
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                p.autoPoll ? "bg-cyan-400/70" : "bg-white/10",
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 size-4 rounded-full bg-white shadow transition-all",
                  p.autoPoll ? "left-[18px]" : "left-0.5",
                )}
              />
            </button>
            自动轮询当前页
            {p.autoPoll && <span className="text-[10px] text-amber-300/80">（进行中）</span>}
          </label>
          <select
            value={p.pollMs}
            onChange={(e) => p.onPollMs(Number(e.target.value))}
            disabled={p.otaBusy}
            className={cn(INPUT_CLS, "w-24 cursor-pointer")}
          >
            {[200, 500, 1000, 2000].map((v) => (
              <option key={v} value={v} className="bg-zinc-900">{v} ms</option>
            ))}
          </select>
        </div>
      </Card>

      {/* ---------- 帧参数：ID 可配置 ---------- */}
      <Card title="Frame · 帧参数" icon={<TimerReset size={13} />}>
        <div className="mb-2.5">
          <div className="mb-1 flex items-center justify-between">
            <span className="text-[11px] text-zinc-500">协议 ID（2 字节 HEX）</span>
            <span className="hex-cell text-[10px] text-violet-300/80">当前 {protoIdToHex(p.protoId)}</span>
          </div>
          <input
            value={p.protoIdText}
            onChange={(e) => p.onProtoIdText(e.target.value)}
            disabled={p.otaBusy}
            className={INPUT_CLS}
            placeholder="11 55"
            spellCheck={false}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge>HEAD EB 90</Badge>
          <Badge tone="violet">ID {protoIdToHex(p.protoId)}</Badge>
          <Badge>TAIL BE 09</Badge>
          <Badge tone="green">CRC-16/XMODEM</Badge>
          <Badge tone="amber">超时 1000ms</Badge>
        </div>
      </Card>
    </div>
  );
}
