import { test, expect } from '@playwright/test';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../../server.js';
async function start(port = 0) {
  const game = createGameServer();
  game.server.listen(port, '127.0.0.1');
  await once(game.server, 'listening');
  return game;
}
const url = (g) => `http://127.0.0.1:${g.server.address().port}`;
async function enter(page, address, name) {
  await page.goto(address + '/#debug');
  await expect(
    page.getByRole('button', { name: 'ENTER THE GRID' }),
  ).toBeEnabled();
  await page.getByRole('textbox', { name: 'Driver name' }).fill('');
  await page
    .getByRole('textbox', { name: 'Driver name' })
    .pressSequentially(name);
  await expect(page.getByRole('textbox')).toHaveValue(name);
  await page.getByRole('button', { name: 'ENTER THE GRID' }).click();
  await expect(page.getByRole('status')).toContainText('Online');
}
test('boot, names, driving, cameras, respawn, join/leave, disconnect and reconnect', async ({
  browser,
}) => {
  let game = await start();
  const address = url(game),
    port = game.server.address().port;
  const context = await browser.newContext();
  try {
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const began = Date.now();
    await enter(page, address, 'wasd racer');
    expect(Date.now() - began).toBeLessThan(10000);
    await expect(page.locator('#offtrack')).toBeHidden();
    await expect(page.locator('#lapTime')).toHaveText('CROSS START LINE');
    await page.keyboard.down('w');
    await expect
      .poll(async () => Number(await page.locator('#speed').textContent()))
      .toBeGreaterThan(10);
    await page.keyboard.up('w');
    await page.keyboard.press('c');
    await expect(page.locator('#diagnostics')).toContainText('"mode":"hood"');
    await page.keyboard.press('c');
    await expect(page.locator('#diagnostics')).toContainText('"mode":"chase"');
    await page.keyboard.press('r');
    await expect(page.locator('#speed')).toHaveText('0');
    await expect(page.locator('#lapTime')).toHaveText('CROSS START LINE');
    await page.keyboard.press('m');
    await expect(page.locator('#flash')).toHaveText('🔇 MUTED');
    const other = await context.newPage();
    await other.goto(address);
    expect(game.wss.clients.size).toBe(1);
    await other.getByRole('textbox').fill('Second');
    await other.getByRole('button', { name: 'ENTER THE GRID' }).click();
    await expect(other.locator('#onlineCount')).toHaveText('2');
    await other.close();
    await page.bringToFront();
    await expect(page.locator('#onlineCount')).toHaveText('1');
    await game.close();
    await expect(page.getByRole('status')).toContainText(
      /Offline|Reconnecting/,
    );
    game = await start(port);
    await expect(page.getByRole('status')).toContainText('Online', {
      timeout: 15000,
    });
    await expect(page.locator('#onlineCount')).toHaveText('1');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole('status')).toBeVisible();
    await expect(page.locator('#speed')).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await game.close();
  }
});
test('GPU resources plateau after 100 join/rename/leave cycles', async ({
  page,
}) => {
  test.setTimeout(180000);
  const game = await start();
  let bot;
  try {
    await enter(page, url(game), 'Soak');
    await page.keyboard.press('r');
    const stats = async () =>
      JSON.parse(await page.locator('#diagnostics').textContent());
    await expect(page.locator('#diagnostics')).toContainText('geometries');
    const pose = await stats();
    async function cycle(i) {
      bot = new WebSocket(url(game).replace('http', 'ws') + '/ws');
      await once(bot, 'open');
      bot.send(
        JSON.stringify({
          type: 'state',
          state: { x: pose.x, z: pose.z, h: 0, s: 0, v: 0, seq: 1, reset: 0 },
        }),
      );
      bot.send(JSON.stringify({ type: 'name', name: `First${i}` }));
      await expect(page.locator('#leaderboard')).toContainText(`First${i}`);
      bot.send(JSON.stringify({ type: 'name', name: `Renamed${i}` }));
      await expect(page.locator('#leaderboard')).toContainText(`Renamed${i}`);
      bot.close();
      await expect(page.locator('#onlineCount')).toHaveText('1');
    }
    await cycle(0);
    await expect.poll(async () => (await stats()).remotes).toBe(0);
    await page.waitForTimeout(1200);
    const baseline = await stats();
    for (let i = 1; i <= 100; i++) await cycle(i);
    await page.waitForTimeout(1200);
    const after = await stats();
    expect(after.geometries).toBeLessThanOrEqual(baseline.geometries);
    expect(after.textures).toBeLessThanOrEqual(baseline.textures);
  } finally {
    bot?.terminate();
    await game.close();
  }
});
