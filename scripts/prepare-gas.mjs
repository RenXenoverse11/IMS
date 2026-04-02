import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'dist');
const appscriptDir = path.join(rootDir, 'appscript');

const MIME_TYPES = {
  '.css': 'text/css',
  '.gif': 'image/gif',
  '.html': 'text/html',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

async function listFiles(dir, baseDir = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFiles(absolutePath, baseDir));
      continue;
    }

    files.push({
      absolutePath,
      relativePath: path.relative(baseDir, absolutePath).replace(/\\/g, '/'),
    });
  }

  return files;
}

function toDataUri(filePath, content) {
  const extension = path.extname(filePath).toLowerCase();
  const mimeType = MIME_TYPES[extension] ?? 'application/octet-stream';

  if (mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'image/svg+xml') {
    return `data:${mimeType};charset=utf-8,${encodeURIComponent(content.toString('utf8'))}`;
  }

  return `data:${mimeType};base64,${content.toString('base64')}`;
}

function replaceAssetPaths(source, assetMap) {
  let output = source;

  for (const [assetPath, assetValue] of assetMap.entries()) {
    output = output.split(assetPath).join(assetValue);
  }

  return output;
}

async function ensureFile(filePath) {
  await stat(filePath);
}

async function build() {
  const indexFile = path.join(distDir, 'index.html');
  await ensureFile(indexFile);

  const distFiles = await listFiles(distDir);
  const assetMap = new Map();

  for (const file of distFiles) {
    if (file.relativePath === 'index.html') {
      continue;
    }

    const content = await readFile(file.absolutePath);
    const assetPath = `/${file.relativePath}`;
    const assetPathNoSlash = file.relativePath;
    const assetPathDot = `./${file.relativePath}`;
    const dataUri = toDataUri(file.absolutePath, content);

    assetMap.set(assetPath, dataUri);
    assetMap.set(assetPathNoSlash, dataUri);
    assetMap.set(assetPathDot, dataUri);
  }

  let html = await readFile(indexFile, 'utf8');
  const stylesheetMatches = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"[^>]*>/g)];
  const scriptMatches = [...html.matchAll(/<script([^>]*)src="([^"]+)"([^>]*)><\/script>/g)];

  for (const match of stylesheetMatches) {
    const href = match[1];
    const stylesheetPath = path.join(distDir, href.replace(/^\/+/, '').replace(/^\.\//, ''));
    let css = await readFile(stylesheetPath, 'utf8');
    css = replaceAssetPaths(css, assetMap);
    html = html.replace(match[0], `<style>\n${css}\n</style>`);
  }

  for (const match of scriptMatches) {
    const beforeSrc = match[1] ?? '';
    const src = match[2];
    const afterSrc = match[3] ?? '';
    const scriptPath = path.join(distDir, src.replace(/^\/+/, '').replace(/^\.\//, ''));
    let js = await readFile(scriptPath, 'utf8');
    js = replaceAssetPaths(js, assetMap);

    const attributes = `${beforeSrc} ${afterSrc}`.trim();
    const attrText = attributes ? ` ${attributes}` : '';
    html = html.replace(match[0], `<script${attrText}>\n${js}\n</script>`);
  }

  html = replaceAssetPaths(html, assetMap);

  await mkdir(appscriptDir, { recursive: true });
  await writeFile(path.join(appscriptDir, 'Index.html'), html);
}

build().catch((error) => {
  console.error('Failed to prepare Google Apps Script output.');
  console.error(error);
  process.exitCode = 1;
});
