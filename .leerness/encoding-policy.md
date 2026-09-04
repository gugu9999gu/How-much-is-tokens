---
leernessRole: encoding-policy
readWhen:
  - 파일 생성 전
  - 한글 깨짐 보고
  - 배포 전
updateWhen:
  - 인코딩 정책 변경
doNotStore:
  - 실제 토큰
  - 비밀번호
  - 운영 쿠키
  - 민감한 개인정보 원문
---
<!-- leerness:managed -->
# Encoding Policy

## Rules
- 모든 텍스트 파일은 **BOM 없는 UTF-8**.
- Windows .bat 최상단에 `chcp 65001 >nul`.
- PowerShell .ps1 시작에 `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8`.
- Python 파일은 첫 줄에 `# -*- coding: utf-8 -*-` (Python 2 호환 필요 시).
- LF 라인 엔딩 권장 (Windows에서도 .gitattributes로 통일).

## Auto check
`leerness encoding check`는 BOM, NUL, .bat의 chcp 65001, 한글 라운드트립을 검사합니다.
