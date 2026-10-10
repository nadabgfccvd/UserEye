module.exports = {
  auth: { strategy: 'hook' },
  hooks: {
    async login(page) {
      await page.evaluate(() => localStorage.setItem('fixture-auth', 'yes'));
      await page.reload({ waitUntil: 'domcontentloaded' });
    },
  },
  codeQuality: false,
  recordVideo: false,
};
