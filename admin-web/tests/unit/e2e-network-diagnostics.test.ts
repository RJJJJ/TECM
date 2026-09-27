import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const diagnosticsModule = fileURLToPath(new URL('../../scripts/e2e-network-diagnostics.cjs', import.meta.url));
const markerValues = [
  'QUERY_SECRET_MARKER',
  'HEADER_SECRET_MARKER',
  'BODY_SECRET_MARKER',
  'ERROR_MESSAGE_SECRET_MARKER',
  'TITLE_SECRET_MARKER'
];

async function listen(server: Server) {
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

function tempDirectory() {
  return mkdtempSync(resolve(tmpdir(), 'tecm-e2e-network-diagnostics-'));
}

function preloadedEnvironment(overrides: Record<string, string | undefined> = {}) {
  const environment = { ...process.env };
  for (const name of ['TECM_E2E_DIAGNOSTICS_DIR', 'PLAYWRIGHT_BASE_URL', 'PLAYWRIGHT_EXTERNAL_SERVER']) {
    delete environment[name];
  }
  Object.assign(environment, overrides);
  const preloadPath = diagnosticsModule.replace(/\\/g, '/');
  const preload = `--require "${preloadPath}"`;
  environment.NODE_OPTIONS = [environment.NODE_OPTIONS, preload].filter(Boolean).join(' ');
  return environment;
}

function runPreloaded(source: string, overrides: Record<string, string | undefined> = {}) {
  const environment = preloadedEnvironment(overrides);
  return new Promise<{
    stdout: string;
    stderr: string;
    status: number | null;
    error?: Error;
  }>((resolveResult) => {
    const child = spawn(process.execPath, ['-e', source], { env: environment });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 10_000);
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
    child.once('error', (error) => {
      clearTimeout(timer);
      resolveResult({ stdout, stderr, status: null, error });
    });
    child.once('close', (status) => {
      clearTimeout(timer);
      resolveResult({
        stdout,
        stderr,
        status,
        ...(timedOut ? { error: new Error('preloaded child timed out') } : {})
      });
    });
  });
}

async function startPreloadedServer(source: string, overrides: Record<string, string | undefined>) {
  const child = spawn(process.execPath, ['-e', source], { env: preloadedEnvironment(overrides) });
  let stdout = '';
  let stderr = '';
  let ready = false;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const readyPromise = new Promise<void>((resolveReady, rejectReady) => {
    readyResolve = resolveReady;
    readyReject = rejectReady;
  });
  const timer = setTimeout(() => readyReject(new Error('preloaded HTTP server did not start')), 5000);
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
    if (!ready && stdout.includes('SERVER_READY')) {
      ready = true;
      clearTimeout(timer);
      readyResolve();
    }
  });
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk; });
  child.once('error', (error) => {
    clearTimeout(timer);
    readyReject(error);
  });
  child.once('close', (status) => {
    if (!ready) {
      clearTimeout(timer);
      readyReject(new Error(`preloaded HTTP server exited before ready (${status}): ${stderr}`));
    }
  });
  try {
    await readyPromise;
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    stop: () => new Promise<void>((resolveStop) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolveStop();
        return;
      }
      const stopTimer = setTimeout(() => child.kill(), 2000);
      child.once('close', () => {
        clearTimeout(stopTimer);
        resolveStop();
      });
      child.stdin.write('STOP\n');
    }),
    get stdout() { return stdout; },
    get stderr() { return stderr; }
  };
}

function readProcessLogs(directory: string) {
  return readdirSync(directory)
    .filter((name) => /^e2e-network-\d+-[0-9a-f-]+\.jsonl$/.test(name))
    .map((name) => readFileSync(resolve(directory, name), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>));
}

test('opt-in preload records completed localhost requests, keep-alive reuse, reset, and child PIDs safely', async () => {
  const reservation = createServer();
  const baseUrl = await listen(reservation);
  await close(reservation);
  const directory = tempDirectory();
  let serverProcess: Awaited<ReturnType<typeof startPreloadedServer>> | undefined;
  try {
    const serverScript = String.raw`
      const http = require('node:http');
      const server = http.createServer((request, response) => {
        if (request.url?.startsWith('/login?reset=1')) {
          request.socket.destroy();
          return;
        }
        response.setHeader('x-diagnostic-secret', 'HEADER_SECRET_MARKER');
        response.end('BODY_SECRET_MARKER');
      });
      server.listen(Number(process.env.TECM_E2E_TEST_SERVER_PORT), '127.0.0.1', () => {
        console.log('SERVER_READY');
      });
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        if (chunk.includes('STOP')) server.close(() => process.exit(0));
      });
    `;
    serverProcess = await startPreloadedServer(serverScript, {
      TECM_E2E_DIAGNOSTICS_DIR: directory,
      PLAYWRIGHT_BASE_URL: baseUrl,
      PLAYWRIGHT_EXTERNAL_SERVER: '1',
      TECM_E2E_TEST_SERVER_PORT: new URL(baseUrl).port
    });
    const nestedClientScript = String.raw`
      const http = require('node:http');
      const request = http.get(process.env.PLAYWRIGHT_BASE_URL + '/login?QUERY_SECRET_MARKER=nested', {
        headers: { authorization: 'HEADER_SECRET_MARKER' }
      }, (response) => { response.resume(); response.once('end', () => console.log('NESTED_REQUEST_OK')); });
      request.once('error', (error) => { console.error(error.code); process.exitCode = 12; });
    `;
    const clientScript = String.raw`
      const http = require('node:http');
      const { spawn } = require('node:child_process');
      const { request: playwrightRequest } = require('@playwright/test');
      const { recordTestEvent } = require(process.env.TECM_E2E_DIAGNOSTICS_MODULE_PATH);
      const base = process.env.PLAYWRIGHT_BASE_URL;
      const agent = new http.Agent({ keepAlive: true });
      recordTestEvent('test.begin', {
        file: '/private/path/attendance.spec.ts', line: 42, project: 'chromium',
        status: 'running', durationMs: 1, title: 'TITLE_SECRET_MARKER'
      });
      recordTestEvent('test.end', {
        file: '/private/path/attendance.spec.ts', line: 42, project: 'chromium',
        status: 'passed', durationMs: 12, title: 'TITLE_SECRET_MARKER'
      });
      const get = (route) => new Promise((resolve, reject) => {
        const request = http.get(base + route, {
          agent,
          headers: { authorization: 'HEADER_SECRET_MARKER' }
        }, (response) => {
          if (route.includes('reset=1')) return reject(new Error('reset unexpectedly returned a response'));
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        });
        request.once('error', reject);
      });
      (async () => {
        await get('/login?QUERY_SECRET_MARKER=1');
        await get('/admin/attendance');
        try {
          await get('/login?reset=1&QUERY_SECRET_MARKER=2');
          throw new Error('reset request unexpectedly resolved');
        } catch (error) {
          if (error.code !== 'ECONNRESET') throw error;
          console.log('RESET_REJECTION_PRESERVED:' + error.code);
        }
        const apiContext = await playwrightRequest.newContext({ timeout: 3000 });
        try {
          const apiResponse = await apiContext.get(base + '/login?QUERY_SECRET_MARKER=playwright', {
            headers: { authorization: 'HEADER_SECRET_MARKER' }
          });
          if (apiResponse.status() !== 200) throw new Error('unexpected Playwright response status');
          await apiResponse.body();
          let playwrightResetWasRejected = false;
          try {
            await apiContext.get(base + '/login?reset=1&QUERY_SECRET_MARKER=playwright', {
              headers: { authorization: 'HEADER_SECRET_MARKER' }
            });
          } catch {
            playwrightResetWasRejected = true;
          }
          if (!playwrightResetWasRejected) throw new Error('Playwright reset request unexpectedly resolved');
          console.log('PLAYWRIGHT_RESET_REJECTION_PRESERVED');
        } finally {
          await apiContext.dispose();
        }
        await new Promise((resolve) => {
          const request = http.request(base + '/login?QUERY_SECRET_MARKER=3', {
            method: 'GET',
            agent,
            headers: { authorization: 'HEADER_SECRET_MARKER' }
          }, () => {});
          request.once('error', (error) => {
            if (error.code !== 'ESECRET') process.exitCode = 11;
            console.log('CUSTOM_REJECTION_PRESERVED:' + error.code);
            resolve();
          });
          request.destroy(Object.assign(new Error('ERROR_MESSAGE_SECRET_MARKER'), { code: 'ESECRET' }));
        });
        await new Promise((resolve, reject) => {
          const nested = spawn(process.execPath, ['-e', ${JSON.stringify(nestedClientScript)}], {
            stdio: ['ignore', 'pipe', 'pipe']
          });
          let nestedOutput = '';
          const timer = setTimeout(() => nested.kill(), 5000);
          nested.stdout.setEncoding('utf8').on('data', (chunk) => { nestedOutput += chunk; });
          nested.once('error', reject);
          nested.once('close', (code) => {
            clearTimeout(timer);
            if (code !== 0 || !nestedOutput.includes('NESTED_REQUEST_OK')) {
              reject(new Error('nested child request did not complete'));
            } else {
              resolve();
            }
          });
        });
        agent.destroy();
      })().catch((error) => {
        console.error(error.message);
        agent.destroy();
        process.exitCode = 13;
      });
    `;
    const result = await runPreloaded(clientScript, {
      TECM_E2E_DIAGNOSTICS_DIR: directory,
      PLAYWRIGHT_BASE_URL: baseUrl,
      PLAYWRIGHT_EXTERNAL_SERVER: '1',
      TECM_E2E_DIAGNOSTICS_MODULE_PATH: diagnosticsModule
    });
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /RESET_REJECTION_PRESERVED:ECONNRESET/);
    assert.match(result.stdout, /PLAYWRIGHT_RESET_REJECTION_PRESERVED/);
    assert.match(result.stdout, /CUSTOM_REJECTION_PRESERVED:ESECRET/);

    await serverProcess.stop();
    const processLogs = readProcessLogs(directory);
    assert.equal(processLogs.length, 3, 'the server, client, and nested child each need their own log');
    const events = processLogs.flat();
    assert.ok(events.some((event) => event.event === 'process.start' && event.externalServer === true));
    assert.ok(events.some((event) => event.event === 'process.exit'));
    assert.ok(events.some((event) => event.event === 'http.client.response.complete' && event.responseStatus === 200));
    assert.ok(events.some((event) => event.event === 'http.client.response.finish' && event.reusedSocket === true));
    assert.ok(events.filter((event) => event.event === 'http.client.request.error' && event.errorCode === 'ECONNRESET').length >= 2,
      'native HTTP and Playwright reset rejections should both be observed');
    assert.ok(events.some((event) => event.event === 'http.client.request.error' && event.errorCode === 'ESECRET'));
    assert.ok(events.some((event) => event.event === 'test.begin' && event.file === 'attendance.spec.ts' && event.line === 42));
    assert.ok(events.some((event) => event.event === 'test.end' && event.status === 'passed' && event.durationMs === 12));
    assert.ok(events.some((event) => event.event === 'http.server.listen' && event.port === Number(new URL(baseUrl).port)));
    assert.ok(events.some((event) => event.event === 'http.server.request.start' && event.route === '/login'));
    assert.ok(events.some((event) => event.event === 'http.server.response.finish' && event.responseStatus === 200));
    assert.ok(events.some((event) => event.event === 'net.socket.connect' && event.side === 'client'
      && Number.isInteger(event.localPort) && event.remotePort === Number(new URL(baseUrl).port)));
    assert.ok(events.some((event) => event.event === 'net.socket.close' && typeof event.socketId === 'string'));
    assert.ok(events.some((event) => event.event === 'child_process.start'));
    assert.ok(events.some((event) => event.event === 'child_process.spawn' && Number.isInteger(event.childPid)));
    assert.ok(events.some((event) => event.event === 'child_process.exit' && Number.isInteger(event.childPid)));
    const serialized = JSON.stringify(events);
    for (const marker of markerValues) assert.equal(serialized.includes(marker), false, `${marker} leaked into diagnostics`);
    assert.equal(serialized.includes('authorization'), false, 'request headers must not be logged');
    assert.ok(events.every((event) => !('responseStatus' in event) || event.complete === true));
    assert.ok(events.every((event) => !('route' in event) || ['/login', '/admin/attendance'].includes(String(event.route))));
    assert.ok(events.every((event) => !('method' in event) || event.method === 'GET'));

    const pids = processLogs.map((lines) => lines[0]?.pid);
    assert.equal(new Set(pids).size, 3);
    for (const lines of processLogs) assert.ok(lines.length > 1);
  } finally {
    await serverProcess?.stop();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('preload stays off without opt-in and ignores non-loopback targets', async () => {
  const defaultOff = await runPreloaded("console.log('PRELOAD_CHILD_OK');");
  assert.equal(defaultOff.status, 0, defaultOff.stderr);
  assert.equal(defaultOff.stdout.trim(), 'PRELOAD_CHILD_OK');
  assert.equal(defaultOff.stderr, '');

  const parent = tempDirectory();
  const diagnosticsDirectory = resolve(parent, 'should-not-exist');
  try {
    const invalidTarget = await runPreloaded("console.log('PRELOAD_CHILD_OK');", {
      TECM_E2E_DIAGNOSTICS_DIR: diagnosticsDirectory,
      PLAYWRIGHT_BASE_URL: 'http://example.invalid:3000'
    });
    assert.equal(invalidTarget.status, 0, invalidTarget.stderr);
    assert.equal(invalidTarget.stderr, '');
    assert.equal(existsSync(diagnosticsDirectory), false);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

test('preload records network events only for the exact loopback host, safe routes, and GET', async () => {
  const server = createServer((_request, response) => response.end('ok'));
  const baseUrl = await listen(server);
  const directory = tempDirectory();
  try {
    const ignored = await runPreloaded(String.raw`
      const http = require('node:http');
      const base = process.env.PLAYWRIGHT_BASE_URL;
      const post = http.request(base + '/login', { method: 'POST' }, (response) => response.resume());
      post.end();
      http.get(base + '/not-allowed', (response) => response.resume());
      setTimeout(() => {}, 30);
    `, {
      TECM_E2E_DIAGNOSTICS_DIR: directory,
      PLAYWRIGHT_BASE_URL: baseUrl
    });
    assert.equal(ignored.status, 0, `${ignored.stdout}\n${ignored.stderr}`);
    const onlyProcessEvents = readProcessLogs(directory).flat();
    assert.deepEqual(onlyProcessEvents.map((event) => event.event), ['process.start', 'process.exit']);

    const hostnameMismatchDirectory = resolve(directory, 'hostname-mismatch');
    const mismatch = await runPreloaded(String.raw`
      const http = require('node:http');
      const port = new URL(process.env.PLAYWRIGHT_BASE_URL).port;
      const request = http.get('http://127.0.0.1:' + port + '/login');
      request.on('response', (response) => response.resume());
      request.on('error', (error) => { console.error(error.code); process.exitCode = 4; });
    `, {
      TECM_E2E_DIAGNOSTICS_DIR: hostnameMismatchDirectory,
      PLAYWRIGHT_BASE_URL: baseUrl.replace('127.0.0.1', 'localhost')
    });
    assert.equal(mismatch.status, 0, `${mismatch.stdout}\n${mismatch.stderr}`);
    assert.deepEqual(readProcessLogs(hostnameMismatchDirectory).flat().map((event) => event.event), [
      'process.start', 'process.exit'
    ]);
  } finally {
    await close(server);
    rmSync(directory, { recursive: true, force: true });
  }
});
