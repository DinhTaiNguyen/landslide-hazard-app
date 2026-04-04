#!/usr/bin/env bash
set -euo pipefail
sudo apt-get update
sudo apt-get install -y build-essential cmake git
mkdir -p "$HOME/geotop"
cd "$HOME/geotop"
if [ ! -d geotop ]; then
  git clone https://github.com/geotopmodel/geotop.git
fi
cd geotop
git checkout v3.0
git pull origin v3.0
mkdir -p cmake-build
cd cmake-build
cmake ..
cmake --build . -j"$(nproc)"
echo "GeoTOP built at: $PWD/geotop"
