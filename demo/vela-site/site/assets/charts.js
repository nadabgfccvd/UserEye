/* ==========================================================================
   Vela Analytics — charts.js
   Sample telemetry datasets + SVG chart renderer for the product live demo.
   Exposes window.velaInitCharts (called by app.js boot) and
   window.__velaCharts.setDataset (called by the tablist in app.js).
   ========================================================================== */
'use strict';

(function () {
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* --------------------------------------------------------------- charts */
  const CHART_DATA = {
    latency: {
      unit: 'ms',
      title: 'p95 latency (ms) — last 24 hours',
      series: {
        desktop: [182, 176, 190, 171, 165, 158, 163, 170, 168, 161, 157, 149, 152, 148, 144, 150, 147, 142, 139, 145, 141, 136, 133, 129],
        api: [241, 238, 245, 236, 230, 228, 235, 240, 237, 229, 224, 219, 225, 220, 216, 222, 218, 212, 208, 215, 210, 205, 201, 196],
        mobile: [312, 305, 318, 299, 292, 288, 296, 303, 298, 289, 283, 276, 281, 275, 269, 277, 272, 265, 259, 268, 262, 255, 249, 243],
      },
    },
    errors: {
      unit: '%',
      title: 'Error rate (%) — last 24 hours',
      series: {
        desktop: [0.42, 0.38, 0.45, 0.36, 0.33, 0.31, 0.35, 0.4, 0.37, 0.32, 0.3, 0.27, 0.29, 0.26, 0.24, 0.28, 0.25, 0.23, 0.21, 0.25, 0.22, 0.2, 0.18, 0.17],
        api: [0.88, 0.84, 0.92, 0.8, 0.76, 0.74, 0.82, 0.86, 0.81, 0.73, 0.7, 0.66, 0.71, 0.67, 0.63, 0.69, 0.65, 0.61, 0.58, 0.64, 0.6, 0.56, 0.53, 0.5],
        mobile: [1.24, 1.18, 1.3, 1.12, 1.08, 1.04, 1.15, 1.22, 1.16, 1.06, 1.02, 0.96, 1.0, 0.95, 0.9, 0.98, 0.93, 0.88, 0.84, 0.92, 0.87, 0.82, 0.78, 0.74],
      },
    },
    traffic: {
      unit: 'k req/min',
      title: 'Requests (thousands/min) — last 24 hours',
      series: {
        desktop: [42, 44, 41, 46, 48, 47, 50, 52, 49, 54, 56, 55, 58, 60, 59, 62, 64, 63, 66, 68, 67, 70, 72, 74],
        api: [61, 63, 60, 65, 68, 67, 70, 73, 71, 75, 78, 77, 80, 83, 82, 85, 88, 87, 90, 93, 92, 95, 98, 101],
        mobile: [28, 30, 29, 32, 34, 33, 36, 38, 37, 40, 42, 41, 44, 46, 45, 48, 50, 49, 52, 54, 53, 56, 58, 61],
      },
    },
  };
  const SERIES_NAMES = { desktop: 'Web app', api: 'Public API', mobile: 'Mobile SDK' };
  const CHART_W = 720;
  const CHART_H = 260;
  const PAD = { top: 16, right: 16, bottom: 30, left: 46 };

  function initCharts() {
    const svg = $('#vela-chart');
    if (!svg) return;
    const hidden = { desktop: false, api: false, mobile: false };
    let dataset = 'latency';

    function draw(animate) {
      const data = CHART_DATA[dataset];
      const values = Object.values(data.series).flat();
      const max = Math.max(...values) * 1.08;
      const min = Math.min(0, Math.min(...values));
      const innerW = CHART_W - PAD.left - PAD.right;
      const innerH = CHART_H - PAD.top - PAD.bottom;
      const x = (i) => PAD.left + (i / 23) * innerW;
      const y = (v) => PAD.top + innerH - ((v - min) / (max - min)) * innerH;

      const parts = [];
      // gridlines + y labels (5 steps)
      for (let g = 0; g <= 4; g++) {
        const value = min + ((max - min) * g) / 4;
        const gy = y(value);
        parts.push(`<line class="grid-line" x1="${PAD.left}" y1="${gy.toFixed(1)}" x2="${CHART_W - PAD.right}" y2="${gy.toFixed(1)}"/>`);
        parts.push(
          `<text class="axis-label" x="${PAD.left - 8}" y="${(gy + 4).toFixed(1)}" text-anchor="end">${value >= 10 ? Math.round(value) : value.toFixed(1)}</text>`,
        );
      }
      // x labels every 6h
      ['00:00', '06:00', '12:00', '18:00', '24:00'].forEach((label, i) => {
        parts.push(`<text class="axis-label" x="${x(i * 6).toFixed(1)}" y="${CHART_H - 8}" text-anchor="middle">${label}</text>`);
      });
      // series
      for (const key of ['desktop', 'api', 'mobile']) {
        const cls = key === 'desktop' ? 's1' : key === 'api' ? 's2' : 's3';
        const points = data.series[key].map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
        const hideAttr = hidden[key] ? ' hidden' : '';
        parts.push(
          `<polyline class="series ${cls}" data-series="${key}" points="${points}"${hideAttr}><title>${SERIES_NAMES[key]} — ${data.title}</title></polyline>`,
        );
      }
      svg.setAttribute('viewBox', `0 0 ${CHART_W} ${CHART_H}`);
      svg.innerHTML = parts.join('');

      if (animate && !prefersReducedMotion.matches) {
        $$('.series', svg).forEach((line) => {
          const len = line.getTotalLength ? line.getTotalLength() : 1200;
          line.style.strokeDasharray = len;
          line.style.strokeDashoffset = len;
          line.getBoundingClientRect(); // force reflow
          line.style.transition = 'stroke-dashoffset 0.9s ease';
          line.style.strokeDashoffset = '0';
        });
      }
    }

    window.__velaCharts = {
      setDataset(name) {
        if (!CHART_DATA[name]) return;
        dataset = name;
        draw(true);
      },
    };

    $$('[data-series-toggle]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.seriesToggle;
        hidden[key] = !hidden[key];
        btn.setAttribute('aria-pressed', String(!hidden[key]));
        const line = $(`.series[data-series="${key}"]`, svg);
        if (line) line.hidden = hidden[key];
      });
    });

    draw(true);

    // live ticker
    const ticker = $('[data-ticker]');
    if (ticker) {
      const target = $('[data-ticker-value]', ticker);
      let base = 128400;
      setInterval(() => {
        base += Math.round((Math.random() - 0.42) * 900);
        base = Math.max(110000, Math.min(160000, base));
        if (target) target.textContent = base.toLocaleString('en-US');
      }, 4000);
    }
  }

  window.velaInitCharts = initCharts;
})();
