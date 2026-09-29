# AMI PHARMA — Frontend (React + TypeScript + Vite + Tailwind) servi par Nginx
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
# npm ci : installation déterministe depuis le lockfile (cohérent avec le backend)
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
