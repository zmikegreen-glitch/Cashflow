import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, extname } from 'node:path';
import { unzipSync } from 'fflate';
import { packageGame } from '../../scripts/package-game.mjs';

test('buy, renovate, earn, sell, and restart', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#cash')).toHaveText('$60,000');
  await page.getByRole('button', { name: 'Buy & renovate' }).click();
  await expect(page.getByRole('status')).toContainText('purchased');
  await expect(page.locator('.holding')).toContainText('Renovating');
  await expect(page.locator('.holding button')).toBeDisabled();
  await page.keyboard.press('n');
  await expect(page.locator('.holding')).toContainText('Leased');
  const before = Number((await page.locator('#cash').textContent()).replace(/[^0-9]/g, ''));
  await page.getByRole('button', { name: 'Next month' }).click();
  const after = Number((await page.locator('#cash').textContent()).replace(/[^0-9]/g, ''));
  expect(after).toBeGreaterThan(before);
  await page.locator('.holding button').click();
  await expect(page.locator('.holding')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Sold');
  await page.getByRole('button', { name: 'Restart game' }).click();
  await expect(page.locator('#cash')).toHaveText('$60,000');
  expect(errors).toEqual([]);
});

test('phone deal filtering and buying work without overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Foreclosure', exact: true }).click();
  await expect(page.locator('.card')).toHaveCount(3);
  await page.getByRole('button', { name: 'Analyze Juniper Bungalow' }).click();
  await expect(page.locator('.analysis')).toContainText('Juniper Bungalow');
  await page.getByRole('button', { name: 'Buy & renovate' }).click();
  await expect(page.locator('.holding')).toContainText('Juniper Bungalow');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('month limit ends play and restart reopens it', async ({ page }) => {
  await page.goto('/');
  for (let i = 0; i < 35; i++) await page.getByRole('button', { name: 'Next month' }).click();
  await expect(page.getByRole('status')).toContainText('Challenge complete');
  await expect(page.getByRole('button', { name: 'Next month' })).toBeDisabled();
  await page.getByRole('button', { name: 'Restart game' }).click();
  await expect(page.getByRole('button', { name: 'Next month' })).toBeEnabled();
});

test('the actual submission ZIP runs under a subdirectory inside an iframe', async ({ page }) => {
  const dir = await mkdtemp(join(tmpdir(), 'vibecda-iframe-'));
  const { output } = await packageGame('dist', join(dir, 'game.zip'));
  const files = unzipSync(await readFile(output));
  const server = createServer((req, res) => {
    if (req.url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>Upload rehearsal</title><iframe title="Submitted game" src="/uploads/team-game/" width="960" height="800"></iframe>');
      return;
    }
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/uploads\/team-game\//, '') || 'index.html';
    const file = files[path];
    if (!file) { res.statusCode = 404; res.end('Missing file'); return; }
    res.setHeader('Content-Type', { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] || 'application/octet-stream');
    res.end(file);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  try {
    await page.goto(`http://127.0.0.1:${port}/`);
    const frame = page.frameLocator('iframe[title="Submitted game"]');
    await expect(frame.getByRole('heading', { name: 'Find your next opportunity.' })).toBeVisible();
    await frame.getByRole('button', { name: 'Buy & renovate' }).click();
    await expect(frame.getByRole('status')).toContainText('purchased');
    await frame.getByRole('button', { name: 'Next month' }).click();
    await expect(frame.locator('.holding')).toContainText('Leased');
  } finally {
    await page.goto('about:blank');
    await new Promise(resolve => server.close(resolve));
  }
});
