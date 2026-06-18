# Kubernetes Deployment

This directory contains Kubernetes manifests for deploying the UCC-MCA Intelligence Platform.

## Prerequisites

- Kubernetes cluster (1.25+)
- kubectl configured for your cluster
- PostgreSQL database (RDS or self-hosted)
- Redis instance (ElastiCache or self-hosted)
- Container registry access (GHCR, ECR, etc.)

## Files

| File              | Description                            |
| ----------------- | -------------------------------------- |
| `namespace.yaml`  | Creates the `ucc-mca` namespace        |
| `configmap.yaml`  | Non-sensitive configuration            |
| `secrets.yaml`    | Template for secrets (replace values!) |
| `deployment.yaml` | API server and worker deployments      |
| `service.yaml`    | Internal ClusterIP service             |
| `ingress.yaml`    | External ingress with TLS              |
| `hpa.yaml`        | Horizontal Pod Autoscaler              |

## Quick Start

1. **Create namespace and config:**

   ```bash
   kubectl apply -f namespace.yaml
   kubectl apply -f configmap.yaml
   ```

2. **Create secrets (modify with real values first!):**

   ```bash
   # Option 1: Edit secrets.yaml with real values
   kubectl apply -f secrets.yaml

   # Option 2: Create secrets from command line
   kubectl create secret generic ucc-mca-secrets \
     --namespace ucc-mca \
     --from-literal=DATABASE_URL='postgresql://...' \
     --from-literal=REDIS_URL='rediss://...' \
     --from-literal=JWT_SECRET='your-secure-secret' \
     --from-literal=AUTH0_CLIENT_SECRET='...' \
     --from-literal=STRIPE_SECRET_KEY='...' \
     --from-literal=STRIPE_WEBHOOK_SECRET='...' \
     --from-literal=TWILIO_AUTH_TOKEN='...' \
     --from-literal=SENDGRID_WEBHOOK_VERIFICATION_KEY='...' \
     --from-literal=PLAID_CLIENT_ID='...' \
     --from-literal=PLAID_SECRET='...'
   ```

3. **Deploy application:**

   ```bash
   kubectl apply -f deployment.yaml
   kubectl apply -f service.yaml
   kubectl apply -f ingress.yaml
   kubectl apply -f hpa.yaml
   ```

4. **Verify deployment:**
   ```bash
   kubectl get pods -n ucc-mca
   kubectl get svc -n ucc-mca
   kubectl logs -n ucc-mca -l app.kubernetes.io/component=api
   ```

## Configuration

### Environment Variables

See `configmap.yaml` for non-sensitive config and `secrets.yaml` for sensitive values.
Production startup validates `JWT_SECRET`, `DATABASE_URL`, `CORS_ORIGIN`, the
Stripe/Twilio/SendGrid webhook secrets, and Plaid API credentials. Keep
`DATABASE_URL` pointed at a non-owner Postgres role for the API/worker so RLS
policies from migration `018` actually apply.

### Scaling

The HPA is configured to:

- **API**: 3-10 replicas based on CPU (70%) and memory (80%)
- **Worker**: 2-5 replicas based on CPU (80%)

Adjust `hpa.yaml` for your workload.

### Resource Limits

Default limits in `deployment.yaml`:

- API: 100m-500m CPU, 256Mi-512Mi memory
- Worker: 100m-1000m CPU, 256Mi-1Gi memory

Adjust based on your observed usage.

## Production Checklist

- [ ] Replace placeholder secrets with real values
- [ ] Configure Auth0 to issue an `org_id` claim, or a namespaced claim ending in `/org_id`
- [ ] Run migrations `014`-`019` before sending production traffic to hardened routes
- [ ] Use a non-owner, non-`BYPASSRLS` Postgres role for API/worker `DATABASE_URL`
- [ ] Confirm `organizations.subscription_tier` values match entitlement intent
- [ ] Configure TLS certificate (cert-manager or manual)
- [ ] Update ingress hostname
- [ ] Set up external PostgreSQL and Redis
- [ ] Configure monitoring (Prometheus/Grafana)
- [ ] Set up log aggregation
- [ ] Configure network policies
- [ ] Set up PodDisruptionBudget for HA

## Troubleshooting

### Pods not starting

```bash
kubectl describe pod -n ucc-mca <pod-name>
kubectl logs -n ucc-mca <pod-name>
```

### Database connection issues

```bash
kubectl exec -n ucc-mca -it <pod-name> -- /bin/sh
# Inside pod:
nc -zv postgres-host 5432
```

### Health check failures

```bash
kubectl port-forward -n ucc-mca svc/ucc-mca-api 3000:80
curl http://localhost:3000/api/health
```
