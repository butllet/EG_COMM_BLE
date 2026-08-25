import { useRef } from "react";
import { CheckCircle2, Cpu, FileArchive, Loader2, Trash2 } from "lucide-react";
import type { ChipPack } from "../lib/packs";
import { Badge, Btn, Card, INPUT_CLS } from "./ui";

export interface ChipSelectorProps {
  packs: ChipPack[];
  installedChipIds: Set<string>;
  selectedId: string;
  installing: boolean;
  connected: boolean;
  onSelectedId: (id: string) => void;
  onInstall: (file: File) => void;
  onRemove: () => void;
  onConfirm: () => void;
}

export function ChipSelector(p: ChipSelectorProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const selected = p.packs.find((pack) => pack.chip.id === p.selectedId);
  const registerCount = selected?.pages.reduce((total, page) => total + page.regs.length, 0) ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5">
        <p className="panel-label">Chip · 芯片选择</p>
        <h2 className="mt-1 text-xl font-bold tracking-tight text-white">选择目标芯片</h2>
        <p className="mt-1 text-[12.5px] leading-relaxed text-zinc-500">先装载对应寄存器定义，再连接串口进行调试。</p>
      </div>

      <Card title="Target · 目标芯片" icon={<Cpu size={13} />}>
        <label className="mb-1.5 block text-[11px] text-zinc-500">已安装芯片</label>
        <select value={p.selectedId} onChange={(event) => p.onSelectedId(event.target.value)} disabled={p.connected} className={INPUT_CLS}>
          {p.packs.map((pack) => (
            <option key={pack.chip.id} value={pack.chip.id} className="bg-zinc-900">
              {pack.chip.model} · v{pack.version}
            </option>
          ))}
        </select>
        {selected && (
          <div className="mt-3 rounded-xl border border-cyan-400/20 bg-cyan-400/[0.05] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[15px] font-semibold text-cyan-100">{selected.chip.model}</span>
              <Badge tone="cyan">v{selected.version}</Badge>
              <Badge>{selected.pages.length} 页</Badge>
              <Badge>{registerCount} 个寄存器</Badge>
            </div>
            <p className="hex-cell mt-2 text-[10.5px] text-zinc-500">CHIP ID · {selected.chip.id} · ID {selected.connection.protocolId} · {selected.connection.baud} bps</p>
          </div>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <Btn variant="primary" onClick={p.onConfirm} disabled={!selected || p.connected}>
            <CheckCircle2 size={13} /> 装载芯片并进入调试
          </Btn>
          <input ref={fileRef} type="file" accept=".CPack,application/zip" className="hidden" onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) p.onInstall(file);
          }} />
          <Btn variant="ghost" onClick={() => fileRef.current?.click()} disabled={p.installing || p.connected}>
            {p.installing ? <Loader2 size={13} className="animate-spin" /> : <FileArchive size={13} />}
            {p.installing ? "安装中…" : "安装 CPack"}
          </Btn>
          {selected && p.installedChipIds.has(selected.chip.id) && (
            <Btn variant="danger" onClick={p.onRemove} disabled={p.connected || p.installing}>
              <Trash2 size={13} /> 移除 CPack
            </Btn>
          )}
        </div>
        {p.connected && <p className="mt-3 text-[11px] text-amber-300/80">请先断开串口后再安装或切换芯片。</p>}
      </Card>

      <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">CPack 为本工具专用 ZIP 文件，根目录需包含 <span className="hex-cell text-zinc-400">manifest.json</span>；默认 CPack 不可移除。</p>
    </div>
  );
}
