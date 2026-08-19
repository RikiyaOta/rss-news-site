terraform {
  backend "s3" {
    bucket                      = "rss-news-site-tfstate"
    key                         = "rss-news-site/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}
