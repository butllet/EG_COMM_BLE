export {};

declare global {
  interface SerialPortOpenOptions {
    baudRate: number;
    dataBits?: number;
    stopBits?: number;
    parity?: "none" | "even" | "odd";
    flowControl?: "none" | "hardware";
  }

  interface SerialPort extends EventTarget {
    open(options: SerialPortOpenOptions): Promise<void>;
    close(): Promise<void>;
    getInfo(): { usbVendorId?: number; usbProductId?: number };
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
  }

  interface Navigator {
    readonly serial?: {
      requestPort(options?: unknown): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }
}
