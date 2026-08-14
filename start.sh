#!/bin/bash
cd "$(dirname "$0")"
echo "Serving at http://localhost:8080"
open http://localhost:8080
python3 -m http.server 8080
