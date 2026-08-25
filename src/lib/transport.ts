export type DataHandler = (d: Uint8Array) => void;
export type CloseHandler = (reason: string) => void;
export type TransportKind = "serial" | "bluetooth";

// Web Bluetooth 的 UUID 校验要求标准小写格式。
export const CH572_BLE_SERVICE_UUID = "9a7f0001-3b72-4f8a-9c6d-2e1b5a70c572";
export const CH572_BLE_WRITE_UUID = "9a7f0002-3b72-4f8a-9c6d-2e1b5a70c572";
export const CH572_BLE_NOTIFY_UUID = "9a7f0003-3b72-4f8a-9c6d-2e1b5a70c572";

export interface ITransport {
  readonly name: string;
  readonly kind: TransportKind;
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
  readonly kind = "serial" as const;
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

/**
 * CH572 BLE GATT 透明桥接。
 * Notify 流是 UART → BLE；Write Without Response 是 BLE → UART。
 */
export class WebBluetoothTransport implements ITransport {
  readonly name = "蓝牙透传";
  readonly kind = "bluetooth" as const;
  onData: DataHandler = () => {};
  onClose: CloseHandler = () => {};

  private device: BluetoothDevice | null = null;
  private gatt: BluetoothRemoteGATTServer | null = null;
  private writeCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyCharacteristic: BluetoothRemoteGATTCharacteristic | null = null;
  private deviceName = "CH572 BLE";
  private intentional = false;

  constructor(private readonly deviceNameFilter = "") {}

  private readonly handleNotification = (event: Event) => {
    const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
    if (!value || value.byteLength === 0) return;
    const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    this.onData(bytes);
  };

  private readonly handleDisconnected = () => {
    this.clearCharacteristics();
    if (!this.intentional) this.onClose("蓝牙连接已断开");
  };

  getBaud(): number {
    // CH572 固件侧的透明 UART 固定为 115200-8-N-1。
    return 115200;
  }

  async open(): Promise<void> {
    if (!("bluetooth" in navigator) || !navigator.bluetooth) {
      throw new Error("当前浏览器不支持 Web Bluetooth（请使用 Chrome / Edge，并在 HTTPS 或 localhost 下访问）");
    }

    this.intentional = false;
    try {
      const name = this.deviceNameFilter.trim();
      this.device = await navigator.bluetooth.requestDevice({
        filters: [{
          services: [CH572_BLE_SERVICE_UUID],
          ...(name ? { name } : {}),
        }],
      });
      this.deviceName = this.device.name || "CH572 BLE";
      this.device.addEventListener("gattserverdisconnected", this.handleDisconnected);
      if (!this.device.gatt) throw new Error("所选蓝牙设备不提供 GATT 服务");

      this.gatt = await this.device.gatt.connect();
      const service = await this.gatt.getPrimaryService(CH572_BLE_SERVICE_UUID);
      this.writeCharacteristic = await service.getCharacteristic(CH572_BLE_WRITE_UUID);
      this.notifyCharacteristic = await service.getCharacteristic(CH572_BLE_NOTIFY_UUID);
      if (!this.writeCharacteristic.properties.writeWithoutResponse) {
        throw new Error("设备缺少 BLE → UART Write Without Response 特征（…0002）");
      }
      if (!this.notifyCharacteristic.properties.notify) {
        throw new Error("设备缺少 UART → BLE Notify 特征（…0003）");
      }

      this.notifyCharacteristic.addEventListener("characteristicvaluechanged", this.handleNotification);
      await this.notifyCharacteristic.startNotifications();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.gatt?.connected || !this.writeCharacteristic) throw new Error("蓝牙未连接");
    // CH572 桥接固件按 20B 单包接收；间隔避免连续写导致无线缓冲溢出。
    for (let offset = 0; offset < data.length; offset += 20) {
      await this.writeCharacteristic.writeValueWithoutResponse(data.slice(offset, offset + 20));
      if (offset + 20 < data.length) await new Promise<void>((resolve) => window.setTimeout(resolve, 10));
    }
  }

  async changeBaud(): Promise<void> {
    throw new Error("蓝牙透传的桥接 UART 固定为 115200 bps，不能在网页中切换波特率");
  }

  async close(): Promise<void> {
    this.intentional = true;
    try { this.notifyCharacteristic?.removeEventListener("characteristicvaluechanged", this.handleNotification); } catch { /* noop */ }
    try { await this.notifyCharacteristic?.stopNotifications(); } catch { /* noop */ }
    try { this.gatt?.disconnect(); } catch { /* noop */ }
    try { this.device?.removeEventListener("gattserverdisconnected", this.handleDisconnected); } catch { /* noop */ }
    this.clearCharacteristics();
    this.device = null;
  }

  describe(): string {
    return `${this.deviceName} · BLE 透传 · UART 115200bps`;
  }

  private clearCharacteristics() {
    try { this.notifyCharacteristic?.removeEventListener("characteristicvaluechanged", this.handleNotification); } catch { /* noop */ }
    this.writeCharacteristic = null;
    this.notifyCharacteristic = null;
    this.gatt = null;
  }
}
