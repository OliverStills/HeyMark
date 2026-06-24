/**
 * Zero-egress and storage isolation tests.
 * Proves that PDF conversion makes no external network requests and leaves
 * no document content in any browser storage.
 *
 * Run: npx playwright test   (or: npm run test:browser)
 */

import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';

const TEXT_PDF = resolve('security-tests/fixtures/pdf/valid-text.pdf');

// ── Shared helper ─────────────────────────────────────────────────────────────

async function uploadAndConvert(page, pdfPath) {
  await page.goto('/');
  await page.locator('#file-input').setInputFiles(pdfPath);
  await page.locator('#file-queue').waitFor({ state: 'visible' });
  await page.locator('#actions-bar').waitFor({ state: 'visible' });
  await page.locator('#convert-all-btn').click();
  await page.locator('#result-panel').waitFor({ state: 'visible', timeout: 30_000 });
}

// ── Zero-egress ───────────────────────────────────────────────────────────────

test.describe('zero-egress', () => {

  test('PDF conversion makes no external requests', async ({ page }) => {
    const external = [];

    page.on('request', req => {
      try {
        const url = new URL(req.url());
        // blob: and data: are internal browser-generated URLs, not network requests
        if (url.protocol === 'blob:' || url.protocol === 'data:') return;
        if (url.hostname !== 'localhost') external.push(req.url());
      } catch { /* ignore unparseable URLs */ }
    });

    await uploadAndConvert(page, TEXT_PDF);

    expect(
      external,
      `External network requests detected:\n  ${external.join('\n  ')}`,
    ).toHaveLength(0);
  });

  test('no external requests during page load', async ({ page }) => {
    const external = [];

    page.on('request', req => {
      try {
        const url = new URL(req.url());
        if (url.protocol === 'blob:' || url.protocol === 'data:') return;
        if (url.hostname !== 'localhost') external.push(req.url());
      } catch {}
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(
      external,
      `External requests on page load:\n  ${external.join('\n  ')}`,
    ).toHaveLength(0);
  });

});

// ── Storage isolation ─────────────────────────────────────────────────────────

test.describe('storage isolation', () => {

  test('localStorage has no document content after conversion', async ({ page }) => {
    await uploadAndConvert(page, TEXT_PDF);

    const items = await page.evaluate(() => {
      const r = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        r[k] = localStorage.getItem(k);
      }
      return r;
    });

    for (const [k, v] of Object.entries(items)) {
      expect(k, `Non-heymark: key in localStorage: "${k}"`).toMatch(/^heymark:/);
      // heymark: values are short boolean/lang strings — anything long is suspicious
      expect(
        v.length,
        `localStorage["${k}"] is ${v.length} chars — may contain document content`,
      ).toBeLessThan(200);
    }
  });

  test('sessionStorage is empty after conversion', async ({ page }) => {
    await uploadAndConvert(page, TEXT_PDF);
    const keys = await page.evaluate(() => Object.keys(sessionStorage));
    expect(keys, 'sessionStorage must be empty — no document content stored').toHaveLength(0);
  });

  test('no cookies are set during or after conversion', async ({ page, context }) => {
    await uploadAndConvert(page, TEXT_PDF);
    const cookies = await context.cookies();
    expect(cookies, 'No cookies should be set — HeyMark requires no session state').toHaveLength(0);
  });

  test('markdown output does not contain javascript: links', async ({ page }) => {
    await uploadAndConvert(page, TEXT_PDF);

    const markdown = await page.evaluate(() =>
      document.getElementById('raw-panel')?.textContent ?? '');

    expect(
      markdown,
      'Markdown output must not contain javascript: URIs',
    ).not.toMatch(/\]\(javascript:/i);

    expect(
      markdown,
      'Markdown output must not contain data:text/html URIs',
    ).not.toMatch(/\]\(data:text\/html/i);
  });

});
