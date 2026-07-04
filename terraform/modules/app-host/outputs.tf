output "instance_id" {
  value = aws_instance.this.id
}

output "public_ip" {
  value = aws_eip.this.public_ip
}

output "public_dns" {
  value = aws_instance.this.public_dns
}

output "ssh_user" {
  value = local.app_ec2_user
}

output "ssh_private_key_pem" {
  value     = var.ssh_public_key == "" ? tls_private_key.generated.private_key_openssh : ""
  sensitive = true
}

output "ssh_public_key" {
  value = local.ssh_public_key
}

output "iam_role_name" {
  value = aws_iam_role.this.name
}
