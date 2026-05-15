#!/usr/bin/env bash
set -euo pipefail

echo "=================================================="
echo " Docker Installer for Ubuntu 24.04"
echo "=================================================="

if [[ $EUID -ne 0 ]]; then
  echo "[ERROR] Please run as root or sudo."
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

echo
echo "[1/7] Removing old Docker packages..."
apt remove -y \
  docker \
  docker-engine \
  docker.io \
  containerd \
  runc || true

echo
echo "[2/7] Installing required packages..."
apt update

apt install -y \
  ca-certificates \
  curl \
  gnupg \
  lsb-release

echo
echo "[3/7] Creating keyring directory..."
install -m 0755 -d /etc/apt/keyrings

echo
echo "[4/7] Installing Docker GPG key..."
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | gpg --dearmor -o /etc/apt/keyrings/docker.gpg

chmod a+r /etc/apt/keyrings/docker.gpg

echo
echo "[5/7] Adding Docker repository..."
echo \
  "deb [arch=$(dpkg --print-architecture) \
  signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

echo
echo "[6/7] Installing Docker Engine..."
apt update

apt install -y \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

echo
echo "[7/7] Enabling Docker service..."
systemctl enable docker
systemctl restart docker

TARGET_USER="${SUDO_USER:-}"

if [[ -n "${TARGET_USER}" ]]; then
  echo
  echo "[INFO] Adding user '${TARGET_USER}' to docker group..."
  usermod -aG docker "${TARGET_USER}" || true
fi

echo
echo "=================================================="
echo " Docker installation completed"
echo "=================================================="

echo
docker --version
docker compose version

echo
echo "[TEST] Running hello-world container..."
docker run --rm hello-world

echo
echo "=================================================="
echo " Done"
echo "=================================================="

if [[ -n "${TARGET_USER}" ]]; then
  echo
  echo "IMPORTANT:"
  echo "Logout/login or run:"
  echo
  echo "  newgrp docker"
  echo
  echo "to use docker without sudo."
fi
