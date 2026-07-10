// Smoke: load the app, wait for the shell, log console errors, screenshot.
import { chromium } from 'playwright';

const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);

const state = {
  title: await page.title(),
  worldSwitcher: await page.getByTestId('world-switcher-trigger').count(),
  searchInput: await page.getByTestId('search-input').count(),
  results: await page.locator('[data-testid^="result-"]').count(),
};
console.log(JSON.stringify(state, null, 2));

// open first result as tab
if (state.results > 0) {
  await page.locator('[data-testid^="result-"]').first().click();
  await page.waitForTimeout(1000);
  console.log('tabs:', await page.locator('[data-testid^="tab-"]').count());
  console.log('editButton:', await page.getByTestId('entry-edit').count());
}

await page.screenshot({ path: '/tmp/sheaf-smoke.png', fullPage: false });
console.log('console errors:', JSON.stringify(errors, null, 2));
await browser.close();
