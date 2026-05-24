# Input Variables
# All variables are in alphabetical order for maintainability

variable "alert_email" {
  description = "Email address for CloudWatch alerts and notifications"
  type        = string
  default     = ""
}

variable "allowed_ssh_cidr" {
  description = "CIDR block allowed for SSH access to application servers"
  type        = string
  default     = "10.0.0.0/8"
}

variable "availability_zones_count" {
  description = "Number of availability zones to use for high availability"
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zones_count >= 2 && var.availability_zones_count <= 3
    error_message = "Availability zones count must be between 2 and 3."
  }
}

variable "aws_region" {
  description = "AWS region where resources will be created"
  type        = string
  default     = "us-east-1"
}

variable "cloudwatch_retention_days" {
  description = "Number of days to retain CloudWatch logs"
  type        = number
  default     = 30
}

variable "database_subnet_cidrs" {
  description = "CIDR blocks for database subnets"
  type        = list(string)
  default     = ["10.0.21.0/24", "10.0.22.0/24", "10.0.23.0/24"]
}

variable "db_allocated_storage" {
  description = "Allocated storage for RDS instance in GB"
  type        = number
  default     = 100
}

variable "db_backup_retention_period" {
  description = "Number of days to retain automated backups"
  type        = number
  default     = 7
}

variable "db_backup_window" {
  description = "Preferred backup window for RDS (UTC)"
  type        = string
  default     = "03:00-04:00"
}

variable "db_deletion_protection" {
  description = "Enable deletion protection for RDS instance"
  type        = bool
  default     = true
}

variable "db_engine_version" {
  description = "PostgreSQL engine version"
  type        = string
  default     = "14.15"
}

variable "db_instance_class" {
  description = "Instance class for RDS PostgreSQL"
  type        = string
  default     = "db.t3.large"
}

variable "db_maintenance_window" {
  description = "Preferred maintenance window for RDS (UTC)"
  type        = string
  default     = "sun:04:00-sun:05:00"
}

# NOTE: db_master_password has been removed. The RDS master password is now
# managed by AWS Secrets Manager via `manage_master_user_password = true` in
# main.tf, so no plaintext password is passed through Terraform variables/state.
# Consumers should read credentials from the `db_master_user_secret_arn` output.

variable "db_master_username" {
  description = "Master username for RDS PostgreSQL"
  type        = string
  default     = "uccadmin"
}

variable "db_monitoring_interval" {
  description = "Enhanced monitoring interval in seconds (0, 1, 5, 10, 15, 30, 60)"
  type        = number
  default     = 60
}

variable "db_multi_az" {
  description = "Enable Multi-AZ deployment for RDS"
  type        = bool
  default     = true
}

variable "db_name" {
  description = "Name of the initial database to create"
  type        = string
  default     = "ucc_intelligence"
}

variable "db_performance_insights_enabled" {
  description = "Enable Performance Insights for RDS"
  type        = bool
  default     = true
}

variable "db_skip_final_snapshot" {
  description = "Skip final snapshot when destroying RDS instance"
  type        = bool
  default     = false
}

variable "environment" {
  description = "Environment name (dev, staging, production)"
  type        = string
  default     = "production"

  validation {
    condition     = contains(["dev", "staging", "production"], var.environment)
    error_message = "Environment must be dev, staging, or production."
  }
}

variable "private_subnet_cidrs" {
  description = "CIDR blocks for private subnets"
  type        = list(string)
  default     = ["10.0.11.0/24", "10.0.12.0/24", "10.0.13.0/24"]
}

variable "project_name" {
  description = "Project name used for resource naming and tagging"
  type        = string
  default     = "ucc-mca-platform"
}

variable "public_subnet_cidrs" {
  description = "CIDR blocks for public subnets"
  type        = list(string)
  default     = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
}

variable "redis_auth_token" {
  description = "Auth token for Redis cluster (use workspace variables for production)"
  type        = string
  sensitive   = true
}

variable "redis_automatic_failover_enabled" {
  description = "Enable automatic failover for Redis"
  type        = bool
  default     = true
}

variable "redis_engine_version" {
  description = "Redis engine version"
  type        = string
  default     = "7.1"
}

variable "redis_maintenance_window" {
  description = "Preferred maintenance window for Redis (UTC)"
  type        = string
  default     = "sun:05:00-sun:06:00"
}

variable "redis_multi_az_enabled" {
  description = "Enable Multi-AZ for Redis cluster"
  type        = bool
  default     = true
}

variable "redis_node_type" {
  description = "Node type for Redis cluster"
  type        = string
  default     = "cache.t3.medium"
}

variable "redis_num_cache_nodes" {
  description = "Number of cache nodes in Redis cluster"
  type        = number
  default     = 2
}

variable "redis_snapshot_retention_limit" {
  description = "Number of days to retain Redis snapshots"
  type        = number
  default     = 5
}

variable "redis_snapshot_window" {
  description = "Preferred snapshot window for Redis (UTC)"
  type        = string
  default     = "02:00-03:00"
}

variable "s3_exports_expiration_days" {
  description = "Number of days before S3 export objects expire"
  type        = number
  default     = 90
}

variable "vpc_cidr" {
  description = "CIDR block for VPC"
  type        = string
  default     = "10.0.0.0/16"
}
