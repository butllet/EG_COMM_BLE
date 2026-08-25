import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, FolderOpen, Loader2, Rocket, Terminal, TriangleAlert } from "lucide-react";
import type { CommEngine } from "../lib/comm";
import { BOOT_MENU_APP, BOOT_MENU_BOT, OtaSession, type OtaFirmware } from "../lib/ota";
import { Badge, Btn, Card, INPUT_CLS } from "./ui";
import { cn } from "../utils/cn";

export interface OtaPanelProps {
  connected: boolean;
  engine: CommEngine;
  /** 侧栏当前选择的波特率，升级结束后恢复到此值 */
  uiBaud: number;
  /** Web Bluetooth 透明桥接不支持 OTA 的裸波特率切换与 YModem 流程。 */
  otaSupported: boolean;
  onBusy: (busy: boolean) => void;
  toast: (type: "ok" | "err" | "info", msg: string) => void;
}

interface LogLine {
  id: number;
  ts: string;
  text: string;
}

function nowTime(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function OtaPanel(p: OtaPanelProps) {
  const [file, setFile] = useState<OtaFirmware | null>(null);
  const [pathLabel, setPathLabel] = useState("");
  const [speed, setSpeed] = useState<9600 | 115200>(115200);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [running, setRunning] = useState(false);
  const [confirmText, setConfirmText] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const sessionRef = useRef<OtaSession | null>(null);
  const confirmResolver = useRef<((v: boolean) => void) | null>(null);
  const logId = useRef(1);
  const logBoxRef = useRef<HTMLDivElement>(null);

  const appendLog = useCallback((text: string) => {
    setLogs((prev) => {
      const next = [...prev, { id: logId.current++, ts: nowTime(), text }];
      return next.length > 400 ? next.slice(next.length - 400) : next;
    });
  }, []);

  useEffect(() => {
    const el = logBoxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);

  const cleanupSession = useCallback(async (restore: boolean, abortYmodem = false) => {
    const s = sessionRef.current;
    sessionRef.current = null;
    if (!s) return;
    if (s.isRunning()) await s.stop({ restore, abortYmodem });
    p.engine.setOtaMode(false);
    setRunning(false);
    p.onBusy(false);
    if (confirmResolver.current) {
      confirmResolver.current(false);
      confirmResolver.current = null;
    }
    setConfirmText(null);
  }, [p.engine, p.onBusy]);

  /* 串口断开时立刻停状态机，不要再改波特率 */
  useEffect(() => {
    if (!p.connected && (running || sessionRef.current)) {
      void cleanupSession(false);
    }
  }, [p.connected, running, cleanupSession]);

  /* 页面卸载时停状态机（Tab 切换不会卸载本面板） */
  useEffect(() => () => { void cleanupSession(false); }, [cleanupSession]);

  const onPickFile = useCallback(async (f: File) => {
    if (!f.name.toLowerCase().endsWith(".bin")) {
      p.toast("err", "请选择 .bin 固件文件。");
      return;
    }
    const buf = new Uint8Array(await f.arrayBuffer());
    if (buf.length === 0) {
      p.toast("err", "文件内容为空。");
      return;
    }
    setFile({ name: f.name, size: buf.length, bin: buf });
    setPathLabel(f.name);
    appendLog(`已选择固件: ${f.name} (${buf.length} Byte)`);
  }, [appendLog, p]);

  const onDownload = useCallback(() => {
    if (!p.otaSupported) {
      p.toast("info", "蓝牙透传模式暂不支持 OTA，请断开后切换到串口。");
      return;
    }
    if (!p.connected) {
      p.toast("err", "请先打开指定的串口。");
      return;
    }
    if (!file) {
      p.toast("err", "请先选择固件文件。");
      return;
    }
    if (sessionRef.current?.isRunning()) {
      p.toast("info", "OTA 升级正在进行中，请等待当前流程结束。");
      return;
    }

    setLogs([]);
    setProgress(0);
    p.onBusy(true);
    setRunning(true);
    p.engine.setOtaMode(true);
    p.engine.sys("OTA 升级开始：已暂停常规帧解析与轮询", "info");

    const session = new OtaSession(
      {
        write: (d) => p.engine.otaWrite(d),
        read: (n) => p.engine.otaRead(n),
        changeBaud: (b) => p.engine.changeBaud(b),
        currentBaud: () => p.engine.getBaud(),
      },
      {
        log: (msg) => appendLog(msg),
        onProgress: setProgress,
        onConfirm: (fromApp) => {
          setConfirmText(fromApp ? BOOT_MENU_APP : BOOT_MENU_BOT);
          return new Promise<boolean>((resolve) => {
            confirmResolver.current = resolve;
          });
        },
        onFinished: (ok, message) => {
          sessionRef.current = null;
          p.engine.setOtaMode(false);
          setRunning(false);
          p.onBusy(false);
          setConfirmText(null);
          confirmResolver.current = null;
          p.engine.sys(`[OTA] ${message}`, ok ? "ok" : "err");
          p.toast(ok ? "ok" : "err", message);
        },
      },
      file,
      speed,
      p.uiBaud,
    );
    sessionRef.current = session;
    session.start();
  }, [appendLog, file, p, speed]);

  const onCancel = useCallback(() => {
    if (!sessionRef.current?.isRunning()) return;
    appendLog("用户点击取消升级");
    void cleanupSession(true, true);
    p.engine.sys("[OTA] 用户取消升级", "info");
    p.toast("info", "已取消升级");
  }, [appendLog, cleanupSession, p]);

  const answerConfirm = (ok: boolean) => {
    confirmResolver.current?.(ok);
    confirmResolver.current = null;
    setConfirmText(null);
  };

  if (!p.otaSupported && !running) {
    return (
      <div className="relative mx-auto max-w-5xl space-y-4 pb-2">
        <Card title="OTA 升级" icon={<Rocket size={13} />}>
          <div className="flex items-start gap-3 rounded-xl border border-amber-400/25 bg-amber-400/[0.07] p-4 text-[12px] leading-relaxed text-amber-100/85">
            <TriangleAlert size={17} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              <p className="font-semibold text-amber-200">蓝牙透传模式暂不支持 OTA</p>
              <p className="mt-1">OTA 需要切换串口波特率并执行 YModem 裸字节传输；CH572 的 Web Bluetooth 透明桥接首版仅支持寄存器与协议帧通信。请断开蓝牙后切换至“串口”模式。</p>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="relative mx-auto max-w-5xl space-y-4 pb-2">
      <Card
        title="文件发送"
        icon={<Rocket size={13} />}
        right={
          running
            ? <Badge tone="amber">升级进行中 · 已独占串口</Badge>
            : <Badge>CMD 0x05 → 0xFA · YModem</Badge>
        }
      >
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-right text-[12px] text-zinc-500">文件路径</span>
            <input
              readOnly
              value={pathLabel}
              placeholder="请选择 .bin 固件"
              className={cn(INPUT_CLS, "min-w-0 flex-1")}
            />
            <input
              ref={fileRef}
              type="file"
              accept=".bin"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void onPickFile(f);
              }}
            />
            <Btn className="w-[100px]" disabled={running} onClick={() => fileRef.current?.click()}>
              <FolderOpen size={13} /> 浏览
            </Btn>
            <Btn
              variant="primary"
              className="w-[100px]"
              disabled={!p.connected || !file || running}
              onClick={onDownload}
            >
              {running ? <Loader2 size={13} className="animate-spin" /> : <FileUp size={13} />}
              下载
            </Btn>
            {running && (
              <Btn variant="danger" onClick={onCancel}>取消升级</Btn>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 shrink-0 text-right text-[12px] text-zinc-500">传输进度</span>
            <div className="relative min-w-0 flex-1">
              <div className="h-7 overflow-hidden rounded-lg border border-white/10 bg-black/40">
                <div
                  className="h-full bg-gradient-to-r from-cyan-500/80 to-cyan-300/70 transition-[width] duration-150"
                  style={{ width: `${Math.min(100, progress)}%` }}
                />
              </div>
              <span className="hex-cell pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-zinc-200">
                {progress}%
              </span>
            </div>
            <div className="flex w-[210px] items-center justify-center gap-4 text-[12.5px] text-zinc-300">
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="ota-speed"
                  checked={speed === 9600}
                  disabled={running}
                  onChange={() => setSpeed(9600)}
                  className="accent-cyan-400"
                />
                低速 9600
              </label>
              <label className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="ota-speed"
                  checked={speed === 115200}
                  disabled={running}
                  onChange={() => setSpeed(115200)}
                  className="accent-cyan-400"
                />
                高速 115200
              </label>
            </div>
          </div>
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-zinc-600">
          流程与桌面版一致：先发 <span className="hex-cell text-zinc-400">CMD=0x05 DATA=ROMUPGRADE</span>，
          再以 9600 发送 4 字节裸波特率，MCU 回 <span className="hex-cell text-zinc-400">ACK=0x06</span> 后切到所选速率，
          确认菜单后走 YModem。升级期间请勿读写寄存器或改协议 ID。
        </p>
      </Card>

      <Card title="控制台" icon={<Terminal size={13} />} bodyClassName="p-0">
        <div
          ref={logBoxRef}
          className="h-[360px] overflow-y-auto bg-black/25 px-3 py-2 font-mono text-[12px] leading-relaxed text-zinc-300"
        >
          {logs.length === 0 ? (
            <p className="text-zinc-600">选择固件并点击「下载」后，此处显示升级步骤日志。</p>
          ) : logs.map((l) => (
            <div key={l.id} className="whitespace-pre-wrap">
              <span className="text-zinc-600">{l.ts}  </span>
              {l.text}
            </div>
          ))}
        </div>
      </Card>

      {confirmText && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
          <div className="w-full max-w-[760px] rounded-2xl border border-white/10 bg-[#0b1220] p-4 shadow-2xl">
            <p className="mb-2 text-[13px] font-semibold text-zinc-200">BootLoader 确认</p>
            <pre className="overflow-x-auto rounded-xl border border-white/[0.08] bg-black/40 p-3 font-mono text-[11px] leading-[1.45] text-zinc-300">
              {confirmText}
            </pre>
            <div className="mt-3 flex justify-end gap-2">
              <Btn onClick={() => answerConfirm(false)}>取消</Btn>
              <Btn variant="primary" onClick={() => answerConfirm(true)}>确定</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
