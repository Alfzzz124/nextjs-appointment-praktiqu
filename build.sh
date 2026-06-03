#!/bin/bash
rm -rf .next
npx tsc --noEmit --skipLibCheck 2>/dev/null || true
npx next build 2>&1 | tail -5
