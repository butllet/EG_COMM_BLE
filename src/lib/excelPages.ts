import * as XLSX from "xlsx";
import type { DType } from "./protocol";
import type { Access, PageDef, RegDef } from "./registers";

/** 把单元格转成去空白字符串 */
function cellStr(v: unknown): string {
  if (v == null) return "";
  return String(v).trim();
}

/** 解析 0xF0 / 240 / "F0h" 等形式的页号或偏移 */
function parseHexOrNum(raw: string, label: string): number {
  const t = raw.trim();
  if (!t) throw new Error(`${label}为空`);
  const hex = t.match(/^(?:0x)?([0-9a-fA-F]+)h?$/);
  if (hex && /[a-fA-F]/.test(hex[1])) return parseInt(hex[1], 16);
  if (/^0x/i.test(t)) return parseInt(t, 16);
  const n = Number(t);
  if (!Number.isFinite(n)) throw new Error(`${label}无法解析：${raw}`);
  return n;
}

/**
 * Excel 类型名 → 内部 DType。
 * enum32 以字节长度为准（1 字节当 uint8，4 字节当 uint32），避免 0x03 标志位标注错误。
 */
function mapDtype(raw: string, len: number): DType {
  const t = raw.trim().toLowerCase();
  if (t === "float32" || t === "float") return "float";
  if (t === "uint8" || t === "uint16" || t === "uint32") return t;
  if (t === "int8" || t === "int16" || t === "int32") return t;
  if (t.startsWith("char[")) return "char";
  if (t.startsWith("uint8[")) return "bytes";
  if (t === "enum32" || t.startsWith("enum")) return len >= 4 ? "uint32" : "uint8";
  throw new Error(`未知数据类型：${raw}`);
}

function mapAccess(raw: string): Access {
  const t = raw.trim().toUpperCase().replace(/\s+/g, "");
  if (t === "R") return "R";
  if (t === "W/R" || t === "RW" || t === "R/W" || t === "W") return "W/R";
  throw new Error(`未知读写权限：${raw}`);
}

function finalizePage(draft: {
  name: string;
  id: number;
  regs: RegDef[];
}): PageDef {
  if (draft.regs.length === 0) throw new Error(`页 ${draft.name} (0x${draft.id.toString(16)}) 没有任何寄存器`);
  const last = draft.regs.reduce((m, r) => Math.max(m, r.offset + r.len), 0);
  return {
    id: draft.id & 0xff,
    name: draft.name,
    cn: draft.name,
    writable: draft.regs.some((r) => r.access === "W/R"),
    totalLen: last,
    regs: draft.regs,
    imported: true,
  };
}

/**
 * 解析《寄存器结构表》xlsx：读取「寄存器表」工作表，按页块堆叠格式抽出 PAGE 定义。
 * 页头用 startsWith 匹配，兼容 0xF0 行 A 列把页名写进去的脏数据。
 */
export function parseRegisterWorkbook(data: ArrayBuffer): PageDef[] {
  const wb = XLSX.read(data, { type: "array" });
  const sheetName = wb.SheetNames.find((n) => n.includes("寄存器")) ?? wb.SheetNames[0];
  if (!sheetName) throw new Error("工作簿中没有任何工作表");
  const sheet = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const pages: PageDef[] = [];
  let cur: { name: string; id: number | null; regs: RegDef[] } | null = null;
  let inFields = false;

  const flush = () => {
    if (!cur) return;
    if (cur.id == null) throw new Error(`页「${cur.name}」缺少页数值`);
    pages.push(finalizePage({ name: cur.name, id: cur.id, regs: cur.regs }));
    cur = null;
    inFields = false;
  };

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const a = cellStr(row[0]);
    const b = cellStr(row[1]);
    const nonempty = row.some((c) => cellStr(c) !== "");

    if (!nonempty) {
      flush();
      continue;
    }

    if (a.startsWith("页显示名称")) {
      flush();
      // B 列为干净英文名；A 列可能是「页显示名称        ProdInfo」
      const name = b || a.replace(/^页显示名称/, "").trim();
      if (!name) throw new Error(`第 ${i + 1} 行：页显示名称为空`);
      cur = { name, id: null, regs: [] };
      inFields = false;
      continue;
    }

    if (a.startsWith("页数值")) {
      if (!cur) throw new Error(`第 ${i + 1} 行：页数值出现在页显示名称之前`);
      const raw = b || a.replace(/^页数值/, "").trim();
      cur.id = parseHexOrNum(raw, `第 ${i + 1} 行页数值`);
      continue;
    }

    if (a.startsWith("偏移地址") || a === "偏移") {
      inFields = true;
      continue;
    }

    if (!inFields || !cur) continue;

    const name = cellStr(row[2]);
    if (!name) continue;

    const offset = parseHexOrNum(a, `第 ${i + 1} 行偏移地址`);
    const len = parseHexOrNum(b, `第 ${i + 1} 行字节长度`);
    const label = cellStr(row[3]) || name;
    const access = mapAccess(cellStr(row[4]));
    const dtype = mapDtype(cellStr(row[5]), len);
    const scaleRaw = cellStr(row[6]);
    const scale = scaleRaw ? Number(scaleRaw) : 1;
    if (!Number.isFinite(scale) || scale <= 0) throw new Error(`第 ${i + 1} 行缩放倍率无效：${scaleRaw}`);

    cur.regs.push({ name, label, offset, len, access, dtype, scale });
  }
  flush();

  if (pages.length === 0) throw new Error("未解析到任何寄存器页，请确认工作表格式为「页显示名称 / 页数值 / 字段表」");
  return pages;
}
