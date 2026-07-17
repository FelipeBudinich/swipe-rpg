import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertProjectSecurity, REMOTE_OR_ACTIVE_URL } from "./security-checks.mjs";

const REQUIRED_FILES = [
  "Procfile",
  "package.json",
  "package-lock.json",
  "server.js",
  ".gitignore",
  ".env.example",
  "README.md",
  "SECURITY.md",
  "public/index.html",
  "public/assets/app.css",
  "public/js/main.js",
];

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

async function requireRegularNonemptyFile(rootDir, relative, errors) {
  const absolute = path.join(rootDir, relative);
  try {
    const stats = await lstat(absolute);
    if (!stats.isFile()) {
      errors.push(`${relative} must be a regular file`);
    } else if (stats.size === 0 || (await readFile(absolute, "utf8")).trim().length === 0) {
      errors.push(`${relative} must not be empty`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") errors.push(`${relative} is required`);
    else throw error;
  }
}

function htmlAttributes(attributes) {
  const entries = [];
  const pattern = /(?:^|\s)([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of attributes.matchAll(pattern)) {
    entries.push({ name: match[1].toLowerCase(), value: match[2] ?? match[3] ?? match[4] ?? null });
  }
  return entries;
}

function openingHtmlTags(source) {
  const tags = [];
  let cursor = 0;
  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start === -1) break;
    const nameMatch = /^<([a-z][a-z0-9:-]*)\b/i.exec(source.slice(start));
    if (!nameMatch) {
      cursor = start + 1;
      continue;
    }
    let quote = null;
    let end = start + nameMatch[0].length;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote) quote = null;
      } else if (character === '"' || character === "'") {
        quote = character;
      } else if (character === ">") {
        break;
      }
    }
    if (end >= source.length) break;
    tags.push({
      name: nameMatch[1].toLowerCase(),
      attributes: source.slice(start + nameMatch[0].length, end),
    });
    cursor = end + 1;
  }
  return tags;
}

function htmlAttribute(attributes, name) {
  return htmlAttributes(attributes).find((attribute) => attribute.name === name.toLowerCase())?.value ?? null;
}

function srcsetReferences(value) {
  return value.split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

function localReferencePath(reference, sourceRelative, rootDir, errors) {
  if (!reference || reference.startsWith("#")) return null;
  if (REMOTE_OR_ACTIVE_URL.test(reference)) {
    errors.push(`${sourceRelative} references forbidden external or active URL ${JSON.stringify(reference)}`);
    return null;
  }
  let url;
  try {
    const sourceUrlPath = sourceRelative.replaceAll(path.sep, "/").replace(/^public\//, "");
    url = new URL(reference, `https://local.invalid/${sourceUrlPath}`);
  } catch {
    errors.push(`${sourceRelative} contains malformed local URL ${JSON.stringify(reference)}`);
    return null;
  }
  if (url.origin !== "https://local.invalid") {
    errors.push(`${sourceRelative} references a non-local URL ${JSON.stringify(reference)}`);
    return null;
  }
  let decoded;
  try {
    decoded = decodeURIComponent(url.pathname);
  } catch {
    errors.push(`${sourceRelative} contains malformed percent encoding in ${JSON.stringify(reference)}`);
    return null;
  }
  if (decoded.includes("\\") || decoded.includes("\0")) {
    errors.push(`${sourceRelative} contains an unsafe local asset path ${JSON.stringify(reference)}`);
    return null;
  }
  const candidate = path.resolve(rootDir, "public", `.${decoded}`);
  const publicRoot = path.resolve(rootDir, "public");
  if (candidate !== publicRoot && !candidate.startsWith(`${publicRoot}${path.sep}`)) {
    errors.push(`${sourceRelative} local asset escapes public/ in ${JSON.stringify(reference)}`);
    return null;
  }
  return candidate;
}

async function validateAsset(rootDir, sourceRelative, reference, errors) {
  const candidate = localReferencePath(reference, sourceRelative, rootDir, errors);
  if (!candidate) return;
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile()) {
      errors.push(`${sourceRelative} references non-file asset ${reference}`);
      return;
    }
    const publicRoot = await realpath(path.join(rootDir, "public"));
    const realCandidate = await realpath(candidate);
    if (realCandidate !== publicRoot && !realCandidate.startsWith(`${publicRoot}${path.sep}`)) {
      errors.push(`${sourceRelative} references an asset outside public/: ${reference}`);
    }
  } catch (error) {
    if (error?.code === "ENOENT") errors.push(`${sourceRelative} references missing local asset ${reference}`);
    else throw error;
  }
}

async function verifyHtmlReferences(rootDir, html, errors) {
  const sourceRelative = "public/index.html";
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));
  const tags = openingHtmlTags(withoutComments);
  const mainScript = tags.find((tag) => tag.name === "script" && htmlAttribute(tag.attributes, "src") === "/js/main.js");
  if (!mainScript || htmlAttribute(mainScript.attributes, "type")?.toLowerCase() !== "module") {
    errors.push("public/index.html must load /js/main.js as a module");
  }

  const stylesheet = tags.find((tag) => {
    if (tag.name !== "link") return false;
    const rel = htmlAttribute(tag.attributes, "rel")?.toLowerCase().split(/\s+/) ?? [];
    return rel.includes("stylesheet") && htmlAttribute(tag.attributes, "href") === "/assets/app.css";
  });
  if (!stylesheet) errors.push("public/index.html must reference /assets/app.css");

  for (const tag of tags) {
    for (const attribute of htmlAttributes(tag.attributes)) {
      if (typeof attribute.value !== "string") continue;
      if (["src", "href", "poster"].includes(attribute.name)) {
        await validateAsset(rootDir, sourceRelative, attribute.value, errors);
      }
      if (["srcset", "imagesrcset"].includes(attribute.name)) {
        for (const reference of srcsetReferences(attribute.value)) {
          await validateAsset(rootDir, sourceRelative, reference, errors);
        }
      }
    }
  }
}

async function verifyModuleReferences(rootDir, errors) {
  const jsRoot = path.join(rootDir, "public", "js");
  async function visit(directory) {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      if (!entry.isFile() || path.extname(entry.name) !== ".js") continue;
      const source = await readFile(absolute, "utf8");
      const relative = path.relative(rootDir, absolute);
      const references = [];
      const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g;
      for (const match of source.matchAll(staticImportPattern)) {
        references.push({ specifier: match[1], index: match.index });
      }
      for (const match of source.matchAll(/\bimport\s*\(/g)) {
        const call = /^import\s*\(\s*(["'`])([^"'`]*)\1\s*\)/.exec(source.slice(match.index));
        if (!call || call[1] === "`" && call[2].includes("${")) {
          errors.push(`${relative}:${lineNumber(source, match.index)} dynamic imports must use a local string literal`);
          continue;
        }
        references.push({ specifier: call[2], index: match.index });
      }

      for (const { specifier, index } of references) {
        if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
          errors.push(`${relative}:${lineNumber(source, index)} browser modules must use local relative imports`);
          continue;
        }
        const candidate = path.resolve(path.dirname(absolute), specifier);
        if (candidate !== jsRoot && !candidate.startsWith(`${jsRoot}${path.sep}`)) {
          errors.push(`${relative}:${lineNumber(source, index)} module import escapes public/js`);
          continue;
        }
        try {
          const stats = await lstat(candidate);
          if (!stats.isFile()) errors.push(`${relative} imports non-file module ${specifier}`);
        } catch (error) {
          if (error?.code === "ENOENT") errors.push(`${relative} imports missing module ${specifier}`);
          else throw error;
        }
      }
    }
  }
  await visit(jsRoot);
}

async function verifyAuthoredArt(rootDir, errors) {
  for (const relative of [
    "public/js/data/deep-south.js",
    "public/js/data/cards/deep-south-cards.js",
  ]) {
    const absolute = path.join(rootDir, relative);
    let source;
    try {
      source = await readFile(absolute, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    for (const match of source.matchAll(/\bartId\s*:\s*["']([^"']+)["']/g)) {
      const artId = match[1];
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(artId)) {
        errors.push(`${relative}:${lineNumber(source, match.index)} contains invalid art ID ${JSON.stringify(artId)}`);
        continue;
      }
      await validateAsset(rootDir, relative, `/assets/art/${artId}.svg`, errors);
    }
  }
  await validateAsset(
    rootDir,
    "render fallback",
    "/assets/art/deep-south-it-begins-here.svg",
    errors,
  );
}

async function verifyCssReferences(rootDir, errors) {
  const relative = "public/assets/app.css";
  let source;
  try {
    source = await readFile(path.join(rootDir, relative), "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const urlPattern = /\burl\s*\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)'";]+))\s*\)/gi;
  const references = new Set();
  for (const match of source.matchAll(urlPattern)) {
    references.add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  const importPattern = /@import\s+(?!url\s*\()(?:"([^"]+)"|'([^']+)'|([^\s;"']+))/gi;
  for (const match of source.matchAll(importPattern)) {
    references.add(match[1] ?? match[2] ?? match[3] ?? "");
  }
  for (const reference of references) {
    await validateAsset(rootDir, relative, reference, errors);
  }
}

async function verifyPackageConfiguration(rootDir, errors) {
  let packageData;
  try {
    packageData = JSON.parse(await readFile(path.join(rootDir, "package.json"), "utf8"));
  } catch (error) {
    errors.push(`package.json must be valid JSON (${error instanceof Error ? error.message : "parse failure"})`);
    return;
  }
  if (packageData.private !== true) errors.push("package.json private must be true");
  if (packageData.type !== "module") errors.push('package.json must retain type "module"');
  if (packageData.engines?.node !== "24.x") errors.push('package.json engines.node must be exactly "24.x"');
  if (packageData.engines?.npm && packageData.engines.npm !== "11.x") {
    errors.push('package.json engines.npm must be exactly "11.x" when specified');
  }
  if (packageData.scripts?.start !== "node server.js") errors.push('package.json start must be "node server.js"');
  if (packageData.scripts?.["build:css"] !== "tailwindcss -i ./src/input.css -o ./public/assets/app.css --minify") {
    errors.push("build:css must perform the single deterministic Tailwind compilation");
  }
  if (packageData.scripts?.build !== "npm run build:css && npm run verify:production") {
    errors.push("build must compile CSS exactly once and then run verify:production");
  }
  for (const lifecycle of ["prebuild", "postbuild", "heroku-postbuild"]) {
    if (/tailwindcss|build:css/.test(packageData.scripts?.[lifecycle] ?? "")) {
      errors.push(`${lifecycle} must not duplicate the production asset build`);
    }
  }
  if (packageData.scripts?.test !== "node --test") errors.push('package.json test must be "node --test"');
  if (packageData.scripts?.["check:security"] !== "node scripts/check-security.mjs") {
    errors.push("check:security must run the deterministic local scanner");
  }
  if (packageData.scripts?.["verify:production"] !== "node scripts/verify-production.mjs") {
    errors.push("verify:production must run the production verifier");
  }
  if (Object.keys(packageData.dependencies ?? {}).length > 0) errors.push("runtime dependencies are not expected for the static server");
  for (const dependency of ["tailwindcss", "@tailwindcss/cli"]) {
    if (!packageData.devDependencies?.[dependency]) errors.push(`${dependency} must remain a development dependency`);
  }

  try {
    const lockData = JSON.parse(await readFile(path.join(rootDir, "package-lock.json"), "utf8"));
    const lockedRoot = lockData.packages?.[""];
    if (lockData.lockfileVersion !== 3 || !lockedRoot) {
      errors.push("package-lock.json must use lockfile version 3 with root package metadata");
    } else {
      if (lockedRoot.engines?.node !== packageData.engines?.node ||
          lockedRoot.engines?.npm !== packageData.engines?.npm) {
        errors.push("package-lock.json engine metadata must match package.json");
      }
      for (const [name, range] of Object.entries(packageData.devDependencies ?? {})) {
        if (lockedRoot.devDependencies?.[name] !== range) {
          errors.push(`package-lock.json must match the ${name} development dependency range`);
        }
      }
    }
  } catch (error) {
    errors.push(`package-lock.json must be valid JSON (${error instanceof Error ? error.message : "parse failure"})`);
  }
}

async function verifyRepositoryConfiguration(rootDir, errors) {
  try {
    const ignoreLines = new Set(
      (await readFile(path.join(rootDir, ".gitignore"), "utf8"))
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#")),
    );
    for (const pattern of [
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
      if (!ignoreLines.has(pattern)) errors.push(`.gitignore must include ${pattern}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  try {
    const example = await readFile(path.join(rootDir, ".env.example"), "utf8");
    const assignments = new Map(
      example.split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .map((line) => {
          const separator = line.indexOf("=");
          return separator === -1 ? [line, null] : [line.slice(0, separator), line.slice(separator + 1)];
        }),
    );
    for (const [name, expected] of [["PORT", "3000"], ["NODE_ENV", "development"], ["ALLOWED_HOSTS", ""]]) {
      if (assignments.get(name) !== expected) errors.push(`.env.example must document ${name}=${expected}`);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export async function collectProductionErrors(rootDir = process.cwd()) {
  const absoluteRoot = path.resolve(rootDir);
  const errors = [];
  for (const relative of REQUIRED_FILES) await requireRegularNonemptyFile(absoluteRoot, relative, errors);

  try {
    const procfile = await readFile(path.join(absoluteRoot, "Procfile"), "utf8");
    if (procfile !== "web: node server.js\n") errors.push("Procfile must contain exactly: web: node server.js");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  let html = "";
  try {
    html = await readFile(path.join(absoluteRoot, "public", "index.html"), "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (html) await verifyHtmlReferences(absoluteRoot, html, errors);
  await verifyModuleReferences(absoluteRoot, errors);
  await verifyAuthoredArt(absoluteRoot, errors);
  await verifyCssReferences(absoluteRoot, errors);
  await verifyPackageConfiguration(absoluteRoot, errors);
  await verifyRepositoryConfiguration(absoluteRoot, errors);

  try {
    await assertProjectSecurity(absoluteRoot);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Security verification failed");
  }
  return errors;
}

export async function verifyProduction(rootDir = process.cwd()) {
  const errors = await collectProductionErrors(rootDir);
  if (errors.length > 0) {
    throw new Error(`Production verification failed:\n- ${errors.join("\n- ")}`);
  }
  return "Production verification passed.";
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  try {
    console.log(await verifyProduction());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Production verification failed.");
    process.exitCode = 1;
  }
}

export { REQUIRED_FILES };
