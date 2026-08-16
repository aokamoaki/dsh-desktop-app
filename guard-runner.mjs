// guard-runner.mjs - runs the startup guard in a CHILD process so a native
// crash inside it (zstd / session scan under the Electron runtime) can never
// take down the desktop app. Usage:
//   node guard-runner.mjs <guard-core.mjs path> <DSH home>
import { pathToFileURL } from 'node:url';

const [guardPath, home] = process.argv.slice(2);

try {
  const { runGuard } = await import(pathToFileURL(guardPath).href);
  const result = await runGuard(home, { detectBootCrash: true });
  process.stdout.write(JSON.stringify(result));
  process.exit(0);
} catch (e) {
  process.stderr.write(`guard failed: ${(e && e.message) || e}`);
  process.exit(2);
}
