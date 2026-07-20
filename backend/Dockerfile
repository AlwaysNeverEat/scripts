FROM node:20-alpine
# Контекст сборки — корень репозитория (backend импортирует ../shared).
# В Render: Dockerfile Path = backend/Dockerfile, Build Context = корень репо.
WORKDIR /app/backend
COPY backend/package.json .
RUN npm install --omit=dev
COPY backend/src ./src
COPY shared ../shared
EXPOSE 3001
CMD ["node", "src/index.js"]
