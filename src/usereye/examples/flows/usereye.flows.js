'use strict';

module.exports = [
  {
    name: 'home page smoke',
    tags: ['critical', 'smoke'],
    run: async ({ eye, page, expect }) => {
      await eye.step('home renders', async () => {
        await eye.see('body');
        await expect(page).count('body', 1);
        await expect(page).text('body', /\S/);
        await eye.waitFor(() => document.readyState === 'complete', { timeout: 5000 });
      });
    },
  },
];
