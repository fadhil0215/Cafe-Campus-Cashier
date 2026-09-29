# Gunakan Node.js LTS resmi yang ringan (Alpine)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Salin manifest dependency dulu supaya layer cache npm install efisien
COPY package.json package-lock.json ./

# Install semua dependency termasuk build tool (esbuild)
RUN npm ci

# Baru salin sisa kode proyek
COPY . .

# Build frontend bundle
RUN npm run build

# Buat folder logs jika belum ada
RUN mkdir -p logs

# Expose port aplikasi (default: 4176)
EXPOSE 4176

# Set environment
ENV NODE_ENV=production
ENV PORT=4176
ENV HOST=0.0.0.0

# Jalankan server
CMD ["node", "server.mjs"]