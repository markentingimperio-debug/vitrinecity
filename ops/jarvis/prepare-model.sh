#!/usr/bin/env bash
# Downloads a pinned, public, open-weight model. No credential or paid inference API.
set -Eeuo pipefail
model_dir=/opt/vitrinecity-jarvis-model
model_file="$model_dir/Qwen3-1.7B-Q8_0.gguf"
expected=061b54daade076b5d3362dac252678d17da8c68f07560be70818cace6590cb1a
install -d -m 755 "$model_dir"
exec 8>"$model_dir/.download.lock"
flock -n 8 || exit 75
if test ! -f "$model_file"; then
  test ! -e "$model_file.part" || { echo 'Partial download exists; inspect before retrying.' >&2; exit 1; }
  curl --fail --location --proto '=https' --proto-redir '=https' --tlsv1.2 --max-time 900 --output "$model_file.part" \
    https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/90862c4b9d2787eaed51d12237eafdfe7c5f6077/Qwen3-1.7B-Q8_0.gguf
  printf '%s  %s\n' "$expected" "$model_file.part" | sha256sum -c -
  mv -n "$model_file.part" "$model_file"
fi
printf '%s  %s\n' "$expected" "$model_file" | sha256sum -c -
chmod 644 "$model_file"
docker pull ghcr.io/ggml-org/llama.cpp@sha256:c363a67c08cb74cc9099590d88cd9948ee0c464cca03db40f9cb5c19d5376da9
