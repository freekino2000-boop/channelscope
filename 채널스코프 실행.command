#!/bin/bash
# 채널스코프 — 더블클릭 실행기
# 서버를 켜고 브라우저를 자동으로 엽니다. (창을 닫으면 서버도 종료됩니다)

cd "$(dirname "$0")" || exit 1

PORT=3456
URL="http://localhost:$PORT"

echo "───────────────────────────────────────"
echo "  채널스코프 실행 중..."
echo "  주소: $URL"
echo "  종료하려면 이 창을 닫거나 Control+C 를 누르세요."
echo "───────────────────────────────────────"

# 이미 서버가 떠 있으면 브라우저만 열기
if curl -s "$URL/api/config" >/dev/null 2>&1; then
  echo "이미 실행 중인 서버에 연결합니다."
  open "$URL"
  exit 0
fi

# node 설치 확인
if ! command -v node >/dev/null 2>&1; then
  echo "⚠️  Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 설치 후 다시 실행하세요."
  read -r -p "엔터를 누르면 닫힙니다..." _
  exit 1
fi

# 3초 뒤 브라우저 자동 열기 (서버 부팅 시간 확보)
( sleep 3; open "$URL" ) &

# 서버 실행 (포그라운드 — 창을 닫으면 함께 종료)
node server.js
