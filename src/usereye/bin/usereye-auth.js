'use strict';

/**
 * `usereye auth save` — capture a signed-in session as Playwright storageState
 * (ROADMAP-NEXT Phase 5.1). Lets a run start already authenticated without
 * embedding credentials, then reuses `.auth/user.json` as `auth.strategy:
 * 'storageState'` for day-2 CI.
 */

const fs = require('fs');
const path = require('path');
const playwright = require('playwright');

const AUTH_USAGE = `Usage: usereye auth save --url <app> --out <file.json> [options]

Drives a login (headed by default so you can finish 2FA/SSO by hand) and saves a
Playwright storageState you can point at with:

  auth: { strategy: 'storageState', storageState: '.auth/user.json' }

Options:
  --url <app>           Application URL (required)
  --out <file.json>     Where to write the storage state (default .auth/user.json)
  --email/--username/--password <v>  Pre-fill credentials (optional)
  --headed              Open a visible browser so you can complete SSO/2FA (default)
  --headless            Drive a headless login (best with credentials)
  --submit <css>        Custom submit selector (default: form submit button)
  --navigate-to <url>   After login, wait for this URL to prove success
  --wait-ms <n>         How long to wait for the post-login transition (default 8000)
  --browser <name>      chromium (default), firefox, or webkit
  --timeout <ms>        Per-navigation timeout (default 30000)

Exit codes: 0 saved; 1 login did not complete; 2 usage/setup.
`;

function parseAuthArgv(argv) {
  const out = {
    out: '.auth/user.json',
    headed: true,
    browser: 'chromium',
    waitMs: 8000,
    timeoutMs: 30000,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const value = () => argv[++index];
    if (token === '--help' || token === '-h') out.help = true;
    else if (token === 'save') {
      /* subcommand already handled */
    } else if (token === '--url') out.url = value();
    else if (token === '--out') out.out = value();
    else if (token === '--email') out.email = value();
    else if (token === '--username') out.username = value();
    else if (token === '--password') out.password = value();
    else if (token === '--submit') out.submit = value();
    else if (token === '--navigate-to') out.navigateTo = value();
    else if (token === '--wait-ms') out.waitMs = Number(value());
    else if (token === '--timeout') out.timeoutMs = Number(value());
    else if (token === '--browser') out.browser = value();
    else if (token === '--headed') out.headed = true;
    else if (token === '--headless') out.headed = false;
    else if (!token.startsWith('--')) out.url = token;
    else throw new Error(`Unknown auth option: ${token}`);
  }
  if (out.help) return out;
  if (!out.url) throw new Error('auth save requires --url <app>.');
  return out;
}

async function loginForm(page, opts) {
  const selectors = {
    email: 'input[type="email"],input[name*="email" i],input[autocomplete="username"],input[type="text"]',
    password: 'input[type="password"]',
    submit:
      opts.submit ||
      'button[type="submit"],button:has-text("Sign in"),button:has-text("Log in"),input[type="submit"]',
  };
  const identity = opts.email || opts.username;
  if (identity) {
    const field = page.locator(selectors.email).first();
    await field.waitFor({ state: 'visible', timeout: opts.timeoutMs });
    await field.fill(identity);
  }
  if (opts.password) {
    const field = page.locator(selectors.password).first();
    await field.waitFor({ state: 'visible', timeout: opts.timeoutMs });
    await field.fill(opts.password);
  }
  const submit = page.locator(selectors.submit).first();
  await submit.waitFor({ state: 'visible', timeout: opts.timeoutMs }).catch(() => {});
  if (await submit.isVisible().catch(() => false)) {
    await submit.click();
  } else if (opts.password) {
    await page.keyboard.press('Enter');
  }
}

function looksLikeLoginPage(text) {
  return /login|sign[ -]?in|password|passcode|unlock/i.test(text);
}

async function runAuth(argv = process.argv.slice(2)) {
  const opts = parseAuthArgv(argv);
  if (opts.help) {
    process.stdout.write(AUTH_USAGE);
    return { exitCode: 0, help: true };
  }
  if (!['chromium', 'firefox', 'webkit'].includes(opts.browser)) {
    throw new Error(`Unsupported browser: ${opts.browser}.`);
  }
  const outPath = path.resolve(opts.out);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browser = await playwright[opts.browser].launch({ headless: !opts.headed });
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    process.stdout.write(`Opening ${opts.url} …\n`);
    await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: opts.timeoutMs });
    await page.waitForLoadState('networkidle').catch(() => {});
    const text = (
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    )
      .replace(/\s+/g, ' ')
      .slice(0, 2000);
    if (looksLikeLoginPage(text)) {
      await loginForm(page, opts);
    }
    process.stdout.write(
      opts.headed
        ? 'Complete any 2FA / SSO in the browser window.\n'
        : 'Waiting for the post-login transition …\n',
    );
    // Wait for a URL change (login page -> app) or the explicit --navigate-to.
    const startedUrl = page.url();
    const deadline = Date.now() + opts.waitMs;
    while (Date.now() < deadline) {
      const current = page.url();
      if (opts.navigateTo) {
        if (current.startsWith(opts.navigateTo)) break;
      } else if (current !== startedUrl) {
        break;
      }
      await page.waitForTimeout(300);
    }
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await context.storageState({ path: outPath });
    const state = JSON.parse(fs.readFileSync(outPath, 'utf8'));
    const cookies = state.cookies || [];
    process.stdout.write(
      `Saved storageState → ${outPath} (${cookies.length} cookie(s), ${(state.origins || []).length} origin(s)).\n`,
    );
    return { exitCode: 0, outPath, cookies: cookies.length, url: page.url() };
  } finally {
    await browser.close().catch(() => {});
  }
}

module.exports = { AUTH_USAGE, parseAuthArgv, runAuth };
