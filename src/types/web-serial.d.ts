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
    readonly bluetooth?: Bluetooth;
  }

  type BluetoothServiceUUID = number | string;
  type BluetoothCharacteristicUUID = number | string;

  interface Bluetooth {
    requestDevice(options: BluetoothRequestDeviceOptions): Promise<BluetoothDevice>;
  }

  interface BluetoothRequestDeviceOptions {
    filters?: BluetoothLEScanFilter[];
    optionalServices?: BluetoothServiceUUID[];
    acceptAllDevices?: boolean;
  }

  interface BluetoothLEScanFilter {
    services?: BluetoothServiceUUID[];
    name?: string;
    namePrefix?: string;
  }

  interface BluetoothDevice extends EventTarget {
    readonly id: string;
    readonly name?: string;
    readonly gatt?: BluetoothRemoteGATTServer;
  }

  interface BluetoothRemoteGATTServer {
    readonly connected: boolean;
    connect(): Promise<BluetoothRemoteGATTServer>;
    disconnect(): void;
    getPrimaryService(service: BluetoothServiceUUID): Promise<BluetoothRemoteGATTService>;
  }

  interface BluetoothRemoteGATTService {
    getCharacteristic(characteristic: BluetoothCharacteristicUUID): Promise<BluetoothRemoteGATTCharacteristic>;
  }

  interface BluetoothCharacteristicProperties {
    readonly write?: boolean;
    readonly writeWithoutResponse?: boolean;
    readonly notify?: boolean;
  }

  interface BluetoothRemoteGATTCharacteristic extends EventTarget {
    readonly properties: BluetoothCharacteristicProperties;
    readonly value: DataView | null;
    startNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    stopNotifications(): Promise<BluetoothRemoteGATTCharacteristic>;
    writeValueWithoutResponse(value: BufferSource): Promise<void>;
  }
}
