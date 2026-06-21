import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const consoleErrors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') consoleErrors.push(msg.text());
});
page.on('pageerror', (err) => {
  consoleErrors.push('PAGEERROR: ' + err.message);
});

const log = (label, obj) => {
  console.log('=== ' + label + ' ===');
  console.log(JSON.stringify(obj, null, 2));
};

// Step 1: Navigate to Dashboard
await page.goto('http://localhost:5173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(1500);
await page.screenshot({ path: 'D:/github_place/fin-agent/project/src/webui/screenshot-1-dashboard.png', fullPage: false });

const state1 = await page.evaluate(() => ({
  url: window.location.pathname,
  title: document.title,
  submenuExpanded: document.querySelector('.ant-menu-submenu')?.getAttribute('aria-expanded'),
  submenuCount: document.querySelectorAll('.ant-menu-submenu').length,
  configLinkExists: !!document.querySelector('a[href="/config"]'),
  h1Text: document.querySelector('h1')?.textContent || document.querySelector('h2')?.textContent,
}));
log('Step 1: Dashboard initial', state1);

// Step 2: Click "Configuration" submenu title
// Find the submenu with key 'agents-group' and click its title
const submenuTitleSelector = '.ant-menu-submenu-title';
const submenuTitles = await page.locator(submenuTitleSelector).all();
console.log('Found ' + submenuTitles.length + ' submenu titles');

// Try to find the Configuration submenu - it's the one with key agents-group
// Click on it - antd uses title prop, so we look for the text
const configSubmenu = page.locator('.ant-menu-submenu').filter({ hasText: 'Configuration' });
const configSubmenuCount = await configSubmenu.count();
console.log('Configuration submenu count: ' + configSubmenuCount);

if (configSubmenuCount > 0) {
  await configSubmenu.first().locator('.ant-menu-submenu-title').click();
} else {
  // Fallback: click all submenu titles
  await page.locator('.ant-menu-submenu-title').first().click();
}

await page.waitForTimeout(800);
await page.screenshot({ path: 'D:/github_place/fin-agent/project/src/webui/screenshot-2-submenu-open.png', fullPage: false });

const state2 = await page.evaluate(() => {
  const subs = Array.from(document.querySelectorAll('.ant-menu-submenu'));
  return {
    url: window.location.pathname,
    submenuStates: subs.map(s => ({
      title: s.querySelector('.ant-menu-submenu-title')?.textContent,
      ariaExpanded: s.getAttribute('aria-expanded'),
      childUlCount: s.querySelectorAll('.ant-menu').length,
    })),
    childLinks: Array.from(document.querySelectorAll('.ant-menu-submenu .ant-menu a')).map(a => a.getAttribute('href')),
    childLinkTexts: Array.from(document.querySelectorAll('.ant-menu-submenu .ant-menu .ant-menu-title-content')).map(e => e.textContent),
    configLinkExists: !!document.querySelector('a[href="/config"]'),
  };
});
log('Step 2: After clicking Configuration', state2);

// Step 3: Click "Config" link
const configLink = page.locator('a[href="/config"]').first();
const configLinkVisible = await configLink.isVisible().catch(() => false);
console.log('Config link visible: ' + configLinkVisible);

if (configLinkVisible) {
  await configLink.click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'D:/github_place/fin-agent/project/src/webui/screenshot-3-config-page.png', fullPage: false });

  const state3 = await page.evaluate(() => ({
    url: window.location.pathname,
    h1Text: document.querySelector('h1')?.textContent,
    h2Text: document.querySelector('h2')?.textContent,
    h3Text: document.querySelector('h3')?.textContent,
    h4Text: document.querySelector('h4')?.textContent,
    monacoExists: !!document.querySelector('.monaco-editor'),
    pageHeadings: Array.from(document.querySelectorAll('h1, h2, h3, h4')).map(h => h.textContent),
  }));
  log('Step 3: After clicking Config link', state3);
} else {
  console.log('CONFIG LINK NOT VISIBLE — bug not fixed');
  // Try to find any links inside the expanded submenu
  const expandedLinks = await page.locator('.ant-menu-submenu .ant-menu a').all();
  console.log('Links found in submenu: ' + expandedLinks.length);
  for (const link of expandedLinks) {
    const href = await link.getAttribute('href');
    const text = await link.textContent();
    console.log('  ' + text + ' -> ' + href);
  }
}

console.log('=== Console Errors ===');
console.log(JSON.stringify(consoleErrors, null, 2));

await browser.close();
