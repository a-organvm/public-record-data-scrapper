# Deployment Guide - UCC-MCA Intelligence Platform

## Table of Contents

1. [Infrastructure Requirements](#infrastructure-requirements)
2. [Environment Setup](#environment-setup)
3. [Database Setup](#database-setup)
4. [Application Deployment](#application-deployment)
5. [Data Pipeline Configuration](#data-pipeline-configuration)
6. [Monitoring & Alerting](#monitoring--alerting)
7. [Security Hardening](#security-hardening)
8. [Scaling Strategy](#scaling-strategy)
9. [Troubleshooting](#troubleshooting)
10. [Rollback Procedures](#rollback-procedures)

---

## Infrastructure Requirements

### Minimum Requirements (Development)

- **CPU**: 2 cores
- **RAM**: 4GB
- **Storage**: 20GB SSD
- **Node.js**: 20.x LTS
- **PostgreSQL**: 14+

### Recommended Requirements (Production)

- **CPU**: 8+ cores
- **RAM**: 16GB+
- **Storage**: 100GB+ SSD (NVMe preferred)
- **Node.js**: 20.x LTS
- **PostgreSQL**: 14+ with 50GB+ storage
- **Redis**: 7+ (for caching)
- **Load Balancer**: Nginx or similar

### Cloud Provider Options

#### AWS

```
- EC2: t3.xlarge or m5.xlarge
- RDS: db.t3.large PostgreSQL 14
- ElastiCache: cache.t3.medium Redis
- S3: For data exports and backups
- CloudWatch: For monitoring
```

#### Google Cloud

```
- Compute Engine: n2-standard-4
- Cloud SQL: PostgreSQL 14, db-n1-standard-2
- Memorystore: Redis M1
- Cloud Storage: For data exports
- Cloud Monitoring: For observability
```

#### Azure

```
- Virtual Machines: Standard_D4s_v3
- Azure Database for PostgreSQL: General Purpose, 4 vCores
- Azure Cache for Redis: Standard C1
- Blob Storage: For exports
- Azure Monitor: For metrics
```

---

## Environment Setup

### 1. Clone Repository

```bash
git clone https://github.com/your-org/public-record-data-scrapper.git
cd public-record-data-scrapper
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment

```bash
# Copy example environment file
cp .env.example .env

# Edit .env with your configuration
nano .env
```

### 4. Essential Environment Variables

```bash
# Application
NODE_ENV=production
PORT=3000

# Feature Flags
VITE_USE_MOCK_DATA=false
VITE_ENABLE_REALTIME_INGESTION=true
VITE_ENABLE_ML_ENRICHMENT=true
VITE_ENABLE_AUTO_REFRESH=true

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/ucc_intelligence
DATABASE_POOL_SIZE=20
DATABASE_TIMEOUT=30000

# Redis (Caching)
REDIS_URL=redis://localhost:6379
REDIS_PREFIX=ucc:

# Data Sources
VITE_UCC_API_ENDPOINT=https://api.ucc-filings.com/v1
VITE_UCC_API_KEY=your_production_api_key

# ML Services
VITE_ML_API_ENDPOINT=https://ml.yourcompany.com/v1
VITE_ML_API_KEY=your_ml_api_key

# Monitoring
SENTRY_DSN=https://your-sentry-dsn@sentry.io/project-id
PROMETHEUS_PORT=9090

# Security
SESSION_SECRET=generate_with_openssl_rand
ENCRYPTION_KEY=generate_with_openssl_rand_base64
ALLOWED_ORIGINS=https://yourdomain.com,https://app.yourdomain.com

# Email/Notifications (optional)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-app-password
ALERT_EMAIL=alerts@yourdomain.com
```

---

## Database Setup

### 1. Create Database

```bash
# PostgreSQL
createdb ucc_intelligence

# Or using SQL
psql -c "CREATE DATABASE ucc_intelligence;"
```

### 2. Run Schema

```bash
psql -d ucc_intelligence -f database/schema.sql
```

### 3. Run Migrations

```bash
for file in database/migrations/*.sql; do
    echo "Running $file..."
    psql -d ucc_intelligence -f "$file"
done
```

### 4. Verify Setup

```bash
psql -d ucc_intelligence -c "\dt"  # List tables
psql -d ucc_intelligence -c "SELECT version FROM schema_migrations;"  # Check migrations
```

### 5. Configure Backups

```bash
# Daily backup cron job
0 2 * * * pg_dump ucc_intelligence | gzip > /backups/ucc_$(date +\%Y\%m\%d).sql.gz

# Cleanup old backups (keep 30 days)
find /backups -name "ucc_*.sql.gz" -mtime +30 -delete
```

---

## Application Deployment

### Development Build

```bash
npm run dev
```

### Production Build

```bash
# Build frontend + bundled API server
npm run build:render

# Preview
npm run preview

# Start bundled production server
npm start
```

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start npm --name "ucc-app" -- start

# Configure startup script
pm2 startup
pm2 save

# Monitor
pm2 monit

# Logs
pm2 logs ucc-app

# Restart
pm2 restart ucc-app

# Stop
pm2 stop ucc-app
```

### Docker Deployment

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
EXPOSE 3000
CMD ["npm", "start"]
```

```bash
# Build image
docker build -t ucc-intelligence:latest .

# Run container
docker run -d \
  --name ucc-app \
  -p 3000:3000 \
  --env-file .env \
  ucc-intelligence:latest
```

### Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - '3000:3000'
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:14-alpine
    environment:
      POSTGRES_DB: ucc_intelligence
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./database:/docker-entrypoint-initdb.d
    ports:
      - '5432:5432'
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data
    restart: unless-stopped

  prometheus:
    image: prom/prometheus
    ports:
      - '9090:9090'
    volumes:
      - ./monitoring/prometheus-config.yml:/etc/prometheus/prometheus.yml
      - ./monitoring/alerts.yml:/etc/prometheus/alerts.yml
      - prometheus_data:/prometheus
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
```

---

## Data Pipeline Configuration

### 1. Configure Data Sources

Edit `src/lib/config/dataPipeline.ts`:

```typescript
export const dataSources = {
  production: [
    {
      id: 'production-api',
      name: 'Production UCC API',
      type: 'api',
      endpoint: process.env.VITE_UCC_API_ENDPOINT,
      apiKey: process.env.VITE_UCC_API_KEY,
      rateLimit: 100
    }
    // Add more sources as needed
  ]
}
```

### 2. Configure Scheduler

```typescript
export const scheduleConfig = {
  production: {
    enabled: true,
    ingestionInterval: 24 * 60 * 60 * 1000, // 24 hours
    enrichmentInterval: 6 * 60 * 60 * 1000, // 6 hours
    refreshInterval: 12 * 60 * 60 * 1000, // 12 hours
    staleDataThreshold: 7, // days
    autoStart: true
  }
}
```

### 3. Start Data Pipeline

The pipeline starts automatically with the application when `autoStart: true`.

Manual control:

```typescript
import { DataRefreshScheduler } from '@/lib/services'

const scheduler = new DataRefreshScheduler(config)

// Start
scheduler.start()

// Stop
scheduler.stop()

// Manual trigger
await scheduler.triggerIngestion()
```

### 4. Monitor Pipeline

- Check logs: `pm2 logs ucc-app | grep 'pipeline'`
- View metrics: http://localhost:9090 (Prometheus)
- Check status UI: Dashboard > Data Pipeline tab

---

## Monitoring & Alerting

### 1. Prometheus Setup

```bash
# Start Prometheus
docker run -d \
  --name prometheus \
  -p 9090:9090 \
  -v $(pwd)/monitoring/prometheus-config.yml:/etc/prometheus/prometheus.yml \
  prom/prometheus
```

### 2. Grafana Setup

```bash
# Start Grafana
docker run -d \
  --name grafana \
  -p 3001:3000 \
  grafana/grafana
```

Access Grafana: http://localhost:3001

- Username: admin
- Password: admin (change on first login)

### 3. Import Dashboards

1. Go to Dashboards > Import
2. Upload `monitoring/grafana-dashboards/*.json`
3. Select Prometheus data source

### 4. Configure Alerts

Alertmanager configuration (`monitoring/alertmanager.yml`):

```yaml
global:
  smtp_smarthost: 'smtp.gmail.com:587'
  smtp_from: 'alerts@yourdomain.com'
  smtp_auth_username: 'your-email@domain.com'
  smtp_auth_password: 'your-app-password'

route:
  receiver: 'email'
  group_by: ['alertname', 'severity']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h

receivers:
  - name: 'email'
    email_configs:
      - to: 'team@yourdomain.com'
        headers:
          Subject: '[UCC Platform] {{ .GroupLabels.alertname }}'
```

### 5. Health Check Endpoint

```bash
# Application health
curl http://localhost:3000/health

# Expected response:
{
  "status": "healthy",
  "timestamp": "2025-01-01T00:00:00Z",
  "uptime": 3600,
  "database": "connected",
  "pipeline": "running"
}
```

---

## Security Hardening

### 1. Firewall Rules

```bash
# Allow only necessary ports
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP
ufw allow 443/tcp  # HTTPS
ufw enable
```

### 2. SSL/TLS Certificate

```bash
# Install certbot
sudo apt-get install certbot

# Get certificate
sudo certbot certonly --standalone -d yourdomain.com
```

### 3. Nginx Configuration

```nginx
server {
    listen 80;
    server_name yourdomain.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name yourdomain.com;

    ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 4. Environment Variable Security

```bash
# Use encrypted environment variables
# Store in AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault

# Access in application:
import { SecretsManager } from '@aws-sdk/client-secrets-manager'

const client = new SecretsManager({ region: 'us-east-1' })
const secret = await client.getSecretValue({ SecretId: 'ucc-app-secrets' })
```

### 5. Database Security

```sql
-- Create dedicated user with limited permissions
CREATE USER ucc_app WITH PASSWORD 'strong_password';

-- Grant only necessary permissions
GRANT CONNECT ON DATABASE ucc_intelligence TO ucc_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ucc_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ucc_app;

-- Revoke superuser privileges
REVOKE ALL ON SCHEMA public FROM public;
```

---

## Scaling Strategy

### Horizontal Scaling

```bash
# Load balancer (Nginx)
upstream ucc_backend {
    least_conn;
    server app1:3000;
    server app2:3000;
    server app3:3000;
}
```

### Database Read Replicas

```sql
-- Primary database (writes)
DATABASE_URL=postgresql://master:5432/ucc_intelligence

-- Read replicas (reads)
DATABASE_READ_URL=postgresql://replica1:5432/ucc_intelligence
```

### Caching Strategy

```typescript
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

// Cache prospect data
await redis.setex(`prospect:${id}`, 3600, JSON.stringify(prospect))

// Retrieve from cache
const cached = await redis.get(`prospect:${id}`)
```

### Queue Processing

```typescript
// Use Bull for job queues
import Bull from 'bull'

const ingestionQueue = new Bull('ingestion', process.env.REDIS_URL)

ingestionQueue.process(async (job) => {
  await ingestDataForState(job.data.state)
})
```

---

## Troubleshooting

### Common Issues

#### Pipeline Not Starting

```bash
# Check logs
pm2 logs ucc-app | grep ERROR

# Check scheduler status
curl http://localhost:3000/api/pipeline/status

# Manually start
curl -X POST http://localhost:3000/api/pipeline/start
```

#### Database Connection Errors

```bash
# Test connection
psql -d ucc_intelligence -c "SELECT 1"

# Check pool size
echo "SELECT count(*) FROM pg_stat_activity;" | psql -d ucc_intelligence

# Restart application
pm2 restart ucc-app
```

#### High Memory Usage

```bash
# Check memory
pm2 monit

# Restart with increased memory
node --max-old-space-size=4096 dist/index.js

# Clear cache
redis-cli FLUSHDB
```

---

## Rollback Procedures

### Application Rollback

```bash
# With PM2
pm2 delete ucc-app
git checkout previous-stable-tag
npm install
npm run build
pm2 start npm --name "ucc-app" -- start
```

### Database Rollback

```bash
# Restore from backup
psql -d ucc_intelligence < /backups/ucc_20250101.sql

# Or use point-in-time recovery (if configured)
```

### Complete System Rollback

```bash
# 1. Stop application
pm2 stop ucc-app

# 2. Restore database
psql -d ucc_intelligence < /backups/ucc_20250101.sql

# 3. Checkout previous version
git checkout v1.0.0

# 4. Rebuild
npm install
npm run build

# 5. Restart
pm2 restart ucc-app

# 6. Verify
curl http://localhost:3000/health
```

---

## Post-Deployment Checklist

- [ ] Application starts without errors
- [ ] Database migrations completed
- [ ] All environment variables configured
- [ ] SSL certificate installed
- [ ] Monitoring configured and working
- [ ] Alerts configured and tested
- [ ] Backups scheduled and tested
- [ ] Load testing completed
- [ ] Security scan passed
- [ ] Documentation updated
- [ ] Team notified

---

## Support

For deployment issues:

- Check logs: `pm2 logs ucc-app`
- Review documentation: [README.md](./README.md)
- Contact: support@yourdomain.com
