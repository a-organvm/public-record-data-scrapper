# Output Values
# All outputs are in alphabetical order for maintainability

output "alb_security_group_id" {
  description = "ID of the public ALB security group"
  value       = module.alb_security_group.security_group_id
}

output "app_security_group_id" {
  description = "ID of the application security group"
  value       = module.app_security_group.security_group_id
}

output "db_master_user_secret_arn" {
  description = "ARN of the Secrets Manager secret holding the RDS master credentials (managed by AWS)"
  value       = try(aws_db_instance.postgresql.master_user_secret[0].secret_arn, null)
  sensitive   = true
}

output "backups_bucket_arn" {
  description = "ARN of the S3 bucket for backups"
  value       = module.backups_bucket.s3_bucket_arn
}

output "backups_bucket_name" {
  description = "Name of the S3 bucket for backups"
  value       = module.backups_bucket.s3_bucket_id
}

output "cloudwatch_log_group_application" {
  description = "Name of the CloudWatch log group for application logs"
  value       = aws_cloudwatch_log_group.application.name
}

output "data_exports_bucket_arn" {
  description = "ARN of the S3 bucket for data exports"
  value       = module.data_exports_bucket.s3_bucket_arn
}

output "data_exports_bucket_name" {
  description = "Name of the S3 bucket for data exports"
  value       = module.data_exports_bucket.s3_bucket_id
}

output "database_endpoint" {
  description = "Connection endpoint for RDS PostgreSQL database"
  value       = aws_db_instance.postgresql.endpoint
  sensitive   = true
}

output "database_name" {
  description = "Name of the PostgreSQL database"
  value       = aws_db_instance.postgresql.db_name
}

output "database_port" {
  description = "Port for RDS PostgreSQL database"
  value       = aws_db_instance.postgresql.port
}

output "nat_gateway_ips" {
  description = "Elastic IPs of NAT Gateways for whitelisting"
  value       = module.vpc.nat_gateway_attributes_by_az[*].public_ip
}

output "private_subnet_ids" {
  description = "IDs of private subnets"
  value       = module.vpc.private_subnet_attributes_by_az[*].id
}

output "public_subnet_ids" {
  description = "IDs of public subnets"
  value       = module.vpc.public_subnet_attributes_by_az[*].id
}

output "rds_security_group_id" {
  description = "ID of the RDS security group"
  value       = module.rds_security_group.security_group_id
}

output "redis_endpoint" {
  description = "Primary endpoint for Redis cluster"
  value       = aws_elasticache_replication_group.redis.primary_endpoint_address
  sensitive   = true
}

output "redis_port" {
  description = "Port for Redis cluster"
  value       = aws_elasticache_replication_group.redis.port
}

output "redis_reader_endpoint" {
  description = "Reader endpoint for Redis cluster (for read replicas)"
  value       = aws_elasticache_replication_group.redis.reader_endpoint_address
  sensitive   = true
}

output "redis_security_group_id" {
  description = "ID of the Redis security group"
  value       = module.redis_security_group.security_group_id
}

output "sns_alerts_topic_arn" {
  description = "ARN of SNS topic for alerts"
  value       = aws_sns_topic.alerts.arn
}

output "vpc_cidr" {
  description = "CIDR block of the VPC"
  value       = module.vpc.vpc_attributes.cidr_block
}

output "vpc_id" {
  description = "ID of the VPC"
  value       = module.vpc.vpc_attributes.id
}
