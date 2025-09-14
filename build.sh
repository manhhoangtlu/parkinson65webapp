#!/usr/bin/env bash
# exit on error
set -o errexit

# Cài đặt các thư viện Python
pip install -r requirements.txt

# Tải và cài đặt Git LFS thủ công vào thư mục cục bộ
LFS_VERSION="3.5.1"
LFS_TARBALL="git-lfs-linux-amd64-v${LFS_VERSION}.tar.gz"

curl -L "https://github.com/git-lfs/git-lfs/releases/download/v${LFS_VERSION}/${LFS_TARBALL}" -o "${LFS_TARBALL}"
tar -xzf "${LFS_TARBALL}"

# --- PHẦN SỬA ĐỔI ---
# Chạy script cài đặt với tiền tố là thư mục cục bộ
# Thay vì ./install.sh, chúng ta chỉ cần chạy git-lfs trực tiếp từ đây
export PATH="$PWD/git-lfs-${LFS_VERSION}:$PATH"

# Cấu hình Git LFS
git lfs install

# Tải các tệp lớn từ LFS
git lfs pull