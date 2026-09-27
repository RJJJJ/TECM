'use strict';

const diagnosticsChannel = require('node:diagnostics_channel');
const { randomUUID } = require('node:crypto');
const { errorMonitor } = require('node:events');
const {
  chmodSync,
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  writeSync
} = require('node:fs');
const net = require('node:net');
const path = require('node:path');

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const ALLOWED_ROUTES = new Set(['/login', '/admin/attendance']);
const ALLOWED_TEST_EVENTS = new Set(['test.begin', 'test.end']);
const ALLOWED_TEST_STATUSES = new Set(['running', 'passed', 'failed', 'skipped', 'timedOut', 'interrupted']);
const config = readConfig(process.env);

let outputFd = null;
let outputBytes = 0;
let outputStopped = false;
let unavailableReported = false;
let nextClientId = 0;
let nextServerRequestId = 0;
let nextSocketId = 0;
let instanceId = null;

const clientRequests = new WeakMap();
const serverRequests = new WeakMap();
const socketRecords = new WeakMap();
const observedServers = new WeakSet();
const observedChildren = new WeakSet();

function normalizeHost(host) {
  if (typeof host !== 'string') return '';
  let normalized = host.trim().toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function isLoopbackHost(host) {
  const normalized = normalizeHost(host);
  if (normalized === 'localhost') return true;
  if (net.isIP(normalized) === 4) return Number(normalized.split('.')[0]) === 127;
  if (net.isIP(normalized) === 6) return normalized === '::1';
  return false;
}

function isLoopbackAddress(address) {
  if (typeof address !== 'string') return false;
  const normalized = normalizeHost(address.split('%')[0]);
  if (normalized.startsWith('::ffff:')) {
    const mappedIpv4 = normalized.slice('::ffff:'.length);
    if (net.isIP(mappedIpv4) === 4) return isLoopbackHost(mappedIpv4);
  }
  return isLoopbackHost(normalized);
}

function readConfig(environment) {
  const directory = environment.TECM_E2E_DIAGNOSTICS_DIR;
  const baseUrl = environment.PLAYWRIGHT_BASE_URL;
  if (typeof directory !== 'string' || directory.length === 0 || typeof baseUrl !== 'string') return null;

  try {
    const parsed = new URL(baseUrl);
    const hostname = normalizeHost(parsed.hostname);
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (!isLoopbackHost(hostname)) return null;
    const port = Number(parsed.port || 80);
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null;
    return { directory: path.resolve(directory), hostname, port };
  } catch {
    return null;
  }
}

function reportUnavailable() {
  if (unavailableReported) return;
  unavailableReported = true;
  try {
    process.stderr.write('TECM_E2E_DIAGNOSTICS_UNAVAILABLE\n');
  } catch {
    // Diagnostics must never affect the observed process.
  }
}

function stopOutput() {
  outputStopped = true;
  if (outputFd !== null) {
    try {
      closeSync(outputFd);
    } catch {
      // A failed close is diagnostic-only.
    }
    outputFd = null;
  }
}

function appendLine(line) {
  if (outputFd === null || outputStopped) return;
  let bytes;
  try {
    bytes = Buffer.byteLength(line, 'utf8');
    if (outputBytes + bytes > MAX_LOG_BYTES) {
      outputStopped = true;
      const truncatedLine = `${JSON.stringify({ event: 'diagnostics.truncated', time: new Date().toISOString(), pid: process.pid })}\n`;
      const truncatedBytes = Buffer.byteLength(truncatedLine, 'utf8');
      if (outputBytes + truncatedBytes <= MAX_LOG_BYTES) {
        writeSync(outputFd, truncatedLine, null, 'utf8');
        outputBytes += truncatedBytes;
      } else {
        reportUnavailable();
      }
      return;
    }
    writeSync(outputFd, line, null, 'utf8');
    outputBytes += bytes;
  } catch {
    stopOutput();
    reportUnavailable();
  }
}

function emit(event, fields = {}) {
  if (outputFd === null || outputStopped) return;
  try {
    appendLine(`${JSON.stringify({
      event,
      time: new Date().toISOString(),
      pid: process.pid,
      ...fields
    })}\n`);
  } catch {
    stopOutput();
    reportUnavailable();
  }
}

function observe(callback) {
  return (...args) => {
    try {
      callback(...args);
    } catch {
      stopOutput();
      reportUnavailable();
    }
  };
}

function safeToken(value, maxLength = 80) {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const token = String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, maxLength);
  return token.length > 0 ? token : undefined;
}

function safeErrorFields(error) {
  const name = safeToken(error && error.name);
  const code = safeToken(error && error.code);
  const fields = {};
  if (name) fields.errorName = name;
  if (code) fields.errorCode = code;
  return fields;
}

function routeFor(rawPath) {
  if (typeof rawPath !== 'string') return null;
  const route = rawPath.split('?', 1)[0];
  return ALLOWED_ROUTES.has(route) ? route : null;
}

function safeMethod(method) {
  return method === 'GET' ? 'GET' : null;
}

function matchesClientTarget(request) {
  if (!request || (request.protocol && request.protocol !== 'http:')) return false;
  const requestHost = normalizeHost(request.host || request.hostname);
  const headerTarget = parseHostHeader(typeof request.getHeader === 'function' ? request.getHeader('host') : null);
  const requestPort = Number(request.port || 0);
  return requestHost === config.hostname
    && isLoopbackHost(requestHost)
    && Boolean(headerTarget
      && headerTarget.hostname === config.hostname
      && headerTarget.port === config.port
      && (!requestPort || requestPort === config.port));
}

function clientRecord(request) {
  let record = clientRequests.get(request);
  if (record) return record;
  if (!matchesClientTarget(request)) return null;
  const route = routeFor(request.path);
  const method = safeMethod(request.method);
  if (!route || !method) return null;
  record = {
    id: `c${++nextClientId}`,
    route,
    method,
    startedAt: process.hrtime.bigint()
  };
  clientRequests.set(request, record);
  request.on(errorMonitor, observe((error) => recordClientError(request, record, error)));
  return record;
}

function recordClientError(request, record, error) {
  if (record.errorRecorded) return;
  record.errorRecorded = true;
  emit('http.client.request.error', {
    ...clientFields(request, record),
    durationMs: durationMs(record.startedAt),
    ...safeErrorFields(error)
  });
}

function durationMs(startedAt) {
  return Number(process.hrtime.bigint() - startedAt) / 1_000_000;
}

function socketFields(socket, side) {
  let record = socketRecords.get(socket);
  if (!record) {
    record = { id: `s${++nextSocketId}`, side, connectLogged: false };
    socketRecords.set(socket, record);
    const recordConnect = observe(() => {
      if (record.connectLogged || !Number.isInteger(socket.localPort) || !Number.isInteger(socket.remotePort)) return;
      record.connectLogged = true;
      emit('net.socket.connect', {
        socketId: record.id,
        side: record.side,
        localPort: socket.localPort,
        remotePort: socket.remotePort
      });
    });
    if (socket.connecting) socket.once('connect', recordConnect);
    else recordConnect();
    socket.on('end', observe(() => emit('net.socket.end', {
      socketId: record.id,
      side: record.side,
      localPort: socket.localPort || null,
      remotePort: socket.remotePort || null
    })));
    socket.on('close', observe((hadError) => emit('net.socket.close', {
      socketId: record.id,
      side: record.side,
      localPort: socket.localPort || null,
      remotePort: socket.remotePort || null,
      hadError: Boolean(hadError)
    })));
    socket.on(errorMonitor, observe((error) => emit('net.socket.error', {
      socketId: record.id,
      side: record.side,
      ...safeErrorFields(error)
    })));
  }
  return {
    socketId: record.id,
    localPort: socket.localPort || null,
    remotePort: socket.remotePort || null
  };
}

function clientFields(request, record) {
  const socket = request.socket;
  return {
    requestId: record.id,
    route: record.route,
    method: record.method,
    reusedSocket: Boolean(request.reusedSocket),
    ...(socket ? socketFields(socket, 'client') : {})
  };
}

function parseHostHeader(header) {
  if (typeof header !== 'string' || header.length === 0) return null;
  try {
    const parsed = new URL(`http://${header}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return {
      hostname: normalizeHost(parsed.hostname),
      port: Number(parsed.port || 80)
    };
  } catch {
    return null;
  }
}

function serverPort(server, socket) {
  try {
    const address = server && typeof server.address === 'function' ? server.address() : null;
    if (address && typeof address === 'object') return Number(address.port);
  } catch {
    // A server can be closing while channels are delivered.
  }
  return Number(socket && socket.localPort);
}

function matchesServerTarget(request, socket, server) {
  if (!socket || Number(socket.localPort) !== config.port || serverPort(server, socket) !== config.port) return false;
  if (!isLoopbackAddress(socket.localAddress)) return false;
  const target = parseHostHeader(request && request.headers && request.headers.host);
  return Boolean(target && target.hostname === config.hostname && target.port === config.port);
}

function serverRecord(request, socket, server) {
  let record = serverRequests.get(request);
  if (record) return record;
  if (!matchesServerTarget(request, socket, server)) return null;
  const route = routeFor(request.url);
  const method = safeMethod(request.method);
  if (!route || !method) return null;
  record = {
    id: `r${++nextServerRequestId}`,
    route,
    method,
    startedAt: process.hrtime.bigint(),
    socket: socketFields(socket, 'server')
  };
  serverRequests.set(request, record);
  request.on('aborted', observe(() => emit('http.server.request.aborted', {
    requestId: record.id,
    route: record.route,
    method: record.method,
    ...record.socket
  })));
  return record;
}

const observedClientResponses = new WeakSet();

function observeClientResponse(request, response, record) {
  if (!response || observedClientResponses.has(response)) return;
  observedClientResponses.add(response);
  const responseFields = () => ({
    ...clientFields(request, record),
    durationMs: durationMs(record.startedAt)
  });
  response.on('end', observe(() => {
    if (response.complete === true) {
      emit('http.client.response.complete', {
        ...responseFields(),
        complete: true,
        responseStatus: Number.isInteger(response.statusCode) ? response.statusCode : null
      });
    }
  }));
  response.on('aborted', observe(() => emit('http.client.response.aborted', responseFields())));
  response.on('close', observe(() => {
    if (response.complete !== true) emit('http.client.response.prematureClose', responseFields());
  }));
  response.on(errorMonitor, observe((error) => emit('http.client.response.errorMonitor', {
    ...responseFields(),
    ...safeErrorFields(error)
  })));
}

function listenAddressMatches(server) {
  try {
    const address = server && typeof server.address === 'function' ? server.address() : null;
    if (!address || typeof address !== 'object' || Number(address.port) !== config.port) return false;
    return address.address === '0.0.0.0' || address.address === '::' || isLoopbackAddress(address.address);
  } catch {
    return false;
  }
}

function observeServer(server) {
  if (!server || observedServers.has(server) || !listenAddressMatches(server)) return;
  observedServers.add(server);
  emit('http.server.listen', { port: config.port });
  server.once('close', observe(() => emit('http.server.close', { port: config.port })));
}

function observeChild(child) {
  if (!child || observedChildren.has(child) || typeof child.once !== 'function') return;
  observedChildren.add(child);
  emit('child_process.start', { childPid: Number.isInteger(child.pid) ? child.pid : null });
  child.once('spawn', observe(() => emit('child_process.spawn', {
    childPid: Number.isInteger(child.pid) ? child.pid : null
  })));
  child.once('exit', observe((code, signal) => emit('child_process.exit', {
    childPid: Number.isInteger(child.pid) ? child.pid : null,
    exitCode: Number.isInteger(code) ? code : null,
    signal: safeToken(signal) || null
  })));
}

function subscribe(channelName, callback) {
  diagnosticsChannel.channel(channelName).subscribe(observe(callback));
}

function initialize() {
  if (!config) return;
  instanceId = randomUUID();
  try {
    mkdirSync(config.directory, { recursive: true, mode: 0o700 });
    try {
      chmodSync(config.directory, 0o700);
    } catch {
      // Windows and restricted filesystems may not support POSIX mode changes.
    }
    const file = path.join(config.directory, `e2e-network-${process.pid}-${instanceId}.jsonl`);
    outputFd = openSync(file, 'a', 0o600);
    try {
      chmodSync(file, 0o600);
    } catch {
      // The file was still created with the requested mode where supported.
    }
    outputBytes = fstatSync(outputFd).size;
    if (outputBytes > MAX_LOG_BYTES) {
      stopOutput();
      reportUnavailable();
      return;
    }
  } catch {
    stopOutput();
    reportUnavailable();
    return;
  }

  const entryPoint = typeof process.argv[1] === 'string'
    ? process.argv[1].split(/[\\/]/).pop()
    : '<eval>';
  emit('process.start', {
    instanceId,
    ppid: process.ppid,
    nodeVersion: process.versions.node,
    entryPoint,
    externalServer: process.env.PLAYWRIGHT_EXTERNAL_SERVER === '1'
  });

  subscribe('http.client.request.created', ({ request }) => {
    const record = clientRecord(request);
    if (record) emit('http.client.request.created', clientFields(request, record));
  });
  subscribe('http.client.request.start', ({ request }) => {
    const record = clientRecord(request);
    if (!record) return;
    emit('http.client.request.start', clientFields(request, record));
  });
  subscribe('http.client.response.finish', ({ request, response }) => {
    const record = clientRecord(request);
    if (!record) return;
    observeClientResponse(request, response, record);
    emit('http.client.response.finish', {
      ...clientFields(request, record),
      durationMs: durationMs(record.startedAt),
      complete: Boolean(response && response.complete === true),
      ...(response && Number.isInteger(response.statusCode) ? { responseStatusHeader: response.statusCode } : {})
    });
  });
  subscribe('http.client.request.error', ({ request, error }) => {
    const record = clientRecord(request);
    if (!record) return;
    recordClientError(request, record, error);
  });
  subscribe('http.server.request.start', ({ request, response, socket, server }) => {
    const record = serverRecord(request, socket, server);
    if (!record) return;
    emit('http.server.request.start', {
      requestId: record.id,
      route: record.route,
      method: record.method,
      ...record.socket
    });
    response.on('close', observe(() => {
      if (response.writableFinished !== true) {
        emit('http.server.response.prematureClose', {
          requestId: record.id,
          route: record.route,
          method: record.method,
          ...record.socket
        });
      }
    }));
  });
  subscribe('http.server.response.finish', ({ request, response, socket, server }) => {
    const record = serverRecord(request, socket, server);
    if (!record) return;
    const complete = response && response.writableFinished === true;
    emit('http.server.response.finish', {
      requestId: record.id,
      route: record.route,
      method: record.method,
      durationMs: durationMs(record.startedAt),
      complete,
      ...record.socket,
      ...(complete && Number.isInteger(response.statusCode) ? { responseStatus: response.statusCode } : {})
    });
  });
  subscribe('net.server.socket', ({ socket }) => {
    if (!socket || Number(socket.localPort) !== config.port || !isLoopbackAddress(socket.localAddress)) return;
    emit('net.server.socket', socketFields(socket, 'server'));
  });
  subscribe('tracing:net.server.listen:asyncEnd', ({ server }) => observeServer(server));
  subscribe('child_process', ({ process: child }) => observeChild(child));

  process.on('uncaughtExceptionMonitor', observe((error) => emit(
    'process.uncaughtException', safeErrorFields(error)
  )));
  process.on('exit', observe((code) => {
    emit('process.exit', { exitCode: Number.isInteger(code) ? code : null });
    stopOutput();
  }));
}

function recordTestEvent(event, fields = {}) {
  try {
    if (outputFd === null || outputStopped || !ALLOWED_TEST_EVENTS.has(event) || !fields || typeof fields !== 'object') return;
    const normalized = {};
    if (typeof fields.file === 'string') {
      const file = fields.file.split(/[\\/]/).pop();
      const safeFile = safeToken(file, 120);
      if (safeFile) normalized.file = safeFile;
    }
    if (Number.isSafeInteger(fields.line) && fields.line > 0) normalized.line = fields.line;
    const project = safeToken(fields.project, 80);
    if (project) normalized.project = project;
    if (ALLOWED_TEST_STATUSES.has(fields.status)) normalized.status = fields.status;
    if (Number.isFinite(fields.durationMs) && fields.durationMs >= 0) {
      normalized.durationMs = Math.round(fields.durationMs);
    }
    emit(event, normalized);
  } catch {
    // Reporter metadata is observational and must not alter the test result.
    stopOutput();
    reportUnavailable();
  }
}

initialize();

module.exports = { recordTestEvent };
