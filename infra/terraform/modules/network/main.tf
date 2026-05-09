resource "aws_vpc" "this" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags = {
    Name = "${var.project}-vpc"
  }
}

output "vpc_id" {
  value = aws_vpc.this.id
}
