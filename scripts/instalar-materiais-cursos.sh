#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
umask 077
mkdir -p private-courses/geladinhos-gourmet private-courses/logo-no-canva

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 não está instalado." >&2
  exit 1
fi

python3 -m venv .course-tools
. .course-tools/bin/activate
python -m pip install --quiet --upgrade pip gdown

echo "Baixando Geladinhos Gourmet do Google Drive..."
gdown --folder "https://drive.google.com/drive/folders/1EpZWGzdcBetrIGqlh2puZ0cfap-x16Gr" --output private-courses/geladinhos-gourmet --remaining-ok

echo "Baixando Criação de Logo no Canva do Google Drive..."
gdown --folder "https://drive.google.com/drive/folders/1HcV_6Inztcw7d0OHiHfa8gyuZ7Neyz2F" --output private-courses/logo-no-canva --remaining-ok

find private-courses -type d -exec chmod 700 {} \;
find private-courses -type f -exec chmod 600 {} \;
echo "Materiais instalados em área privada."
