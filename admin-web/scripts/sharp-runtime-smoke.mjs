import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

assert.equal(process.versions.node.split('.')[0], '22', 'Sharp smoke test requires Node 22.x');

const require = createRequire(import.meta.url);
const sharpPackagePath = join(dirname(dirname(require.resolve('sharp'))), 'package.json');
const sharpPackage = JSON.parse(await readFile(sharpPackagePath, 'utf8'));
assert.equal(sharpPackage.version, '0.35.3', 'installed Sharp must be exactly 0.35.3');

const smoke = async () => {
  const { default: sharp } = await import('sharp');
  const input = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="#2463eb"/></svg>'
  );
  const image = sharp(input, { failOn: 'error', limitInputPixels: 16 });
  const metadata = await image.metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);

  const png = await sharp(input).resize(1, 1).png().toBuffer();
  const webp = await sharp(input).resize(1, 1).webp().toBuffer();
  assert.equal((await sharp(png).metadata()).format, 'png');
  assert.equal((await sharp(webp).metadata()).format, 'webp');
};

let timeout;
try {
  await Promise.race([
    smoke(),
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Sharp runtime smoke exceeded 15 seconds')), 15_000);
    })
  ]);
} finally {
  clearTimeout(timeout);
}

console.log(`Sharp runtime smoke passed on Node ${process.versions.node}: metadata, resize, PNG and WebP.`);
