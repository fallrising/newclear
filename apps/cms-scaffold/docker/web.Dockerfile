ARG APP=web-front
ARG PORT=5173
FROM node:24-alpine
ARG APP
ARG PORT
ARG VITE_API_BASE=http://localhost:8080
WORKDIR /src
COPY package.json package-lock.json* ./
COPY packages ./packages
COPY apps ./apps
RUN npm install
ENV VITE_API_BASE=$VITE_API_BASE
RUN npm run build -w @cms/${APP}
ENV APP_NAME=${APP}
ENV PORT=${PORT}
EXPOSE ${PORT}
CMD ["sh", "-c", "npm run preview -w @cms/$APP_NAME -- --host 0.0.0.0 --port $PORT"]
