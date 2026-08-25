import { strFromU8, unzipSync } from "fflate";
import { parseProtoIdHex, protoIdToHex, type DType } from "./protocol";
import type { PageDef } from "./registers";
import defaultChip from "../data/default-chip.json";

export interface ChipPack {
  schemaVersion: 1;
  chip: { id: string; model: string };
  version: string;
  connection: { protocolId: string; baud: number };
  pages: PageDef[];
}

const LS_INSTALLED_PACKS = "egcc.installed-packs";
const LS_SELECTED_CHIP = "egcc.selected-chip";
const DTYPES: DType[] = ["uint8", "uint16", "uint32", "int8", "int16", "int32", "float", "char", "bytes"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

/** 校验 Pack 清单；只接受当前串口协议能表达的 PAGE / ADDR / LEN 范围。 */
export function validateChipPack(value: unknown): ChipPack {
  if (!isRecord(value)) throw new Error("Pack 清单必须是 JSON 对象");
  if (value.schemaVersion !== 1) throw new Error("不支持的 Pack schemaVersion（仅支持 1）");
  if (!isRecord(value.chip)) throw new Error("Pack 缺少 chip 信息");
  const id = nonEmpty(value.chip.id, "芯片 ID");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(id)) throw new Error("芯片 ID 仅允许字母、数字、点、下划线和连字符");
  const model = nonEmpty(value.chip.model, "芯片型号");
  const version = nonEmpty(value.version, "Pack 版本");
  if (!isRecord(value.connection)) throw new Error("Pack 缺少 connection 通信参数");
  const protocolId = nonEmpty(value.connection.protocolId, "协议 ID");
  try { parseProtoIdHex(protocolId); } catch (error) { throw new Error(error instanceof Error ? error.message : "协议 ID 无效"); }
  const baud = value.connection.baud;
  if (typeof baud !== "number" || !Number.isInteger(baud) || baud <= 0) throw new Error("串口波特率必须为正整数");
  if (!Array.isArray(value.pages) || value.pages.length === 0) throw new Error("Pack 至少应包含一个寄存器页");

  const pageIds = new Set<number>();
  const pages = value.pages.map((rawPage, pageIndex) => {
    if (!isRecord(rawPage)) throw new Error(`第 ${pageIndex + 1} 个寄存器页无效`);
    const page = rawPage as unknown as PageDef;
    if (!Number.isInteger(page.id) || page.id < 0 || page.id > 0xff || pageIds.has(page.id)) {
      throw new Error(`第 ${pageIndex + 1} 个寄存器页的 PAGE 必须唯一且在 0x00–0xFF 范围内`);
    }
    pageIds.add(page.id);
    if (!page.name || !page.cn || !Array.isArray(page.regs) || page.regs.length === 0) {
      throw new Error(`PAGE 0x${page.id.toString(16)} 缺少名称或寄存器`);
    }
    const offsets = new Set<number>();
    let totalLen = 0;
    for (const reg of page.regs) {
      if (!reg.name || !reg.label || !Number.isInteger(reg.offset) || !Number.isInteger(reg.len)) {
        throw new Error(`PAGE 0x${page.id.toString(16)} 存在不完整寄存器定义`);
      }
      if (reg.offset < 0 || reg.offset > 0xff || reg.len < 1 || reg.len > 0xff || reg.offset + reg.len > 0xff) {
        throw new Error(`${reg.name} 的地址或长度超出协议字节范围`);
      }
      if (offsets.has(reg.offset)) throw new Error(`PAGE 0x${page.id.toString(16)} 的偏移地址 0x${reg.offset.toString(16)} 重复`);
      offsets.add(reg.offset);
      if (reg.access !== "R" && reg.access !== "W/R") throw new Error(`${reg.name} 的读写权限无效`);
      if (!DTYPES.includes(reg.dtype)) throw new Error(`${reg.name} 的数据类型无效`);
      if (!Number.isFinite(reg.scale) || reg.scale <= 0) throw new Error(`${reg.name} 的缩放倍率无效`);
      totalLen = Math.max(totalLen, reg.offset + reg.len);
    }
    if (page.totalLen !== totalLen || page.writable !== page.regs.some((reg) => reg.access === "W/R")) {
      throw new Error(`PAGE 0x${page.id.toString(16)} 的汇总信息与寄存器定义不一致`);
    }
    return { ...page, imported: true };
  });
  return { schemaVersion: 1, chip: { id, model }, version, connection: { protocolId: protoIdToHex(parseProtoIdHex(protocolId)), baud }, pages };
}

/** 从 ZIP 格式 .pack 中读取根目录 manifest.json。 */
export function parseChipPack(data: ArrayBuffer): ChipPack {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error("无法解压 Pack，请确认文件为有效的 ZIP 格式 .pack");
  }
  const manifest = files["manifest.json"];
  if (!manifest) throw new Error("Pack 根目录缺少 manifest.json");
  try {
    return validateChipPack(JSON.parse(strFromU8(manifest)));
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("manifest.json 不是有效 JSON");
  }
}

export const DEFAULT_CHIP_PACK = validateChipPack(defaultChip);

export function loadInstalledPacks(): ChipPack[] {
  try {
    const stored = JSON.parse(localStorage.getItem(LS_INSTALLED_PACKS) ?? "[]");
    if (!Array.isArray(stored)) return [];
    return stored.map(validateChipPack);
  } catch {
    return [];
  }
}

export function persistInstalledPacks(packs: ChipPack[]) {
  localStorage.setItem(LS_INSTALLED_PACKS, JSON.stringify(packs));
}

/** 仅保存外部安装包；默认 Pack 不可被删除。 */
export function removeInstalledPack(packs: ChipPack[], chipId: string): ChipPack[] {
  const next = packs.filter((pack) => pack.chip.id !== chipId);
  persistInstalledPacks(next);
  return next;
}

export function allChipPacks(installed: ChipPack[]): ChipPack[] {
  const byId = new Map<string, ChipPack>([[DEFAULT_CHIP_PACK.chip.id, DEFAULT_CHIP_PACK]]);
  installed.forEach((pack) => byId.set(pack.chip.id, pack));
  return [...byId.values()];
}

export function loadSelectedChipId(): string {
  return localStorage.getItem(LS_SELECTED_CHIP) ?? DEFAULT_CHIP_PACK.chip.id;
}

export function persistSelectedChipId(id: string) {
  localStorage.setItem(LS_SELECTED_CHIP, id);
}
