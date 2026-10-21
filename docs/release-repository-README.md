# How much is tokens — Releases

이 저장소는 **How much is tokens의 공개 배포 전용 저장소**입니다.

개발 소스, 내부 테스트 코드, `.leerness` 개발 상태, 개발용 workflow는 이 저장소에 미러링하지 않습니다. 공개 배포에는 빌드된 Windows portable 실행 파일, macOS Apple Silicon 앱, 검증용 체크섬, 릴리스 노트만 포함됩니다.

## 다운로드

GitHub Releases에서 최신 버전을 받으세요.

각 릴리스의 주요 자산:

- `How-much-is-tokens-<version>-portable.exe` — Windows x64 포터블
- `How-much-is-tokens-<version>-mac-arm64.dmg` — macOS Apple Silicon 설치 이미지
- `How-much-is-tokens-<version>-mac-arm64.zip` — macOS Apple Silicon `.app` 압축 파일
- `SHA256SUMS.txt`

macOS 앱은 Apple Silicon(M1 이상)용입니다. Apple 공증이 없으면 처음 실행할 때 **우클릭 → 열기**를 사용하세요.

## 무결성 확인

PowerShell에서 다음처럼 SHA-256을 확인할 수 있습니다.

```powershell
Get-FileHash .\How-much-is-tokens-<version>-portable.exe -Algorithm SHA256
```

macOS에서는:

```bash
shasum -a 256 How-much-is-tokens-<version>-mac-arm64.dmg
shasum -a 256 How-much-is-tokens-<version>-mac-arm64.zip
```

결과를 같은 릴리스의 `SHA256SUMS.txt`와 비교하세요.

## 저장소 역할

- 이 저장소: 공개 바이너리 배포, 릴리스 노트, 사용자 이슈
- 개발 저장소: 비공개 소스 개발 및 CI

개발 저장소의 소스 코드는 이 공개 배포 저장소의 릴리스 산출물에 포함하지 않습니다.
