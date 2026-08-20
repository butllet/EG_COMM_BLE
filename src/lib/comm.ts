import { CMD_NAME, FrameParser, h16, h8, parseFrame, respCmdOf, toHex, buildFrame } from "./protocol";
import type { ParsedFrame } from "./protocol";
import type { ITransport } from "./transport";
import { WebSerialTransport } from "./transport";

export type LogLevel = "info" | "ok" | "err";
export type LogDir = "tx" | "rx" | "sys";

export interface LogEntry {
  id: number;
  ts: number;
  dir: LogDir;
  raw?: Uint8Array;
  frame?: ParsedFrame;
  msg?: string;
  level?: LogLevel;
  poll?: boolean;
}

export interface Counters {
  tx: number;   // 发送字节
  rx: number;   // 接收字节
  frames: number; // 完成帧数
  crcErr: number; // CRC 错误帧数
}

interface EngineEvents {
  onLog: (e: LogEntry) => void;
  onCounters: (c: Counters) => void;
  onConn: (connected: boolean, desc: string) => void;
}

type MatchResult = "hit" | "fail" | null;

interface Waiter {
  match: (f: ParsedFrame) => MatchResult;
  resolve: (f: ParsedFrame) => void;
  reject: (e: Error) => void;
  timer: number;
}

/**
 * 通信引擎：帧收发 / 响应等待 / 日志
 * 判定标准（协议 §8）：
 *  读：CMD=0xAD 且 PAGE/ADDR 匹配 且 CRC 正确
 *  写：CMD=0xA8 且 LEN=1 且 DATA[0]=0x00 且 CRC 正确
 */
export class CommEngine {
  private transport: ITransport | null = null;
  private parser = new FrameParser();
  private waiters: Waiter[] = [];
  private logId = 1;
  private counters: Counters = { tx: 0, rx: 0, frames: 0, crcErr: 0 };
  /** 当前等待响应期间收到的原始字节（截断保存，供超时对照抓包） */
  private waitRx: number[] = [];
  /** OTA 独占串口：RX 不再进 FrameParser，改入 otaBuf 供 YModem/裸 ACK 读取 */
  private otaMode = false;
  private otaBuf: number[] = [];

  constructor(private ev: EngineEvents) {}

  get connected() {
    return this.transport !== null;
  }

  get isOtaMode() {
    return this.otaMode;
  }

  async connectSerial(baud: number): Promise<void> {
    const t = new WebSerialTransport(baud);
    await this.attach(t);
  }

  private async attach(t: ITransport): Promise<void> {
    t.onData = (d) => this.handleRx(d);
    await t.open();
    this.transport = t;
    this.parser.reset();
    this.ev.onConn(true, t.describe());
    this.sys(`${t.name} 已连接 · ${t.describe()}`, "ok");
  }

  async disconnect(): Promise<void> {
    this.setOtaMode(false);
    const t = this.transport;
    this.transport = null;
    if (t) {
      try { await t.close(); } catch { /* noop */ }
    }
    this.rejectAll(new Error("连接已断开"));
    this.ev.onConn(false, "");
    this.sys("连接已断开", "info");
  }

  /**
   * 进入/退出 OTA：暂停常规帧解析，避免 YModem 裸字节被当成 EB90 噪声丢掉。
   */
  setOtaMode(enabled: boolean) {
    this.otaMode = enabled;
    this.otaBuf = [];
    this.parser.reset();
    if (enabled) this.rejectAll(new Error("已进入 OTA 升级，常规收发已暂停"));
  }

  /** OTA 直写（升级请求帧、裸波特率、YModem 块） */
  async otaWrite(data: Uint8Array): Promise<void> {
    if (!this.transport) throw new Error("尚未连接设备");
    this.counters.tx += data.length;
    this.ev.onCounters({ ...this.counters });
    await this.transport.send(data);
  }

  /**
   * 从 OTA 接收缓冲取字节。size=0 表示取走当前全部；不足时返回已有部分（非阻塞）。
   */
  otaRead(size: number): Uint8Array {
    if (size === 0) {
      const all = Uint8Array.from(this.otaBuf);
      this.otaBuf = [];
      return all;
    }
    const n = Math.min(size, this.otaBuf.length);
    if (n <= 0) return new Uint8Array(0);
    const out = Uint8Array.from(this.otaBuf.slice(0, n));
    this.otaBuf = this.otaBuf.slice(n);
    return out;
  }

  getBaud(): number {
    return this.transport?.getBaud() ?? 0;
  }

  /** 改波特率后清空 OTA 缓冲，丢掉切波特瞬间的错码 */
  async changeBaud(baud: number): Promise<void> {
    if (!this.transport) throw new Error("尚未连接设备");
    if (this.transport.getBaud() === baud) return;
    this.otaBuf = [];
    this.parser.reset();
    await this.transport.changeBaud(baud);
    this.otaBuf = [];
    this.parser.reset();
    this.sys(`串口波特率已切换为 ${baud}`, "info");
  }

  private handleRx(d: Uint8Array) {
    this.counters.rx += d.length;
    this.ev.onCounters({ ...this.counters });
    if (this.otaMode) {
      for (const b of d) this.otaBuf.push(b);
      return;
    }
    if (this.waiters.length > 0) {
      for (let i = 0; i < d.length && this.waitRx.length < 48; i++) this.waitRx.push(d[i]);
    }
    const frames = this.parser.push(d);
    if (frames.length > 0) {
      this.counters.frames += frames.length;
      this.counters.crcErr += frames.filter((f) => !f.crcOk).length;
    }
    this.ev.onCounters({ ...this.counters });
    for (const f of frames) {
      this.logRx(f);
      this.dispatch(f);
    }
  }

  private logRx(f: ParsedFrame) {
    const cmdName = CMD_NAME[f.cmd] ?? "未知命令字";
    let msg = `${cmdName} · PAGE 0x${h8(f.page)} ADDR 0x${h8(f.addr)} · ${f.len}B`;
    let level: LogLevel = "ok";
    if (!f.idOk) { msg += " · 协议ID不符"; level = "err"; }
    if (!f.crcOk) { msg += ` · CRC错误(收 0x${h16(f.crcRecv)} / 算 0x${h16(f.crcCalc)})`; level = "err"; }
    if (!f.tailOk) { msg += " · 尾帧错误"; level = "err"; }
    this.ev.onLog({ id: this.logId++, ts: Date.now(), dir: "rx", raw: f.raw, frame: f, msg, level });
  }

  sys(msg: string, level: LogLevel = "info", poll = false) {
    this.ev.onLog({ id: this.logId++, ts: Date.now(), dir: "sys", msg, level, poll });
  }

  private dispatch(f: ParsedFrame) {
    for (const w of [...this.waiters]) {
      const r = w.match(f);
      if (r === null) continue;
      window.clearTimeout(w.timer);
      this.waiters = this.waiters.filter((x) => x !== w);
      if (r === "hit") w.resolve(f);
      else w.reject(new Error(`响应命令字错误 CMD=0x${h8(f.cmd)}`));
    }
  }

  private rejectAll(e: Error) {
    for (const w of this.waiters) {
      window.clearTimeout(w.timer);
      w.reject(e);
    }
    this.waiters = [];
  }

  /** 开始等待响应：清空本轮收包快照 */
  private beginWait() {
    this.waitRx = [];
  }

  /**
   * 等待超时：清空半包残留，避免污染下一轮；附带已收 HEX 便于对照外部抓包。
   */
  private failWait(base: string, rxAtSend: number, framesAtSend: number): Error {
    const rxDelta = this.counters.rx - rxAtSend;
    const frameDelta = this.counters.frames - framesAtSend;
    const snapBytes = this.waitRx.slice();
    const leftover = this.parser.peek();
    // 没有其他等待器时才清缓冲，避免并发等待被误伤
    if (this.waiters.length === 0) {
      this.parser.reset();
      this.waitRx = [];
    }
    let hint = base;
    if (rxDelta === 0) {
      hint += "：期间串口无任何回包（检查接线、波特率，或设备是否识别 EB90/当前协议ID）";
    } else if (frameDelta === 0) {
      hint += `：收到 ${rxDelta}B 原始数据，但未能解析出完整 EB90 帧`;
      if (snapBytes.length > 0) hint += ` · 收包前 ${snapBytes.length}B ${toHex(snapBytes)}`;
    } else {
      hint += `：收到 ${frameDelta} 帧，但没有匹配的响应`;
    }
    if (leftover.length > 0 && frameDelta === 0) {
      hint += ` · 解析残留 ${leftover.length}B`;
    }
    return new Error(hint);
  }

  /**
   * 发送一帧并等待匹配的响应帧。
   * 默认匹配：CMD = ~cmd，PAGE/ADDR 一致，CRC 正确。
   * 收到同 PAGE/ADDR 但 CMD 非期望值的帧 → 立即判定失败（协议 §4）。
   */
  request(opts: {
    cmd: number;
    page: number;
    addr: number;
    data?: Uint8Array;
    timeout?: number;
    note?: string;
    poll?: boolean;
    expectDataLen?: number;
  }): Promise<ParsedFrame> {
    if (!this.transport) return Promise.reject(new Error("尚未连接设备"));
    if (this.otaMode) return Promise.reject(new Error("OTA 升级进行中，请等待结束"));
    const { cmd, page, addr } = opts;
    const data = opts.data ?? new Uint8Array(0);
    const timeout = opts.timeout ?? 1000;
    const expect = respCmdOf(cmd);

    const frame = buildFrame(cmd, page, addr, data);
    const parsed = parseFrame(frame);
    this.counters.tx += frame.length;
    this.ev.onCounters({ ...this.counters });
    this.ev.onLog({
      id: this.logId++, ts: Date.now(), dir: "tx", raw: frame, frame: parsed,
      msg: opts.note ?? `${CMD_NAME[cmd] ?? "自定义命令"} · PAGE 0x${h8(page)} ADDR 0x${h8(addr)}`,
      level: "info", poll: opts.poll,
    });

    this.beginWait();
    const rxAtSend = this.counters.rx;
    const framesAtSend = this.counters.frames;
    const promise = new Promise<ParsedFrame>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== waiter);
        reject(this.failWait(`等待 0x${h8(expect)} 响应超时 (${timeout}ms)`, rxAtSend, framesAtSend));
      }, timeout);

      const waiter: Waiter = {
        timer, resolve, reject,
        match: (f) => {
          if (!f.crcOk) return null; // CRC 错误帧直接忽略（视为无效响应）
          const sameField = f.page === page && f.addr === addr;
          if (f.cmd === expect && sameField) return "hit";
          if (sameField && f.cmd !== cmd && f.cmd !== expect) return "fail"; // 明确错误响应 → 快速失败
          return null;
        },
      };
      this.waiters.push(waiter);
    });

    return this.transport.send(frame).then(
      () => promise,
      (err) => {
        this.rejectAll(new Error("发送失败"));
        throw err instanceof Error ? err : new Error("发送失败");
      },
    );
  }

  /**
   * 按原始字节直发，不经过 buildFrame（不重算 CRC、不补 HEAD/TAIL）。
   * 用于帧解析器发送错误帧，观察对端是否丢弃或回错误响应。
   * 等待期间任意完整帧都算作“收到响应”。
   */
  sendRaw(raw: Uint8Array, opts?: { timeout?: number; note?: string }): Promise<ParsedFrame> {
    if (!this.transport) return Promise.reject(new Error("尚未连接设备"));
    if (this.otaMode) return Promise.reject(new Error("OTA 升级进行中，请等待结束"));
    if (raw.length === 0) return Promise.reject(new Error("发送数据为空"));
    const timeout = opts?.timeout ?? 1000;

    let parsed: ParsedFrame | undefined;
    if (raw.length >= 8) {
      try { parsed = parseFrame(raw); } catch { /* 非法帧仍原样发送 */ }
    }

    this.counters.tx += raw.length;
    this.ev.onCounters({ ...this.counters });
    this.ev.onLog({
      id: this.logId++, ts: Date.now(), dir: "tx", raw, frame: parsed,
      msg: opts?.note ?? `原始 HEX 直发 ${raw.length}B（不重组）`,
      level: "info",
    });

    this.beginWait();
    const rxAtSend = this.counters.rx;
    const framesAtSend = this.counters.frames;
    const promise = new Promise<ParsedFrame>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== waiter);
        reject(this.failWait(`等待响应超时 (${timeout}ms)`, rxAtSend, framesAtSend));
      }, timeout);

      const sent = raw.slice();
      const waiter: Waiter = {
        timer, resolve, reject,
        // 异常帧测试：任意完整帧都视为对端有反应；忽略与发送内容完全相同的回显
        match: (f) => {
          if (f.raw.length === sent.length) {
            let same = true;
            for (let i = 0; i < sent.length; i++) {
              if (f.raw[i] !== sent[i]) { same = false; break; }
            }
            if (same) return null;
          }
          return "hit";
        },
      };
      this.waiters.push(waiter);
    });

    return this.transport.send(raw).then(
      () => promise,
      (err) => {
        this.rejectAll(new Error("发送失败"));
        throw err instanceof Error ? err : new Error("发送失败");
      },
    );
  }

  /** 数据区转 hex（供日志展示） */
  static hexOf(f: ParsedFrame): string {
    return toHex(f.raw);
  }
}
