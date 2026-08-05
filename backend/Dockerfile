# Node 22, а не 20: undici 8 (нужен для послабления TLS у CRM, см.
# src/http/tlsTrust.js) на 20-м падает с «webidl.util.markAsUncloneable is not a
# function» — на этом уже обжигались в deploy/scrape.sh.
FROM node:22-alpine
# Контекст сборки — корень репозитория (backend импортирует ../shared).
# В Render: Dockerfile Path = backend/Dockerfile, Build Context = корень репо.
WORKDIR /app/backend
COPY backend/package.json .
RUN npm install --omit=dev
COPY backend/src ./src
COPY shared ../shared
EXPOSE 3001
CMD ["node", "src/index.js"]
