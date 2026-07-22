import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const workflowDirectory = resolve('docs/n8n/workflows');
const files = readdirSync(workflowDirectory)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (files.length === 0) throw new Error('No n8n workflows were found.');

for (const file of files) {
  const path = join(workflowDirectory, file);
  const raw = readFileSync(path, 'utf8');
  const workflow = JSON.parse(raw);
  if (workflow.active !== false) throw new Error(`${file}: workflow must remain inactive in Git.`);

  const serialized = JSON.stringify(workflow).toLowerCase();
  if (/supabase[_ -]?service[_ -]?role[_ -]?key/.test(serialized)) {
    throw new Error(`${file}: committed workflow references a Supabase service-role key.`);
  }
  const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
  for (const node of nodes) {
    const identity = `${node?.name ?? ''} ${node?.type ?? ''}`.toLowerCase();
    if (identity.includes('whatsapp') || identity.includes('wechat')) {
      throw new Error(`${file}: automatic WhatsApp/WeChat nodes are prohibited.`);
    }
  }
}

console.log(`[PASS] ${files.length} n8n workflows parse, remain inactive, and contain no prohibited sender/secrets.`);
