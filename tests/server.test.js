import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { connect, createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { PassThrough } from "node:stream";

import {
  CONTENT_SECURITY_POLICY,
  createShutdownController,
  createStaticServer,
  parseAllowedHosts,
  readPort,
  startServer,
} from "../server.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");

async function listen(server, host = "127.0.0.1") {
  server.listen(0, host);
  await once(server, "listening");
  return server.address();
}

async function close(server) {
  if (!server.listening) return;
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => error ? rejectClose(error) : resolveClose());
  });
}

async function useServer(t, options = {}) {
  const server = createStaticServer(options);
  await listen(server);
  t.after(() => close(server));
  return server;
}

function send(server, path, {
  body,
  headers = {},
  method = "GET",
} = {}) {
  const address = server.address();
  return new Promise((resolveResponse, rejectResponse) => {
    const req = request({
      agent: false,
      headers,
      host: "127.0.0.1",
      method,
      path,
      port: address.port,
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("aborted", () => rejectResponse(new Error("Response aborted.")));
      response.on("end", () => resolveResponse({
        body: Buffer.concat(chunks).toString("utf8"),
        headers: response.headers,
        status: response.statusCode,
      }));
    });
    req.on("error", rejectResponse);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function createFixture(t) {
  const parent = await mkdtemp(join(tmpdir(), "lumenwake-server-"));
  const publicRoot = join(parent, "public");
  await mkdir(join(publicRoot, "assets"), { recursive: true });
  await writeFile(join(publicRoot, "index.html"), "<!doctype html><title>Fixture</title>\n");
  await writeFile(join(publicRoot, "app.js"), "export const fixture = true;\n");
  await writeFile(join(publicRoot, "assets", "app.css"), "body { color: #fff; }\n");
  await writeFile(join(publicRoot, "art.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  t.after(() => rm(parent, { force: true, recursive: true }));
  return { parent, publicRoot };
}

async function getFreePort() {
  const probe = createNetServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const { port } = probe.address();
  await close(probe);
  return port;
}

function requestRaw(port, payload) {
  return new Promise((resolveResponse, rejectResponse) => {
    const socket = connect({ host: "127.0.0.1", port });
    const chunks = [];
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.end(payload));
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("error", rejectResponse);
    socket.on("end", () => resolveResponse(chunks.join("")));
  });
}

test("factory does not bind and configures strict HTTP parser limits", () => {
  const server = createStaticServer();
  assert.equal(server.listening, false);
  assert.equal(server.maxHeadersCount, 100);
  assert.equal(server.headersTimeout, 60_000);
  assert.equal(server.requestTimeout, 120_000);
  assert.equal(server.keepAliveTimeout, 95_000);
  if ("keepAliveTimeoutBuffer" in server) assert.equal(server.keepAliveTimeoutBuffer, 5_000);
});

test("GET / serves index.html and HEAD returns identical metadata without a body", async (t) => {
  const server = await useServer(t);
  const page = await send(server, "/?ignored=yes");
  const head = await send(server, "/?ignored=yes", { method: "HEAD" });

  assert.equal(page.status, 200);
  assert.match(page.body, /Lumenwake/);
  assert.match(page.headers["content-type"], /^text\/html; charset=utf-8$/u);
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], page.headers["content-length"]);
  assert.equal(head.headers.etag, page.headers.etag);
});

test("GET and HEAD /healthz return only minimal readiness data", async (t) => {
  const server = await useServer(t);
  const health = await send(server, "/healthz?ignored=yes");
  const head = await send(server, "/healthz", { method: "HEAD" });

  assert.equal(health.status, 200);
  assert.equal(health.body, '{"status":"ok"}');
  assert.equal(health.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(health.headers["cache-control"], "no-store");
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.equal(head.headers["content-length"], health.headers["content-length"]);
});

test("all unsupported methods return 405 with the narrow Allow header", async (t) => {
  const server = await useServer(t);
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "TRACE", "OPTIONS"]) {
    const response = await send(server, "/", { method });
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.allow, "GET, HEAD", method);
    assert.equal(response.body, "Method Not Allowed\n", method);
  }
});

test("missing files and directories return real 404 responses without listings", async (t) => {
  const server = await useServer(t);
  const missing = await send(server, "/does-not-exist.js");
  const directory = await send(server, "/assets/");
  assert.equal(missing.status, 404);
  assert.equal(directory.status, 404);
  assert.doesNotMatch(directory.body, /index of|directory/iu);
});

test("traversal, dotfiles, backslashes, controls, and malformed encoding are rejected", async (t) => {
  const server = await useServer(t);
  const cases = [
    ["/../server.js", 403],
    ["/%2e%2e/server.js", 403],
    ["/%2E%2E%2fserver.js", 403],
    ["/%2e./server.js", 403],
    ["/..%5cserver.js", 400],
    ["/%2e%2e\\server.js", 400],
    ["/.git/config", 403],
    ["/%2eenv", 403],
    ["/%00.js", 400],
    ["/%1f.js", 400],
    ["/%zz", 400],
  ];
  for (const [path, expected] of cases) {
    const response = await send(server, path);
    assert.equal(response.status, expected, path);
    assert.doesNotMatch(response.body, /package-lock|createStaticServer|ALLOWED_HOSTS/u, path);
  }

  const doubleEncoded = await send(server, "/%252e%252e%252fserver.js");
  assert.notEqual(doubleEncoded.status, 200);
  assert.doesNotMatch(doubleEncoded.body, /createStaticServer/u);
});

test("a symlink is rejected even when its target is a regular file", async (t) => {
  const { parent, publicRoot } = await createFixture(t);
  const secretPath = join(parent, "outside.txt");
  await writeFile(secretPath, "not public\n");
  await symlink(secretPath, join(publicRoot, "leak.txt"));
  const server = await useServer(t, { publicRoot });

  const response = await send(server, "/leak.txt");
  assert.equal(response.status, 403);
  assert.doesNotMatch(response.body, /not public/u);
});

test("unknown extensions are refused and allowlisted MIME types are explicit", async (t) => {
  const { publicRoot } = await createFixture(t);
  await writeFile(join(publicRoot, "unknown.bin"), "bytes");
  const server = await useServer(t, { publicRoot });

  const unknown = await send(server, "/unknown.bin");
  assert.equal(unknown.status, 415);

  const cases = [
    ["/", "text/html; charset=utf-8"],
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/assets/app.css", "text/css; charset=utf-8"],
    ["/art.svg", "image/svg+xml"],
  ];
  for (const [path, contentType] of cases) {
    const response = await send(server, path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers["content-type"], contentType, path);
  }
});

test("security headers are centralized on success, health, 404, 405, and 415", async (t) => {
  const { publicRoot } = await createFixture(t);
  await writeFile(join(publicRoot, "unknown.bin"), "bytes");
  const server = await useServer(t, { production: true, publicRoot });
  const responses = [
    await send(server, "/"),
    await send(server, "/healthz"),
    await send(server, "/missing.js"),
    await send(server, "/", { method: "POST" }),
    await send(server, "/unknown.bin"),
  ];

  for (const response of responses) {
    assert.equal(response.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
    assert.equal(response.headers["strict-transport-security"], "max-age=31536000");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.equal(response.headers["referrer-policy"], "no-referrer");
    assert.equal(response.headers["x-frame-options"], "DENY");
    assert.equal(response.headers["x-xss-protection"], "0");
    assert.equal(response.headers["cross-origin-opener-policy"], "same-origin");
    assert.equal(response.headers["cross-origin-embedder-policy"], "require-corp");
    assert.equal(response.headers["cross-origin-resource-policy"], "same-origin");
    assert.equal(response.headers["origin-agent-cluster"], "?1");
    assert.equal(response.headers["x-dns-prefetch-control"], "off");
    assert.equal(response.headers["x-permitted-cross-domain-policies"], "none");
    assert.match(response.headers["permissions-policy"], /camera=\(\).*microphone=\(\).*payment=\(\).*usb=\(\)/u);
    assert.equal(response.headers["x-powered-by"], undefined);
    assert.equal(response.headers.server, undefined);
  }

  assert.doesNotMatch(CONTENT_SECURITY_POLICY, /unsafe-eval|unsafe-inline/u);
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'none'/u);
  assert.match(CONTENT_SECURITY_POLICY, /script-src-attr 'none'/u);
  assert.match(CONTENT_SECURITY_POLICY, /style-src-attr 'none'/u);
  assert.match(CONTENT_SECURITY_POLICY, /require-trusted-types-for 'script'/u);
  assert.match(CONTENT_SECURITY_POLICY, /trusted-types 'none'/u);
});

test("a static read failure before headers returns one generic hardened 500", async (t) => {
  const logs = [];
  const server = await useServer(t, {
    fileStreamFactory() {
      const stream = new PassThrough();
      queueMicrotask(() => stream.destroy(new Error("sensitive injected detail")));
      return stream;
    },
    logger: {
      error: (message) => logs.push(message),
      info: () => {},
      warn: () => {},
    },
    production: true,
  });

  const response = await send(server, "/index.html");
  assert.equal(response.status, 500);
  assert.equal(response.body, "Internal Server Error\n");
  assert.equal(response.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
  assert.equal(response.headers["strict-transport-security"], "max-age=31536000");
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(logs, ["[server] unexpected static read error"]);
  assert.doesNotMatch(`${response.body}\n${logs.join("\n")}`, /sensitive injected detail/u);
});

test("a static read failure after headers safely aborts without a second response", async (t) => {
  const logs = [];
  const server = await useServer(t, {
    fileStreamFactory() {
      const stream = new PassThrough();
      queueMicrotask(() => {
        stream.emit("open", 1);
        stream.write("partial");
        stream.destroy(new Error("injected post-header error"));
      });
      return stream;
    },
    logger: {
      error: (message) => logs.push(message),
      info: () => {},
      warn: () => {},
    },
  });

  let responseCount = 0;
  await new Promise((resolveRequest, rejectRequest) => {
    const req = request({
      agent: false,
      host: "127.0.0.1",
      path: "/index.html",
      port: server.address().port,
    }, (response) => {
      responseCount += 1;
      response.resume();
      response.once("aborted", resolveRequest);
      response.once("end", resolveRequest);
      response.once("error", (error) => {
        if (error.code === "ECONNRESET") resolveRequest();
        else rejectRequest(error);
      });
    });
    req.once("error", (error) => {
      if (error.code === "ECONNRESET") resolveRequest();
      else rejectRequest(error);
    });
    req.end();
  });

  assert.equal(responseCount, 1);
  assert.deepEqual(logs, ["[server] unexpected static read error"]);
});

test("HSTS is production-only and development sends no-store everywhere", async (t) => {
  const server = await useServer(t, { production: false });
  for (const path of ["/", "/assets/app.css", "/js/main.js", "/healthz", "/missing.js"]) {
    const response = await send(server, path);
    assert.equal(response.headers["cache-control"], "no-store", path);
    assert.equal(response.headers["strict-transport-security"], undefined, path);
    assert.doesNotMatch(response.headers["content-security-policy"], /upgrade-insecure-requests/u, path);
    assert.match(response.headers["content-security-policy"], /default-src 'none'/u, path);
  }
});

test("production cache policy distinguishes HTML, code, media, and verified hashes", async (t) => {
  const { publicRoot } = await createFixture(t);
  const hashedContent = "export const immutable = true;\n";
  const digest = createHash("sha256").update(hashedContent).digest("hex");
  const hashedName = `bundle.${digest.slice(0, 12)}.js`;
  const fakeHashedName = "bundle.0123456789ab.js";
  await writeFile(join(publicRoot, hashedName), hashedContent);
  await writeFile(join(publicRoot, fakeHashedName), hashedContent);
  const server = await useServer(t, { production: true, publicRoot });

  assert.equal((await send(server, "/")).headers["cache-control"], "no-cache");
  assert.equal(
    (await send(server, "/app.js")).headers["cache-control"],
    "public, max-age=0, must-revalidate",
  );
  assert.equal(
    (await send(server, "/assets/app.css")).headers["cache-control"],
    "public, max-age=0, must-revalidate",
  );
  assert.equal(
    (await send(server, "/art.svg")).headers["cache-control"],
    "public, max-age=86400, must-revalidate",
  );
  assert.equal(
    (await send(server, `/${hashedName}`)).headers["cache-control"],
    "public, max-age=31536000, immutable",
  );
  assert.equal(
    (await send(server, `/${fakeHashedName}`)).headers["cache-control"],
    "public, max-age=0, must-revalidate",
  );
});

test("If-None-Match revalidation returns 304 with no response body", async (t) => {
  const server = await useServer(t, { production: true });
  const first = await send(server, "/js/main.js");
  assert.equal(first.status, 200);
  assert.ok(first.headers.etag);

  const revalidated = await send(server, "/js/main.js", {
    headers: { "If-None-Match": first.headers.etag },
  });
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.body, "");
  assert.equal(revalidated.headers["content-length"], undefined);
  assert.equal(revalidated.headers.etag, first.headers.etag);
  assert.equal(revalidated.headers["content-security-policy"], CONTENT_SECURITY_POLICY);
});

test("ALLOWED_HOSTS validates only the direct Host header without reflection", async (t) => {
  const logs = [];
  const logger = {
    error: (message) => logs.push(message),
    log: (message) => logs.push(message),
    warn: (message) => logs.push(message),
  };
  const server = await useServer(t, {
    allowedHosts: "allowed.example,LOCALHOST",
    logger,
  });

  const accepted = await send(server, "/healthz", {
    headers: {
      Host: "allowed.example:443",
      "X-Forwarded-Host": "evil.example",
    },
  });
  assert.equal(accepted.status, 200);

  const rejected = await send(server, "/", { headers: { Host: "evil.example" } });
  assert.equal(rejected.status, 421);
  assert.equal(rejected.body, "Misdirected Request\n");
  assert.doesNotMatch(rejected.body, /evil\.example/u);
  assert.equal(logs.join("\n").includes("evil.example"), false);

  const malformed = await send(server, "/", { headers: { Host: "allowed.example:99999" } });
  assert.equal(malformed.status, 400);
});

test("ALLOWED_HOSTS configuration is normalized once and invalid entries fail closed", () => {
  assert.deepEqual([...parseAllowedHosts("Example.COM:443,localhost")], ["example.com", "localhost"]);
  assert.throws(() => parseAllowedHosts("*.example.com"), /invalid entry/u);
  assert.throws(() => parseAllowedHosts("example.com,"), /invalid entry/u);
  assert.throws(() => createStaticServer({ allowedHosts: "bad host" }), /invalid entry/u);
});

test("GET and HEAD requests carrying bodies or transfer encoding are rejected", async (t) => {
  const server = await useServer(t);
  const withLength = await send(server, "/", {
    body: "x",
    headers: { "Content-Length": "1" },
  });
  assert.equal(withLength.status, 400);
  assert.equal(withLength.body, "Bad Request\n");
  assert.equal(withLength.headers.connection, "close");

  const chunked = await send(server, "/", {
    body: "x",
    headers: { "Transfer-Encoding": "chunked" },
  });
  assert.equal(chunked.status, 400);

  const headWithBody = await send(server, "/", {
    body: "x",
    headers: { "Content-Length": "1" },
    method: "HEAD",
  });
  assert.equal(headWithBody.status, 400);
  assert.equal(headWithBody.body, "");

  const zero = await send(server, "/", { headers: { "Content-Length": "0" } });
  assert.equal(zero.status, 200);
});

test("malformed HTTP is handled through clientError without stack traces", async (t) => {
  const server = await useServer(t, { production: true });
  const response = await requestRaw(
    server.address().port,
    "GET / HTTP/1.1\r\nHost: localhost\r\nMalformed Header\r\n\r\n",
  );
  assert.match(response, /^HTTP\/1\.1 400 Bad Request\r\n/u);
  assert.match(response, /Content-Security-Policy: default-src 'none'/u);
  assert.match(response, /Strict-Transport-Security: max-age=31536000/u);
  assert.doesNotMatch(response, /Error:| at /u);
  assert.equal(response.match(/HTTP\/1\.1 400 Bad Request/gu)?.length, 1);

  const missingHost = await requestRaw(
    server.address().port,
    "GET / HTTP/1.1\r\nConnection: close\r\n\r\n",
  );
  assert.match(missingHost, /^HTTP\/1\.1 400 Bad Request\r\n/u);
  assert.doesNotMatch(missingHost, /Lumenwake/u);
});

test("CONNECT receives one generic hardened 405 instead of opening a tunnel", async (t) => {
  const server = await useServer(t, { production: true });
  const response = await requestRaw(
    server.address().port,
    "CONNECT private.example:443 HTTP/1.1\r\nHost: private.example:443\r\n\r\n",
  );

  assert.match(response, /^HTTP\/1\.1 405 Method Not Allowed\r\n/u);
  assert.match(response, /Allow: GET, HEAD\r\n/u);
  assert.match(response, /Content-Security-Policy: default-src 'none'/u);
  assert.match(response, /Strict-Transport-Security: max-age=31536000/u);
  assert.match(response, /Cache-Control: no-store/u);
  assert.match(response, /Connection: close/u);
  assert.match(response, /\r\n\r\nMethod Not Allowed\n$/u);
  assert.equal(response.match(/HTTP\/1\.1 405 Method Not Allowed/gu)?.length, 1);
  assert.doesNotMatch(response, /private\.example/u);
});

test("disconnecting during a static response stops the stream without destabilizing the server", async (t) => {
  const { publicRoot } = await createFixture(t);
  await writeFile(join(publicRoot, "large.txt"), Buffer.alloc(2 * 1024 * 1024, 97));
  const logs = [];
  const server = await useServer(t, {
    logger: {
      error: (message) => logs.push(message),
      info: () => {},
      warn: () => {},
    },
    publicRoot,
  });

  await new Promise((resolveClosed, rejectClosed) => {
    const req = request({
      agent: false,
      host: "127.0.0.1",
      path: "/large.txt",
      port: server.address().port,
    }, (response) => {
      response.once("data", () => response.destroy());
      response.once("close", resolveClosed);
      response.once("error", (error) => {
        if (error.code !== "ECONNRESET") rejectClosed(error);
      });
    });
    req.once("error", rejectClosed);
    req.end();
  });

  assert.equal((await send(server, "/healthz")).status, 200);
  assert.deepEqual(logs, []);
});

test("readPort accepts only injected ports in the valid production range", () => {
  assert.equal(readPort(undefined), 3000);
  assert.equal(readPort("5000"), 5000);
  for (const value of ["", "0", "65536", "1.5", "1e3", "3000.0", " 3000 ", "+3000", "abc", "-1"]) {
    assert.throws(() => readPort(value), /integer from 1 to 65535/u);
  }
});

test("startServer binds the injected port on 0.0.0.0 and logs only safe startup fields", async (t) => {
  const port = await getFreePort();
  const entries = [];
  const logger = {
    error: (message) => entries.push(message),
    log: (message) => entries.push(message),
    warn: (message) => entries.push(message),
  };
  const runtime = startServer({
    env: { ALLOWED_HOSTS: "", NODE_ENV: "development", PORT: String(port) },
    logger,
    manageProcess: false,
  });
  t.after(() => runtime.lifecycle.shutdown("test"));
  await runtime.ready;

  assert.equal(runtime.port, port);
  assert.equal(runtime.host, "0.0.0.0");
  assert.equal(runtime.server.address().address, "0.0.0.0");
  assert.equal(runtime.server.address().port, port);
  assert.deepEqual(entries, [`[server] started env=development port=${port} pid=${process.pid}`]);
  assert.equal((await send(runtime.server, "/healthz")).status, 200);
});

test("production startup emits one concise warning when ALLOWED_HOSTS is empty", async (t) => {
  const port = await getFreePort();
  const entries = [];
  const logger = {
    error: (message) => entries.push(message),
    log: (message) => entries.push(message),
    warn: (message) => entries.push(message),
  };
  const runtime = startServer({
    env: { ALLOWED_HOSTS: "", NODE_ENV: "production", PORT: String(port) },
    logger,
    manageProcess: false,
  });
  t.after(() => runtime.lifecycle.shutdown("test"));
  await runtime.ready;
  await send(runtime.server, "/healthz");
  await send(runtime.server, "/");

  assert.equal(
    entries.filter((entry) => entry.includes("ALLOWED_HOSTS is empty")).length,
    1,
  );
});

test("graceful shutdown is idempotent, stops accepting connections, and sets exit status", async () => {
  const server = createStaticServer();
  await listen(server);
  const port = server.address().port;
  const statuses = [];
  const logs = [];
  const controller = createShutdownController(server, {
    gracePeriodMs: 200,
    logger: { error: (value) => logs.push(value), info: (value) => logs.push(value) },
    setExitCode: (code) => statuses.push(code),
  });

  const first = controller.shutdown("SIGTERM");
  const second = controller.shutdown("SIGTERM");
  assert.equal(first, second);
  await first;
  assert.equal(server.listening, false);
  assert.deepEqual(statuses, [0]);
  assert.deepEqual(logs, ["[server] shutdown started reason=SIGTERM"]);

  await assert.rejects(new Promise((resolveRequest, rejectRequest) => {
    const req = request({ host: "127.0.0.1", path: "/healthz", port }, resolveRequest);
    req.on("error", rejectRequest);
    req.end();
  }));
});

test("the executable server handles SIGTERM and exits cleanly", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["server.js"], {
    cwd: PROJECT_ROOT,
    env: {
      ...process.env,
      ALLOWED_HOSTS: "127.0.0.1",
      NODE_ENV: "production",
      PORT: String(port),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  await new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("Startup timed out.")), 3_000);
    const finish = (callback) => (value) => {
      clearTimeout(timeout);
      callback(value);
    };
    const inspect = () => {
      if (stdout.includes(`[server] started env=production port=${port}`)) {
        child.stdout.removeListener("data", inspect);
        finish(resolveReady)();
      }
    };
    child.stdout.on("data", inspect);
    child.once("exit", finish((code) => {
      rejectReady(new Error(`Child exited before ready (${code}).`));
    }));
  });

  const health = await new Promise((resolveResponse, rejectResponse) => {
    const req = request({
      headers: { Host: "127.0.0.1" },
      host: "127.0.0.1",
      path: "/healthz",
      port,
    }, (response) => {
      response.resume();
      response.on("end", () => resolveResponse(response.statusCode));
    });
    req.on("error", rejectResponse);
    req.end();
  });
  assert.equal(health, 200);

  child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit");
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.match(stdout, /shutdown started reason=SIGTERM/u);
  assert.equal(stderr, "");
});
