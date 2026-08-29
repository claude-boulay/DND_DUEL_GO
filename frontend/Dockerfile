# syntax=docker/dockerfile:1

# ---------- base : dépendances complètes ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install

# ---------- dev : serveur Vite avec HMR ----------
FROM deps AS dev
ENV NODE_ENV=development
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev"]

# ---------- build : bundle statique ----------
FROM deps AS build
ENV NODE_ENV=production
COPY . .
RUN npm run build

# ---------- prod : Nginx sert le bundle et proxifie l'API ----------
FROM nginx:1.27-alpine AS prod
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
