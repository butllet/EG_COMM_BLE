export type DataHandler = (d: Uint8Array) => void;
export type CloseHandler = (reason: string) => void;

export interface ITransport {
  readonly name: string;
  onData: DataHandler;
  onClose: CloseHandler;
  open(): Promise<void>;
  close(): Promise<void>;
  send(d: Uint8Array): Promise<void>;
  describe(): string;
  /** 当前打开波特率（OTA 协商时会临时改） */
  getBaud(): number;
  /** 同一端口关再开以切换波特率（不弹选择框） */
  changeBaud(baud: number): Promise<void>;
}

/* ================= 真实串口（Web Serial API，Windows Chrome/Edge 可用） ================= */
export class WebSerialTransport implements ITransport {
  readonly name = "真实串口";
  onData: DataHandler = () => {};
  onClose: CloseHandler = () => {};

  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private intentional = false;
  /** 正在为改波特率关闭读循环，此时不要当成掉线 */
  private reconfiguring = false;
  private readFinished: Promise<void> = Promise.resolve();
  private baud: number;

  constructor(baud: number) {
    this.baud = baud;
  }

  getBaud(): number {
    return this.baud;
  }

  async open(): Promise<void> {
    if (!("serial" in navigator) || !navigator.serial) {
      throw new Error("当前浏览器不支持 Web Serial API（请使用 Chrome / Edge，且需要 HTTPS 或 localhost）");
    }
    this.port = await navigator.serial.requestPort(); // 用户取消会抛 NotFoundError
    await this.openPort();
  }

  /** 打开已选中的 SerialPort（首次连接与改波特率共用） */
  private async openPort(): Promise<void> {
    if (!this.port) throw new Error("串口未打开");
    await this.port.open({
      baudRate: this.baud,
      dataBits: 8,
      stopBits: 1,
      parity: "none",
      flowControl: "none",
    }); // 8N1
    this.intentional = false;
    this.reconfiguring = false;
    if (this.port.writable) this.writer = this.port.writable.getWriter();
    void this.readLoop();
  }

  /**
   * OTA 步骤 2：先 9600 发裸波特率参数，MCU ACK 后再切到 9600/115200。
   * Web Serial 不能热改波特率，只能释放读写锁 → close → 同一 port 再 open。
   */
  async changeBaud(baud: number): Promise<void> {
    if (!this.port) throw new Error("串口未打开");
    if (this.baud === baud) return;
    this.reconfiguring = true;
    this.baud = baud;
    try {
      try { await this.reader?.cancel(); } catch { /* noop */ }
      await this.readFinished;
      try { this.writer?.releaseLock(); } catch { /* noop */ }
      this.writer = null;
      this.reader = null;
      try { await this.port.close(); } catch { /* noop */ }
      await this.openPort();
    } catch (err) {
      this.reconfiguring = false;
      throw err;
    }
  }

  private async readLoop() {
    if (!this.port?.readable) return;
    let resolveFinished: () => void = () => {};
    this.readFinished = new Promise((r) => { resolveFinished = r; });
    this.reader = this.port.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;
        if (value && value.length > 0) this.onData(value);
      }
    } catch {
      /* 读取失败 / cancel，走关闭或改波特率 */
    } finally {
      try { this.reader?.releaseLock(); } catch { /* noop */ }
      this.reader = null;
      resolveFinished();
      // 改波特率或主动断开：由调用方继续关/开端口，这里不要 onClose
      if (this.reconfiguring || this.intentional) return;
      this.onClose("串口连接已断开");
      try { await this.port?.close(); } catch { /* noop */ }
      this.port = null;
    }
  }

  async send(d: Uint8Array): Promise<void> {
    if (!this.writer) throw new Error("串口未打开");
    await this.writer.write(d);
  }

  async close(): Promise<void> {
    this.intentional = true;
    try { await this.reader?.cancel(); } catch { /* noop */ }
    await this.readFinished;
    try { this.writer?.releaseLock(); } catch { /* noop */ }
    this.writer = null;
    try { await this.port?.close(); } catch { /* noop */ }
    this.port = null;
  }

  describe(): string {
    try {
      const info = this.port?.getInfo() ?? {};
      if (info.usbVendorId) {
        return `串口设备 (USB ${info.usbVendorId.toString(16).padStart(4, "0")}:${(info.usbProductId ?? 0).toString(16).padStart(4, "0")})`;
      }
    } catch { /* noop */ }
    return `串口设备 @ ${this.baud}`;
  }
}
