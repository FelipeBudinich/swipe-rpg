import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  collectSecurityViolations,
  inspectSvgSource,
} from "../scripts/security-checks.mjs";
import { verifyProduction } from "../scripts/verify-production.mjs";

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, "..");

const VALID_PACKAGE = {
  name: "verification-fixture",
  version: "1.0.0",
  private: true,
  type: "module",
  scripts: {
    start: "node server.js",
    "build:css": "tailwindcss -i ./src/input.css -o ./public/assets/app.css --minify",
    build: "npm run build:css && npm run verify:production",
    test: "node --test",
    "check:security": "node scripts/check-security.mjs",
    "verify:production": "node scripts/verify-production.mjs",
  },
  dependencies: {},
  devDependencies: {
    "@tailwindcss/cli": "4.1.0",
    tailwindcss: "4.1.0",
  },
  engines: { node: "24.x", npm: "11.x" },
};

async function write(root, relative, contents) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents);
}

async function createValidFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "lumenwake-production-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    Procfile: "web: node server.js\n",
    "package.json": `${JSON.stringify(VALID_PACKAGE, null, 2)}\n`,
    "package-lock.json": `${JSON.stringify({
      name: "verification-fixture",
      lockfileVersion: 3,
      packages: {
        "": {
          devDependencies: VALID_PACKAGE.devDependencies,
          engines: VALID_PACKAGE.engines,
        },
      },
    }, null, 2)}\n`,
    "server.js": 'export function createServer() { return { name: "fixture" }; }\n',
    ".gitignore": "node_modules/\n.env\n.env.*\n!.env.example\ncoverage/\n.tmp/\n.vscode/\n.idea/\n",
    ".env.example": "PORT=3000\nNODE_ENV=development\nALLOWED_HOSTS=\n",
    "README.md": "# Fixture\n",
    "SECURITY.md": "# Security\n",
    "public/index.html": [
      "<!doctype html>",
      '<html><head><link rel="stylesheet" href="/assets/app.css">',
      '<script type="module" src="/js/main.js"></script></head>',
      '<body><img src="/assets/art/player.svg" alt=""><p id="output"></p></body></html>',
      "",
    ].join("\n"),
    "public/assets/app.css": "body{color:#fff}\n",
    "public/assets/art/player.svg": '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>\n',
    "public/js/main.js": 'import "./module.js";\ndocument.getElementById("output").textContent = "Ready";\n',
    "public/js/module.js": "export const ready = true;\n",
  };
  for (const [relative, contents] of Object.entries(files)) await write(root, relative, contents);
  return root;
}

async function expectVerificationFailure(t, mutate, expected) {
  const root = await createValidFixture(t);
  await mutate(root);
  await assert.rejects(() => verifyProduction(root), expected);
}

test("root deployment and build configuration is exact and reproducible", async () => {
  assert.equal(await readFile(path.join(REPOSITORY_ROOT, "Procfile"), "utf8"), "web: node server.js\n");
  const packageData = JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "package.json"), "utf8"));
  assert.equal(packageData.private, true);
  assert.equal(packageData.type, "module");
  assert.equal(packageData.engines.node, "24.x");
  assert.equal(packageData.engines.npm, "11.x");
  assert.equal(packageData.scripts.start, "node server.js");
  assert.equal(packageData.scripts.build, "npm run build:css && npm run verify:production");
  assert.equal(packageData.scripts["heroku-postbuild"], undefined);
  assert.equal((packageData.scripts.build.match(/build:css/g) ?? []).length, 1);
  assert.deepEqual(packageData.dependencies, {});

  const gitignore = await readFile(path.join(REPOSITORY_ROOT, ".gitignore"), "utf8");
  for (const required of [
    "node_modules/",
    ".env",
    ".env.*",
    "!.env.example",
    "npm-debug.log*",
    ".DS_Store",
    "coverage/",
    ".tmp/",
    ".idea/",
    ".vscode/",
  ]) {
    assert.match(gitignore, new RegExp(`^${required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  }
});

test("the current production tree passes deterministic verification", async () => {
  await assert.doesNotReject(() => verifyProduction(REPOSITORY_ROOT));
  assert.deepEqual(await collectSecurityViolations(REPOSITORY_ROOT), []);
});

test("production verification rejects missing output, unsafe HTML, and broken assets", async (t) => {
  await t.test("missing index", (t) => expectVerificationFailure(
    t,
    (root) => rm(path.join(root, "public/index.html")),
    /public\/index\.html is required/,
  ));
  await t.test("empty compiled CSS", (t) => expectVerificationFailure(
    t,
    (root) => writeFile(path.join(root, "public/assets/app.css"), "\n"),
    /public\/assets\/app\.css must not be empty/,
  ));
  await t.test("missing JavaScript entry", (t) => expectVerificationFailure(
    t,
    (root) => rm(path.join(root, "public/js/main.js")),
    /public\/js\/main\.js is required/,
  ));
  await t.test("inline script", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", '<script>document.body.textContent = "bad";</script>'),
    /inline script elements are forbidden/,
  ));
  await t.test("inline handler", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", '<button onclick="run()">Run</button>'),
    /inline event-handler attributes are forbidden/,
  ));
  await t.test("unquoted inline handler", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", "<button onclick=run()>Run</button>"),
    /inline event-handler attributes are forbidden/,
  ));
  await t.test("style attribute", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", '<p style="color:red">Unsafe</p>'),
    /HTML style attributes are forbidden/,
  ));
  await t.test("unquoted style attribute", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", "<p style=color:red>Unsafe</p>"),
    /HTML style attributes are forbidden/,
  ));
  await t.test("dynamic code", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/main.js", 'eval("2 + 2");\n'),
    /eval\(\) is forbidden/,
  ));
  await t.test("external CDN", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", '<script src="https://cdn.example/app.js"></script>'),
    /external or active-content HTML URLs are forbidden/,
  ));
  await t.test("unquoted external script URL", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", "<script src=https://cdn.example/app.js></script>"),
    /external or active-content HTML URLs are forbidden/,
  ));
  await t.test("external stylesheet", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", '<link rel="stylesheet" href="https://cdn.example/app.css">'),
    /external or active-content HTML URLs are forbidden/,
  ));
  await t.test("unquoted external stylesheet URL", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", "<link rel=stylesheet href=https://cdn.example/app.css>"),
    /external or active-content HTML URLs are forbidden/,
  ));
  await t.test("missing HTML asset", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", [
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script type="module" src="/js/main.js"></script>',
      '<img src="/assets/missing.svg" alt="">',
    ].join("\n")),
    /references missing local asset \/assets\/missing\.svg/,
  ));
  await t.test("missing srcset asset", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", [
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script type="module" src="/js/main.js"></script>',
      '<img srcset="/assets/art/player.svg 1x, /assets/art/missing-player.svg 2x" alt="">',
    ].join("\n")),
    /references missing local asset \/assets\/art\/missing-player\.svg/,
  ));
  await t.test("external imagesrcset asset", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/index.html", [
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script type="module" src="/js/main.js"></script>',
      '<link rel="preload" as="image" imagesrcset="/assets/art/player.svg 1x, https://cdn.example/player.svg 2x">',
    ].join("\n")),
    /external or active-content HTML URLs are forbidden/,
  ));
  await t.test("missing CSS asset", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/assets/app.css", 'body{background-image:url("./missing.png")}\n'),
    /references missing local asset \.\/missing\.png/,
  ));
  await t.test("missing local CSS import", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/assets/app.css", '@import "./missing-theme.css";\nbody{color:white}\n'),
    /references missing local asset \.\/missing-theme\.css/,
  ));
  await t.test("missing imported module", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/main.js", 'import "./missing.js";\n'),
    /imports missing module \.\/missing\.js/,
  ));
  await t.test("external static module import", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/main.js", 'import "https://cdn.example/module.js";\n'),
    /external module imports are forbidden/,
  ));
  await t.test("external dynamic module import", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/main.js", 'import("https://cdn.example/module.js");\n'),
    /external module imports are forbidden/,
  ));
  await t.test("missing dynamic local module", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/main.js", 'import("./missing-dynamic.js");\n'),
    /imports missing module \.\/missing-dynamic\.js/,
  ));
  await t.test("missing authored art", async (t) => expectVerificationFailure(
    t,
    (root) => write(root, "public/js/data/cards.js", 'export const card = { artId: "scene-missing" };\n'),
    /references missing local asset \/assets\/art\/scene-missing\.svg/,
  ));
  await t.test("incorrect Procfile", (t) => expectVerificationFailure(
    t,
    (root) => write(root, "Procfile", "web: npm start\n"),
    /Procfile must contain exactly/,
  ));
});

test("security checks reject executable DOM, network, environment, and npm configuration", async (t) => {
  const sourceCases = [
    ['eval("x")', /eval\(\) is forbidden/],
    ["new Function", /new Function is forbidden/],
    ['document.write("x")', /document\.write is forbidden/],
    ["element.innerHTML = value", /HTML-string assignment is forbidden/],
    ["element.outerHTML += value", /HTML-string assignment is forbidden/],
    ['element.insertAdjacentHTML("beforeend", value)', /insertAdjacentHTML is forbidden/],
    ['element.setAttribute("style", value)', /setAttribute\("style"/],
    ['setTimeout("run()", 10)', /string-based timers are forbidden/],
    ['const target = "javascript:alert(1)"', /javascript: URLs are forbidden/],
    ['const policy = "script-src \'unsafe-eval\'"', /unsafe-eval is forbidden/],
    ['fetch("/private")', /runtime network request APIs are forbidden/],
    ['import "https://cdn.example/static.js"', /external module imports are forbidden/],
    ['import("https://cdn.example/dynamic.js")', /external module imports are forbidden/],
  ];
  for (const [source, expected] of sourceCases) {
    await t.test(source.slice(0, 30), async (t) => {
      const root = await createValidFixture(t);
      await write(root, "public/js/main.js", `${source};\n`);
      assert.match((await collectSecurityViolations(root)).join("\n"), expected);
    });
  }

  await t.test("root environment file", async (t) => {
    const root = await createValidFixture(t);
    await write(root, ".env.production", "TOKEN=not-allowed\n");
    assert.match((await collectSecurityViolations(root)).join("\n"), /environment files are forbidden/);
  });
  await t.test("npm authentication token", async (t) => {
    const root = await createValidFixture(t);
    await write(root, ".npmrc", "//registry.npmjs.org/:_authToken=not-allowed\n");
    assert.match((await collectSecurityViolations(root)).join("\n"), /npm credentials or authentication configuration are forbidden/);
  });
});

test("SVG verification rejects executable and externally loaded features", () => {
  const unsafeCases = [
    ["<svg><script>alert(1)</script></svg>", /script elements/],
    ['<svg onload="run()"></svg>', /event-handler attributes/],
    ["<svg><foreignObject><p>HTML</p></foreignObject></svg>", /foreignObject elements/],
    ['<svg><image href="https://example.test/image.png"/></svg>', /external or embedded resource URLs/],
    ['<svg><use xlink:href="javascript:run()"/></svg>', /javascript: URLs/],
    ["<svg><style>@import url(https://example.test/x.css)</style></svg>", /CSS imports/],
    ['<svg><image href="data:text/html,bad"/></svg>', /external or embedded resource URLs/],
    ['<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>', /document type or entity declarations/],
  ];
  for (const [source, expected] of unsafeCases) {
    assert.match(inspectSvgSource(source, "fixture.svg").join("\n"), expected);
  }
  assert.deepEqual(
    inspectSvgSource('<svg xmlns="http://www.w3.org/2000/svg"><use href="#shape"/></svg>', "safe.svg"),
    [],
  );
});
