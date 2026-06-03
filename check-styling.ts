import { chromium } from '@playwright/test';

async function checkPage() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  console.log('Opening http://localhost:3000...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle' });

  // Check for console errors
  const errors: string[] = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });

  // Get page title
  const title = await page.title();
  console.log('Page title:', title);

  // Check if CSS is loaded
  const bgColor = await page.evaluate(() => {
    return window.getComputedStyle(document.body).backgroundColor;
  });
  console.log('Body background-color:', bgColor);

  // Check for specific elements
  const header = await page.$('header');
  console.log('Header exists:', !!header);

  const buttons = await page.$$('.btn-primary');
  console.log('Primary buttons found:', buttons.length);

  // Check for styling classes
  const hasPrimary700 = await page.evaluate(() => {
    return document.querySelector('.text-primary-700') !== null;
  });
  console.log('Has primary-700 class:', hasPrimary700);

  // Check if Tailwind is working
  const fontFamily = await page.evaluate(() => {
    return window.getComputedStyle(document.body).fontFamily;
  });
  console.log('Body font-family:', fontFamily);

  // Check network requests for CSS
  const cssRequests: string[] = [];
  page.on('request', req => {
    if (req.url().includes('.css')) {
      cssRequests.push(req.url());
    }
  });

  // Reload and capture CSS requests
  await page.reload({ waitUntil: 'networkidle' });

  console.log('\nCSS files loaded:');
  cssRequests.forEach(url => console.log(' -', url));

  if (errors.length > 0) {
    console.log('\nConsole errors:');
    errors.forEach(e => console.log(' -', e));
  }

  await browser.close();
}

checkPage().catch(console.error);