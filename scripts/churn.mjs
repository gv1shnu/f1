// Run against the local debug browser session, after one warmup join/leave.
import { WebSocket } from 'ws';
import { once } from 'node:events';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const count = Number(process.env.CYCLES || 100),
  url = process.env.CHURN_URL || 'ws://127.0.0.1:3000/ws';
for (let i = 0; i < count; i++) {
  const ws = new WebSocket(url);
  await once(ws, 'open');
  ws.send(
    JSON.stringify({
      type: 'state',
      state: {
        x: Number(process.env.CAR_X || 0),
        z: Number(process.env.CAR_Z || 10),
        h: 0,
        s: 0,
        v: 0,
        seq: 1,
        reset: 0,
      },
    }),
  );
  ws.send(JSON.stringify({ type: 'name', name: `Join${i}` }));
  await pause(150);
  ws.send(JSON.stringify({ type: 'name', name: `Rename${i}` }));
  await pause(150);
  ws.close();
  await once(ws, 'close');
  await pause(150);
}
console.log(`${count} join/rename/leave cycles completed`);
