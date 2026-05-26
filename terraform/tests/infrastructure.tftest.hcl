# Terraform Tests for UCC-MCA Infrastructure
# Run with: terraform test

# Test: Validate VPC CIDR Configuration
run "validate_vpc_cidr" {
  command = plan

  variables {
    vpc_cidr                  = "10.0.0.0/16"
    public_subnet_cidrs       = ["10.0.1.0/24", "10.0.2.0/24"]
    private_subnet_cidrs      = ["10.0.11.0/24", "10.0.12.0/24"]
    database_subnet_cidrs     = ["10.0.21.0/24", "10.0.22.0/24"]
    availability_zones_count  = 2
    redis_auth_token          = "TestRedisToken456789!"
  }

  assert {
    condition     = module.vpc.vpc_attributes.cidr_block == "10.0.0.0/16"
    error_message = "VPC CIDR block does not match expected value"
  }
}

# Test: Validate RDS Configuration
run "validate_rds_config" {
  command = plan

  variables {
    environment               = "production"
    db_instance_class        = "db.t3.large"
    db_multi_az              = true
    db_deletion_protection   = true
    redis_auth_token         = "SecureRedisToken456789!"
  }

  assert {
    condition     = aws_db_instance.postgresql.instance_class == "db.t3.large"
    error_message = "RDS instance class does not match expected value"
  }

  assert {
    condition     = aws_db_instance.postgresql.multi_az == true
    error_message = "RDS Multi-AZ should be enabled for production"
  }

  assert {
    condition     = aws_db_instance.postgresql.storage_encrypted == true
    error_message = "RDS storage should be encrypted"
  }

  assert {
    condition     = aws_db_instance.postgresql.deletion_protection == true
    error_message = "RDS deletion protection should be enabled for production"
  }
}

# Test: Validate Redis Configuration
run "validate_redis_config" {
  command = plan

  variables {
    redis_node_type               = "cache.t3.medium"
    redis_num_cache_nodes         = 2
    redis_multi_az_enabled        = true
    redis_automatic_failover_enabled = true
    redis_auth_token              = "SecureRedisToken456789!"
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.node_type == "cache.t3.medium"
    error_message = "Redis node type does not match expected value"
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.at_rest_encryption_enabled == true
    error_message = "Redis at-rest encryption should be enabled"
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.transit_encryption_enabled == true
    error_message = "Redis transit encryption should be enabled"
  }

  assert {
    condition     = aws_elasticache_replication_group.redis.multi_az_enabled == true
    error_message = "Redis Multi-AZ should be enabled"
  }
}

# Test: Validate Security Groups
run "validate_security_groups" {
  command = plan

  variables {
    redis_auth_token   = "SecureRedisToken456789!"
  }

  assert {
    condition     = length(module.rds_security_group.security_group_id) > 0
    error_message = "RDS security group should be created"
  }

  assert {
    condition     = length(module.redis_security_group.security_group_id) > 0
    error_message = "Redis security group should be created"
  }

  assert {
    condition     = length(module.app_security_group.security_group_id) > 0
    error_message = "Application security group should be created"
  }
}

# Test: Validate S3 Buckets
run "validate_s3_buckets" {
  command = plan

  variables {
    redis_auth_token   = "SecureRedisToken456789!"
  }

  assert {
    condition     = length(module.data_exports_bucket.s3_bucket_id) > 0
    error_message = "Data exports S3 bucket should be created"
  }

  assert {
    condition     = length(module.backups_bucket.s3_bucket_id) > 0
    error_message = "Backups S3 bucket should be created"
  }
}

# Test: Validate Development Environment Configuration
run "validate_dev_environment" {
  command = plan

  variables {
    environment              = "dev"
    db_instance_class       = "db.t3.medium"
    db_multi_az             = false
    db_deletion_protection  = false
    redis_node_type         = "cache.t3.micro"
    redis_num_cache_nodes   = 1
    redis_auth_token        = "DevRedisToken456789!"
  }

  assert {
    condition     = aws_db_instance.postgresql.instance_class == "db.t3.medium"
    error_message = "Dev environment should use smaller instance class"
  }

  assert {
    condition     = aws_db_instance.postgresql.multi_az == false
    error_message = "Dev environment should not use Multi-AZ"
  }
}

# Test: Validate CloudWatch Alarms
run "validate_cloudwatch_alarms" {
  command = plan

  variables {
    redis_auth_token   = "SecureRedisToken456789!"
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.rds_cpu.alarm_name) > 0
    error_message = "RDS CPU alarm should be created"
  }

  assert {
    condition     = length(aws_cloudwatch_metric_alarm.redis_cpu.alarm_name) > 0
    error_message = "Redis CPU alarm should be created"
  }
}

# Test: Validate Tags
run "validate_tags" {
  command = plan

  variables {
    project_name       = "test-project"
    environment        = "production"
    redis_auth_token   = "SecureRedisToken456789!"
  }

  assert {
    condition = alltrue([
      for tag_key in ["Project", "Environment", "ManagedBy"] :
      contains(keys(aws_db_instance.postgresql.tags_all), tag_key)
    ])
    error_message = "RDS instance should have all required tags"
  }
}
