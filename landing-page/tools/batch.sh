#!/bin/bash
# Tarik semua landing page: render WP -> inline jadi satu file HTML mandiri.
# Sekuensial supaya tidak membebani box produksi.
export PATH=$HOME/nodevenv/staging2.praktiqu.com/20/bin:$PATH
mkdir -p ~/lp-raw ~/lp-out
LOG=~/lp-batch.log
: > "$LOG"
n=0; total=$(grep -c . ~/manifest.txt)
while read -r id name; do
  [ -z "$id" ] && continue
  n=$((n+1))
  printf "[%2d/%d] %-34s id=%-6s " "$n" "$total" "$name" "$id" >> "$LOG"
  if ! php ~/render.php "$id" > ~/lp-raw/"$name".html 2>/dev/null; then
    echo "RENDER GAGAL" >> "$LOG"; continue
  fi
  raw=$(stat -c%s ~/lp-raw/"$name".html)
  if [ "$raw" -lt 20000 ]; then echo "RENDER KOSONG (${raw}B)" >> "$LOG"; continue; fi
  node ~/inline.mjs ~/lp-raw/"$name".html ~/lp-out/"$name".html 2>&1 | grep -E "^${name}" >> "$LOG" || echo "INLINE GAGAL" >> "$LOG"
done < ~/manifest.txt
echo "SELESAI $(date)" >> "$LOG"
