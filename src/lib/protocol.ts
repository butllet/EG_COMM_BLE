/* ============================================================
 * EGmicroChameleonComm 协议核心（用户调试版）
 * HEAD(2) + ID(2) + CMD(1) + PAGE(1) + ADDR(1) + LEN(1) + DATA(N) + CRC16(2 LE) + TAIL(2)
 * 协议 ID 默认 0x11 0x55，运行时可全局配置，组帧/解析共用同一份。
 * ============================================================ */

export const HEAD = [0xeb, 0x90] as const;
/** 出厂默认协议 ID（界面可改，写入后全局生效） */
export const DEFAULT_PROTO_ID: [number, number] = [0x11, 0x55];
export const TAIL = [0xbe, 0x09] as const;

const LS_PROTO_ID = "egcc.protoId";

/** 当前全局协议 ID（模块级，供组帧/流式解析同步读取） */
let currentProtoId: [number, number] = [DEFAULT_PROTO_ID[0], DEFAULT_PROTO_ID[1]];

export const CMD = {
  READ: 0x52, // 读请求
  WRITE: 0x57, // 写请求
  UPGRADE: 0x05, // 升级请求
} as const;

export const CMD_NAME: Record<number, string> = {
  0x52: "读请求 READ",
  0x57: "写请求 WRITE",
  0x05: "升级请求 UPGRADE",
  0xad: "读响应 READ_ACK",
  0xa8: "写响应 WRITE_ACK",
  0xfa: "升级响应 UPG_ACK",
};

/** 响应命令字规则：按位取反 */
export const respCmdOf = (cmd: number) => ~cmd & 0xff;

export const WRITE_STATUS: Record<number, string> = {
  0x00: "写OK",
  0x01: "页不存在",
  0x02: "地址越界",
  0x03: "当前页不允许写",
  0x04: "长度非法",
  0x05: "参数错误",
  0x06: "命令不支持",
};

/* ---------------- CRC-16/XMODEM (poly 0x1021, init 0, xorout 0) ---------------- */
export function crc16Xmodem(data: Uint8Array): number {
  let crc = 0x0000;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i] << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc & 0xffff;
}

/* ---------------- HEX 工具 ---------------- */
export const h8 = (v: number) => (v & 0xff).toString(16).toUpperCase().padStart(2, "0");
export const h16 = (v: number) => (v & 0xffff).toString(16).toUpperCase().padStart(4, "0");

export function toHex(data: Uint8Array | number[], sep = " "): string {
  return Array.from(data).map(h8).join(sep);
}

/** 解析用户输入的十六进制字符串（容忍空格/逗号/0x 前缀） */
export function hexToBytes(s: string): Uint8Array {
  const clean = s.replace(/0x/gi, "").replace(/[^0-9a-fA-F]/g, "");
  if (clean.length === 0) return new Uint8Array(0);
  if (clean.length % 2 !== 0) throw new Error("十六进制长度必须为偶数");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  return out;
}

/** 解析单字节十六进制输入 */
export function parseByteHex(s: string, name: string): number {
  const b = hexToBytes(s || "0");
  if (b.length > 1) throw new Error(`${name} 必须是 1 字节 (0x00~0xFF)`);
  return b[0] ?? 0;
}

/** 解析 2 字节协议 ID（如 "11 55" / "1155"） */
export function parseProtoIdHex(s: string): [number, number] {
  const b = hexToBytes(s);
  if (b.length !== 2) throw new Error("协议 ID 必须是 2 字节（例如 11 55）");
  return [b[0], b[1]];
}

export function protoIdToHex(id: [number, number] = getProtoId(), sep = " "): string {
  return `${h8(id[0])}${sep}${h8(id[1])}`;
}

export function getProtoId(): [number, number] {
  return [currentProtoId[0], currentProtoId[1]];
}

/** 设置全局协议 ID，并持久化到 localStorage */
export function setProtoId(id: [number, number]): void {
  currentProtoId = [id[0] & 0xff, id[1] & 0xff];
  try {
    localStorage.setItem(LS_PROTO_ID, protoIdToHex(currentProtoId, ""));
  } catch {
    /* 隐私模式 / 无 storage 时忽略 */
  }
}

/** 启动时从 localStorage 恢复协议 ID */
export function restoreProtoId(): [number, number] {
  try {
    const s = localStorage.getItem(LS_PROTO_ID);
    if (s) {
      const id = parseProtoIdHex(s);
      currentProtoId = id;
      return id;
    }
  } catch {
    /* 忽略损坏数据 */
  }
  currentProtoId = [DEFAULT_PROTO_ID[0], DEFAULT_PROTO_ID[1]];
  return getProtoId();
}

/* ---------------- 数据类型 / 缩放 ---------------- */
/** char = C 字符串数组；bytes = 原始字节数组（如 chip_uid） */
export type DType =
  | "uint8" | "uint16" | "uint32"
  | "int8" | "int16" | "int32"
  | "float"
  | "char"
  | "bytes";

export const TYPE_SIZE: Record<Exclude<DType, "char" | "bytes">, number> = {
  uint8: 1, uint16: 2, uint32: 4, int8: 1, int16: 2, int32: 4, float: 4,
};

export const TYPE_RANGE: Record<Exclude<DType, "char" | "bytes">, [number, number]> = {
  uint8: [0, 0xff], uint16: [0, 0xffff], uint32: [0, 0xffffffff],
  int8: [-0x80, 0x7f], int16: [-0x8000, 0x7fff], int32: [-0x80000000, 0x7fffffff],
  float: [-3.4028235e38, 3.4028235e38],
};

/** 是否为定长数组类型（显示/写入走字节编解码，不走数值路径） */
export function isArrayDtype(dtype: DType): boolean {
  return dtype === "char" || dtype === "bytes";
}

/** 小端解码原始数值 */
export function decodeRaw(buf: Uint8Array, dtype: Exclude<DType, "char" | "bytes">, offset = 0): number {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  switch (dtype) {
    case "uint8": return dv.getUint8(offset);
    case "uint16": return dv.getUint16(offset, true);
    case "uint32": return dv.getUint32(offset, true);
    case "int8": return dv.getInt8(offset);
    case "int16": return dv.getInt16(offset, true);
    case "int32": return dv.getInt32(offset, true);
    case "float": return dv.getFloat32(offset, true);
  }
}

/** 小端编码原始数值，返回 len 字节 */
export function encodeRaw(value: number, dtype: Exclude<DType, "char" | "bytes">, len: number): Uint8Array {
  const out = new Uint8Array(len);
  const dv = new DataView(out.buffer);
  switch (dtype) {
    case "uint8": dv.setUint8(0, value & 0xff); break;
    case "uint16": dv.setUint16(0, value & 0xffff, true); break;
    case "uint32": dv.setUint32(0, value >>> 0, true); break;
    case "int8": dv.setInt8(0, value); break;
    case "int16": dv.setInt16(0, value, true); break;
    case "int32": dv.setInt32(0, value | 0, true); break;
    case "float": dv.setFloat32(0, value, true); break;
  }
  return out;
}

const clamp = (v: number, [min, max]: [number, number]) => Math.min(max, Math.max(min, v));

/**
 * 设置值 → 原始值
 * 缩放倍率仅对 uint 生效：raw = floor(设置值 / 倍率)
 * 有符号整型 / float 不缩放
 */
export function toRaw(input: string | number, dtype: Exclude<DType, "char" | "bytes">, scale: number): number {
  const n = typeof input === "string" ? Number(input.trim()) : input;
  if (!Number.isFinite(n)) throw new Error("输入不是有效数字");
  let raw: number;
  if (dtype.startsWith("uint")) {
    const s = scale > 0 ? scale : 1;
    raw = Math.floor(n / s);
  } else if (dtype === "float") {
    raw = n;
  } else {
    raw = Math.trunc(n);
  }
  return clamp(raw, TYPE_RANGE[dtype]);
}

/** 原始值 → 显示值：uint 应用倍率（显示值 = 原始值 × 倍率） */
export function toDisplay(raw: number, dtype: Exclude<DType, "char" | "bytes">, scale: number): string {
  if (dtype === "float") return String(Math.round(raw * 1000) / 1000);
  if (dtype.startsWith("uint") && scale !== 1) {
    const dec = decimalsOf(scale);
    return (raw * scale).toFixed(dec);
  }
  return String(raw);
}

function decimalsOf(scale: number): number {
  const s = String(scale);
  const i = s.indexOf(".");
  return i < 0 ? 0 : Math.min(s.length - i - 1, 6);
}

/**
 * 解码 C 字符串：从 offset 起读 len 字节，遇 0x00 截断。
 * 可打印 ASCII 原样显示，其余用 '.' 占位。
 */
export function decodeChars(buf: Uint8Array, offset: number, len: number): string {
  const slice = buf.subarray(offset, offset + len);
  let end = slice.indexOf(0);
  if (end < 0) end = slice.length;
  let out = "";
  for (let i = 0; i < end; i++) {
    const c = slice[i];
    out += c >= 0x20 && c <= 0x7e ? String.fromCharCode(c) : ".";
  }
  return out;
}

/**
 * 编码 C 字符串：ASCII 写入，右侧补 0x00 到 len。
 * 超出长度或出现非单字节字符时抛错。
 */
export function encodeChars(text: string, len: number): Uint8Array {
  const out = new Uint8Array(len);
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) throw new Error("仅支持 ASCII 字符（单字节）");
    bytes.push(code & 0xff);
  }
  if (bytes.length > len) throw new Error(`字符串超过字段长度 ${len} 字节`);
  out.set(bytes, 0);
  return out;
}

/** 原始字节数组显示为连续 HEX */
export function decodeBytesHex(buf: Uint8Array, offset: number, len: number): string {
  return toHex(buf.subarray(offset, offset + len));
}

/** HEX 文本编码为定长字节，不足右侧补 0x00 */
export function encodeBytesHex(hex: string, len: number): Uint8Array {
  const b = hexToBytes(hex);
  if (b.length > len) throw new Error(`HEX 超过字段长度 ${len} 字节`);
  const out = new Uint8Array(len);
  out.set(b, 0);
  return out;
}

/** 寄存器当前值展示（数值 / 字符串 / HEX） */
export function fieldDisplay(buf: Uint8Array, dtype: DType, offset: number, len: number, scale: number): string {
  if (dtype === "char") return decodeChars(buf, offset, len);
  if (dtype === "bytes") return decodeBytesHex(buf, offset, len);
  return toDisplay(decodeRaw(buf, dtype, offset), dtype, scale);
}

/** 原始值列：数组类型显示 HEX，数值类型显示未缩放整数/浮点 */
export function fieldRawLabel(buf: Uint8Array, dtype: DType, offset: number, len: number): string {
  if (dtype === "char" || dtype === "bytes") return decodeBytesHex(buf, offset, len);
  return String(decodeRaw(buf, dtype, offset));
}

/** 设定值 → 待发送 payload（按类型分流） */
export function encodeField(input: string, dtype: DType, len: number, scale: number): Uint8Array {
  if (dtype === "char") return encodeChars(input, len);
  if (dtype === "bytes") return encodeBytesHex(input, len);
  return encodeRaw(toRaw(input, dtype, scale), dtype, len);
}

/* ---------------- 帧构造与解析 ---------------- */
export const FRAME_OVERHEAD = 12; // HEAD2 + ID2 + CMD+PAGE+ADDR+LEN + CRC2 + TAIL2

export function buildFrame(cmd: number, page: number, addr: number, data: Uint8Array = new Uint8Array(0)): Uint8Array {
  if (data.length > 255) throw new Error("DATA 长度不能超过 255 字节");
  const id = getProtoId();
  const body = new Uint8Array(6 + data.length); // ID2 + CMD + PAGE + ADDR + LEN + DATA
  body[0] = id[0];
  body[1] = id[1];
  body[2] = cmd & 0xff;
  body[3] = page & 0xff;
  body[4] = addr & 0xff;
  body[5] = data.length;
  body.set(data, 6);
  const crc = crc16Xmodem(body); // 计算范围：ID → DATA 结束
  const frame = new Uint8Array(FRAME_OVERHEAD + data.length);
  frame.set(HEAD, 0);
  frame.set(body, 2);
  frame[8 + data.length] = crc & 0xff; // CRC 小端：低字节在前
  frame[9 + data.length] = (crc >> 8) & 0xff;
  frame.set(TAIL, 10 + data.length);
  return frame;
}

export interface ParsedFrame {
  raw: Uint8Array;
  total: number;
  headOk: boolean;
  idOk: boolean;
  cmd: number;
  page: number;
  addr: number;
  len: number;
  data: Uint8Array;
  crcRecv: number;
  crcCalc: number;
  crcOk: boolean;
  tailOk: boolean;
  valid: boolean;
}

/** 解析一整帧（长度须与 LEN 字段一致） */
export function parseFrame(raw: Uint8Array): ParsedFrame {
  const id = getProtoId();
  const len = raw.length > 7 ? raw[7] : 0;
  const total = FRAME_OVERHEAD + len;
  const get = (i: number) => (i < raw.length ? raw[i] : -1);
  const headOk = get(0) === HEAD[0] && get(1) === HEAD[1];
  const idOk = get(2) === id[0] && get(3) === id[1];
  const data = raw.slice(8, 8 + len);
  const crcRecv = raw.length >= 10 + len ? (get(9 + len) << 8) | get(8 + len) : -1;
  const crcCalc = raw.length >= 8 + len ? crc16Xmodem(raw.slice(2, 8 + len)) : -1;
  const crcOk = crcRecv === crcCalc;
  const tailOk = get(10 + len) === TAIL[0] && get(11 + len) === TAIL[1];
  return {
    raw: raw.slice(0, total), total, headOk, idOk,
    cmd: raw[4] ?? 0, page: raw[5] ?? 0, addr: raw[6] ?? 0, len,
    data, crcRecv, crcCalc, crcOk, tailOk,
    valid: headOk && idOk && crcOk && tailOk && raw.length >= total,
  };
}

/** 流式帧解析器：处理粘包 / 半包 / 帧前噪声 / Web Serial 跨包拆帧头 */
export class FrameParser {
  private buf: number[] = [];

  push(chunk: Uint8Array): ParsedFrame[] {
    for (const b of chunk) this.buf.push(b);
    const out: ParsedFrame[] = [];
    for (;;) {
      // 重新同步：寻找帧头 0xEB 0x90
      let idx = -1;
      for (let i = 0; i < this.buf.length - 1; i++) {
        if (this.buf[i] === HEAD[0] && this.buf[i + 1] === HEAD[1]) { idx = i; break; }
      }
      if (idx < 0) {
        // 跨包关键：单独到达的 0xEB 必须保留，否则下一包从 0x90 起永远组不出帧头
        const last = this.buf.length > 0 ? this.buf[this.buf.length - 1] : -1;
        this.buf = last === HEAD[0] ? [HEAD[0]] : [];
        break;
      }
      if (idx > 0) this.buf = this.buf.slice(idx);
      if (this.buf.length < 8) break; // 至少到 LEN 字段
      const len = this.buf[7];
      const total = FRAME_OVERHEAD + len;
      if (this.buf.length < total) break; // 半包，等待更多数据
      const tail0 = this.buf[total - 2];
      const tail1 = this.buf[total - 1];
      // 伪帧头或错误 LEN：TAIL 不是 BE 09 则丢掉当前这个 EB，从下一字节继续搜
      if (tail0 !== TAIL[0] || tail1 !== TAIL[1]) {
        this.buf.shift();
        continue;
      }
      out.push(parseFrame(Uint8Array.from(this.buf.slice(0, total))));
      this.buf = this.buf.slice(total);
    }
    return out;
  }

  /** 查看尚未组完的残留字节（超时诊断用） */
  peek(): Uint8Array {
    return Uint8Array.from(this.buf);
  }

  reset() { this.buf = []; }
}
