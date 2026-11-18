import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('BROWSER ERROR:', error.message));
  await page.goto('http://127.0.0.1:5189/wasm-bench', { waitUntil: 'networkidle' });
  await page.waitForFunction(
    () => window.__wasmBenchResult || window.__wasmBenchError,
    null,
    { timeout: 120000 }
  );
  const outcome = await page.evaluate(() => ({
    result: window.__wasmBenchResult,
    error: window.__wasmBenchError
  }));
  if (outcome.error) throw Error(outcome.error);
  const result = outcome.result;
  if (result.comparisons !== result.fields) throw Error('Incomplete parity check');
  writeFileSync('wasm-compact-results.json', JSON.stringify(result, null, 2) + '\n');
  console.log('WASM_COMPACT_BENCHMARK=' + JSON.stringify({
    fields: result.fields,
    visibleFields: result.visibleFields,
    sharedRoot: result.sharedRoot,
    affectedFields: result.affectedFields,
    runs: result.runs,
    comparisons: result.comparisons,
    cases: result.cases.map(x => ({
      case: x.case,
      fullMedianMs: x.fullMedianMs,
      compactMedianMs: x.compactMedianMs,
      speedup: x.speedup
    }))
  }));
} finally {
  await browser.close();
}
