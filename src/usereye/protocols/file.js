'use strict';

async function downloadProtocol(runner) {
  if (!runner.allowDownloads) {
    return { status: 'skipped', details: { reason: 'downloads-not-authorized' } };
  }
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const control = page
      .getByRole('button', { name: /download|baixar|export/i })
      .or(page.locator('a[download]'))
      .first();
    if (!(await control.count()) || !(await control.isVisible())) {
      return { status: 'skipped', details: { reason: 'no-download-control', telemetry } };
    }
    const downloadPromise = page.waitForEvent('download', { timeout: 5000 });
    const dismissDialog = dialog => dialog.dismiss();
    page.once('dialog', dismissDialog);
    await control.click();
    const download = await downloadPromise.catch(() => null);
    page.off('dialog', dismissDialog);
    return {
      status: download ? 'passed' : 'warning',
      details: { suggestedFilename: download?.suggestedFilename() || null, telemetry },
    };
  });
}

async function uploadProtocol(runner) {
  if (!runner.allowWrite) {
    return { status: 'skipped', details: { reason: 'write-not-authorized' } };
  }
  return runner.withContext({}, async ({ page, telemetry }) => {
    await page.goto(runner.baseURL, { waitUntil: 'domcontentloaded' });
    const input = page.locator('input[type="file"]:visible').first();
    if (!(await input.count())) {
      return { status: 'skipped', details: { reason: 'no-visible-file-input', telemetry } };
    }
    await input.setInputFiles({
      name: 'usereye-protocol.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('UserEye protocol fixture'),
    });
    const files = await input.evaluate(element =>
      [...element.files].map(file => ({ name: file.name, size: file.size, type: file.type })),
    );
    return { status: files.length ? 'passed' : 'warning', details: { files, telemetry } };
  });
}

module.exports = { downloadProtocol, uploadProtocol };
