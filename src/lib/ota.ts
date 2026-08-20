/**
 * Comm 协议 OTA 升级：沿用 app_main/ota_upgrade.py 的 YModem 状态机。
 * 升级请求走 EB90 帧（CMD=0x05），波特率协商与 YModem 为裸字节，必须独占串口。
 */

import { buildFrame, FrameParser, toHex, type ParsedFrame } from "./protocol";

/* ---------------- 协议常量（与 Python 上位机一致） ---------------- */

export const UPGRADE_CMD = 0x05;
export const UPGRADE_RESP_CMD = 0xfa;

/** BootLoader 状态字：响应 DATA 前两字节，大端 */
export const OTA_STATUS = {
  ENTER_BOOT_OK: 0xf000,
  BOOT_READY: 0xf010,
  WAIT_C: 0xf121,
  WAIT_SEND: 0xf232,
  PROGRAM_OK: 0xf343,
  TOO_LARGE: 0xf354,
  CRC_ERROR: 0xf365,
  USER_STOP: 0xf376,
  SEND_FAILED: 0xf387,
} as const;

export const OTA_STATUS_TEXT: Record<number, string> = {
  [OTA_STATUS.ENTER_BOOT_OK]: "F000 从 APP 进入 BootLoader 成功",
  [OTA_STATUS.BOOT_READY]: "F010 BootLoader 就绪",
  [OTA_STATUS.WAIT_C]: "F121 确认字符 C 无效",
  [OTA_STATUS.WAIT_SEND]: "F232 等待发送数据",
  [OTA_STATUS.PROGRAM_OK]: "F343 烧写成功",
  [OTA_STATUS.TOO_LARGE]: "F354 固件过大",
  [OTA_STATUS.CRC_ERROR]: "F365 CRC 错误",
  [OTA_STATUS.SEND_FAILED]: "F387 发送失败",
  [OTA_STATUS.USER_STOP]: "F376 用户取消",
};

/** 波特率协商阶段：MCU 回 1 字节裸 ACK */
export const RAW_ACK = 0x06;

export const YMODEM_PACKET_SIZE = 128;
export const YMODEM_PACKET_1K_SIZE = 1024;
const PACKET_HEADER_SIZE = 3;
const PACKET_TRAILER_SIZE = 2;
const PACKET_OVERHEAD = PACKET_HEADER_SIZE + PACKET_TRAILER_SIZE;
const CODE_CAN_NUMBER = 5;
const DATA_PAD = 0x1a;

/** 10ms 节拍下的超时计数：100 × 10ms = 1s */
const TIME_OUT_1000MS = 200;

/** YModem CCITT-0 查表（与 Python YMODEM_CRC_TABLE 一致） */
const YMODEM_CRC_TABLE = [
  0x0000, 0x1021, 0x2042, 0x3063, 0x4084, 0x50a5, 0x60c6, 0x70e7,
  0x8108, 0x9129, 0xa14a, 0xb16b, 0xc18c, 0xd1ad, 0xe1ce, 0xf1ef,
  0x1231, 0x0210, 0x3273, 0x2252, 0x52b5, 0x4294, 0x72f7, 0x62d6,
  0x9339, 0x8318, 0xb37b, 0xa35a, 0xd3bd, 0xc39c, 0xf3ff, 0xe3de,
  0x2462, 0x3443, 0x0420, 0x1401, 0x64e6, 0x74c7, 0x44a4, 0x5485,
  0xa56a, 0xb54b, 0x8528, 0x9509, 0xe5ee, 0xf5cf, 0xc5ac, 0xd58d,
  0x3653, 0x2672, 0x1611, 0x0630, 0x76d7, 0x66f6, 0x5695, 0x46b4,
  0xb75b, 0xa77a, 0x9719, 0x8738, 0xf7df, 0xe7fe, 0xd79d, 0xc7bc,
  0x48c4, 0x58e5, 0x6886, 0x78a7, 0x0840, 0x1861, 0x2802, 0x3823,
  0xc9cc, 0xd9ed, 0xe98e, 0xf9af, 0x8948, 0x9969, 0xa90a, 0xb92b,
  0x5af5, 0x4ad4, 0x7ab7, 0x6a96, 0x1a71, 0x0a50, 0x3a33, 0x2a12,
  0xdbfd, 0xcbdc, 0xfbbf, 0xeb9e, 0x9b79, 0x8b58, 0xbb3b, 0xab1a,
  0x6ca6, 0x7c87, 0x4ce4, 0x5cc5, 0x2c22, 0x3c03, 0x0c60, 0x1c41,
  0xedae, 0xfd8f, 0xcdec, 0xddcd, 0xad2a, 0xbd0b, 0x8d68, 0x9d49,
  0x7e97, 0x6eb6, 0x5ed5, 0x4ef4, 0x3e13, 0x2e32, 0x1e51, 0x0e70,
  0xff9f, 0xefbe, 0xdfdd, 0xcffc, 0xbf1b, 0xaf3a, 0x9f59, 0x8f78,
  0x9188, 0x81a9, 0xb1ca, 0xa1eb, 0xd10c, 0xc12d, 0xf14e, 0xe16f,
  0x1080, 0x00a1, 0x30c2, 0x20e3, 0x5004, 0x4025, 0x7046, 0x6067,
  0x83b9, 0x9398, 0xa3fb, 0xb3da, 0xc33d, 0xd31c, 0xe37f, 0xf35e,
  0x02b1, 0x1290, 0x22f3, 0x32d2, 0x4235, 0x5214, 0x6277, 0x7256,
  0xb5ea, 0xa5cb, 0x95a8, 0x8589, 0xf56e, 0xe54f, 0xd52c, 0xc50d,
  0x34e2, 0x24c3, 0x14a0, 0x0481, 0x7466, 0x6447, 0x5424, 0x4405,
  0xa7db, 0xb7fa, 0x8799, 0x97b8, 0xe75f, 0xf77e, 0xc71d, 0xd73c,
  0x26d3, 0x36f2, 0x0691, 0x16b0, 0x6657, 0x7676, 0x4615, 0x5634,
  0xd94c, 0xc96d, 0xf90e, 0xe92f, 0x99c8, 0x89e9, 0xb98a, 0xa9ab,
  0x5844, 0x4865, 0x7806, 0x6827, 0x18c0, 0x08e1, 0x3882, 0x28a3,
  0xcb7d, 0xdb5c, 0xeb3f, 0xfb1e, 0x8bf9, 0x9bd8, 0xabbb, 0xbb9a,
  0x4a75, 0x5a54, 0x6a37, 0x7a16, 0x0af1, 0x1ad0, 0x2ab3, 0x3a92,
  0xfd2e, 0xed0f, 0xdd6c, 0xcd4d, 0xbdaa, 0xad8b, 0x9de8, 0x8dc9,
  0x7c26, 0x6c07, 0x5c64, 0x4c45, 0x3ca2, 0x2c83, 0x1ce0, 0x0cc1,
  0xef1f, 0xff3e, 0xcf5d, 0xdf7c, 0xaf9b, 0xbfba, 0x8fd9, 0x9ff8,
  0x6e17, 0x7e36, 0x4e55, 0x5e74, 0x2e93, 0x3eb2, 0x0ed1, 0x1ef0,
];

/** 控制码 / 状态机返回值（数值与 Python Code 枚举对应） */
export const Code = {
  None: 0x00,
  Soh: 0x01,
  Stx: 0x02,
  Eot: 0x04,
  Ack: 0x06,
  Nak: 0x15,
  Can: 0x18,
  C: 0x43,
  A1: 0x41,
  A2: 0x61,
  Confirm: 0x31, // ASCII '1'
  Cancel: 0x33, // ASCII '3'
  EnterBootLoad: 0xf010,
  WaitC: 0xf121,
  WaitSend: 0xf232,
  ProgramSuccess: 0xf343,
  TooLarge: 0xf354,
  CrcError: 0xf365,
  UserStop: 0xf376,
  SendFailed: 0xf387,
  BaudLow: 9600,
  BaudHigh: 115200,
} as const;

/** 阶段编号必须与 Python 一致：Established + data_count 会跳到 Transmitting/Finishing */
export const Stage = {
  None: 0x00,
  WaitUpgradeAck: 0x01,
  PrepareIAP: 0x02,
  WaitLogMsg1: 0x03,
  WaitAPPConfirm: 0x04,
  YMODEMEstablishing: 0x05,
  YMODEMEstablished: 0x06,
  YMODEMTransmitting: 0x07,
  YMODEMFinishing: 0x08,
  YMODEMFinished: 0x09,
  WaitDownLoadFinished: 0x0a,
  ChangeingBaud: 0x0b,
  ChangedBaud: 0x0c,
  WaitSendReady: 0x0d,
} as const;

export const Status = {
  None: 0x00,
  PrepareIAP: 0x02,
  WaitConfirm: 0x04,
  YMODEMEEstablish: 0x05,
  YMODEMETransmit: 0x06,
  YMODEMEFinishing: 0x07,
  YMODEMEFinish: 0x08,
  YMODEMEAbort: 0x0a,
  Timeout: 0x0b,
  Error: 0x0c,
  APPEnterBootLoad: 0x0d,
  BootLoadToBootLoad: 0x0e,
  ProgramSuccess: 0x0f,
  ProgramFailed: 0x10,
  ChangeingBaud: 0x11,
  UserStop: 0x12,
  UpgradeAck: 0x13,
  BootLoaderNoAck: 0x14,
  WaitSendReady: 0x15,
  WaitSendTimeout: 0x16,
} as const;

/* ---------------- 工具 ---------------- */

function concat(...parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/** YModem CRC-CCITT-0，高字节在前 */
export function calcYmodemCrc(data: Uint8Array, crc = 0): number {
  let c = crc & 0xffff;
  for (let i = 0; i < data.length; i++) {
    const idx = ((c >> 8) ^ data[i]) & 0xff;
    c = ((c << 8) ^ YMODEM_CRC_TABLE[idx]) & 0xffff;
  }
  return c;
}

function makeDataChecksum(data: Uint8Array): Uint8Array {
  const crc = calcYmodemCrc(data);
  return Uint8Array.of((crc >> 8) & 0xff, crc & 0xff);
}

function makeEdgePacketHeader(packetSize = 128): Uint8Array {
  if (packetSize === 128) return Uint8Array.of(Code.Soh, 0x00, 0xff);
  if (packetSize === 1024) return Uint8Array.of(Code.Stx, 0x00, 0xff);
  return new Uint8Array(0);
}

function makeDataPacketHeader(packetSize: number, sequence: number): Uint8Array {
  const soh = packetSize === 1024 ? Code.Stx : Code.Soh;
  const seq = sequence & 0xff;
  return Uint8Array.of(soh, seq, (0xff - seq) & 0xff);
}

/** 从缓冲中抽出完整 Comm 帧，残留半包返回 rest */
function extractCommFrames(buf: Uint8Array): { frames: ParsedFrame[]; rest: Uint8Array } {
  const parser = new FrameParser();
  const frames = parser.push(buf);
  return { frames, rest: parser.peek() };
}

function statusText(code: number | null): string {
  if (code === null) return "未收到有效状态码";
  return OTA_STATUS_TEXT[code] ?? `0x${code.toString(16).toUpperCase().padStart(4, "0")} 未知状态`;
}

/** BootLoader 确认菜单（与 Python 80 列文本框一致） */
export function buildBootMenu(sourceText: string): string {
  const width = 80;
  const inner = width - 2;
  const border = "=".repeat(width);
  const line = (text = "", align: "left" | "center" = "left") => {
    const content = align === "center" ? text.padStart(Math.floor((inner + text.length) / 2)).padEnd(inner) : text.padEnd(inner);
    return `=${content.slice(0, inner)}=`;
  };
  const action = (left: string, right: string) => {
    const gap = Math.max(1, inner - 5 - left.length - right.length);
    return line(`    ${left}${" ".repeat(gap)}${right}`);
  };
  return [
    border,
    line("(C) COPYRIGHT 2026 EG Microelectronics Co., LTD", "center"),
    line("In-Application Programming Application (Version 1.0.1)", "center"),
    line("By EG Application Team", "center"),
    border,
    line("Main Menu", "center"),
    line(sourceText),
    action("DownLoad Image To the Egmicro Device Internal Flash", "Click OK"),
    action("Exitting the Upgrade Mode", "Click CANCEL"),
    border,
  ].join("\n");
}

export const BOOT_MENU_APP = buildBootMenu("    Now from APP enter BootLoad, please check.");
export const BOOT_MENU_BOT = buildBootMenu("    Now from BootLoad enter BootLoad, please check.");

/* ---------------- 对外接口 ---------------- */

export interface OtaFirmware {
  name: string;
  size: number;
  bin: Uint8Array;
}

export interface OtaPort {
  write(data: Uint8Array): Promise<void>;
  /** size=0 读走当前全部；否则最多取 size 字节（非阻塞，对齐 Python timeout 轮询） */
  read(size: number): Uint8Array;
  changeBaud(baud: number): Promise<void>;
  currentBaud(): number;
}

export interface OtaHooks {
  log(msg: string, onceKey?: string): void;
  onProgress(pct: number): void;
  /** 弹出 BootLoader 确认框；true=确定下载，false=取消 */
  onConfirm(fromApp: boolean): Promise<boolean>;
  onFinished(ok: boolean, message: string): void;
}

/* ---------------- 状态机 ---------------- */

export class OtaSession {
  private readonly timeDivide = 499;
  private readonly timeMax = 5;
  private readonly errorMax = 999;

  private timeCount = 0;
  private errorCount = 0;
  private dataCount = 0;
  private code: number = Code.None;
  private stage: number = Stage.None;
  private isApp = false;
  private txBuffer = new Uint8Array(0);
  private rxBuffer: number[] = [];
  private rxLength = 0;
  private commRecv = new Uint8Array(0);
  private lastStatusCode: number | null = null;

  private startFlag = false;
  private confirmIndex = 0xff;
  private progress = 0;
  private ymodemStarted = false;
  private fileCount = 0;
  private sequence = 1;
  private logged = new Set<string>();

  private timer = 0;
  private ticking = false;
  private paused = false;
  private running = false;
  private stopping = false;

  constructor(
    private port: OtaPort,
    private hooks: OtaHooks,
    private file: OtaFirmware,
    private downloadSpeed: 9600 | 115200,
    private restoreBaud: number,
  ) {}

  isRunning() {
    return this.running;
  }

  /** 启动 10ms 节拍，与 Python QTimer 对齐 */
  start() {
    if (this.running) return;
    this.running = true;
    this.stopping = false;
    this.startFlag = true;
    this.confirmIndex = 0xff;
    this.progress = 0;
    this.ymodemStarted = false;
    this.fileCount = 0;
    this.sequence = 1;
    this.logged.clear();
    this.resetMachine();
    this.hooks.onProgress(0);
    this.log("开始 OTA 升级流程");
    this.timer = window.setInterval(() => void this.tick(), 10);
  }

  /** 结束升级：停表、可选发 CAN、恢复界面波特率 */
  async stop(opts?: { abortYmodem?: boolean; restore?: boolean }) {
    if (this.stopping) return;
    if (!this.running) return;
    this.stopping = true;
    this.running = false;
    this.paused = false;
    if (this.timer) {
      window.clearInterval(this.timer);
      this.timer = 0;
    }
    if (opts?.abortYmodem) {
      try {
        await this.write(new Uint8Array(CODE_CAN_NUMBER).fill(Code.Can));
      } catch {
        /* 断开时忽略 */
      }
    }
    this.resetMachine();
    if (opts?.restore !== false) {
      try {
        await this.port.changeBaud(this.restoreBaud);
        this.log(`已恢复到主页面选项框波特率: ${this.restoreBaud}`, "restore_baud");
      } catch {
        /* 端口已关则跳过 */
      }
    }
    this.stopping = false;
  }

  private resetMachine() {
    this.timeCount = 0;
    this.errorCount = 0;
    this.dataCount = 0;
    this.code = Code.None;
    this.stage = Stage.None;
    this.commRecv = new Uint8Array(0);
    this.lastStatusCode = null;
    this.txBuffer = new Uint8Array(0);
    this.rxBuffer = [];
    this.rxLength = 0;
  }

  private log(msg: string, onceKey?: string) {
    if (onceKey) {
      if (this.logged.has(onceKey)) return;
      this.logged.add(onceKey);
    }
    this.hooks.log(msg, onceKey);
  }

  private async tick() {
    if (!this.running || this.paused || this.ticking) return;
    this.ticking = true;
    try {
      await this.transmit();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.log(`升级异常: ${msg}`, "tick_error");
      await this.finish(false, `升级失败: ${msg}`);
    } finally {
      this.ticking = false;
    }
  }

  private async transmit() {
    switch (this.stage) {
      case Stage.None: await this.stageNone(); break;
      case Stage.WaitUpgradeAck: await this.stageWaitUpgradeAck(); break;
      case Stage.PrepareIAP: await this.stagePrepareIap(); break;
      case Stage.ChangeingBaud: this.stageChangingBaud(); break;
      case Stage.ChangedBaud: await this.stageChangedBaud(); break;
      case Stage.WaitLogMsg1: await this.stageWaitLogMsg1(); break;
      case Stage.WaitAPPConfirm: await this.stageWaitConfirm(); break;
      case Stage.WaitSendReady: await this.stageWaitSendReady(); break;
      case Stage.YMODEMEstablishing: await this.stageEstablishing(); break;
      case Stage.YMODEMEstablished: await this.stageEstablished(); break;
      case Stage.YMODEMTransmitting: await this.stageTransmitting(); break;
      case Stage.YMODEMFinishing: await this.stageFinishing(); break;
      case Stage.YMODEMFinished: await this.stageFinished(); break;
      case Stage.WaitDownLoadFinished: await this.stageWaitDownloadFinished(); break;
      default: break;
    }
  }

  private async write(data: Uint8Array) {
    if (data.length === 0) return;
    await this.port.write(data);
  }

  /* ---------- 阶段：升级请求 / 波特率 ---------- */

  private async stageNone() {
    this.timeCount = 0;
    this.errorCount = 0;
    if (!this.startFlag) return;
    this.startFlag = false;
    this.log("步骤1 发起 OTA 请求: CMD=0x05 PAGE=0x00 ADDR=0x01 DATA=ROMUPGRADE", "step1_start");
    const data = new TextEncoder().encode("ROMUPGRADE");
    await this.write(buildFrame(UPGRADE_CMD, 0x00, 0x01, data));
    this.code = Code.None;
    this.stage = Stage.WaitUpgradeAck;
  }

  private async stageWaitUpgradeAck() {
    const oldLen = this.commRecv.length;
    this.feedCommBuffer();
    if (this.commRecv.length > oldLen) {
      const neu = this.commRecv.subarray(oldLen);
      this.log(`[WaitUpgradeAck] 接收到原始数据: ${toHex(neu)}`);
    }
    const code = this.tryParseCommFrames();
    if (code === Code.Ack) {
      this.log("步骤1 完成: 收到 F000，按 APP 路径继续", "step1_done");
      this.timeCount = 0;
      this.errorCount = 0;
      this.stage = Stage.PrepareIAP;
    } else {
      this.timeCount += 1;
      if (this.timeCount === TIME_OUT_1000MS) {
        this.timeCount = 0;
        this.errorCount = 0;
        this.log("步骤1 1000ms 未收到 APP 响应，按 BootLoader 模式继续", "step1_bootloader_no_ack");
        if (await this.sendBaudPayload()) {
          this.code = Code.None;
          this.stage = Stage.ChangeingBaud;
        } else {
          await this.finish(false, "升级失败: 波特率参数发送失败");
        }
      }
    }
  }

  private async stagePrepareIap() {
    this.timeCount += 1;
    if (this.timeCount !== TIME_OUT_1000MS) return;
    this.timeCount = 0;
    this.errorCount = 0;
    if (!(await this.sendBaudPayload())) {
      await this.finish(false, "升级失败: 波特率参数发送失败");
      return;
    }
    this.code = Code.None;
    this.stage = Stage.ChangeingBaud;
  }

  /** BootLoader 固定以 9600 收 4 字节裸波特率参数 */
  private async sendBaudPayload(): Promise<boolean> {
    const cur = this.port.currentBaud();
    if (cur !== 9600) {
      await this.port.changeBaud(9600);
      this.log(`步骤2 发送裸参数前切换上位机串口: ${cur} -> 9600`, "step2_force_9600");
    } else {
      this.log("步骤2 发送裸参数前上位机串口已是 9600", "step2_already_9600");
    }
    const payload = this.downloadSpeed === 115200
      ? Uint8Array.of(0x00, 0x01, 0xc2, 0x00)
      : Uint8Array.of(0x00, 0x00, 0x25, 0x80);
    this.log(
      `步骤2 准备切换波特率: ${this.downloadSpeed}，裸参数 ${toHex(payload)}`,
      "step2_start",
    );
    await this.write(payload);
    this.log(`步骤2 已发送波特率裸数据: ${toHex(payload)}`, "step2_payload_sent");
    return true;
  }

  private stageChangingBaud() {
    this.timeCount = 0;
    this.errorCount = 0;
    this.code = Code.None;
    this.stage = Stage.ChangedBaud;
  }

  private async stageChangedBaud() {
    const raw = this.port.read(1);
    if (raw.length > 0 && raw[0] === RAW_ACK) {
      this.timeCount = 0;
      this.errorCount = 0;
      await this.port.changeBaud(this.downloadSpeed);
      this.log(`步骤2 完成: 收到 ACK，串口已切换到 ${this.downloadSpeed}`, "step2_done");
      this.log("步骤3 等待 BootLoader 就绪状态 F010", "step3_start");
      this.code = Code.None;
      this.stage = Stage.WaitLogMsg1;
    } else if (this.timeCount === TIME_OUT_1000MS) {
      await this.finish(false, "升级失败: 超时");
    } else {
      this.timeCount += 1;
    }
  }

  private async stageWaitLogMsg1() {
    const code = this.receiveCommOnly();
    if (code === Code.EnterBootLoad) {
      this.timeCount = 0;
      this.errorCount = 0;
      this.code = Code.None;
      this.stage = Stage.WaitAPPConfirm;
      this.log("步骤4 BootLoader 已就绪，等待用户确认", "step4_start");
      this.paused = true;
      const ok = await this.hooks.onConfirm(this.isApp);
      this.confirmIndex = ok ? 1 : 3;
      this.paused = false;
    } else if (code === Code.TooLarge || code === Code.SendFailed || code === Code.CrcError || code === Code.UserStop) {
      this.timeCount = 0;
      await this.failProgram();
    } else {
      this.timeCount += 1;
      if (this.timeCount === TIME_OUT_1000MS) {
        this.log("升级失败: 等待设备响应超时，请复位设备后重试", "timeout");
        await this.finish(false, "升级失败: 超时");
      }
    }
  }

  private async stageWaitConfirm() {
    if (this.confirmIndex === 1) {
      this.progress = 1;
      this.hooks.onProgress(1);
      this.log("步骤4 完成: 用户确认下载，发送裸字节 0x31", "step4_done");
      this.log("步骤5 等待设备返回 F232 准备发送状态", "step5_wait_f232");
      this.timeCount = 0;
      this.errorCount = 0;
      await this.write(Uint8Array.of(Code.Confirm));
      this.code = Code.None;
      this.commRecv = new Uint8Array(0);
      this.stage = Stage.WaitSendReady;
    } else if (this.confirmIndex === 3) {
      this.startFlag = false;
      this.log("步骤4 取消: 用户取消升级，发送裸字节 0x33", "step4_cancel");
      this.timeCount = 0;
      this.errorCount = 0;
      await this.write(Uint8Array.of(Code.Cancel));
      this.code = Code.None;
      this.log("升级已取消: 用户主动退出升级流程", "user_stop");
      await this.finish(false, "用户取消升级");
    }
  }

  private async stageWaitSendReady() {
    const code = this.receiveCommOnly();
    if (code === Code.WaitSend) {
      this.timeCount = 0;
      this.errorCount = 0;
      this.code = Code.None;
      this.commRecv = new Uint8Array(0);
      this.log("步骤5 收到 F232，设备已准备发送数据，进入 YModem", "step5_done");
      this.log("步骤6 等待 YModem 握手字符 C", "step6_start");
      this.stage = Stage.YMODEMEstablishing;
    } else if (code === Code.UserStop) {
      this.log("升级已取消: 用户主动退出升级流程", "user_stop");
      await this.finish(false, "用户取消升级");
    } else if (code === Code.WaitC || code === Code.TooLarge || code === Code.SendFailed || code === Code.CrcError) {
      await this.failProgram();
    } else {
      this.timeCount += 1;
      if (this.timeCount === TIME_OUT_1000MS) {
        this.log("升级失败: 等待 F232 超时，请复位设备后重试", "wait_f232_timeout");
        await this.finish(false, "升级失败: 等待 F232 超时");
      }
    }
  }

  /* ---------- 阶段：YModem ---------- */

  private async stageEstablishing() {
    const code = this.receivePacket();
    if (code === Code.C) {
      if (this.file.bin.length === 0) {
        await this.abortYmodem(Status.Error);
        return;
      }
      this.fileCount = 0;
      this.sequence = 1;
      this.txBuffer = this.makeFirstPacket();
      this.log("步骤6 YModem 握手成功: 发送 Block0 文件信息", "step6_block0");
      this.timeCount = 0;
      this.errorCount = 0;
      this.dataCount = 0;
      this.code = Code.None;
      this.stage = Stage.YMODEMEstablished;
      await this.write(this.txBuffer);
    } else if (code === Code.A1 || code === Code.A2 || code === Code.Can) {
      await this.abortYmodem(Status.YMODEMEAbort);
    } else {
      await this.handleYmodemTimeout(false);
    }
  }

  private async stageEstablished() {
    const code = this.receivePacket();
    if (code === Code.Nak) {
      await this.handleNak();
    } else if (code === Code.C) {
      await this.handleResendOrError();
    } else if (code === Code.Ack) {
      const next = this.buildNextDataOrEot();
      if (next === Code.Ack) {
        this.timeCount = 0;
        this.errorCount = 0;
        this.dataCount = 1;
        this.code = Code.None;
        this.stage = Stage.YMODEMEstablished;
      } else if (next === Code.Eot) {
        this.timeCount = 0;
        this.errorCount = 0;
        this.dataCount = 2;
        this.code = Code.None;
        this.stage = Stage.YMODEMEstablished;
        await this.write(Uint8Array.of(Code.Eot));
      } else {
        await this.abortYmodem(Status.Error);
      }
    } else if (code === Code.A1 || code === Code.A2 || code === Code.Can) {
      await this.abortYmodem(Status.YMODEMEAbort);
    } else {
      await this.handleYmodemTimeout(true);
    }
  }

  private async stageTransmitting() {
    const code = this.receivePacket();
    if (code === Code.Nak) {
      await this.handleNak();
    } else if (code === Code.Ack) {
      const next = this.buildNextDataOrEot();
      if (next === Code.Ack) {
        this.timeCount = 0;
        this.errorCount = 0;
        this.dataCount += 1;
        this.code = Code.None;
        this.stage = Stage.YMODEMTransmitting;
        await this.write(this.txBuffer);
      } else if (next === Code.Eot) {
        this.timeCount = 0;
        this.errorCount = 0;
        this.dataCount = 0;
        this.code = Code.None;
        this.stage = Stage.YMODEMFinishing;
        await this.write(Uint8Array.of(Code.Eot));
      } else {
        await this.abortYmodem(Status.Error);
      }
    } else if (code === Code.A1 || code === Code.A2 || code === Code.Can) {
      await this.handleYmodemTimeout(true);
    } else {
      await this.handleYmodemTimeout(true);
    }
  }

  private async stageFinishing() {
    const code = this.receivePacket();
    if (code === Code.Nak) {
      this.timeCount = 0;
      this.errorCount = 0;
      this.dataCount = 0;
      this.code = Code.None;
      this.stage = Stage.YMODEMFinishing;
      await this.write(Uint8Array.of(Code.Eot));
    } else if (code === Code.C || code === Code.Ack) {
      this.txBuffer = this.makeLastPacket();
      this.log("步骤6 YModem 结束握手: 发送空数据块", "step6_last");
      this.timeCount = 0;
      this.errorCount = 0;
      this.dataCount = 0;
      this.code = Code.None;
      this.stage = Stage.YMODEMFinished;
      await this.write(this.txBuffer);
    } else if (code === Code.A1 || code === Code.A2 || code === Code.Can) {
      await this.abortYmodem(Status.YMODEMEAbort);
    } else {
      await this.handleYmodemTimeout(true);
    }
  }

  private async stageFinished() {
    const code = this.receivePacket();
    if (code === Code.C || code === Code.Nak) {
      this.errorCount += 1;
      if (this.errorCount > this.errorMax) await this.abortYmodem(Status.Error);
      else await this.write(this.txBuffer);
    } else if (code === Code.Ack) {
      this.timeCount = 0;
      this.errorCount = 0;
      this.dataCount = 0;
      this.code = Code.None;
      this.stage = Stage.WaitDownLoadFinished;
      this.log("步骤6 完成: YModem 传输结束", "step6_done");
      this.log("步骤7 等待烧写结果状态 F343", "step7_start");
    } else if (code === Code.A1 || code === Code.A2 || code === Code.Can) {
      await this.abortYmodem(Status.YMODEMEAbort);
    } else {
      await this.handleYmodemTimeout(true);
    }
  }

  private async stageWaitDownloadFinished() {
    const code = this.receiveCommOnly();
    if (code === Code.ProgramSuccess) {
      this.hooks.onProgress(100);
      this.log(`升级成功: ${this.file.name} (${this.file.size} Byte)`, "program_success");
      await this.finish(true, "烧写成功");
    } else if (code === Code.TooLarge || code === Code.SendFailed || code === Code.CrcError || code === Code.UserStop) {
      await this.failProgram();
    } else {
      this.timeCount += 1;
      if (this.timeCount === TIME_OUT_1000MS) {
        this.log("升级失败: 等待设备响应超时，请复位设备后重试", "timeout");
        await this.finish(false, "升级失败: 超时");
      }
    }
  }

  /* ---------- YModem 组包 / 重试 ---------- */

  /** 还有数据则组下一包并返回 Ack；发完返回 Eot */
  private buildNextDataOrEot(): number {
    if (this.file.size !== this.fileCount) {
      if (!this.ymodemStarted) {
        this.ymodemStarted = true;
        this.log("步骤6 YModem 传输中: 开始发送固件数据块", "step6_data");
      }
      const remaining = this.file.size - this.fileCount;
      let data: Uint8Array;
      let packSize: number;
      let size: number;
      if (remaining > YMODEM_PACKET_1K_SIZE) {
        data = this.file.bin.subarray(this.fileCount, this.fileCount + YMODEM_PACKET_1K_SIZE);
        packSize = YMODEM_PACKET_1K_SIZE;
        size = packSize;
      } else {
        data = this.file.bin.subarray(this.fileCount, this.fileCount + YMODEM_PACKET_SIZE);
        packSize = data.length;
        size = packSize;
      }
      if (packSize < YMODEM_PACKET_SIZE) packSize = YMODEM_PACKET_SIZE;
      const header = makeDataPacketHeader(packSize, this.sequence);
      const padded = new Uint8Array(packSize);
      padded.fill(DATA_PAD);
      padded.set(data, 0);
      this.txBuffer = concat(header, padded, makeDataChecksum(padded));
      this.progress = Math.max(1, Math.ceil((this.fileCount * 100) / this.file.size));
      this.hooks.onProgress(this.progress);
      this.sequence += 1;
      this.fileCount += size;
      return Code.Ack;
    }
    this.log("步骤6 YModem 数据发送完成: 发送 EOT", "step6_eot");
    return Code.Eot;
  }

  private makeFirstPacket(): Uint8Array {
    let name = this.file.name;
    if (name.length > 100) name = name.slice(0, 100);
    const sizeStr = String(this.file.size);
    if (sizeStr.length > 20) throw new Error("文件过大");
    const enc = new TextEncoder();
    const nameBytes = enc.encode(name);
    const sizeBytes = enc.encode(sizeStr);
    const payload = new Uint8Array(YMODEM_PACKET_SIZE);
    payload.set(nameBytes, 0);
    payload.set(sizeBytes, nameBytes.length + 1);
    return concat(makeEdgePacketHeader(YMODEM_PACKET_SIZE), payload, makeDataChecksum(payload));
  }

  private makeLastPacket(): Uint8Array {
    const payload = new Uint8Array(YMODEM_PACKET_SIZE);
    return concat(makeDataPacketHeader(YMODEM_PACKET_SIZE, 0), payload, makeDataChecksum(payload));
  }

  private async handleNak() {
    this.errorCount += 1;
    if (this.errorCount > this.errorMax) await this.abortYmodem(Status.Error);
    else await this.write(this.txBuffer);
  }

  private async handleResendOrError() {
    this.errorCount += 1;
    if (this.errorCount > this.errorMax) {
      await this.abortYmodem(Status.Error);
      return;
    }
    this.timeCount = 0;
    this.errorCount = 0;
    this.code = Code.None;
    this.stage = this.stage + this.dataCount;
    await this.write(this.txBuffer);
  }

  private async handleYmodemTimeout(resend: boolean) {
    this.timeCount += 1;
    if (Math.floor(this.timeCount / (this.timeDivide + 1)) > this.timeMax) {
      this.log("升级失败: 等待设备响应超时，请复位设备后重试", "timeout");
      await this.abortYmodem(Status.Timeout);
    } else if (resend && this.timeCount % (this.timeDivide + 1) === 0) {
      await this.write(this.txBuffer);
    }
  }

  private async abortYmodem(status: number) {
    if (status === Status.YMODEMEAbort) {
      this.log("升级失败: YModem 传输被设备中止，请复位设备后重试", "ymodem_abort");
    } else if (status === Status.Timeout) {
      this.log("升级失败: 等待设备响应超时，请复位设备后重试", "timeout");
    } else {
      this.log("升级失败: YModem 传输错误，请复位设备后重试", "ymodem_error");
    }
    try {
      await this.write(new Uint8Array(CODE_CAN_NUMBER).fill(Code.Can));
    } catch {
      /* noop */
    }
    const msg =
      status === Status.YMODEMEAbort ? "升级失败: YModem 中止"
        : status === Status.Timeout ? "升级失败: 超时"
          : "升级失败: YModem 错误";
    await this.finish(false, msg, { skipCan: true });
  }

  private async failProgram() {
    const reason = statusText(this.lastStatusCode);
    this.log(`升级失败: ${reason}，请复位设备后重试`, "program_failed");
    await this.finish(false, `烧写失败: ${reason}`);
  }

  private async finish(ok: boolean, message: string, opts?: { skipCan?: boolean }) {
    if (this.stopping || !this.running) return;
    await this.stop({ abortYmodem: false, restore: true });
    this.hooks.onFinished(ok, message);
    void opts;
  }

  /* ---------- 收包 ---------- */

  private feedCommBuffer() {
    const chunk = this.port.read(0);
    if (chunk.length > 0) {
      this.commRecv = concat(this.commRecv, chunk);
      return;
    }
    if (this.commRecv.length === 0) {
      const single = this.port.read(1);
      if (single.length > 0) this.commRecv = concat(this.commRecv, single);
    }
  }

  private tryParseCommFrames(): number {
    const { frames, rest } = extractCommFrames(this.commRecv);
    this.commRecv = rest;
    let result = Code.None;
    for (const f of frames) {
      const parsed = this.parseCommStatus(f);
      if (parsed !== Code.None) result = parsed;
    }
    return result;
  }

  private receiveCommOnly(): number {
    this.feedCommBuffer();
    return this.tryParseCommFrames();
  }

  private parseCommStatus(frame: ParsedFrame): number {
    if (frame.cmd !== UPGRADE_RESP_CMD) return Code.None;
    if (!frame.crcOk || !frame.valid) return Code.None;
    const data = frame.data;
    if (data.length < 2) return Code.None;
    const status = (data[0] << 8) | data[1];
    this.lastStatusCode = status;
    this.onCommStatus(status);
    if (status === OTA_STATUS.ENTER_BOOT_OK) {
      this.isApp = true;
      return Code.Ack;
    }
    if (status === OTA_STATUS.BOOT_READY) return Code.EnterBootLoad;
    const map: Record<number, number> = {
      [OTA_STATUS.WAIT_C]: Code.WaitC,
      [OTA_STATUS.WAIT_SEND]: Code.WaitSend,
      [OTA_STATUS.PROGRAM_OK]: Code.ProgramSuccess,
      [OTA_STATUS.TOO_LARGE]: Code.TooLarge,
      [OTA_STATUS.CRC_ERROR]: Code.CrcError,
      [OTA_STATUS.USER_STOP]: Code.UserStop,
      [OTA_STATUS.SEND_FAILED]: Code.SendFailed,
    };
    return map[status] ?? Code.None;
  }

  private onCommStatus(status: number) {
    const text = statusText(status);
    if (status === OTA_STATUS.ENTER_BOOT_OK) this.log(`步骤1 收到 APP 响应: ${text}`, "rx_f000");
    else if (status === OTA_STATUS.BOOT_READY) this.log(`步骤3 成功: ${text}`, "rx_f010");
    else if (status === OTA_STATUS.WAIT_C) this.log(`步骤4 提示: ${text}`, "rx_f121");
    else if (status === OTA_STATUS.WAIT_SEND) this.log(`步骤5 收到: ${text}`, "rx_f232");
    else if (status === OTA_STATUS.PROGRAM_OK) this.log(`步骤6 成功: ${text}`, "rx_f343");
    else if (
      status === OTA_STATUS.TOO_LARGE
      || status === OTA_STATUS.CRC_ERROR
      || status === OTA_STATUS.USER_STOP
      || status === OTA_STATUS.SEND_FAILED
    ) {
      this.log(`设备返回失败状态: ${text}`, `rx_${status.toString(16)}`);
    }
  }

  /** YModem 阶段只认裸控制字符 */
  private receivePacket(): number {
    if (this.code === Code.None) {
      const raw = this.port.read(1);
      if (raw.length === 0) return Code.None;
      const c = raw[0];
      if (c === Code.Soh) return this.readYmodemBlock(Code.Soh, YMODEM_PACKET_SIZE);
      if (c === Code.Stx) return this.readYmodemBlock(Code.Stx, YMODEM_PACKET_1K_SIZE);
      if (c === Code.C || c === Code.Eot || c === Code.Ack || c === Code.Nak || c === Code.Can) return c;
      return Code.None;
    }
    if (this.code === Code.Soh) return this.continueYmodemBlock(Code.Soh, YMODEM_PACKET_SIZE);
    if (this.code === Code.Stx) return this.continueYmodemBlock(Code.Stx, YMODEM_PACKET_1K_SIZE);
    this.code = Code.None;
    return Code.None;
  }

  private readYmodemBlock(code: number, blockSize: number): number {
    this.rxBuffer = [];
    const need = blockSize + PACKET_OVERHEAD - 1;
    const rx = this.port.read(need);
    for (const b of rx) this.rxBuffer.push(b);
    if (this.rxBuffer.length < need) {
      this.rxLength = this.rxBuffer.length + 1;
      this.code = code;
      return Code.None;
    }
    return code;
  }

  private continueYmodemBlock(code: number, blockSize: number): number {
    const need = blockSize + PACKET_OVERHEAD - this.rxLength;
    const rx = this.port.read(need);
    for (const b of rx) this.rxBuffer.push(b);
    if (rx.length < need) {
      this.rxLength += rx.length;
      return Code.None;
    }
    this.code = Code.None;
    return code;
  }
}
