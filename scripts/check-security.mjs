import { fileURLToPath } from "node:url";

import { assertProjectSecurity } from "./security-checks.mjs";

export async function runSecurityCheck(rootDir = process.cwd()) {
  await assertProjectSecurity(rootDir);
  return "Security checks passed.";
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  try {
    console.log(await runSecurityCheck());
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Security verification failed.");
    process.exitCode = 1;
  }
}
