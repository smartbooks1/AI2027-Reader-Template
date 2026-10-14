# 전자책 PDF 뷰어 공통 템플릿

이 저장소는 AI2027 부록 뷰어를 기반으로 만든 **새 책용 빈 템플릿**입니다. AI2027 원본 PDF나 원래 목차는 포함하지 않습니다.

## 새 책을 서비스하는 순서

1. 이 저장소의 **Settings → General → Template repository**를 체크합니다. (저장소 관리 권한 필요, 최초 한 번만.)
2. 템플릿 저장소 상단 **Use this template → Create a new repository**를 누릅니다.
3. 새 저장소 이름(영문 권장)을 입력하고 **Public**으로 생성합니다.
4. 새 저장소의 **Add file → Upload files**에서 새 책 PDF를 올리고 **Commit changes**를 누릅니다. 파일이 크거나 GitHub 제한을 초과할 경우 별도 업로드 방법이 필요합니다.
5. `config/books.json`을 편집합니다. `siteTitle`을 새 책의 제목으로 바꿉니다. 정확한 목차를 만들려면 `autoDiscover`를 `false`로 변경하고 `books`에 실제 PDF 경로, 독자에게 보여 줄 제목, 순서를 지정합니다. 간편하게 자동 등록하려면 `autoDiscover: true`를 유지합니다.
6. 새 저장소에서 **Settings → Pages → Build and deployment → Deploy from a branch**, Branch **main**, 폴더 **/(root)**를 선택하고 저장합니다.
7. 공개 주소 `https://smartbooks1.github.io/새저장소이름/`에서 열람을 테스트합니다. 배포 완료까지 시간이 걸릴 수 있습니다.
8. 실제 공개 주소로 QR코드를 만듭니다. PDF를 바꿔도 저장소 주소가 유지되면 QR코드 링크를 그대로 사용할 수 있습니다.

## 관리하는 파일
- `config/books.json`: 책 제목, 목차, 표시 여부, 기본 보기·다운로드 설정
- `config/설정_간단안내.md`: 설정 예시, 오류별 해결 방법
- `index.html`, `css/style.css`, `js/reader.js`: 독자용 뷰어 프로그램

## 주의할 점
- **공개 GitHub 저장소의 PDF는 누구나 원본에 접근할 수 있습니다.** 다운로드 버튼을 숨기거나 목차에서 제외해도 파일 자체가 비공개가 되지 않습니다.
- 이 템플릿을 사용해 만든 새 저장소는 서로 독립적입니다. 템플릿을 수정해도 이미 만든 책에는 자동으로 반영되지 않습니다.
- 기본 URL은 GitHub Pages의 `사용자명.github.io/저장소명/` 형식입니다. 별도 도메인을 사용하는 경우 자동 인식 설정을 확인해야 합니다.
- 이 템플릿은 책마다 별도의 주소로 접속한다는 가정 아래 책갈피를 저장소별로 구분합니다.

## 관련 사이트
- 실제 운영 중인 책: https://smartbooks1.github.io/AI2027/
- GitHub Pages 공식 문서: https://docs.github.com/pages
