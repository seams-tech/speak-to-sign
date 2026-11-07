#!/bin/sh
# Builds the linux/amd64 image locally (no push) and prints its size and id.
set -eu
cd "$(dirname "$0")"
MODEL_DIR=${MODEL_DIR:-../../seams-wallet/packages/voiceid/assets}
TAG=${TAG:-seams-speaker-service:local}

docker build --platform linux/amd64 --build-context "model=$MODEL_DIR" -t "$TAG" .
docker image inspect "$TAG" --format 'image {{.Id}} size {{.Size}} bytes'
