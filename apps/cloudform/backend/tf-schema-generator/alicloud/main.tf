terraform {
  required_version = ">= 1.5"
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "1.230.0"
    }
  }
}

provider "alicloud" {
  # Credentials not needed for schema dump; provided via env if init requires it.
}
