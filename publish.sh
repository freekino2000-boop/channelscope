#!/bin/bash
# 30분 주기 로 진행 중인 자동 반영 루프에서 호출.
# 1) 로컬 전체 대시보드(댓글 포함) 재빌드 2) 공개용 정제본(docs/index.html) 재빌드
# 3) 변경이 있으면 GitHub에 커밋·푸시해서 GitHub Pages 라이브 페이지를 갱신
set -e
cd "$(dirname "$0")"

node build-standalone.js
node build-public.js

git add docs/index.html
if git diff --cached --quiet; then
  echo "[publish] 변경 없음 — 커밋 생략"
else
  git commit -m "데이터 자동 갱신 $(date '+%Y-%m-%d %H:%M')"
  git push
  echo "[publish] GitHub Pages에 반영 완료"
fi
