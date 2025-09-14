#!/usr/bin/env bash
# exit on error
set -o errexit

# Cài đặt các thư viện Python
pip install -r requirements.txt

# Tải và cài đặt Git LFS thủ công
LFS_VERSION="3.5.1"
LFS_TARBALL="git-lfs-linux-amd64-v${LFS_VERSION}.tar.gz"
LFS_DIR="git-lfs-${LFS_VERSION}"

curl -L "https://github.com/git-lfs/git-lfs/releases/download/v${LFS_VERSION}/${LFS_TARBALL}" -o "${LFS_TARBALL}"
tar -xzf "${LFS_TARBALL}"

# --- PHẦN SỬA ĐỔI BẮT ĐẦU TỪ ĐÂY ---

# Di chuyển vào thư mục vừa giải nén
cd "${LFS_DIR}"

# Chạy script cài đặt
./install.sh

# Quay trở lại thư mục gốc của dự án
cd ..

# --- KẾT THÚC PHẦN SỬA ĐỔI ---

# Cấu hình Git LFS
git lfs install

# Tải các tệp lớn từ LFS
git lfs pull