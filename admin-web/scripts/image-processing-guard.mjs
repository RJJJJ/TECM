import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import nextConfig from '../next.config.mjs';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const sourceRoots = ['app', 'components', 'lib', 'pages', 'src'];
const sourceExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const failures = [];

if (nextConfig.images?.unoptimized !== true) {
  failures.push('next.config.mjs must keep images.unoptimized=true');
}

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await sourceFiles(path));
    else if (sourceExtensions.has(extname(entry.name))) files.push(path);
  }
  return files;
}

for (const root of sourceRoots) {
  for (const path of await sourceFiles(join(projectRoot, root))) {
    const source = await readFile(path, 'utf8');
    const displayPath = relative(projectRoot, path).replaceAll('\\', '/');

    if (/\b(?:from\s*|import\s*\()\s*['"]next\/image['"]|\brequire\s*\(\s*['"]next\/image['"]\s*\)/.test(source)) {
      failures.push(`${displayPath}: next/image requires re-reviewing the Sharp/Next exception`);
    }
    if (/\/_next\/image\b/.test(source)) {
      failures.push(`${displayPath}: direct Next image optimizer use requires security review`);
    }
    if (/\b(?:from\s*|import\s*\()\s*['"]sharp['"]|\brequire\s*\(\s*['"]sharp['"]\s*\)/.test(source)) {
      failures.push(`${displayPath}: application Sharp decoding requires security review`);
    }

    const isApiRoute = /(?:^|\/)(?:route\.(?:js|ts)|pages\/api\/)/.test(displayPath);
    const acceptsFileData = /multipart\/form-data|\.formData\s*\(|\.arrayBuffer\s*\(|\bFile\b/.test(source);
    const imageUploadIntent = /\b(?:image|photo|avatar|thumbnail)\b/i.test(source) && /\bupload\b|image\//i.test(source);
    if (isApiRoute && acceptsFileData && imageUploadIntent) {
      failures.push(`${displayPath}: image upload/decoding endpoint requires security review`);
    }
  }
}

if (failures.length > 0) {
  console.error('Admin image-processing security guard failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Admin image-processing guard passed: optimization is disabled and no image-processing entry points were found.');
