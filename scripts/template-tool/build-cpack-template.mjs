import fs from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const sourcePath = "F:/Work/Trae/egmicrochameleoncomm-protocol-specification/寄存器结构表.xlsx";
const outputPath = "F:/Work/Trae/egmicrochameleoncomm-protocol-specification/templates/CPack模板.xlsx";
const source = XLSX.readFile(sourcePath);
const rows = XLSX.utils.sheet_to_json(source.Sheets["寄存器表"], { header: 1, defval: "", raw: false });
const workbook = Workbook.create();
const info = workbook.worksheets.add("芯片信息");
const registers = workbook.worksheets.add("寄存器表");
info.showGridLines = false;
registers.showGridLines = false;

info.getRange("A1:C1").values = [["CPack 芯片信息模板", "", ""]];
info.getRange("A1:D1").format = { fill: "#083344", font: { bold: true, color: "#CFFAFE", size: 16 }, horizontalAlignment: "center", verticalAlignment: "center" };
info.getRange("A1:D1").format.rowHeight = 30;
info.getRange("A3:C3").values = [["字段", "填写值", "说明"]];
info.getRange("A3:C3").format = { fill: "#155E75", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center" };
info.getRange("A4:C8").values = [
  ["芯片名称", "EGmicro Chameleon", "显示在芯片选择页和顶部"],
  ["芯片 ID", "egmicro-chameleon", "唯一键：字母、数字、点、下划线、连字符"],
  ["协议 ID", "0D AB", "固定 2 字节 HEX，格式如 0D AB"],
  ["串口波特率", 115200, "正整数；装载芯片后自动应用"],
  ["Pack 版本", "1.0.0", "建议使用语义化版本号"],
];
info.getRange("A4:A8").format = { fill: "#ECFEFF", font: { bold: true, color: "#164E63" } };
info.getRange("B4:B8").format = { fill: "#FFFFFF" };
info.getRange("C4:C8").format = { font: { color: "#475569" }, wrapText: true };
info.getRange("A3:C8").format.borders = { style: "continuous", color: "#BAE6FD" };
info.getRange("A1:C8").format.font = { name: "Microsoft YaHei", size: 10 };
info.getRange("A1").format.font = { name: "Microsoft YaHei", size: 16, bold: true, color: "#CFFAFE" };
info.getRange("A:A").format.columnWidth = 18;
info.getRange("B:B").format.columnWidth = 25;
info.getRange("C:C").format.columnWidth = 44;
info.getRange("C4:C8").format.rowHeight = 30;
info.freezePanes.freezeRows(3);

registers.getRange("A1:G1").values = [["CPack 寄存器表", "", "", "", "", "", ""]];
registers.getRange("A1:G1").format = { fill: "#083344", font: { bold: true, color: "#CFFAFE", size: 15 }, horizontalAlignment: "center", verticalAlignment: "center" };
registers.getRange("A1:G1").format.rowHeight = 28;
registers.getRange("A2:G2").values = [["按页块填写：页显示名称 → 页数值 → 字段标题 → 寄存器行；页块之间保留空行。", "", "", "", "", "", ""]];
registers.getRange("A2:G2").format = { fill: "#ECFEFF", font: { color: "#155E75", italic: true }, wrapText: true };
registers.getRangeByIndexes(2, 0, rows.length, 7).values = rows.map((row) => Array.from({ length: 7 }, (_, index) => row[index] ?? ""));
for (let index = 0; index < rows.length; index++) {
  const value = String(rows[index][0] ?? "");
  const target = registers.getRangeByIndexes(index + 2, 0, 1, 7);
  if (value.startsWith("页显示名称")) target.format = { fill: "#155E75", font: { bold: true, color: "#FFFFFF" } };
  else if (value.startsWith("页数值")) target.format = { fill: "#CFFAFE", font: { bold: true, color: "#164E63" } };
  else if (value.startsWith("偏移地址")) target.format = { fill: "#0E7490", font: { bold: true, color: "#FFFFFF" }, horizontalAlignment: "center" };
}
registers.getRange(`A3:G${rows.length + 2}`).format.borders = { style: "continuous", color: "#E2E8F0" };
for (const [column, width] of [["A:A", 14], ["B:B", 14], ["C:C", 26], ["D:D", 25], ["E:E", 14], ["F:F", 16], ["G:G", 14]]) {
  registers.getRange(column).format.columnWidth = width;
}
registers.freezePanes.freezeRows(2);

await fs.mkdir(path.dirname(outputPath), { recursive: true });
console.log((await workbook.inspect({ kind: "table", range: "芯片信息!A1:C8", include: "values", tableMaxRows: 8, tableMaxCols: 3 })).ndjson);
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
const preview = await workbook.render({ sheetName: "芯片信息", range: "A1:C8", scale: 2, format: "png" });
await fs.writeFile("F:/Work/Trae/egmicrochameleoncomm-protocol-specification/templates/CPack模板-预览.png", new Uint8Array(await preview.arrayBuffer()));
const registerPreview = await workbook.render({ sheetName: "寄存器表", range: "A1:G35", scale: 1, format: "png" });
await fs.writeFile("F:/Work/Trae/egmicrochameleoncomm-protocol-specification/templates/CPack模板-寄存器表预览.png", new Uint8Array(await registerPreview.arrayBuffer()));
console.log(outputPath);
