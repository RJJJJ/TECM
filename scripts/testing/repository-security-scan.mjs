import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { extname } from 'node:path';

const tracked = execFileSync(
  'git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' }
)
  .split('\0')
  .filter(Boolean);

const prohibitedPaths = [
  /(^|\/)\.omx(\/|$)/,
  /(^|\/)(playwright-report|test-results|xcuserdata)(\/|$)/,
  /\.mobileprovision$/i,
  /\.p8$/i,
  /\.p12$/i,
  /\.cer$/i,
  /tsconfig\.tsbuildinfo$/,
  /(^|\/)Secrets\.xcconfig$/
];

const pathFailures = tracked.filter((file) => {
  const basename = file.split('/').at(-1) ?? file;
  const prohibitedEnvironmentFile = basename.startsWith('.env') && !basename.endsWith('.example');
  return prohibitedEnvironmentFile || prohibitedPaths.some((pattern) => pattern.test(file));
});
if (pathFailures.length > 0) {
  throw new Error(`Prohibited runtime or secret-bearing paths are tracked:\n${pathFailures.join('\n')}`);
}

const textExtensions = new Set([
  '.env', '.json', '.js', '.jsx', '.mjs', '.sql', '.swift', '.toml', '.ts', '.tsx', '.xcconfig', '.yml', '.yaml'
]);
const secretPatterns = [
  {
    name: 'private key',
    pattern: /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----\s+[A-Za-z0-9+/=\r\n]{100,}-----END (?:EC |RSA )?PRIVATE KEY-----/
  },
  { name: 'hard-coded JWT', pattern: /eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g }
];

function isServiceRoleJwt(candidate) {
  try {
    const payload = JSON.parse(Buffer.from(candidate.split('.')[1], 'base64url').toString('utf8'));
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

function scanSecretContent(content, location, failures) {
  for (const { name, pattern } of secretPatterns) {
    pattern.lastIndex = 0;
    if (name === 'hard-coded JWT') {
      for (const match of content.matchAll(pattern)) {
        if (isServiceRoleJwt(match[0])) failures.push(`${location}: hard-coded service-role JWT`);
      }
    } else if (pattern.test(content)) {
      failures.push(`${location}: ${name}`);
    }
  }
}

const contentFailures = [];
for (const file of tracked) {
  if (!textExtensions.has(extname(file).toLowerCase())) continue;
  let size;
  try {
    size = statSync(file).size;
  } catch {
    continue;
  }
  if (size > 2_000_000) continue;
  const content = readFileSync(file, 'utf8');
  scanSecretContent(content, file, contentFailures);
  if (/TECM\/(?:Services|Features|ViewModels|App)\//.test(file) && /service[_ -]?role/i.test(content)) {
    contentFailures.push(`${file}: service-role reference in iOS client source`);
  }
  if (/^admin-web\/(?:app|components|lib)\//.test(file) && /NEXT_PUBLIC_[A-Z0-9_]*SERVICE[_ -]?ROLE/i.test(content)) {
    contentFailures.push(`${file}: public service-role environment variable`);
  }
}

if (contentFailures.length > 0) {
  throw new Error(`Potential secret exposure detected:\n${contentFailures.join('\n')}`);
}

// Scan every reachable historical text blob as well. This catches a key that
// was deleted from the working tree but still remains recoverable from Git.
const objectLines = execFileSync('git', ['rev-list', '--objects', '--all'], {
  encoding: 'utf8',
  maxBuffer: 20_000_000
}).trim().split('\n').filter(Boolean);
const candidateObjects = new Map();
for (const line of objectLines) {
  const separator = line.indexOf(' ');
  if (separator < 0) continue;
  const objectId = line.slice(0, separator);
  const path = line.slice(separator + 1);
  if (textExtensions.has(extname(path).toLowerCase()) && !candidateObjects.has(objectId)) {
    candidateObjects.set(objectId, path);
  }
}

const historyFailures = [];
for (const [objectId, path] of candidateObjects) {
  const size = Number(execFileSync('git', ['cat-file', '-s', objectId], { encoding: 'utf8' }).trim());
  if (!Number.isFinite(size) || size > 2_000_000) continue;
  const content = execFileSync('git', ['cat-file', 'blob', objectId], {
    encoding: 'utf8',
    maxBuffer: 2_100_000
  });
  scanSecretContent(content, `${path}@${objectId.slice(0, 12)}`, historyFailures);
}

if (historyFailures.length > 0) {
  throw new Error(`Potential secret exposure detected in reachable Git history:\n${historyFailures.join('\n')}`);
}

console.log(
  `[PASS] ${tracked.length} tracked/candidate paths and ${candidateObjects.size} historical text blobs checked for runtime artifacts and secret exposure.`
);
