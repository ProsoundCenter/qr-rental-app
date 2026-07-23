// rfid.js - Doc dau doc RFID UHF Nextwaves (giao thuc NRN) truc tiep tu trinh duyet
// qua Web Serial API (khong can cai app/driver rieng, chi can Chrome/Edge tren may
// tinh + dau doc cam qua cong USB). Duoc port thu cong tu SDK chinh thuc cua Nextwaves
// (Nextwaves-Industries/nextwaves-sdk, thu muc sdk/nation/webserial, giay phep MIT)
// tu TypeScript sang JS thuan vi app nay khong dung build step/bundler.
//
// Web Serial API CHI co tren trinh duyet nen desktop (Chrome/Edge), KHONG co tren
// Safari/iPhone va hau het trinh duyet mobile - vi vay dung song song voi camera QR
// (dung cho dien thoai) va nhap tay/may quet ma vach, khong thay the hoan toan.
//
// Cach dung o cac trang khac: rfidIsSupported() -> kiem tra truoc khi hien nut;
// const rfid = createNRNReader(); await rfid.connect(); await rfid.startInventory([1], tag => ...)
// tag.epc la chuoi hex duy nhat cua the RFID, dung lam "ma" giong het qr_code.

function rfidIsSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

// ---- Hang so giao thuc NRN ----
const _NRN_FRAME_HEADER = 0x5a;
const _NRN_PROTO_TYPE = 0x00;
const _NRN_PROTO_VER = 0x01;

const _NRN_MID = {
  QUERY_INFO: 0x0100,
  READ_EPC_TAG: (0x02 << 8) | 0x10,
  STOP_INVENTORY: (0x02 << 8) | 0xff,
  STOP_OPERATION: 0xff
};

class RfidError extends Error {
  constructor(message) { super(message); this.name = 'RfidError'; }
}

// ---- Ham tien ich giao thuc (CRC16, dong khung, tach khung, doc EPC) ----
const NRNUtils = {
  crc16CCITT(data) {
    let crc = 0x0000;
    for (const byte of data) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) {
        crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  },

  buildPCW(category, mid, rs485, notify) {
    let pcw = (_NRN_PROTO_TYPE << 24) | (_NRN_PROTO_VER << 16);
    if (rs485) pcw |= 1 << 13;
    if (notify) pcw |= 1 << 12;
    pcw |= (category << 8) | mid;
    return pcw;
  },

  buildFrame(mid, payload, rs485, notify) {
    payload = payload || new Uint8Array(0);
    const category = (mid >> 8) & 0xff;
    const midCode = mid & 0xff;
    const pcw = this.buildPCW(category, midCode, !!rs485, !!notify);
    const pcwBytes = new Uint8Array([(pcw >> 24) & 0xff, (pcw >> 16) & 0xff, (pcw >> 8) & 0xff, pcw & 0xff]);
    const addrBytes = rs485 ? new Uint8Array([0x00]) : new Uint8Array(0);
    const lengthBytes = new Uint8Array([(payload.length >> 8) & 0xff, payload.length & 0xff]);
    const frameContent = new Uint8Array([...pcwBytes, ...addrBytes, ...lengthBytes, ...payload]);
    const crc = this.crc16CCITT(frameContent);
    const crcBytes = new Uint8Array([(crc >> 8) & 0xff, crc & 0xff]);
    return new Uint8Array([_NRN_FRAME_HEADER, ...frameContent, ...crcBytes]);
  },

  parseFrame(raw) {
    if (raw.length < 9) throw new RfidError('Khung du lieu qua ngan');
    if (raw[0] !== _NRN_FRAME_HEADER) throw new RfidError('Sai header khung');
    let offset = 1;
    const pcw = (raw[offset] << 24) | (raw[offset + 1] << 16) | (raw[offset + 2] << 8) | raw[offset + 3];
    offset += 4;
    const rs485Flag = (pcw >> 13) & 0x01;
    const category = (pcw >> 8) & 0xff;
    const mid = pcw & 0xff;
    let addr = null;
    if (rs485Flag) { addr = raw[offset]; offset += 1; }
    const dataLen = (raw[offset] << 8) | raw[offset + 1];
    offset += 2;
    if (offset + dataLen + 2 > raw.length) throw new RfidError('Khung bi cat cut / sai do dai');
    const data = raw.slice(offset, offset + dataLen);
    offset += dataLen;
    const receivedCRC = (raw[offset] << 8) | raw[offset + 1];
    const calculatedCRC = this.crc16CCITT(raw.slice(1, offset));
    if (receivedCRC !== calculatedCRC) throw new RfidError('CRC khong khop');
    return { category, mid, address: addr, data, raw };
  },

  extractValidFrames(data, rs485) {
    const frames = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] !== 0x5a) { i++; continue; }
      if (i + 9 > data.length) break;
      const length = (data[i + 5] << 8) | data[i + 6];
      const addrLen = rs485 ? 1 : 0;
      const fullLen = 1 + 4 + addrLen + 2 + length + 2;
      if (i + fullLen > data.length) break;
      const frame = data.slice(i, i + fullLen);
      const crcCalc = this.crc16CCITT(frame.slice(1, -2));
      const crcRecv = (frame[frame.length - 2] << 8) | frame[frame.length - 1];
      if (crcCalc === crcRecv) frames.push(frame);
      i += fullLen;
    }
    return frames;
  }
};

// ---- Lop chinh: ket noi + doc lien tuc the RFID qua Web Serial ----
class NRNWebSerial {
  constructor(options) {
    options = options || {};
    this.baudrate = options.baudrate || 115200;
    this.rs485 = options.rs485 || false;
    this.onLog = options.onLog || function () {};
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.isConnected = false;
    this.isInventoryRunning = false;
    this.inventoryCallback = null;
  }

  _log(level, msg) { try { this.onLog(level, msg); } catch (e) {} }

  static isSupported() { return rfidIsSupported(); }

  async connect() {
    if (!NRNWebSerial.isSupported()) throw new RfidError('Trình duyệt này không hỗ trợ Web Serial (cần Chrome/Edge trên máy tính)');
    this.port = await navigator.serial.requestPort();
    await this.port.open({ baudRate: this.baudrate, dataBits: 8, parity: 'none', stopBits: 1, flowControl: 'none' });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.isConnected = true;
    this._log('info', 'Đã kết nối đầu đọc RFID @ ' + this.baudrate + 'bps');
    try {
      const stopFrame = NRNUtils.buildFrame(_NRN_MID.STOP_INVENTORY, new Uint8Array(0), this.rs485);
      await this._send(stopFrame);
      await this._delay(100);
      await this._receive();
    } catch (e) { /* mot so may khong tra loi STOP khi dang idle, bo qua */ }
    return true;
  }

  async disconnect() {
    try {
      if (this.isInventoryRunning) await this.stopInventory();
      if (this.reader) { try { this.reader.releaseLock(); } catch (e) {} this.reader = null; }
      if (this.writer) { try { this.writer.releaseLock(); } catch (e) {} this.writer = null; }
      if (this.port) { await this.port.close(); this.port = null; }
      this.isConnected = false;
    } catch (e) { this._log('error', 'Loi ngat ket noi: ' + e.message); }
  }

  async _send(data) {
    if (!this.isConnected || !this.writer) throw new RfidError('Chưa kết nối đầu đọc');
    await this.writer.write(data);
  }

  async _receive() {
    if (!this.isConnected || !this.reader) throw new RfidError('Chưa kết nối đầu đọc');
    const { value, done } = await this.reader.read();
    if (done) throw new RfidError('Mất kết nối với đầu đọc');
    return value;
  }

  _delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

  _buildAntennaMask(antennaIds) {
    let mask = 0;
    for (const aid of antennaIds) mask |= 1 << (aid - 1);
    return mask;
  }

  _buildEPCReadPayload(antennaMask, continuous) {
    if (!antennaMask) antennaMask = 0x00000001;
    return new Uint8Array([
      (antennaMask >> 24) & 0xff, (antennaMask >> 16) & 0xff, (antennaMask >> 8) & 0xff, antennaMask & 0xff,
      continuous ? 0x01 : 0x00
    ]);
  }

  _parseEPC(data) {
    try {
      const epcLen = (data[0] << 8) | data[1];
      const epc = Array.from(data.slice(2, 2 + epcLen)).map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      const antennaId = data[2 + epcLen + 2];
      let rssi = null;
      let cursor = 2 + epcLen + 3;
      while (cursor < data.length) {
        const pid = data[cursor];
        cursor++;
        if (pid === 0x01) { if (cursor < data.length) { rssi = -100 + Math.round((data[cursor] * 70) / 255); cursor += 1; } else break; }
        else if (pid === 0x02) { cursor += 1; }
        else if (pid === 0x03) { if (cursor + 1 < data.length) { const l = (data[cursor] << 8) | data[cursor + 1]; cursor += 2 + l; } else break; }
        else if (pid === 0x04 || pid === 0x05) { if (cursor + 1 < data.length) { const l = (data[cursor] << 8) | data[cursor + 1]; cursor += 2 + l; } else break; }
        else if (pid === 0x06) { cursor += 1; }
        else if (pid === 0x07) { cursor += 8; }
        else if (pid === 0x08) { cursor += 4; }
        else if (pid === 0x09) { cursor += 1; }
        else break;
      }
      if (!epc) return { error: 'empty' };
      return { epc, antenna_id: antennaId, rssi };
    } catch (e) {
      return { error: e.message };
    }
  }

  _isReadEndMID(mid) { return [0x01, 0x21, 0x31].includes(mid); }

  // Bat dau doc lien tuc, goi callback(tag) moi lan doc duoc 1 the (tag.epc la ma duy nhat).
  async startInventory(antennaMask, callback) {
    antennaMask = antennaMask || [1];
    await this.stopInventory().catch(() => {});
    this.isInventoryRunning = true;
    this.inventoryCallback = callback || null;
    const mask = this._buildAntennaMask(antennaMask);
    const payload = this._buildEPCReadPayload(mask, true);
    const frame = NRNUtils.buildFrame(_NRN_MID.READ_EPC_TAG, payload, this.rs485);
    await this._send(frame);
    this._receiveInventoryLoop();
    return true;
  }

  async stopInventory() {
    this.isInventoryRunning = false;
    this.inventoryCallback = null;
    if (!this.isConnected) return true;
    try {
      const stopFrame = NRNUtils.buildFrame(_NRN_MID.STOP_INVENTORY, new Uint8Array(0), this.rs485);
      await this._send(stopFrame);
    } catch (e) { /* co the dau doc da rut day, bo qua */ }
    return true;
  }

  async _receiveInventoryLoop() {
    let buffer = new Uint8Array(0);
    while (this.isInventoryRunning) {
      let raw;
      try {
        raw = await this._receive();
      } catch (e) {
        this._log('debug', 'Loi doc du lieu: ' + e.message);
        await this._delay(50);
        continue;
      }
      if (!raw || !raw.length) { await this._delay(10); continue; }
      const merged = new Uint8Array(buffer.length + raw.length);
      merged.set(buffer); merged.set(raw, buffer.length);
      buffer = merged;
      const frames = NRNUtils.extractValidFrames(buffer, this.rs485);
      if (frames.length) {
        const last = frames[frames.length - 1];
        let idx = -1;
        for (let i = 0; i <= buffer.length - last.length; i++) {
          let match = true;
          for (let j = 0; j < last.length; j++) { if (buffer[i + j] !== last[j]) { match = false; break; } }
          if (match) { idx = i; break; }
        }
        if (idx !== -1) buffer = buffer.slice(idx + last.length);
      }
      for (const frame of frames) {
        try {
          const parsed = NRNUtils.parseFrame(frame);
          if (parsed.category === 0x10 || parsed.mid === 0x00) {
            const tag = this._parseEPC(parsed.data);
            if (!tag.error && this.inventoryCallback) this.inventoryCallback(tag);
          } else if (this._isReadEndMID(parsed.mid)) {
            this.isInventoryRunning = false;
            return;
          }
        } catch (e) { /* frame loi/nhieu, bo qua tiep tuc doc */ }
      }
    }
  }
}

function createNRNReader(options) { return new NRNWebSerial(options); }
