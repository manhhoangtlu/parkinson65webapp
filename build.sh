#!/usr/bin/env bash
# exit on error
set -o errexit

# Cài đặt các thư viện Python
pip install -r requirements.txt

# Tải và cài đặt Git LFS thủ công
# (Cách này không cần quyền admin)
LFS_VERSION="3.5.1"
LFS_TARBALL="git-lfs-linux-amd64-v${LFS_VERSION}.tar.gz"

curl -L "https://github.com/git-lfs/git-lfs/releases/download/v${LFS_VERSION}/${LFS_TARBALL}" -o "${LFS_TARBALL}"
tar -xzf "${LFS_TARBALL}"

# Chạy script cài đặt bên trong thư mục vừa giải nén
./install.sh

# Cấu hình Git LFS
git lfs install

# Tải các tệp lớn từ LFS
git lfs pull