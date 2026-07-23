const noble = require('@abandonware/noble');
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 8080 });
console.log('WebSocket server started on port 8080');

let connectedDevice = null;
let targetCharacteristic = null;

// Svakom BLE service/characteristic UUIDs (common ones)
const SERVICE_UUID = '6e400001b5a3f393e0a9e50e24dcca9e';
const WRITE_UUID = '6e400002b5a3f393e0a9e50e24dcca9e';
const NOTIFY_UUID = '6e400003b5a3f393e0a9e50e24dcca9e';

wss.on('connection', (ws) => {
  console.log('Client connected');

  ws.on('message', async (msg) => {
    try {
      const data = JSON.parse(msg);

      if (data.action === 'scan') {
        startScan(ws);
      } else if (data.action === 'connect' && data.address) {
        await connectDevice(data.address, ws);
      } else if (data.action === 'vibrate' && data.level !== undefined) {
        await sendVibrate(data.level, ws);
      } else if (data.action === 'stop') {
        await sendVibrate(0, ws);
      }
    } catch (e) {
      ws.send(JSON.stringify({ error: e.message }));
    }
  });

  ws.on('close', () => {
    console.log('Client disconnected');
  });
});

function startScan(ws) {
  noble.startScanning([], true);
  noble.on('discover', (peripheral) => {
    const name = peripheral.advertisement.localName || '';
    if (name.toLowerCase().includes('svakom')) {
      ws.send(JSON.stringify({
        event: 'device_found',
        name: name,
        address: peripheral.id,
        rssi: peripheral.rssi
      }));
    }
  });

  setTimeout(() => {
    noble.stopScanning();
    ws.send(JSON.stringify({ event: 'scan_complete' }));
  }, 10000);
}

async function connectDevice(address, ws) {
  noble.stopScanning();

  const peripheral = noble._peripherals[address];
  if (!peripheral) {
    ws.send(JSON.stringify({ error: 'Device not found' }));
    return;
  }

  await new Promise((resolve, reject) => {
    peripheral.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });

  connectedDevice = peripheral;
  console.log('Connected to', peripheral.advertisement.localName);

  peripheral.discoverSomeServicesAndCharacteristics(
    [SERVICE_UUID], [WRITE_UUID, NOTIFY_UUID],
    (err, services, characteristics) => {
      if (err) {
        ws.send(JSON.stringify({ error: err.message }));
        return;
      }
      characteristics.forEach((c) => {
        if (c.uuid === WRITE_UUID) {
          targetCharacteristic = c;
        }
        if (c.uuid === NOTIFY_UUID) {
          c.subscribe();
          c.on('data', (data) => {
            ws.send(JSON.stringify({ event: 'notify', data: data.toString('hex') }));
          });
        }
      });
      ws.send(JSON.stringify({ event: 'connected', name: peripheral.advertisement.localName }));
    }
  );
}

async function sendVibrate(level, ws) {
  if (!targetCharacteristic) {
    ws.send(JSON.stringify({ error: 'Not connected to device' }));
    return;
  }

  // Svakom protocol: vibration command
  const cmd = Buffer.from([0x03, 0x01, Math.min(20, Math.max(0, level))]);
  targetCharacteristic.write(cmd, false, (err) => {
    if (err) {
      ws.send(JSON.stringify({ error: err.message }));
    } else {
      ws.send(JSON.stringify({ event: 'vibrate_set', level: level }));
    }
  });
}
