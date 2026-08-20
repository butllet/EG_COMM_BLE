import { useMemo, type ReactNode } from "react";
import { BookOpenText, CircleHelp } from "lucide-react";
import { buildFrame, CMD, parseFrame, protoIdToHex } from "../lib/protocol";
import { FrameAnatomy } from "./FrameAnatomy";
import { Badge, Card } from "./ui";

/* ================= 协议文档 ================= */
const THc = "border border-white/[0.07] bg-white/[0.04] px-3 py-1.5 text-left text-[10.5px] font-semibold text-zinc-400";
const TDc = "border border-white/[0.05] px-3 py-1.5 text-[12px] text-zinc-300";
const TDm = TDc + " hex-cell";

function DocTable({ head, rows }: { head: string[]; rows: (string | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg">
      <table className="w-full min-w-[560px] border-collapse">
        <thead>
          <tr>{head.map((h) => <th key={h} className={THc}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-white/[0.02]">
              {r.map((c, j) => (
                <td key={j} className={typeof c === "string" && c.startsWith("0x") ? TDm : TDc}>{c}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ProtocolDocs({ protoId }: { protoId: [number, number] }) {
  const example = useMemo(
    () => parseFrame(buildFrame(CMD.READ, 0x00, 0x02, Uint8Array.of(2))),
    [protoId],
  );
  const idHex = `0x${protoIdToHex(protoId, "")}`;

  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-2">
      <Card title="EGmicroChameleonComm · 帧格式" icon={<BookOpenText size={13} />}>
        <p className="mb-3 text-[12px] leading-relaxed text-zinc-500">
          一切帧均为二进制结构：<span className="hex-cell text-zinc-300">HEAD(2) + ID(2) + CMD(1) + PAGE(1) + ADDR(1) + LEN(1) + DATA(N) + CRC16(2 小端) + TAIL(2)</span>。
          串口参数固定 <Badge>8N1</Badge>，波特率由界面选择。协议 ID 可在侧栏或帧构建页修改，全局生效。
        </p>
        <FrameAnatomy frame={example} title="示例：PAGE=0x00 从 ADDR=0x02 读取 2 字节（读请求）" />
        <div className="mt-4">
          <DocTable
            head={["字段", "字节数", "默认值", "说明"]}
            rows={[
              ["HEAD", "2", "0xEB90", "帧头"],
              ["ID", "2", idHex, "协议 ID（可配置，默认 0x1155）"],
              ["CMD", "1", "—", "命令字（读 0x52 / 写 0x57 / 升级 0x05）"],
              ["PAGE", "1", "—", "页号，来自 Excel 结构体页数值（可导入）"],
              ["ADDR", "1", "—", "偏移地址，结构体内寄存器起始地址"],
              ["LEN", "1", "—", "数据区长度 0~255"],
              ["DATA", "N", "—", "数据区"],
              ["CRC16", "2", "—", "CRC-16/XMODEM，小端发送（低字节在前）"],
              ["TAIL", "2", "0xBE09", "尾帧"],
            ]}
          />
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="CRC16/XMODEM · 校验" icon={<BookOpenText size={13} />}>
          <DocTable
            head={["参数", "取值"]}
            rows={[
              ["多项式", "0x1021"],
              ["初始值", "0x0000"],
              ["结果异或", "0x0000"],
              ["计算范围", "ID → DATA 结束（含 ID/CMD/PAGE/ADDR/LEN/DATA，不含 HEAD/TAIL/CRC）"],
              ["发送字节序", "小端（先发 CRC_L，再发 CRC_H）"],
            ]}
          />
        </Card>

        <Card title="命令字 · 响应规则" icon={<BookOpenText size={13} />}>
          <DocTable
            head={["命令", "请求 CMD", "响应 CMD"]}
            rows={[
              ["读寄存器", "0x52", "0xAD"],
              ["写寄存器", "0x57", "0xA8"],
              ["升级", "0x05", "0xFA"],
            ]}
          />
          <p className="mt-2.5 text-[12px] leading-relaxed text-zinc-500">
            响应命令字 = 请求命令字<span className="hex-cell text-amber-300"> 按位取反 </span>
            (<span className="hex-cell">0x52 ^ 0xFF = 0xAD</span>)。
            调试时若响应 CMD 不是期望值，直接判定失败。
          </p>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="读写规则 · 单次 / 批量" icon={<BookOpenText size={13} />}>
          <ul className="space-y-2 text-[12px] leading-relaxed text-zinc-400">
            <li><Badge tone="cyan">读请求</Badge> <span className="hex-cell">LEN=1，DATA=[期望读取字节数]</span>；读响应必须 CMD=0xAD 且 PAGE/ADDR 与请求一致。</li>
            <li><Badge tone="amber">写请求</Badge> <span className="hex-cell">LEN=payload 长度，DATA=payload</span>；写响应固定 LEN=1、DATA[0]=状态码。</li>
            <li><Badge tone="violet">批量读</Badge> 从 ADDR=0 起读取该页面全部成员总长度。</li>
            <li><Badge tone="violet">批量写</Badge> 从 ADDR=0 起写入整页总长：可写字段按设定值填充，只读字段填 0x00。</li>
          </ul>
        </Card>

        <Card title="写响应状态码（DATA[0]）" icon={<BookOpenText size={13} />}>
          <DocTable
            head={["状态码", "含义"]}
            rows={[
              ["0x00", "写OK（唯一成功码，收到后才更新当前值）"],
              ["0x01", "页不存在"],
              ["0x02", "地址越界"],
              ["0x03", "当前页不允许写"],
              ["0x04", "长度非法"],
              ["0x05", "参数错误"],
              ["0x06", "命令不支持"],
            ]}
          />
        </Card>
      </div>

      <Card title="数据类型 · 缩放倍率" icon={<BookOpenText size={13} />}>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <DocTable
              head={["类型", "字节序 / 规则"]}
              rows={[
                ["uint8 / uint16 / uint32", "小端"],
                ["int8 / int16 / int32", "小端"],
                ["float (IEEE754)", "小端"],
                ["char[N]", "ASCII，遇 0x00 截断；写入右侧补 0x00"],
                ["uint8[N] / bytes", "原始 HEX，不当字符串"],
              ]}
            />
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-black/25 p-3.5 text-[12px] leading-relaxed text-zinc-400">
            <p className="font-semibold text-zinc-300">缩放仅对 uint 类型生效：</p>
            <p className="hex-cell mt-1.5 text-cyan-200/90">显示值 = 原始值 × 倍率</p>
            <p className="hex-cell text-amber-200/90">写入原始值 = floor(设定值 ÷ 倍率)</p>
            <p className="mt-2 text-zinc-500">
              例：倍率 0.01，界面输入 12.34 → MCU 收到 <span className="hex-cell text-zinc-200">floor(12.34 / 0.01) = 1234</span>。
              有符号整型与 float 不缩放。char / bytes 不缩放。
            </p>
          </div>
        </div>
      </Card>

      <Card title="通信成功判定标准" icon={<BookOpenText size={13} />}>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3.5 text-[12px] leading-relaxed text-emerald-200/80">
            <p className="font-semibold text-emerald-300">读成功</p>
            收到 CMD=0xAD 且 PAGE/ADDR 匹配 且 CRC 正确 → 刷新“当前值”。
          </div>
          <div className="rounded-xl border border-emerald-400/20 bg-emerald-400/[0.05] p-3.5 text-[12px] leading-relaxed text-emerald-200/80">
            <p className="font-semibold text-emerald-300">写成功</p>
            收到 CMD=0xA8 且 LEN=1 且 DATA[0]=0x00 且 CRC 正确 → 刷新“当前值”。
          </div>
        </div>
      </Card>
    </div>
  );
}

/* ================= 用户使用说明（独立 Tab） ================= */
export function UserGuide() {
  return (
    <div className="mx-auto max-w-4xl space-y-4 pb-2">
      <Card title="用户使用说明" icon={<CircleHelp size={13} />}>
        <p className="mb-4 text-[12.5px] leading-relaxed text-zinc-500">
          本页说明如何用这套 Web 上位机连接设备、导入寄存器表、读写寄存器、OTA 升级，以及如何用帧构建/解析做合法通信和异常帧测试。
        </p>
        <ol className="space-y-3.5 text-[12.5px] leading-relaxed text-zinc-400">
          <li>
            <p className="font-semibold text-zinc-200">1. 环境与连接</p>
            <p className="mt-1">
              请使用 Windows 版 Chrome / Edge（需 HTTPS 或 localhost）。左侧选择波特率（默认 115200，8N1 固定），点击
              <span className="text-cyan-300">「选择并打开串口」</span>。不支持的浏览器会提示无法使用 Web Serial。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">2. 协议 ID</p>
            <p className="mt-1">
              默认 ID 为 <span className="hex-cell text-violet-300">11 55</span>。可在侧栏「Frame · 帧参数」或「帧构建」页修改，
              全局立刻生效（组帧、解析、校验共用），并会记住下次打开。ID 必须与固件一致，否则对端会丢弃帧，读请求会等待 0xAD 超时。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">3. 导入寄存器页（Excel）</p>
            <p className="mt-1">
              侧栏 Pages 区点击<span className="text-cyan-300">「导入」</span>，选择《寄存器结构表》xlsx（工作表「寄存器表」）。
              解析后会替换调试页列表（含 0xF0 ProdInfo 等）。可用「内置」恢复 SysConfig / DisplayReg。导入结果会保存在浏览器本地。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">4. 寄存器调试</p>
            <p className="mt-1">
              单次读/写针对当前行的偏移与长度；「读取整页 / 写入整页」从 ADDR=0 起按页总长操作。
              只读字段不能写；批量写时只读位填 0x00。char 按 ASCII 显示（遇 0x00 截断），写入右侧补零；
              uint8[]（如 chip_uid）按 HEX 显示。自动轮询会周期性读取<strong>当前选中页</strong>，对端无 0xAD 时应关闭轮询以免刷日志。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">5. 帧构建（左侧）</p>
            <p className="mt-1">
              填写 CMD / PAGE / ADDR / DATA 后，工具会自动补 HEAD、当前 ID、LEN、CRC、TAIL，再发送并等待对应响应
              （读 0xAD / 写 0xA8）。适合发<strong>合法帧</strong>。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">6. 帧解析器直发（右侧，异常测试）</p>
            <p className="mt-1">
              在 HEX 输入框粘贴完整帧（可故意改坏 CRC、截断、改错 ID）。点击
              <span className="text-cyan-300">「发送并等待响应」</span>会<strong>按原文直发、不重组</strong>。
              用于测试对端是否丢弃错误帧。无回包将在 1000ms 超时，这通常表示对端按协议丢弃了该帧。
              可先点「CRC 损坏帧」示例再发送。测试时请关闭自动轮询，避免抢响应。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">7. OTA 升级</p>
            <p className="mt-1">
              先连接串口，在「OTA 升级」页选择 <span className="hex-cell text-zinc-300">.bin</span> 固件，选低速 9600 或高速 115200，点「下载」。
              流程与桌面版一致：升级请求 <span className="hex-cell text-violet-300">CMD=0x05 DATA=ROMUPGRADE</span>，
              再以 9600 发送 4 字节裸波特率，设备回 ACK(0x06) 后切到所选速率；确认菜单后走 YModem。
              升级期间会独占串口并暂停寄存器读写/轮询，结束后恢复侧栏波特率。Web Serial 改波特率需要短暂关闭再打开同一端口。
            </p>
          </li>
          <li>
            <p className="font-semibold text-zinc-200">8. 底部日志</p>
            <p className="mt-1">
              TX / RX 显示十六进制与解析结果。默认「隐藏轮询」会滤掉轮询收发。状态栏可看 TX/RX 字节数：
              TX 增加而 RX 始终为 0，说明设备完全无回包（接线、波特率或帧头/ID 不匹配）。
            </p>
          </li>
        </ol>
      </Card>
    </div>
  );
}
