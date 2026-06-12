import puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\' + process.env.USERNAME + '\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
];

const chromePath = CHROME_PATHS.find(p => existsSync(p));
if (!chromePath) {
  console.error('Could not find Chrome or Edge. Install one and try again.');
  process.exit(1);
}

const htmlFile = resolve(__dirname, '../docs/IMS_User_Manual.html');
const outFile  = resolve(__dirname, '../docs/IMS_User_Manual.pdf');

console.log('Launching browser…');
const browser = await puppeteer.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.goto('file:///' + htmlFile.replace(/\\/g, '/'), { waitUntil: 'networkidle0' });

console.log('Generating PDF…');
await page.pdf({
  path: outFile,
  format: 'A4',
  printBackground: true,   // keeps colors and gradients
  displayHeaderFooter: false, // no date / URL headers
  margin: { top: '0', right: '0', bottom: '0', left: '0' },
});

await browser.close();
console.log('Done →', outFile);
