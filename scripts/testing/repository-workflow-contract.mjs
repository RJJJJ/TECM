import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isAbsolute, relative } from 'node:path';

const requireAdmin = createRequire(
  new URL('../../admin-web/package.json', import.meta.url)
);

function loadYaml() {
  try {
    const packageRoot = fileURLToPath(
      new URL('../../admin-web/node_modules/yaml/', import.meta.url)
    );
    const resolved = requireAdmin.resolve('yaml');
    const location = relative(packageRoot, resolved);
    if (isAbsolute(location) || location.startsWith('..')) throw new Error();
    if (requireAdmin('yaml/package.json').version !== '2.9.0') throw new Error();
    return requireAdmin('yaml');
  } catch {
    const error = new Error(
      'S2_YAML_PARSER_UNAVAILABLE: Run npm --prefix admin-web ci'
    );
    error.code = 'S2_YAML_PARSER_UNAVAILABLE';
    throw error;
  }
}

export function repositoryWorkflowIsValid(workflow) {
  const { parse, YAMLParseError } = loadYaml();
  if (typeof workflow !== 'string') return false;

  let document;
  try {
    document = parse(workflow, {
      version: '1.2',
      uniqueKeys: true,
      merge: false
    });
  } catch (error) {
    if (error instanceof YAMLParseError) return false;
    throw error;
  }

  const isMapping = value =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const hasOverride = value =>
    Object.hasOwn(value, 'if') || Object.hasOwn(value, 'continue-on-error');

  if (!isMapping(document) || !isMapping(document.jobs)) return false;
  const database = document.jobs.database;
  if (!isMapping(database) || hasOverride(database) ||
      !Array.isArray(database.steps)) return false;
  if (database.steps.some(step => !isMapping(step) || hasOverride(step))) return false;

  const verifierSteps = database.steps.filter(step =>
    typeof step.run === 'string' &&
    step.run.includes('scripts/testing/database-verify.ps1')
  );
  return verifierSteps.length === 1 &&
    !Object.hasOwn(verifierSteps[0], 'uses') &&
    verifierSteps[0].shell === 'pwsh' &&
    verifierSteps[0].run.trim() === './scripts/testing/database-verify.ps1';
}
