#!/usr/bin/env bash
# exit on error
set -o errexit

# Cài đặt các thư viện Python
pip install -r requirements.txt

# Cài đặt Git LFS
curl -s https://packagecloud.io/install/repositories/github/git-lfs/script.deb.sh | bash
apt-get install -y git-lfs
git lfs install

# Tải các tệp lớn từ LFS
git lfs pull