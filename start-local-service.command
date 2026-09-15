#!/bin/zsh
cd "/Users/liujianing/Desktop/project worker/output/书论工作区/tasks/2026-06-03-calligraphy-table-focus/calligraphy-online-site" || exit 1
echo "Starting calligraphy workspace at http://127.0.0.1:8765/index.html"
python3 server.py --host 127.0.0.1 --port 8765
