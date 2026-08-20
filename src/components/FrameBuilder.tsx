import { useMemo, useState } from "react";
import { Braces, CheckCircle2, Loader2, ScanSearch, SendHorizonal, XCircle } from "lucide-react";
import {
  buildFrame, CMD, h8, h16, hexToBytes, parseByteHex, parseFrame, protoIdToHex, toHex,
} from "../lib/protocol";
import type { ParsedFrame } from "../lib/protocol";
import { FrameAnatomy, FrameFieldTable } from "./FrameAnatomy";
import { Badge, Btn, Card, Field, INPUT_CLS } from "./ui";
import { cn } from "../utils/cn";

export interface SendResult {
  ok: boolean;
  msg: string;
}

export interface FrameBuilderProps {
  canComm: boolean;
  protoId: [number, number];
  protoIdText: string;
  onProtoIdText: (s: string) => void;
  onSend: (cmd: number, page: number, addr: number, data: Uint8Array) => Promise<SendResult>;
  /** 按输入框 HEX 原文直发，不重组帧，用于异常帧测试 */
  onSendRaw: (raw: Uint8Array) => Promise<SendResult>;
}

const CMD_PRESETS = [
  { v: "52", label: "0x52 读请求" },
  { v: "57", label: "0x57 写请求" },
  { v: "05", label: "0x05 升级请求" },
  { v: "custom", label: "自定义" },
];

export function FrameBuilder(p: FrameBuilderProps) {
  const [cmdSel, setCmdSel] = useState("52");
  const [cmdCustom, setCmdCustom] = useState("05");
  const [pageHex, setPageHex] = useState("00");
  const [addrHex, setAddrHex] = useState("02");
  const [dataHex, setDataHex] = useState("02");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const preview = useMemo((): { frame?: ParsedFrame; cmd?: number; page?: number; addr?: number; data?: Uint8Array; err?: string } => {
    try {
      const cmd = cmdSel === "custom" ? parseByteHex(cmdCustom, "CMD") : parseInt(cmdSel, 16);
      const page = parseByteHex(pageHex, "PAGE");
      const addr = parseByteHex(addrHex, "ADDR");
      const data = hexToBytes(dataHex);
      if (data.length > 255) return { err: "DATA 长度不能超过 255 字节" };
      return { frame: parseFrame(buildFrame(cmd, page, addr, data)), cmd, page, addr, data };
    } catch (e) {
      return { err: e instanceof Error ? e.message : "输入无效" };
    }
  }, [cmdSel, cmdCustom, pageHex, addrHex, dataHex, p.protoId]);

  const doSend = async () => {
    if (!preview.frame || preview.cmd === undefined) return;
    setSending(true);
    setResult(null);
    try {
      const r = await p.onSend(preview.cmd, preview.page!, preview.addr!, preview.data!);
      setResult(r);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {/* ---------- 帧构建 ---------- */}
      <Card title="Frame Builder · 帧构建" icon={<Braces size={13} />}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="ID 协议号" className="col-span-2 sm:col-span-1">
            <input
              value={p.protoIdText}
              onChange={(e) => p.onProtoIdText(e.target.value)}
              className={INPUT_CLS}
              placeholder="11 55"
              spellCheck={false}
            />
          </Field>
          <Field label="CMD 命令字" className="col-span-2">
            <div className="flex gap-1.5">
              <select value={cmdSel} onChange={(e) => setCmdSel(e.target.value)} className={cn(INPUT_CLS, "cursor-pointer")}>
                {CMD_PRESETS.map((c) => (
                  <option key={c.v} value={c.v} className="bg-zinc-900">{c.label}</option>
                ))}
              </select>
              {cmdSel === "custom" && (
                <input value={cmdCustom} onChange={(e) => setCmdCustom(e.target.value)} className={cn(INPUT_CLS, "w-20")} placeholder="FA" />
              )}
            </div>
          </Field>
          <Field label="PAGE 页号">
            <input value={pageHex} onChange={(e) => setPageHex(e.target.value)} className={INPUT_CLS} placeholder="00" />
          </Field>
          <Field label="ADDR 偏移">
            <input value={addrHex} onChange={(e) => setAddrHex(e.target.value)} className={INPUT_CLS} placeholder="02" />
          </Field>
        </div>
        <Field label="DATA 数据区（HEX，可为空；LEN 自动计算）" className="mt-3">
          <input value={dataHex} onChange={(e) => setDataHex(e.target.value)} className={INPUT_CLS} placeholder="例: 02 或 E8 03" />
        </Field>

        <div className="mt-4 rounded-xl border border-white/[0.07] bg-black/25 p-3">
          {preview.err ? (
            <div className="flex items-center gap-2 text-[12px] text-rose-400">
              <XCircle size={14} /> {preview.err}
            </div>
          ) : (
            <>
              <FrameAnatomy frame={preview.frame!} title="发送帧预览（CRC 自动计算）" />
              <div className="hex-cell mt-3 break-all border-t border-white/[0.06] pt-2.5 text-[12px] leading-relaxed text-cyan-200/90">
                {toHex(preview.frame!.raw)}
              </div>
            </>
          )}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <Btn variant="primary" onClick={doSend} disabled={!p.canComm || sending || !!preview.err} className="min-w-36">
            {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizonal size={13} />}
            {sending ? "等待响应…" : "发送并等待响应"}
          </Btn>
          {result && (
            <div className={cn("flex items-center gap-1.5 text-[12px]", result.ok ? "text-emerald-300" : "text-rose-400")}>
              {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span className="hex-cell">{result.msg}</span>
            </div>
          )}
        </div>
      </Card>

      <FrameAnalyzer protoId={p.protoId} canComm={p.canComm} onSendRaw={p.onSendRaw} />
    </div>
  );
}

/* ================= 帧解析器 ================= */
function FrameAnalyzer({
  protoId, canComm, onSendRaw,
}: {
  protoId: [number, number];
  canComm: boolean;
  onSendRaw: (raw: Uint8Array) => Promise<SendResult>;
}) {
  const [hex, setHex] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);

  const analysis = useMemo((): { frame?: ParsedFrame; err?: string; bytes?: Uint8Array } => {
    if (!hex.trim()) return {};
    try {
      const bytes = hexToBytes(hex);
      if (bytes.length < 8) return { err: `仅 ${bytes.length} 字节，不足最小帧长度 (8)`, bytes };
      const len = bytes[7];
      const expected = 12 + len;
      if (bytes.length !== expected) {
        return { err: `长度不符：实际 ${bytes.length}B，按 LEN=${len} 应为 ${expected}B（仍可原样发送）`, bytes };
      }
      return { frame: parseFrame(bytes), bytes };
    } catch (e) {
      return { err: e instanceof Error ? e.message : "无法解析" };
    }
  }, [hex, protoId]);

  const examples: { label: string; bytes: Uint8Array }[] = useMemo(() => {
    const bad = buildFrame(CMD.READ, 0x01, 0, Uint8Array.of(5));
    bad[bad.length - 3] ^= 0xff; // 破坏 CRC_H
    return [
      { label: "读请求示例", bytes: buildFrame(CMD.READ, 0x00, 0x02, Uint8Array.of(2)) },
      { label: "读响应示例", bytes: buildFrame(0xad, 0x00, 0x02, Uint8Array.of(0xe8, 0x03)) },
      { label: "写响应 OK", bytes: buildFrame(0xa8, 0x00, 0x04, Uint8Array.of(0x00)) },
      { label: "CRC 损坏帧", bytes: bad },
    ];
  }, [protoId]);

  const idLabel = protoIdToHex(protoId, "");
  const checks: { label: string; ok: boolean }[] | null = analysis.frame
    ? [
        { label: "帧头 0xEB90", ok: analysis.frame.headOk },
        { label: `协议 ID 0x${idLabel}`, ok: analysis.frame.idOk },
        { label: `CRC16/XMODEM（收 0x${h16(analysis.frame.crcRecv)} / 算 0x${h16(analysis.frame.crcCalc)}）`, ok: analysis.frame.crcOk },
        { label: "尾帧 0xBE09", ok: analysis.frame.tailOk },
      ]
    : null;

  /** 原文直发：不因长度/CRC 错误而禁止，便于对端异常测试 */
  const doSendRaw = async () => {
    let bytes: Uint8Array;
    try {
      bytes = analysis.bytes ?? hexToBytes(hex);
    } catch (e) {
      setResult({ ok: false, msg: e instanceof Error ? e.message : "HEX 无效" });
      return;
    }
    if (bytes.length === 0) {
      setResult({ ok: false, msg: "输入框为空" });
      return;
    }
    setSending(true);
    setResult(null);
    try {
      setResult(await onSendRaw(bytes));
    } finally {
      setSending(false);
    }
  };

  return (
    <Card title="Frame Decoder · 帧解析器" icon={<ScanSearch size={13} />}>
      <Field label="粘贴一帧完整 HEX（容忍空格 / 0x 前缀；可故意写错后直发）">
        <textarea
          value={hex}
          onChange={(e) => setHex(e.target.value)}
          rows={2}
          spellCheck={false}
          className={cn(INPUT_CLS, "h-auto resize-none !leading-relaxed")}
          placeholder={`EB 90 ${protoIdToHex(protoId)} 52 00 02 01 02 …`}
        />
      </Field>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {examples.map((ex) => (
          <button
            key={ex.label}
            onClick={() => setHex(toHex(ex.bytes))}
            className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10.5px] text-zinc-400 transition-colors hover:border-cyan-400/30 hover:text-cyan-300"
          >
            {ex.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl border border-white/[0.07] bg-black/25 p-3">
        {!hex.trim() ? (
          <p className="text-[12px] text-zinc-600">输入帧 HEX 或点击上方示例，自动校验结构、CRC 并标注字段。</p>
        ) : analysis.err ? (
          <div className="flex items-center gap-2 text-[12px] text-rose-400">
            <XCircle size={14} /> {analysis.err}
          </div>
        ) : (
          <>
            <FrameAnatomy frame={analysis.frame!} title={`解析结果 · CMD=0x${h8(analysis.frame!.cmd)}`} />
            <div className="mt-3 border-t border-white/[0.06] pt-2.5">
              <FrameFieldTable frame={analysis.frame!} />
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {checks!.map((c) => (
                <Badge key={c.label} tone={c.ok ? "green" : "red"}>
                  {c.ok ? <CheckCircle2 size={10} /> : <XCircle size={10} />}
                  {c.label}
                </Badge>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Btn
          variant="primary"
          onClick={() => void doSendRaw()}
          disabled={!canComm || sending || !hex.trim()}
          className="min-w-36"
        >
          {sending ? <Loader2 size={13} className="animate-spin" /> : <SendHorizonal size={13} />}
          {sending ? "等待响应…" : "发送并等待响应"}
        </Btn>
        {result && (
          <div className={cn("flex items-center gap-1.5 text-[12px]", result.ok ? "text-emerald-300" : "text-rose-400")}>
            {result.ok ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
            <span className="hex-cell">{result.msg}</span>
          </div>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-zinc-600">
        按输入框 HEX <span className="text-zinc-400">原文直发</span>，不会重算 CRC、也不会补帧头帧尾。
        可发送 CRC 损坏、长度错误、截断帧，观察对端是否丢弃或回包。对端无反应将在 1000ms 后超时。
      </p>
    </Card>
  );
}
