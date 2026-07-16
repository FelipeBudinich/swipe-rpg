import { readdir, readFile, lstat } from "node:fs/promises";
import path from "node:path";

const EXECUTABLE_EXTENSIONS = new Set([".html", ".js", ".mjs"]);
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "coverage", ".tmp", "tmp"]);
const REMOTE_OR_ACTIVE_URL = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function lineNumber(source, offset) {
  return source.slice(0, offset).split("\n").length;
}

function location(rootDir, file, source, offset = 0) {
  const relative = path.relative(rootDir, file) || path.basename(file);
  return `${relative}:${lineNumber(source, offset)}`;
}

function addMatchViolations(violations, { rootDir, file, source, pattern, message }) {
  pattern.lastIndex = 0;
  for (const match of source.matchAll(pattern)) {
    violations.push(`${location(rootDir, file, source, match.index)} ${message}`);
  }
}

async function walk(rootDir, currentDir = rootDir) {
  let entries;
  try {
    entries = await readdir(currentDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return { files: [], symlinks: [] };
    throw error;
  }

  const files = [];
  const symlinks = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const absolute = path.join(currentDir, entry.name);
    if (entry.isSymbolicLink()) {
      symlinks.push(absolute);
    } else if (entry.isDirectory()) {
      const nested = await walk(rootDir, absolute);
      files.push(...nested.files);
      symlinks.push(...nested.symlinks);
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return { files, symlinks };
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
    const attributesStart = start + nameMatch[0].length;
    tags.push({
      name: nameMatch[1].toLowerCase(),
      attributes: source.slice(attributesStart, end),
      index: start,
    });
    cursor = end + 1;
  }
  return tags;
}

function readAttribute(attributes, name) {
  return htmlAttributes(attributes).find((attribute) => attribute.name === name.toLowerCase())?.value ?? null;
}

function srcsetReferences(value) {
  return value.split(",")
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0])
    .filter(Boolean);
}

function scanHtml(rootDir, file, source, violations) {
  const withoutComments = source.replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, " "));

  for (const tag of openingHtmlTags(withoutComments)) {
    const attributes = htmlAttributes(tag.attributes);
    const here = location(rootDir, file, withoutComments, tag.index);
    if (tag.name === "script" && !readAttribute(tag.attributes, "src")?.trim()) {
      violations.push(`${here} inline script elements are forbidden`);
    }
    if (tag.name === "style") violations.push(`${here} inline style elements are forbidden`);
    for (const attribute of attributes) {
      if (attribute.name === "style") violations.push(`${here} HTML style attributes are forbidden`);
      if (/^on[a-z][a-z0-9:_-]*$/i.test(attribute.name)) {
        violations.push(`${here} inline event-handler attributes are forbidden`);
      }
      if (["src", "href", "poster"].includes(attribute.name) &&
          typeof attribute.value === "string" && REMOTE_OR_ACTIVE_URL.test(attribute.value)) {
        violations.push(`${here} external or active-content HTML URLs are forbidden`);
      }
      if (["srcset", "imagesrcset"].includes(attribute.name) && typeof attribute.value === "string") {
        for (const reference of srcsetReferences(attribute.value)) {
          if (REMOTE_OR_ACTIVE_URL.test(reference)) {
            violations.push(`${here} external or active-content HTML URLs are forbidden`);
          }
        }
      }
    }
  }
}

function scanExecutable(rootDir, file, source, violations) {
  const checks = [
    [/\beval\s*\(/g, "eval() is forbidden"],
    [/\bnew\s+Function\b/g, "new Function is forbidden"],
    [/\bdocument\s*\.\s*write(?:ln)?\s*\(/g, "document.write is forbidden"],
    [/\.(?:innerHTML|outerHTML)\s*(?:(?:\?\?|\|\||&&|[+\-*/%&|^])?=)(?!=)/g, "HTML-string assignment is forbidden"],
    [/\.insertAdjacentHTML\s*\(/g, "insertAdjacentHTML is forbidden"],
    [/\.setAttribute\s*\(\s*["']style["']\s*,/g, "setAttribute(\"style\", ...) is forbidden"],
    [/\.cssText\s*=(?!=)/g, "CSS text assignment is forbidden"],
    [/\bset(?:Timeout|Interval)\s*\(\s*["'`]/g, "string-based timers are forbidden"],
    [/\bjavascript\s*:/gi, "javascript: URLs are forbidden"],
    [/["']unsafe-eval["']/gi, "unsafe-eval is forbidden"],
    [/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(?/g, "runtime network request APIs are forbidden for this application"],
    [/\bnavigator\s*\.\s*sendBeacon\s*\(/g, "runtime network request APIs are forbidden for this application"],
  ];
  for (const [pattern, message] of checks) {
    addMatchViolations(violations, { rootDir, file, source, pattern, message });
  }

  const staticImportPattern = /(?:\bfrom\s*|\bimport\s*)["']([^"']+)["']/g;
  for (const match of source.matchAll(staticImportPattern)) {
    const isServerBuiltin = file === path.join(rootDir, "server.js") && match[1].startsWith("node:");
    if (!isServerBuiltin && REMOTE_OR_ACTIVE_URL.test(match[1])) {
      violations.push(`${location(rootDir, file, source, match.index)} external module imports are forbidden`);
    }
  }

  for (const match of source.matchAll(/\bimport\s*\(/g)) {
    const call = /^import\s*\(\s*(["'`])([^"'`]*)\1\s*\)/.exec(source.slice(match.index));
    if (!call || call[1] === "`" && call[2].includes("${")) {
      violations.push(`${location(rootDir, file, source, match.index)} dynamic imports must use a verifiable local string literal`);
    } else if (!(file === path.join(rootDir, "server.js") && call[2].startsWith("node:")) &&
               REMOTE_OR_ACTIVE_URL.test(call[2])) {
      violations.push(`${location(rootDir, file, source, match.index)} external module imports are forbidden`);
    }
  }
}

export function inspectSvgSource(source, label = "SVG") {
  const violations = [];
  const checks = [
    [/<script\b/gi, "script elements"],
    [/<foreignObject\b/gi, "foreignObject elements"],
    [/\son[a-z][a-z0-9:_-]*\s*=/gi, "event-handler attributes"],
    [/\bjavascript\s*:/gi, "javascript: URLs"],
    [/@import\b/gi, "CSS imports"],
    [/\b(?:href|xlink:href|src|xml:base)\s*=\s*(?:"\s*(?:[a-z][a-z0-9+.-]*:|\/\/)[^"]*"|'\s*(?:[a-z][a-z0-9+.-]*:|\/\/)[^']*')/gi, "external or embedded resource URLs"],
    [/\burl\s*\(\s*(?:["']?\s*)?(?:[a-z][a-z0-9+.-]*:|\/\/)/gi, "external or embedded CSS resources"],
    [/<!DOCTYPE\b|<!ENTITY\b/gi, "document type or entity declarations"],
  ];
  for (const [pattern, feature] of checks) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      violations.push(`${label}:${lineNumber(source, match.index)} SVG ${feature} are forbidden`);
    }
  }
  return violations;
}

async function scanNpmConfiguration(rootDir, files, violations) {
  const npmFiles = files.filter((file) => path.basename(file) === ".npmrc");
  for (const file of npmFiles) {
    const source = await readFile(file, "utf8");
    const pattern = /(?:^|\n)\s*(?:[^\n=]*:_authToken|_auth|username|password)\s*=|https?:\/\/[^/\s:@]+:[^@\s]+@/gi;
    addMatchViolations(violations, {
      rootDir,
      file,
      source,
      pattern,
      message: "npm credentials or authentication configuration are forbidden",
    });
  }

  for (const filename of ["package.json", "package-lock.json"]) {
    const file = path.join(rootDir, filename);
    try {
      const source = await readFile(file, "utf8");
      addMatchViolations(violations, {
        rootDir,
        file,
        source,
        pattern: /["'](?:_authToken|npmAuthToken|_auth|password)["']\s*:/gi,
        message: "package metadata must not contain authentication credentials",
      });
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

export async function collectSecurityViolations(rootDir = process.cwd()) {
  const absoluteRoot = path.resolve(rootDir);
  const publicRoot = path.join(absoluteRoot, "public");
  const projectWalk = await walk(absoluteRoot);
  const publicWalk = await walk(publicRoot);
  const violations = [];

  for (const link of publicWalk.symlinks) {
    violations.push(`${path.relative(absoluteRoot, link)} public assets must not be symbolic links`);
  }
  for (const link of projectWalk.symlinks) {
    const basename = path.basename(link);
    if (basename === ".npmrc") {
      violations.push(`${path.relative(absoluteRoot, link)} npm configuration must not be a symbolic link`);
    }
    if ((basename === ".env" || basename.startsWith(".env.")) && basename !== ".env.example") {
      violations.push(`${path.relative(absoluteRoot, link)} environment files are forbidden in the project tree`);
    }
  }

  const productionSources = [path.join(absoluteRoot, "server.js"), ...publicWalk.files]
    .filter((file, index, files) => files.indexOf(file) === index);
  for (const file of productionSources) {
    const extension = path.extname(file).toLowerCase();
    if (!EXECUTABLE_EXTENSIONS.has(extension) && extension !== ".svg" && extension !== ".css") continue;
    let source;
    try {
      source = await readFile(file, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") continue;
      throw error;
    }
    if (EXECUTABLE_EXTENSIONS.has(extension)) scanExecutable(absoluteRoot, file, source, violations);
    if (extension === ".html") scanHtml(absoluteRoot, file, source, violations);
    if (extension === ".svg") violations.push(...inspectSvgSource(source, path.relative(absoluteRoot, file)));
    if (extension === ".css") {
      addMatchViolations(violations, {
        rootDir: absoluteRoot,
        file,
        source,
        pattern: /@import\s+(?:url\s*\()?\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/gi,
        message: "external stylesheet imports are forbidden",
      });
      addMatchViolations(violations, {
        rootDir: absoluteRoot,
        file,
        source,
        pattern: /\burl\s*\(\s*["']?\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/gi,
        message: "external or active-content stylesheet URLs are forbidden",
      });
    }
  }

  for (const file of projectWalk.files) {
    const relative = path.relative(absoluteRoot, file);
    const basename = path.basename(file);
    if ((basename === ".env" || basename.startsWith(".env.")) && basename !== ".env.example") {
      violations.push(`${relative} environment files are forbidden in the project tree`);
    }
  }

  await scanNpmConfiguration(absoluteRoot, projectWalk.files, violations);
  return [...new Set(violations)].sort();
}

export async function assertProjectSecurity(rootDir = process.cwd()) {
  const violations = await collectSecurityViolations(rootDir);
  if (violations.length > 0) {
    throw new Error(`Security verification failed:\n- ${violations.join("\n- ")}`);
  }
}

export { REMOTE_OR_ACTIVE_URL };
