# Gunakan Node.js LTS resmi yang ringan (Alpine)
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Salin manifest dependency dulu supaya layer cache npm install efisien
COPY package.json package-lock.json ./

# Install dependency production saja (express, mysql2, midtrans-client, dll)
RUN npm ci --omit=dev

# Baru salin sisa kode proyek
COPY . .

# Buat folder data dan logs jika belum ada
RUN mkdir -p data logs

# Expose port aplikasi (default: 4176)
EXPOSE 4176

# Set environment
ENV NODE_ENV=production
ENV PORT=4176
ENV HOST=0.0.0.0

# Jalankan server
CMD ["node", "server.mjs"]