import { createHash } from "node:crypto";
import { createReadStream, lstatSync, realpathSync, statSync } from "node:fs";
import { lstat, realpath, stat } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { isIP } from "node:net";
import { basename, extname, resolve, sep } from "node:path";
import { domainToASCII, fileURLToPath } from "node:url";

const MODULE_PATH = fileURLToPath(import.meta.url);
const DEFAULT_PUBLIC_ROOT = fileURLToPath(new URL("./public", import.meta.url));
const DEFAULT_PORT = 3000;
const MAX_REQUEST_TARGET_LENGTH = 8_192;
const MAX_HEADER_SIZE = 16 * 1024;
const SHUTDOWN_GRACE_MS = 8_000;

const MIME_TYPES = new Map([
  [".avif", "image/avif"],
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".txt", "text/plain; charset=utf-8"],
  [".webp", "image/webp"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
]);

const LONG_CACHE_EXTENSIONS = new Set([
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".mp3",
  ".ogg",
  ".png",
  ".svg",
  ".webp",
  ".woff",
  ".woff2",
]);

export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "img-src 'self'",
  "font-src 'self'",
  "media-src 'self'",
  "connect-src 'none'",
  "worker-src 'none'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
].join("; ");

const DEVELOPMENT_CONTENT_SECURITY_POLICY = CONTENT_SECURITY_POLICY
  .split("; ")
  .filter((directive) => directive !== "upgrade-insecure-requests")
  .join("; ");

const COMMON_SECURITY_HEADERS = Object.freeze({
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Origin-Agent-Cluster": "?1",
  "Permissions-Policy": [
    "accelerometer=()",
    "camera=()",
    "display-capture=()",
    "geolocation=()",
    "gyroscope=()",
    "magnetometer=()",
    "microphone=()",
    "payment=()",
    "usb=()",
  ].join(", "),
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-DNS-Prefetch-Control": "off",
  "X-Frame-Options": "DENY",
  "X-Permitted-Cross-Domain-Policies": "none",
  "X-XSS-Protection": "0",
});

class RequestError extends Error {
  constructor(statusCode) {
    super("Request rejected");
    this.statusCode = statusCode;
  }
}

class ClientDisconnectedError extends Error {}

function getSecurityHeaders(production) {
  return production
    ? {
        ...COMMON_SECURITY_HEADERS,
        "Content-Security-Policy": CONTENT_SECURITY_POLICY,
        "Strict-Transport-Security": "max-age=31536000",
      }
    : {
        ...COMMON_SECURITY_HEADERS,
        "Content-Security-Policy": DEVELOPMENT_CONTENT_SECURITY_POLICY,
      };
}

function isInsideRoot(candidate, root) {
  return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function statusMessage(statusCode) {
  switch (statusCode) {
    case 400: return "Bad Request";
    case 403: return "Forbidden";
    case 404: return "Not Found";
    case 405: return "Method Not Allowed";
    case 414: return "URI Too Long";
    case 415: return "Unsupported Media Type";
    case 421: return "Misdirected Request";
    default: return "Internal Server Error";
  }
}

function sendPlain(request, response, production, statusCode, extraHeaders = {}) {
  if (response.destroyed || response.headersSent || response.writableEnded) return false;

  const body = Buffer.from(`${statusMessage(statusCode)}\n`, "utf8");
  response.writeHead(statusCode, {
    ...getSecurityHeaders(production),
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": "text/plain; charset=utf-8",
    ...extraHeaders,
  });
  response.end(request.method === "HEAD" ? undefined : body);
  return true;
}

function decodeRequestPath(requestUrl) {
  if (typeof requestUrl !== "string" || requestUrl.length > MAX_REQUEST_TARGET_LENGTH) {
    throw new RequestError(414);
  }

  const queryIndex = requestUrl.indexOf("?");
  const fragmentIndex = requestUrl.indexOf("#");
  const endIndex = Math.min(
    queryIndex === -1 ? requestUrl.length : queryIndex,
    fragmentIndex === -1 ? requestUrl.length : fragmentIndex,
  );
  const rawPath = requestUrl.slice(0, endIndex);

  if (!rawPath.startsWith("/") || /[\u0000-\u001f\u007f-\u009f]/u.test(rawPath)) {
    throw new RequestError(400);
  }

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    throw new RequestError(400);
  }

  if (
    /[\u0000-\u001f\u007f-\u009f]/u.test(decodedPath)
    || decodedPath.includes("\\")
  ) {
    throw new RequestError(400);
  }

  const segments = decodedPath.split("/");
  if (segments.some((segment) => segment === "." || segment === ".." || segment.startsWith("."))) {
    throw new RequestError(403);
  }

  return decodedPath === "/" ? "/index.html" : decodedPath;
}

function parsePortSuffix(value) {
  if (!/^\d{1,5}$/u.test(value)) throw new TypeError("Invalid host value.");
  const port = Number(value);
  if (port < 1 || port > 65_535) throw new TypeError("Invalid host value.");
}

function normalizeHostname(hostname) {
  let normalized = hostname.toLowerCase();
  if (normalized.endsWith(".")) normalized = normalized.slice(0, -1);
  if (!normalized) throw new TypeError("Invalid host value.");

  if (isIP(normalized)) return normalized;

  normalized = domainToASCII(normalized).toLowerCase();
  if (!normalized || normalized.length > 253) throw new TypeError("Invalid host value.");
  const labels = normalized.split(".");
  if (labels.some((label) => (
    !label
    || label.length > 63
    || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label)
  ))) {
    throw new TypeError("Invalid host value.");
  }
  return normalized;
}

function normalizeHost(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || /[\u0000-\u0020\u007f-\u009f,@/?#\\]/u.test(value)
  ) {
    throw new TypeError("Invalid host value.");
  }

  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket < 2) throw new TypeError("Invalid host value.");
    const hostname = value.slice(1, closingBracket);
    const suffix = value.slice(closingBracket + 1);
    if (suffix) {
      if (!suffix.startsWith(":")) throw new TypeError("Invalid host value.");
      parsePortSuffix(suffix.slice(1));
    }
    if (isIP(hostname) !== 6) throw new TypeError("Invalid host value.");
    return new URL(`http://[${hostname}]/`).hostname.slice(1, -1).toLowerCase();
  }

  const colonIndex = value.lastIndexOf(":");
  if (colonIndex !== -1) {
    if (value.indexOf(":") !== colonIndex) throw new TypeError("Invalid host value.");
    parsePortSuffix(value.slice(colonIndex + 1));
    return normalizeHostname(value.slice(0, colonIndex));
  }

  return normalizeHostname(value);
}

export function parseAllowedHosts(value = "") {
  if (typeof value !== "string") throw new TypeError("ALLOWED_HOSTS must be a string.");
  if (!value.trim()) return new Set();

  const hosts = new Set();
  for (const item of value.split(",")) {
    if (!item.trim()) throw new TypeError("ALLOWED_HOSTS contains an invalid entry.");
    try {
      hosts.add(normalizeHost(item.trim()));
    } catch {
      throw new TypeError("ALLOWED_HOSTS contains an invalid entry.");
    }
  }
  return hosts;
}

function getDirectHost(request) {
  const hostValues = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index].toLowerCase() === "host") {
      hostValues.push(request.rawHeaders[index + 1]);
    }
  }

  const requiresHost = request.httpVersionMajor > 1
    || (request.httpVersionMajor === 1 && request.httpVersionMinor >= 1);
  if ((requiresHost && hostValues.length !== 1) || hostValues.length > 1) {
    throw new RequestError(400);
  }
  return hostValues[0];
}

function validateRequestHost(request, allowedHosts) {
  const directHost = getDirectHost(request);
  if (!directHost) {
    if (allowedHosts.size > 0) throw new RequestError(400);
    return;
  }

  let normalized;
  try {
    normalized = normalizeHost(directHost);
  } catch {
    throw new RequestError(400);
  }
  if (allowedHosts.size > 0 && !allowedHosts.has(normalized)) {
    throw new RequestError(421);
  }
}

function hasUnexpectedBody(request) {
  if (request.headers["transfer-encoding"] !== undefined) return true;
  const contentLength = request.headers["content-length"];
  return contentLength !== undefined && !/^0+$/u.test(contentLength.trim());
}

async function locateStaticFile(requestedPath, root, realRoot) {
  const relativePath = requestedPath.replace(/^\/+/, "");
  const candidatePath = resolve(root, relativePath);
  if (!isInsideRoot(candidatePath, root)) throw new RequestError(403);

  let currentPath = root;
  for (const segment of relativePath.split("/").filter(Boolean)) {
    currentPath = resolve(currentPath, segment);
    let pathStats;
    try {
      pathStats = await lstat(currentPath);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new RequestError(404);
      throw error;
    }
    if (pathStats.isSymbolicLink()) throw new RequestError(403);
  }

  let realFilePath;
  let fileStats;
  try {
    realFilePath = await realpath(candidatePath);
    fileStats = await stat(realFilePath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") throw new RequestError(404);
    throw error;
  }

  const expectedRealPath = resolve(realRoot, relativePath);
  if (!isInsideRoot(realFilePath, realRoot) || realFilePath !== expectedRealPath) {
    throw new RequestError(403);
  }
  if (!fileStats.isFile()) throw new RequestError(404);

  const extension = extname(realFilePath).toLowerCase();
  const contentType = MIME_TYPES.get(extension);
  if (!contentType) throw new RequestError(415);

  return { contentType, extension, fileStats, realFilePath };
}

function createEtag(fileStats) {
  const size = Number(fileStats.size).toString(16);
  const modified = Math.trunc(fileStats.mtimeMs).toString(16);
  return `W/"${size}-${modified}"`;
}

function etagMatches(headerValue, etag) {
  if (typeof headerValue !== "string") return false;
  const opaque = etag.replace(/^W\//u, "");
  return headerValue.split(",").some((item) => {
    const candidate = item.trim();
    return candidate === "*" || candidate.replace(/^W\//u, "") === opaque;
  });
}

function filenameHashToken(filePath) {
  const match = basename(filePath).match(/(?:^|[._-])([a-f0-9]{8,64})(?=(?:\.min)?\.[^.]+$)/iu);
  return match?.[1]?.toLowerCase() ?? null;
}

async function hasVerifiedFilenameHash(filePath, response, fileStreamFactory) {
  const token = filenameHashToken(filePath);
  if (!token) return false;

  const hash = createHash("sha256");
  const stream = fileStreamFactory(filePath);
  const stop = () => stream.destroy(new ClientDisconnectedError());
  response.once("close", stop);
  try {
    for await (const chunk of stream) hash.update(chunk);
  } finally {
    response.removeListener("close", stop);
  }
  if (response.destroyed) throw new ClientDisconnectedError();
  return hash.digest("hex").startsWith(token);
}

function getCacheControl(extension, production, verifiedFilenameHash) {
  if (!production) return "no-store";
  if (extension === ".html") return "no-cache";
  if (verifiedFilenameHash) return "public, max-age=31536000, immutable";
  if (extension === ".js" || extension === ".mjs" || extension === ".css") {
    return "public, max-age=0, must-revalidate";
  }
  if (LONG_CACHE_EXTENSIONS.has(extension)) {
    return "public, max-age=86400, must-revalidate";
  }
  return "public, max-age=0, must-revalidate";
}

function sendHealth(request, response, production) {
  const body = Buffer.from('{"status":"ok"}', "utf8");
  response.writeHead(200, {
    ...getSecurityHeaders(production),
    "Cache-Control": "no-store",
    "Content-Length": body.length,
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(request.method === "HEAD" ? undefined : body);
}

function streamStaticFile(request, response, production, file, headers, logger, fileStreamFactory) {
  const stream = fileStreamFactory(file.realFilePath);
  let opened = false;
  const stop = () => stream.destroy();

  request.once("aborted", stop);
  response.once("close", stop);

  stream.once("open", () => {
    if (request.aborted || response.destroyed || response.writableEnded) {
      stream.destroy();
      return;
    }
    opened = true;
    response.writeHead(200, headers);
    stream.pipe(response);
  });

  stream.once("error", () => {
    request.removeListener("aborted", stop);
    if (response.destroyed || response.writableEnded) return;
    logger.error("[server] unexpected static read error");
    if (!opened && !response.headersSent) {
      sendPlain(request, response, production, 500);
    } else {
      response.destroy();
    }
  });

  stream.once("close", () => {
    request.removeListener("aborted", stop);
  });
}

async function handleRequest(request, response, context) {
  const { allowedHosts, fileStreamFactory, logger, production, realRoot, root } = context;

  try {
    validateRequestHost(request, allowedHosts);
  } catch (error) {
    sendPlain(request, response, production, error instanceof RequestError ? error.statusCode : 400);
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    sendPlain(request, response, production, 405, {
      Allow: "GET, HEAD",
      Connection: "close",
    });
    return;
  }

  if (hasUnexpectedBody(request)) {
    sendPlain(request, response, production, 400, { Connection: "close" });
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeRequestPath(request.url);
  } catch (error) {
    sendPlain(request, response, production, error instanceof RequestError ? error.statusCode : 400);
    return;
  }

  if (requestedPath === "/healthz") {
    sendHealth(request, response, production);
    return;
  }

  let file;
  try {
    file = await locateStaticFile(requestedPath, root, realRoot);
  } catch (error) {
    if (response.destroyed) return;
    if (error instanceof RequestError) {
      sendPlain(request, response, production, error.statusCode);
      return;
    }
    logger.error("[server] unexpected static lookup error");
    sendPlain(request, response, production, 500);
    return;
  }

  if (request.aborted || response.destroyed || response.writableEnded) return;

  let verifiedFilenameHash = false;
  try {
    verifiedFilenameHash = await hasVerifiedFilenameHash(file.realFilePath, response, fileStreamFactory);
  } catch (error) {
    if (error instanceof ClientDisconnectedError || response.destroyed) return;
    logger.error("[server] unexpected static hash error");
    sendPlain(request, response, production, 500);
    return;
  }

  if (request.aborted || response.destroyed || response.writableEnded) return;

  const etag = createEtag(file.fileStats);
  const headers = {
    ...getSecurityHeaders(production),
    "Cache-Control": getCacheControl(file.extension, production, verifiedFilenameHash),
    "Content-Length": file.fileStats.size,
    "Content-Type": file.contentType,
    ETag: etag,
  };

  if (etagMatches(request.headers["if-none-match"], etag)) {
    if (request.aborted || response.destroyed || response.writableEnded) return;
    const { "Content-Length": _contentLength, ...notModifiedHeaders } = headers;
    response.writeHead(304, notModifiedHeaders);
    response.end();
    return;
  }

  if (request.method === "HEAD") {
    if (request.aborted || response.destroyed || response.writableEnded) return;
    response.writeHead(200, headers);
    response.end();
    return;
  }

  streamStaticFile(request, response, production, file, headers, logger, fileStreamFactory);
}

function attachRawProtocolHandlers(server, production) {
  const handledSockets = new WeakSet();
  const sendRawResponse = (socket, statusCode, extraHeaders = {}) => {
    if (handledSockets.has(socket) || !socket.writable || socket.writableEnded || socket.destroyed) return;
    handledSockets.add(socket);
    const body = Buffer.from(`${statusMessage(statusCode)}\n`, "utf8");
    const headers = {
      ...getSecurityHeaders(production),
      "Cache-Control": "no-store",
      Connection: "close",
      "Content-Length": body.length,
      "Content-Type": "text/plain; charset=utf-8",
      ...extraHeaders,
    };
    const serializedHeaders = Object.entries(headers)
      .map(([name, value]) => `${name}: ${value}`)
      .join("\r\n");
    socket.end(`HTTP/1.1 ${statusCode} ${statusMessage(statusCode)}\r\n${serializedHeaders}\r\n\r\n${body}`);
  };

  server.on("clientError", (_error, socket) => {
    sendRawResponse(socket, 400);
  });
  server.on("connect", (_request, socket) => {
    sendRawResponse(socket, 405, { Allow: "GET, HEAD" });
  });
}

/**
 * Creates the hardened static server without listening or installing process handlers.
 */
export function createStaticServer({
  publicRoot = DEFAULT_PUBLIC_ROOT,
  production = process.env.NODE_ENV === "production",
  allowedHosts = process.env.ALLOWED_HOSTS ?? "",
  fileStreamFactory = createReadStream,
  logger = console,
} = {}) {
  if (typeof fileStreamFactory !== "function") {
    throw new TypeError("fileStreamFactory must be a function.");
  }
  const root = resolve(publicRoot);
  const rootStats = statSync(root);
  if (!rootStats.isDirectory() || lstatSync(root).isSymbolicLink()) {
    throw new TypeError("The public root must be a real directory.");
  }
  const realRoot = realpathSync(root);
  const normalizedAllowedHosts = allowedHosts instanceof Set
    ? new Set(allowedHosts)
    : parseAllowedHosts(allowedHosts);
  const safeLogger = {
    error: typeof logger?.error === "function" ? logger.error.bind(logger) : () => {},
    info: typeof logger?.info === "function"
      ? logger.info.bind(logger)
      : typeof logger?.log === "function" ? logger.log.bind(logger) : () => {},
    warn: typeof logger?.warn === "function" ? logger.warn.bind(logger) : () => {},
  };
  const context = {
    allowedHosts: normalizedAllowedHosts,
    fileStreamFactory,
    logger: safeLogger,
    production: Boolean(production),
    realRoot,
    root,
  };

  const server = createHttpServer({
    insecureHTTPParser: false,
    maxHeaderSize: MAX_HEADER_SIZE,
    requireHostHeader: true,
  }, (request, response) => {
    request.on("error", () => {
      if (!response.writableEnded) response.destroy();
    });
    void handleRequest(request, response, context).catch(() => {
      if (response.destroyed) return;
      safeLogger.error("[server] unexpected request handler error");
      if (!response.headersSent) sendPlain(request, response, context.production, 500);
      else response.destroy();
    });
  });

  server.maxHeadersCount = 100;
  server.headersTimeout = 60_000;
  server.requestTimeout = 120_000;
  server.keepAliveTimeout = 95_000;
  if ("keepAliveTimeoutBuffer" in server) server.keepAliveTimeoutBuffer = 5_000;
  attachRawProtocolHandlers(server, context.production);
  return server;
}

export function readPort(value) {
  if (value === undefined) return DEFAULT_PORT;
  if (typeof value !== "string" || !/^\d{1,5}$/u.test(value)) {
    throw new TypeError("PORT must be an integer from 1 to 65535.");
  }
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError("PORT must be an integer from 1 to 65535.");
  }
  return port;
}

/**
 * Adds idempotent, testable graceful-shutdown behavior to a server.
 */
export function createShutdownController(server, {
  gracePeriodMs = SHUTDOWN_GRACE_MS,
  logger = console,
  setExitCode = (code) => { process.exitCode = code; },
} = {}) {
  const sockets = new Set();
  let requestedExitCode = 0;
  let shutdownPromise;

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });

  function shutdown(reason = "shutdown", { exitCode = 0 } = {}) {
    requestedExitCode = Math.max(requestedExitCode, exitCode);
    if (shutdownPromise) return shutdownPromise;

    const info = typeof logger?.info === "function"
      ? logger.info.bind(logger)
      : typeof logger?.log === "function" ? logger.log.bind(logger) : () => {};
    const errorLog = typeof logger?.error === "function" ? logger.error.bind(logger) : () => {};
    info(`[server] shutdown started reason=${reason === "SIGINT" ? "SIGINT" : reason === "SIGTERM" ? "SIGTERM" : "internal"}`);

    shutdownPromise = new Promise((resolveShutdown) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        clearTimeout(forceTimer);
        setExitCode(requestedExitCode);
        resolveShutdown();
      };

      const forceTimer = setTimeout(() => {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
        for (const socket of sockets) socket.destroy();
      }, gracePeriodMs);
      forceTimer.unref?.();

      try {
        server.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
            requestedExitCode = 1;
            errorLog("[server] unexpected shutdown error");
          }
          finish();
        });
        server.closeIdleConnections?.();
      } catch {
        requestedExitCode = 1;
        errorLog("[server] unexpected shutdown error");
        finish();
      }
    });

    return shutdownPromise;
  }

  return { shutdown };
}

export function installProcessHandlers(server, options = {}) {
  const logger = options.logger ?? console;
  const controller = createShutdownController(server, options);
  const onSigterm = () => { void controller.shutdown("SIGTERM"); };
  const onSigint = () => { void controller.shutdown("SIGINT"); };
  const onUncaughtException = () => {
    logger.error?.("[server] fatal uncaught exception");
    void controller.shutdown("fatal", { exitCode: 1 });
  };
  const onUnhandledRejection = () => {
    logger.error?.("[server] fatal unhandled rejection");
    void controller.shutdown("fatal", { exitCode: 1 });
  };

  process.once("SIGTERM", onSigterm);
  process.once("SIGINT", onSigint);
  process.once("uncaughtException", onUncaughtException);
  process.once("unhandledRejection", onUnhandledRejection);

  return {
    ...controller,
    uninstall() {
      process.removeListener("SIGTERM", onSigterm);
      process.removeListener("SIGINT", onSigint);
      process.removeListener("uncaughtException", onUncaughtException);
      process.removeListener("unhandledRejection", onUnhandledRejection);
    },
  };
}

export function startServer({
  env = process.env,
  logger = console,
  manageProcess = true,
} = {}) {
  const port = readPort(env.PORT);
  const production = env.NODE_ENV === "production";
  const environment = production ? "production" : env.NODE_ENV === "test" ? "test" : "development";
  const allowedHosts = parseAllowedHosts(env.ALLOWED_HOSTS ?? "");
  const server = createStaticServer({ allowedHosts, logger, production });
  const lifecycle = manageProcess
    ? installProcessHandlers(server, { logger })
    : createShutdownController(server, { logger });

  if (production && allowedHosts.size === 0) {
    logger.warn?.("[server] warning ALLOWED_HOSTS is empty in production");
  }

  const ready = new Promise((resolveReady, rejectReady) => {
    const onStartupError = () => {
      server.removeListener("listening", onListening);
      rejectReady(new Error("Server failed to start."));
    };
    const onListening = () => {
      server.removeListener("error", onStartupError);
      logger.log?.(`[server] started env=${environment} port=${port} pid=${process.pid}`);
      resolveReady();
    };
    server.once("error", onStartupError);
    server.once("listening", onListening);
  });

  server.on("error", () => {
    logger.error?.("[server] fatal server error");
    void lifecycle.shutdown("fatal", { exitCode: 1 });
  });
  server.listen(port, "0.0.0.0");

  return { host: "0.0.0.0", lifecycle, port, ready, server };
}

const isMainModule = process.argv[1] && resolve(process.argv[1]) === MODULE_PATH;
if (isMainModule) {
  try {
    const runtime = startServer();
    runtime.ready.catch(() => {});
  } catch {
    console.error("[server] fatal startup configuration error");
    process.exitCode = 1;
  }
}
