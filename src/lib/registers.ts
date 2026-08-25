import type { DType } from "./protocol";

/* 寄存器定义 —— 来自已装载 Chip Pack 的 pages 清单。
 * PAGE 来自页数值，ADDR 来自每个寄存器的偏移地址。
 */

export type Access = "R" | "W/R";

export interface RegDef {
  name: string;      // 寄存器名称
  label: string;     // 页面显示名称
  offset: number;    // 偏移地址 ADDR
  len: number;       // 字节长度
  access: Access;    // 读写权限
  dtype: DType;      // 数据类型
  scale: number;     // 缩放倍率（仅 uint 生效）
}

export interface PageDef {
  id: number;        // 页数值
  name: string;      // 页显示名称
  cn: string;
  writable: boolean; // 页面是否允许写（存在任一 W/R 字段即为可写页）
  totalLen: number;  // 全部成员总长度（批量读写用）
  regs: RegDef[];
  imported?: boolean; // 是否来自外部 Chip Pack
}

export const DEFAULT_PAGES: PageDef[] = [
  {
    id: 0x00,
    name: "SysConfig",
    cn: "系统配置页",
    writable: true,
    totalLen: 20,
    regs: [
      { name: "PartState", label: "工作状态", offset: 0, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "data1", label: "数据1", offset: 2, len: 2, access: "W/R", dtype: "uint16", scale: 0.1 },
      { name: "VoutSet", label: "输出电压设置", offset: 4, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "IoutSet", label: "输出电流设置", offset: 6, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "VinCalibrate", label: "输入电压校准", offset: 8, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "IinCalibrate", label: "母线电压校准", offset: 10, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "VoutCalibrate", label: "输出电压校准", offset: 12, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "IoutCalibrate", label: "输出电流校准", offset: 14, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "VbatCalibrate", label: "电池电压校准", offset: 16, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
      { name: "VauxCalibrate", label: "辅助电压校准", offset: 18, len: 2, access: "W/R", dtype: "uint16", scale: 1 },
    ],
  },
  {
    id: 0x01,
    name: "DisplayReg",
    cn: "显示寄存器页",
    writable: false,
    totalLen: 28,
    regs: [
      { name: "FaultStatus", label: "错误状态", offset: 0, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "WorkStatus", label: "工作状态", offset: 2, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "VinDisplay", label: "输入电压", offset: 4, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "IinDisplay", label: "母线电压", offset: 6, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "VoutDisplay", label: "输出电压", offset: 8, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "IoutDisplay", label: "输出电流", offset: 10, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "VbatDisplay", label: "电池电压", offset: 12, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "IbatDisplay", label: "电池电流", offset: 14, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "T1", label: "温度1", offset: 16, len: 2, access: "R", dtype: "int16", scale: 1 },
      { name: "T2", label: "温度2", offset: 18, len: 2, access: "R", dtype: "int16", scale: 1 },
      { name: "version", label: "版本", offset: 20, len: 4, access: "R", dtype: "int32", scale: 1 },
      { name: "power_order", label: "功率序号", offset: 24, len: 2, access: "R", dtype: "uint16", scale: 1 },
      { name: "data1", label: "数据1", offset: 26, len: 2, access: "R", dtype: "uint16", scale: 1 },
    ],
  },
];

/** 在给定页列表中查找页定义；找不到则回退到第一页 */
export const pageOf = (pages: PageDef[], id: number): PageDef =>
  pages.find((p) => p.id === id) ?? pages[0];

export const regKey = (pageId: number, offset: number) => `${pageId}:${offset}`;
