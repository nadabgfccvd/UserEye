# Version policy: this tag MUST match the exact "playwright" version pinned in
# package.json / resolved in package-lock.json. `npm run check:versions`
# (scripts/check-playwright-version.js) fails CI and prepack on divergence.
FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /opt/usereye
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npx playwright install chromium
COPY . .

WORKDIR /work
ENV CI=1
ENTRYPOINT ["node", "/opt/usereye/bin/usereye.js"]
CMD ["--help"]
