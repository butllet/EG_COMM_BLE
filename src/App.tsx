import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  BookOpenText, Braces, CheckCircle2, ChevronRight, CircleHelp, Cpu, Info, PackageCheck, Rocket, Table2, XCircle,
} from "lucide-react";
import { CommEngine, type Counters, type LogEntry } from "./lib/comm";
import type { TransportKind } from "./lib/transport";
import {
  CMD, WRITE_STATUS, encodeField, fieldDisplay, h8, parseProtoIdHex, protoIdToHex,
  restoreProtoId, setProtoId, toHex,
} from "./lib/protocol";
import { pageOf, regKey } from "./lib/registers";
import type { PageDef, RegDef } from "./lib/registers";
import { allChipPacks, loadInstalledPacks, loadSelectedChipId, parseChipPack, persistInstalledPacks, persistSelectedChipId, removeInstalledPack, type ChipPack } from "./lib/packs";
import { SideBar } from "./components/SideBar";
import { ChipSelector } from "./components/ChipSelector";
import { RegisterTable, type ChangedMark } from "./components/RegisterTable";
import { FrameBuilder } from "./components/FrameBuilder";
import { LogConsole } from "./components/LogConsole";
import { ProtocolDocs, UserGuide } from "./components/InfoPanels";
import { OtaPanel } from "./components/OtaPanel";
import { Badge, Btn } from "./components/ui";
import { cn } from "./utils/cn";

type TabId = "chips" | "regs" | "builder" | "ota" | "docs" | "guide";

const TABS: { id: TabId; label: string; icon: ReactNode }[] = [
  { id: "chips", label: "芯片选择", icon: <PackageCheck size={13} /> },
  { id: "regs", label: "寄存器调试", icon: <Table2 size={13} /> },
  { id: "builder", label: "帧构建 / 解析", icon: <Braces size={13} /> },
  { id: "ota", label: "OTA 升级", icon: <Rocket size={13} /> },
  { id: "docs", label: "协议文档", icon: <BookOpenText size={13} /> },
  { id: "guide", label: "用户使用说明", icon: <CircleHelp size={13} /> },
];

interface Toast { id: number; type: "ok" | "err" | "info"; msg: string }

const SERIAL_SUPPORTED = typeof navigator !== "undefined" && "serial" in navigator;
const BLUETOOTH_SUPPORTED = typeof navigator !== "undefined" && "bluetooth" in navigator;
type TransportMode = TransportKind;

export default function App() {
  /* ---------- 连接 ---------- */
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [transportDesc, setTransportDesc] = useState("");
  const [transportMode, setTransportMode] = useState<TransportMode>("serial");
  const [connectedTransport, setConnectedTransport] = useState<TransportKind | null>(null);
  const [bluetoothName, setBluetoothName] = useState("CH572_Direct");
  const [baud, setBaud] = useState(115200);
  /* ---------- 协议 ID（模块级 + React state 同步，驱动 UI 重渲染） ---------- */
  const [protoId, setProtoIdState] = useState<[number, number]>(() => restoreProtoId());
  const [protoIdText, setProtoIdText] = useState(() => protoIdToHex(restoreProtoId()));
  /* ---------- 数据 ---------- */
  const [installedPacks, setInstalledPacks] = useState<ChipPack[]>(() => loadInstalledPacks());
  const [selectedChipId, setSelectedChipId] = useState(() => loadSelectedChipId());
  const [activeChip, setActiveChip] = useState<ChipPack | null>(null);
  const [pages, setPages] = useState<PageDef[]>([]);
  const [activePage, setActivePage] = useState(0);
  const [tab, setTab] = useState<TabId>("chips");
  const [mem, setMem] = useState<Record<number, Uint8Array | null>>({});
  const [readKeys, setReadKeys] = useState<Set<string>>(new Set());
  const [setVals, setSetVals] = useState<Record<string, string>>({});
  const [changed, setChanged] = useState<ChangedMark | null>(null);
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState<string | null>(null);
  const [installing, setInstalling] = useState(false);
  /* ---------- 日志/计数 ---------- */
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [counters, setCounters] = useState<Counters>({ tx: 0, rx: 0, frames: 0, crcErr: 0 });
  const [paused, setPaused] = useState(false);
  const [hidePoll, setHidePoll] = useState(true);
  /* ---------- 轮询/提示 ---------- */
  const [autoPoll, setAutoPoll] = useState(false);
  const [pollMs, setPollMs] = useState(500);
  const [otaBusy, setOtaBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const engineRef = useRef<CommEngine | null>(null);
  const inflightRef = useRef(0);
  const toastId = useRef(1);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const pollFailRef = useRef(0); // 连续轮询失败次数，避免 SYS 日志被刷屏

  const toast = useCallback((type: Toast["type"], msg: string) => {
    const id = toastId.current++;
    setToasts((prev) => [...prev.slice(-4), { id, type, msg }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4200);
  }, []);

  const pushLog = useCallback((e: LogEntry) => {
    setLogs((prev) => {
      const next = [...prev, e];
      return next.length > 800 ? next.slice(next.length - 800) : next;
    });
  }, []);

  const getEngine = useCallback((): CommEngine => {
    if (!engineRef.current) {
      engineRef.current = new CommEngine({
        onLog: pushLog,
        onCounters: setCounters,
        onConn: (c, desc, kind) => {
          setConnected(c);
          setTransportDesc(desc);
          setConnectedTransport(kind);
          if (!c) {
            setBusyRow(null);
            setBatchBusy(null);
            inflightRef.current = 0;
          }
        },
      });
    }
    return engineRef.current;
  }, [pushLog]);

  /** 解析 ID 文本；合法 2 字节时立刻写入全局配置 */
  const onProtoIdText = useCallback((s: string) => {
    setProtoIdText(s);
    try {
      const id = parseProtoIdHex(s);
      setProtoId(id);
      setProtoIdState(id);
    } catch {
      /* 输入未完成，保持上次合法 ID 用于组帧 */
    }
  }, []);

  /* ---------- 连接动作 ---------- */
  const connect = useCallback(async () => {
    const eng = getEngine();
    setConnecting(true);
    try {
      if (transportMode === "bluetooth") {
        await eng.connectBluetooth(bluetoothName);
        toast("ok", "蓝牙透传已连接 · 桥接 UART 115200bps");
      } else {
        await eng.connectSerial(baud);
        toast("ok", `串口已打开 @ ${baud}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "连接失败";
      const cancelled = msg.includes("No port selected") || msg.includes("NotFoundError");
      toast("err", cancelled ? (transportMode === "bluetooth" ? "未选择蓝牙设备" : "未选择串口设备") : msg);
      eng.sys(`连接失败：${msg}`, "err");
    } finally {
      setConnecting(false);
    }
  }, [getEngine, baud, toast, transportMode, bluetoothName]);

  const disconnect = useCallback(async () => {
    await getEngine().disconnect();
  }, [getEngine]);

  /* ---------- 芯片 Pack 安装 / 装载 ---------- */
  const resetPageRuntime = useCallback((next: PageDef[]) => {
    setPages(next);
    setActivePage(next[0]?.id ?? 0);
    setMem({});
    setReadKeys(new Set());
    setSetVals({});
    setChanged(null);
  }, []);

  const onInstallPack = useCallback(async (file: File) => {
    setInstalling(true);
    try {
      if (!file.name.endsWith(".CPack")) throw new Error("请选择 .CPack 文件（扩展名区分大小写）");
      const buf = await file.arrayBuffer();
      const pack = parseChipPack(buf);
      setInstalledPacks((previous) => {
        const next = [...previous.filter((item) => item.chip.id !== pack.chip.id), pack];
        persistInstalledPacks(next);
        return next;
      });
      setSelectedChipId(pack.chip.id);
      toast("ok", `已安装 ${pack.chip.model} v${pack.version}，请确认装载`);
    } catch (e) {
      toast("err", `Pack 安装失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setInstalling(false);
    }
  }, [toast]);

  const chipPacks = allChipPacks(installedPacks);
  const selectedChip = chipPacks.find((pack) => pack.chip.id === selectedChipId) ?? chipPacks[0];

  const confirmChip = useCallback(() => {
    if (connected) { toast("info", "请先断开串口后再切换芯片"); return; }
    if (!selectedChip) { toast("err", "未找到所选芯片 Pack"); return; }
    resetPageRuntime(selectedChip.pages);
    const protocolId = parseProtoIdHex(selectedChip.connection.protocolId);
    setProtoId(protocolId);
    setProtoIdState(protocolId);
    setProtoIdText(protoIdToHex(protocolId));
    setBaud(selectedChip.connection.baud);
    setActiveChip(selectedChip);
    setSelectedChipId(selectedChip.chip.id);
    persistSelectedChipId(selectedChip.chip.id);
    setAutoPoll(false);
    setTab("regs");
    toast("ok", `已装载芯片：${selectedChip.chip.model}`);
  }, [connected, resetPageRuntime, selectedChip, toast]);

  const onRemovePack = useCallback(() => {
    if (connected) { toast("info", "请先断开串口后再移除 CPack"); return; }
    if (!selectedChip || !installedPacks.some((pack) => pack.chip.id === selectedChip.chip.id)) {
      toast("info", "默认 CPack 不可移除");
      return;
    }
    setInstalledPacks((previous) => removeInstalledPack(previous, selectedChip.chip.id));
    setSelectedChipId("egmicro-chameleon");
    persistSelectedChipId("egmicro-chameleon");
    if (activeChip?.chip.id === selectedChip.chip.id) {
      setActiveChip(null);
      resetPageRuntime([]);
      setAutoPoll(false);
      setTab("chips");
    }
    toast("ok", `已移除 CPack：${selectedChip.chip.model}`);
  }, [activeChip, connected, installedPacks, resetPageRuntime, selectedChip, toast]);

  /* ---------- 内存镜像更新 ---------- */
  const applyRead = useCallback((pageId: number, offset: number, data: Uint8Array, keys: string[] | "all") => {
    const total = pageOf(pagesRef.current, pageId).totalLen;
    setMem((prev) => {
      const base = prev[pageId] ? prev[pageId]!.slice() : new Uint8Array(total);
      base.set(data.slice(0, Math.min(data.length, total - offset)), offset);
      return { ...prev, [pageId]: base };
    });
    setReadKeys((prev) => {
      const next = new Set(prev);
      if (keys === "all") {
        next.add(`${pageId}:all`);
        pageOf(pagesRef.current, pageId).regs.forEach((r) => next.add(regKey(pageId, r.offset)));
      } else keys.forEach((k) => next.add(k));
      return next;
    });
  }, []);

  const mark = useCallback((key: string, ok: boolean) => {
    setChanged({ key, ok, nonce: Date.now() });
  }, []);

  /* ---------- 寄存器读写 ---------- */
  const doReadReg = useCallback(async (pageId: number, reg: RegDef) => {
    const key = regKey(pageId, reg.offset);
    setBusyRow(key);
    inflightRef.current++;
    try {
      const f = await getEngine().request({
        cmd: CMD.READ, page: pageId, addr: reg.offset,
        data: Uint8Array.of(reg.len),
        note: `单次读 ${pageOf(pagesRef.current, pageId).name}.${reg.name} (${reg.len}B)`,
      });
      if (f.data.length < reg.len) throw new Error(`响应数据长度不足：期望 ${reg.len}B，收到 ${f.data.length}B`);
      applyRead(pageId, reg.offset, f.data.slice(0, reg.len), [key]);
      mark(key, true);
    } catch (e) {
      toast("err", `${reg.name} 读取失败：${e instanceof Error ? e.message : e}`);
      mark(key, false);
    } finally {
      inflightRef.current--;
      setBusyRow(null);
    }
  }, [getEngine, applyRead, mark, toast]);

  const doWriteReg = useCallback(async (pageId: number, reg: RegDef) => {
    const key = regKey(pageId, reg.offset);
    let text = (setVals[key] ?? "").trim();
    const pageMem = mem[pageId];
    // 未输入则沿用当前值（char/bytes 走字段显示，数值走同一套 fieldDisplay）
    if (!text && pageMem && (readKeys.has(key) || readKeys.has(`${pageId}:all`))) {
      text = fieldDisplay(pageMem, reg.dtype, reg.offset, reg.len, reg.scale);
    }
    if (!text && reg.dtype !== "char") { toast("info", `请先为 ${reg.name} 输入设定值`); return; }
    let bytes: Uint8Array;
    try { bytes = encodeField(text, reg.dtype, reg.len, reg.scale); }
    catch (e) { toast("err", e instanceof Error ? e.message : "设定值无效"); return; }
    setBusyRow(key);
    inflightRef.current++;
    try {
      const f = await getEngine().request({
        cmd: CMD.WRITE, page: pageId, addr: reg.offset, data: bytes,
        note: `单次写 ${pageOf(pagesRef.current, pageId).name}.${reg.name} (${toHex(bytes)})`,
      });
      const st = f.data[0] ?? 0xff;
      if (st === 0x00) {
        applyRead(pageId, reg.offset, bytes, [key]);
        mark(key, true);
        toast("ok", `${reg.name} 写入成功`);
      } else {
        const name = WRITE_STATUS[st] ?? "未知状态";
        getEngine().sys(`写失败 ${reg.name}：0x${h8(st)} ${name}`, "err");
        toast("err", `写失败：0x${h8(st)} ${name}`);
        mark(key, false);
      }
    } catch (e) {
      toast("err", `${reg.name} 写入失败：${e instanceof Error ? e.message : e}`);
      mark(key, false);
    } finally {
      inflightRef.current--;
      setBusyRow(null);
    }
  }, [getEngine, setVals, mem, readKeys, applyRead, mark, toast]);

  /* ---------- 批量读写 ---------- */
  const doBatchRead = useCallback(async (pageId: number, opts?: { poll?: boolean }) => {
    if (!activeChip) { toast("info", "请先在芯片选择页装载芯片"); return; }
    const page = pageOf(pagesRef.current, pageId);
    inflightRef.current++;
    if (!opts?.poll) setBatchBusy("read");
    try {
      const f = await getEngine().request({
        cmd: CMD.READ, page: pageId, addr: 0,
        data: Uint8Array.of(page.totalLen),
        note: opts?.poll ? `轮询批量读 ${page.name}` : `批量读 ${page.name} (ADDR=0, ${page.totalLen}B)`,
        poll: opts?.poll,
      });
      if (f.data.length < page.totalLen) throw new Error(`响应长度不足：期望 ${page.totalLen}B，收到 ${f.data.length}B`);
      applyRead(pageId, 0, f.data.slice(0, page.totalLen), "all");
      mark(`${pageId}:all`, true);
      if (opts?.poll) pollFailRef.current = 0;
      if (!opts?.poll) toast("ok", `${page.name} 批量读取完成（${page.totalLen}B）`);
    } catch (e) {
      mark(`${pageId}:all`, false);
      const msg = e instanceof Error ? e.message : String(e);
      if (!opts?.poll) {
        toast("err", `批量读取失败：${msg}`);
      } else {
        pollFailRef.current++;
        const n = pollFailRef.current;
        // 轮询失败不再每轮写 SYS（否则会刷屏）；连续 3 次后自动关闭
        if (n === 3) {
          setAutoPoll(false);
          getEngine().sys(
            `自动轮询已停止：连续 ${n} 次未收到 0xAD 读响应。${msg}`,
            "err",
          );
          toast("err", "连续收不到 0xAD，已关闭自动轮询。请检查接线、波特率、协议 ID");
        }
      }
    } finally {
      inflightRef.current--;
      if (!opts?.poll) setBatchBusy(null);
    }
  }, [activeChip, getEngine, applyRead, mark, toast, setAutoPoll]);

  const doBatchWrite = useCallback(async (pageId: number) => {
    if (!activeChip) { toast("info", "请先在芯片选择页装载芯片"); return; }
    const page = pageOf(pagesRef.current, pageId);
    if (!page.writable) { toast("info", `${page.name} 为只读页，批量写将被拒绝（0x03）`); }
    const pageMem = mem[pageId];
    const payload = new Uint8Array(page.totalLen);
    try {
      for (const r of page.regs) {
        if (r.access !== "W/R") continue; // 只读字段填 0
        const key = regKey(pageId, r.offset);
        const text = (setVals[key] ?? "").trim();
        if (text) {
          payload.set(encodeField(text, r.dtype, r.len, r.scale), r.offset);
        } else if (pageMem && (readKeys.has(key) || readKeys.has(`${pageId}:all`))) {
          payload.set(pageMem.slice(r.offset, r.offset + r.len), r.offset); // 沿用当前值
        }
      }
    } catch (e) {
      toast("err", e instanceof Error ? e.message : "设定值无效");
      return;
    }
    setBatchBusy("write");
    inflightRef.current++;
    try {
      const f = await getEngine().request({
        cmd: CMD.WRITE, page: pageId, addr: 0, data: payload,
        note: `批量写 ${page.name} (ADDR=0, ${page.totalLen}B)`,
      });
      const st = f.data[0] ?? 0xff;
      if (st === 0x00) {
        applyRead(pageId, 0, payload, "all");
        mark(`${pageId}:all`, true);
        toast("ok", `${page.name} 批量写入成功`);
      } else {
        const name = WRITE_STATUS[st] ?? "未知状态";
        getEngine().sys(`批量写失败：0x${h8(st)} ${name}`, "err");
        toast("err", `批量写失败：0x${h8(st)} ${name}`);
        mark(`${pageId}:all`, false);
      }
    } catch (e) {
      toast("err", `批量写失败：${e instanceof Error ? e.message : e}`);
      mark(`${pageId}:all`, false);
    } finally {
      inflightRef.current--;
      setBatchBusy(null);
    }
  }, [activeChip, getEngine, mem, setVals, readKeys, applyRead, mark, toast]);

  /* ---------- 帧构建发送 ---------- */
  const doSendCustom = useCallback(async (cmd: number, page: number, addr: number, data: Uint8Array) => {
    inflightRef.current++;
    try {
      const f = await getEngine().request({
        cmd, page, addr, data,
        note: `自定义帧 CMD 0x${h8(cmd)}`,
      });
      if (cmd === CMD.WRITE && f.len === 1) {
        const st = f.data[0];
        return st === 0x00
          ? { ok: true, msg: `写响应 0xA8 · 状态 0x00 写OK` }
          : { ok: false, msg: `写响应状态 0x${h8(st)} ${WRITE_STATUS[st] ?? "未知"}` };
      }
      return { ok: true, msg: `响应 CMD 0x${h8(f.cmd)} · LEN ${f.len} · DATA ${f.len ? toHex(f.data) : "(空)"}` };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : "发送失败" };
    } finally {
      inflightRef.current--;
    }
  }, [getEngine]);

  /** 帧解析器：原文 HEX 直发，用于错误帧/截断帧测试 */
  const doSendRaw = useCallback(async (raw: Uint8Array) => {
    inflightRef.current++;
    try {
      const f = await getEngine().sendRaw(raw, { note: `原始 HEX 直发 ${raw.length}B（不重组）` });
      return {
        ok: true,
        msg: `收到响应 CMD 0x${h8(f.cmd)} · PAGE 0x${h8(f.page)} ADDR 0x${h8(f.addr)} · LEN ${f.len}${f.len ? " · DATA " + toHex(f.data) : ""}${f.crcOk ? "" : " · CRC错误"}`,
      };
    } catch (e) {
      return { ok: false, msg: e instanceof Error ? e.message : "发送失败" };
    } finally {
      inflightRef.current--;
    }
  }, [getEngine]);

  /* OTA 独占串口时关闭自动轮询，避免与 YModem 抢字节 */
  useEffect(() => {
    if (otaBusy) setAutoPoll(false);
  }, [otaBusy]);

  /* ---------- 自动轮询当前选中页（等上次完成后再间隔 pollMs，避免超时日志重叠刷屏） ---------- */
  const pollFnRef = useRef<() => Promise<void>>(async () => {});
  pollFnRef.current = async () => {
    if (inflightRef.current > 0 || otaBusy) return; // 避免与手动操作 / OTA 重叠
    await doBatchRead(activePage, { poll: true });
  };
  useEffect(() => {
    if (!autoPoll || !connected || otaBusy) return;
    pollFailRef.current = 0;
    let cancelled = false;
    let timer = 0;
    const tick = async () => {
      if (cancelled) return;
      await pollFnRef.current();
      if (!cancelled) timer = window.setTimeout(() => void tick(), pollMs);
    };
    timer = window.setTimeout(() => void tick(), pollMs);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [autoPoll, connected, pollMs, otaBusy]);

  /* ---------- 日志 ---------- */
  const exportLog = useCallback(() => {
    const lines = logs.map((e) => {
      const t = new Date(e.ts).toLocaleTimeString("zh-CN", { hour12: false });
      const hex = e.raw ? toHex(e.raw) : "";
      return `[${t}] ${e.dir.toUpperCase().padEnd(3)} ${hex}${e.msg ? "  | " + e.msg : ""}`;
    });
    const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "chameleon-comm-log.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [logs]);

  const page = activeChip ? pageOf(pages, activePage) : null;
  const pageMem = mem[activePage] ?? null;

  return (
    <div className="relative flex h-screen flex-col overflow-hidden bg-ink font-sans text-zinc-200">
      <div className="bg-grid pointer-events-none absolute inset-0 z-0" />

      {/* ================= 头部 ================= */}
      <header className="relative z-20 flex h-14 shrink-0 items-center gap-3 border-b border-white/[0.08] bg-[#05080d]/85 px-4 backdrop-blur">
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent" />
        <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-cyan-400/25 to-cyan-400/5 text-cyan-300 shadow-[0_0_24px_-6px_rgba(34,211,238,0.6)] ring-1 ring-cyan-300/30">
          <Cpu size={17} />
        </div>
        <div>
          <h1 className="text-[14.5px] font-bold leading-tight tracking-tight text-white">
            EGmicro <span className="text-cyan-300">ChameleonComm</span>
            <span className="ml-2 rounded-md border border-white/10 bg-white/[0.04] px-1.5 py-0.5 align-middle text-[10px] font-medium text-zinc-400">上位机 · 用户调试版</span>
          </h1>
          <p className="hex-cell text-[10px] leading-tight text-zinc-500">
            EB90 · {protoIdToHex(protoId, "")} · CMD PAGE ADDR LEN DATA CRC16/XMODEM(LE) · BE09
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden items-center gap-1.5 rounded-lg border border-cyan-400/35 bg-cyan-400/[0.10] px-2.5 py-1 text-[11px] font-semibold text-cyan-100 shadow-[0_0_18px_-6px_rgba(34,211,238,0.55)] sm:flex">
            <Cpu size={12} className="text-cyan-300" />
            <span className="text-cyan-300/75">当前芯片</span>
            <span>{activeChip?.chip.model ?? "待选择芯片"}</span>
          </div>
          <Badge tone={connected ? "green" : "zinc"}>
            <span className={cn("size-1.5 rounded-full", connected ? "bg-emerald-400 animate-pulse-dot" : "bg-zinc-500")} />
            {connected ? "已连接" : "未连接"}
          </Badge>
          <Badge tone="cyan">{transportMode === "bluetooth" ? "Web Bluetooth · BLE" : "Web Serial · 免安装"}</Badge>
          <Badge>v1.1.0</Badge>
        </div>
      </header>

      {/* ================= 主体 ================= */}
      <div className="relative z-10 flex min-h-0 flex-1">
        {/* 左侧栏 */}
        <aside className="w-[336px] shrink-0 overflow-y-auto border-r border-white/[0.07] bg-[#070b11]/70">
          <SideBar
            connected={connected} connecting={connecting} transportDesc={transportDesc}
            baud={baud} onBaud={setBaud}
            onConnect={connect} onDisconnect={disconnect}
            serialSupported={SERIAL_SUPPORTED}
            bluetoothSupported={BLUETOOTH_SUPPORTED}
            transportMode={transportMode}
            onTransportMode={setTransportMode}
            bluetoothName={bluetoothName}
            onBluetoothName={setBluetoothName}
            otaBusy={otaBusy}
            pages={pages}
            activePage={activePage} onPage={setActivePage}
            chipReady={!!activeChip}
            onBatchRead={() => void doBatchRead(activePage)}
            onBatchWrite={() => void doBatchWrite(activePage)}
            batchBusy={batchBusy}
            autoPoll={autoPoll} onPoll={setAutoPoll}
            pollMs={pollMs} onPollMs={setPollMs}
            protoId={protoId} protoIdText={protoIdText} onProtoIdText={onProtoIdText}
          />
        </aside>

        {/* 右侧内容 */}
        <main className="flex min-w-0 flex-1 flex-col">
          <nav className="flex h-11 shrink-0 items-center gap-1 border-b border-white/[0.07] bg-[#070b11]/50 px-4">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  "flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-all",
                  tab === t.id
                    ? "bg-cyan-400/12 text-cyan-200 shadow-[inset_0_0_0_1px_rgba(34,211,238,0.3)]"
                    : "text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
            <ChevronRight size={12} className="ml-1 text-zinc-700" />
            <span className="hex-cell ml-1 text-[10.5px] text-zinc-600">
              {tab === "regs" && page && `${page.name} · PAGE 0x${h8(page.id)} · ${page.regs.length} regs · ${page.totalLen}B`}
              {tab === "chips" && "安装 CPack · 选择芯片 · 装载寄存器定义"}
              {tab === "builder" && "HEX 帧编辑与校验"}
              {tab === "ota" && (transportMode === "bluetooth" ? "蓝牙透传模式不支持 OTA" : otaBusy ? "YModem 传输中 · 已独占串口" : "固件文件 · 波特率协商 · YModem")}
              {tab === "docs" && "EGmicroChameleonComm 用户调试版"}
              {tab === "guide" && "选择芯片、连接、读写与异常帧测试"}
            </span>
          </nav>

          <div className="min-h-0 flex-1 overflow-y-auto p-5">
            {/* OTA 面板始终挂载，避免切走 Tab 时中断升级状态机 */}
            <div className={cn(tab !== "ota" && "hidden")}>
              <OtaPanel
                connected={connected && connectedTransport === "serial"}
                engine={getEngine()}
                uiBaud={baud}
                otaSupported={transportMode === "serial"}
                onBusy={setOtaBusy}
                toast={toast}
              />
            </div>
            <AnimatePresence mode="wait">
              {tab !== "ota" && (
              <motion.div
                key={tab}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              >
                {tab === "regs" && page && (
                  <div className="mx-auto max-w-6xl">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {pages.map((pg) => (
                        <Btn
                          key={pg.id}
                          variant="ghost"
                          className={cn("h-7", activePage === pg.id && "!border-cyan-400/40 !bg-cyan-400/10 !text-cyan-200")}
                          onClick={() => setActivePage(pg.id)}
                        >
                          {pg.name} <span className="hex-cell text-[10px] opacity-70">0x{h8(pg.id)}</span>
                        </Btn>
                      ))}
                      <span className="ml-auto text-[11px] text-zinc-600">
                        {page.cn} · {page.writable ? "可读写页 W/R" : "只读页 R"} · 页内存总长 {page.totalLen} 字节
                      </span>
                    </div>
                    <RegisterTable
                      page={page}
                      mem={pageMem}
                      readKeys={readKeys}
                      setVals={setVals}
                      onSetVal={(k, v) => setSetVals((prev) => ({ ...prev, [k]: v }))}
                      busyRow={busyRow}
                      changed={changed}
                      canComm={connected && !otaBusy}
                      onRead={(r) => void doReadReg(activePage, r)}
                      onWrite={(r) => void doWriteReg(activePage, r)}
                    />
                    <p className="mt-2.5 text-[11px] leading-relaxed text-zinc-600">
                      提示：单次读 DATA=[寄存器字节数]；单次写成功（状态 0x00）后才刷新当前值。批量读/写始终从
                      <span className="hex-cell text-zinc-400"> ADDR=0x00 </span>开始、长度为整页
                      <span className="hex-cell text-zinc-400"> {page.totalLen}B</span>，批量写时只读字段填充 0x00。
                      char 字段按 ASCII 显示（遇 0x00 截断），写入右侧补零；uint8[] 按 HEX 显示。
                    </p>
                  </div>
                )}
                {tab === "chips" && (
                  <ChipSelector
                    packs={chipPacks}
                    installedChipIds={new Set(installedPacks.map((pack) => pack.chip.id))}
                    selectedId={selectedChip?.chip.id ?? ""}
                    installing={installing}
                    connected={connected}
                    onSelectedId={setSelectedChipId}
                    onInstall={(file) => void onInstallPack(file)}
                    onRemove={onRemovePack}
                    onConfirm={confirmChip}
                  />
                )}
                {tab === "builder" && (
                  <div className="mx-auto max-w-6xl">
                    <FrameBuilder
                      canComm={connected && !otaBusy}
                      protoId={protoId}
                      protoIdText={protoIdText}
                      onProtoIdText={onProtoIdText}
                      onSend={doSendCustom}
                      onSendRaw={doSendRaw}
                    />
                  </div>
                )}
                {tab === "docs" && <ProtocolDocs protoId={protoId} />}
                {tab === "guide" && <UserGuide />}
              </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ================= 日志控制台 ================= */}
      <div className="relative z-10 h-[240px] shrink-0">
        <LogConsole
          entries={logs}
          paused={paused} onTogglePause={() => setPaused((v) => !v)}
          hidePoll={hidePoll} onToggleHidePoll={() => setHidePoll((v) => !v)}
          onClear={() => setLogs([])}
          onExport={exportLog}
        />
      </div>

      {/* ================= 状态栏 ================= */}
      <footer className="relative z-10 flex h-8 shrink-0 items-center gap-4 border-t border-white/[0.07] bg-[#060a10] px-4">
        <span className="hex-cell text-[10.5px] text-zinc-500">
          {connected ? transportDesc : "等待连接"}
          {connected && connectedTransport === "serial" && ` · ${baud}bps`}
          {otaBusy && " · OTA 升级中"}
        </span>
        <div className="hex-cell ml-auto flex items-center gap-4 text-[10.5px] text-zinc-500">
          <span>TX <b className="text-cyan-300/90">{counters.tx}</b>B</span>
          <span>RX <b className="text-amber-300/90">{counters.rx}</b>B</span>
          <span>完整帧 <b className="text-zinc-300">{counters.frames}</b></span>
          <span className={counters.crcErr > 0 ? "text-rose-400" : ""}>CRC错误 <b>{counters.crcErr}</b></span>
          <span className="text-zinc-700">|</span>
          <span>读 0x52→0xAD · 写 0x57→0xA8 · 升级 0x05→0xFA</span>
        </div>
      </footer>

      {/* ================= Toasts ================= */}
      <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-[340px] flex-col gap-2">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, x: 40, scale: 0.96 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.97 }}
              transition={{ type: "spring", stiffness: 420, damping: 30 }}
              className={cn(
                "pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-[12.5px] shadow-2xl backdrop-blur-md",
                t.type === "ok" && "border-emerald-400/30 bg-emerald-950/85 text-emerald-200",
                t.type === "err" && "border-rose-400/30 bg-rose-950/85 text-rose-200",
                t.type === "info" && "border-cyan-400/30 bg-cyan-950/85 text-cyan-200",
              )}
            >
              {t.type === "ok" && <CheckCircle2 size={15} className="mt-0.5 shrink-0" />}
              {t.type === "err" && <XCircle size={15} className="mt-0.5 shrink-0" />}
              {t.type === "info" && <Info size={15} className="mt-0.5 shrink-0" />}
              <span className="leading-snug">{t.msg}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
