import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import XLSX from "xlsx";
import { strToU8, zipSync } from "fflate";

const args = Object.fromEntries(process.argv.slice(2).reduce((all, arg, index, list) => {
  if (arg.startsWith("--")) all.push([arg.slice(2), list[index + 1]]);
  return all;
}, []));

function required(name) {
  const value = args[name];
  if (!value || value.startsWith("--")) throw new Error(`缺少 --${name}`);
  return value;
}

function cell(value) { return value == null ? "" : String(value).trim(); }
function number(value, label) {
  const text = cell(value);
  if (!text) throw new Error(`${label}为空`);
  if (/^0x/i.test(text)) return Number.parseInt(text, 16);
  if (/^[0-9a-f]+h$/i.test(text)) return Number.parseInt(text.slice(0, -1), 16);
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) throw new Error(`${label}无法解析：${text}`);
  return parsed;
}
function dtype(value, len) {
  const type = cell(value).toLowerCase();
  if (type === "float32" || type === "float") return "float";
  if (["uint8", "uint16", "uint32", "int8", "int16", "int32"].includes(type)) return type;
  if (type.startsWith("char[")) return "char";
  if (type.startsWith("uint8[")) return "bytes";
  if (type === "enum32" || type.startsWith("enum")) return len >= 4 ? "uint32" : "uint8";
  throw new Error(`未知数据类型：${value}`);
}
function access(value) {
  const text = cell(value).toUpperCase().replace(/\s+/g, "");
  if (text === "R") return "R";
  if (["W/R", "RW", "R/W", "W"].includes(text)) return "W/R";
  throw new Error(`未知读写权限：${value}`);
}

function parseRegisters(workbook) {
  const sheetName = workbook.SheetNames.find((name) => name === "寄存器表");
  if (!sheetName) throw new Error("缺少「寄存器表」工作表");
  if (!sheetName) throw new Error("工作簿中没有工作表");
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "", raw: false });
  const pages = [];
  let current = null;
  let inFields = false;
  const flush = () => {
    if (!current) return;
    if (current.id == null || !current.regs.length) throw new Error(`页 ${current.name} 不完整`);
    const totalLen = Math.max(...current.regs.map((reg) => reg.offset + reg.len));
    pages.push({ id: current.id, name: current.name, cn: current.name, writable: current.regs.some((reg) => reg.access === "W/R"), totalLen, regs: current.regs });
    current = null;
    inFields = false;
  };
  rows.forEach((row, index) => {
    const a = cell(row[0]);
    const b = cell(row[1]);
    if (!row.some((value) => cell(value))) return flush();
    if (a.startsWith("页显示名称")) {
      flush();
      current = { name: b || a.replace(/^页显示名称/, "").trim(), id: null, regs: [] };
      return;
    }
    if (a.startsWith("页数值")) {
      if (!current) throw new Error(`第 ${index + 1} 行缺少页显示名称`);
      current.id = number(b || a.replace(/^页数值/, "").trim(), `第 ${index + 1} 行页数值`);
      return;
    }
    if (a.startsWith("偏移地址") || a === "偏移") { inFields = true; return; }
    if (!current || !inFields || !cell(row[2])) return;
    const len = number(row[1], `第 ${index + 1} 行字节长度`);
    const scale = cell(row[6]) ? Number(row[6]) : 1;
    current.regs.push({ name: cell(row[2]), label: cell(row[3]) || cell(row[2]), offset: number(row[0], `第 ${index + 1} 行偏移地址`), len, access: access(row[4]), dtype: dtype(row[5], len), scale });
  });
  flush();
  return pages;
}

function parseChipInfo(workbook) {
  const sheet = workbook.Sheets["芯片信息"];
  if (!sheet) throw new Error("缺少「芯片信息」工作表");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const fields = new Map(rows.map((row) => [cell(row[0]), cell(row[1])]).filter(([key]) => key));
  const protocolId = requiredFrom(fields, "协议 ID");
  if (!/^[0-9a-fA-F]{2}\s*[0-9a-fA-F]{2}$/.test(protocolId)) throw new Error("芯片信息.协议 ID 必须为 2 字节 HEX，例如 0D AB");
  const baud = Number(requiredFrom(fields, "串口波特率"));
  if (!Number.isInteger(baud) || baud <= 0) throw new Error("芯片信息.串口波特率必须为正整数");
  return {
    chip: { id: requiredFrom(fields, "芯片 ID"), model: requiredFrom(fields, "芯片名称") },
    version: requiredFrom(fields, "Pack 版本"),
    connection: { protocolId: protocolId.replace(/\s+/g, " ").toUpperCase(), baud },
  };
}
function requiredFrom(fields, key) {
  const value = fields.get(key);
  if (!value) throw new Error(`芯片信息缺少「${key}」`);
  return value;
}

const input = required("input");
const workbook = XLSX.readFile(input);
const pack = {
  schemaVersion: 1,
  ...parseChipInfo(workbook),
  pages: parseRegisters(workbook),
};
const json = `${JSON.stringify(pack, null, 2)}\n`;
const output = required("out");
const sourceOutput = required("source-out");
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.mkdirSync(path.dirname(sourceOutput), { recursive: true });
fs.writeFileSync(output, zipSync({ "manifest.json": strToU8(json) }));
fs.writeFileSync(sourceOutput, json);
console.log(`已生成 ${output}（${pack.pages.length} 页）`);
