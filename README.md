# judot
Judot-Crawler: 돚하이 클립 수집기 (Backend)
1. 프로젝트 개요
'Judot-Next' 프론트엔드 프로젝트에 데이터를 제공하는 백엔드 시스템입니다. 특정 네이버 카페 게시판('돚하이' 검색 결과)의 영상 게시물을 주기적으로 자동 수집(크롤링)하고, 추출한 데이터를 정제하여 Firestore 데이터베이스에 저장하는 역할을 담당합니다.

2. 최종 시스템 아키텍처 (데이터 파이프라인)
본 백엔드 시스템은 GCP와 Firebase의 서버리스(Serverless) 서비스들을 기반으로 구축되었습니다.

GCP Scheduler: 정해진 시간마다 Pub/Sub 토픽에 메시지를 발행하여 전체 크롤링 프로세스를 트리거합니다.
GCP Pub/Sub: Scheduler로부터 메시지를 받아 지정된 Firebase Function을 호출합니다.
Firebase Functions: 핵심 로직이 실행되는 부분입니다.
Puppeteer와 Chromium을 사용하여 네이버 카페의 동적 페이지에 접속하고 게시글 목록을 수집합니다.
각 게시글 URL에 재접근하여 iframe으로 삽입된 SOOP VOD 정보(영상 URL, 제목, 본문 등)를 추출합니다.
추출된 데이터를 가공하여 Firebase Firestore 데이터베이스에 저장합니다.
3. 핵심 기능
자동화된 스케줄링: GCP Scheduler와 Pub/Sub을 연동하여 별도의 서버 운영 없이 주기적인 크롤링을 자동 수행합니다.
동적 페이지 크롤링: 헤드리스 브라우저인 Puppeteer를 사용하여 JavaScript 렌더링이 완료된 최종 페이지의 데이터를 안정적으로 추출합니다.
데이터 중복 방지: 게시물의 고유 URL을 Firestore 문서 ID로 활용하여, 중복 데이터는 새로 덮어쓰는 방식(Upsert)으로 데이터의 무결성과 일관성을 유지합니다.
4. 기술 스택 (Libraries & Platforms)
Cloud: Firebase (Functions, Firestore), GCP (Scheduler, Pub/Sub)
Libraries: puppeteer-core, @sparticuz/chromium (Functions 환경용), firebase-admin, @google-cloud/pubsub
Runtime: Node.js v20
AI Assistants: Claude, ChatGPT
5. 개발 과정 및 주요 문제 해결 로그
문제 발생	원인	해결 방안
정적 크롤링 실패	네이버 카페는 JS 렌더링이 필요한 동적 페이지이므로, Cheerio가 iframe 내부 콘텐츠를 로드하지 못함.	헤드리스 브라우저 Puppeteer로 전면 전환하여 JS 실행 후의 최종 DOM을 기준으로 데이터를 성공적으로 추출.
Puppeteer 타임아웃	한 번에 50개의 게시글을 처리하려 하자 Firebase Functions의 응답 시간(기본 1분) 초과.	처리 단위를 15개로 축소하여 Functions의 실행 시간 내에 작업을 완료하도록 조정.
Puppeteer 병렬 작업 오류	Promise.all 등을 사용한 병렬 크롤링 시, 마지막 작업만 실행되고 이전 작업들이 누락되는 현상 발생.	동시 작업 수를 1개로 제한하여 순차적으로 안정적인 크롤링이 이루어지도록 로직 수정.
Firebase 버전 충돌	로컬 Node.js v22 환경에서 개발 후 배포 시, Firebase Functions (Node.js v20 지원)와 호환성 에러 발생.	로컬 개발 환경을 Node.js v20으로 다운그레이드하여 버전 일치.
Firestore DB 쓰기 실패	1. DB 권한이 문서 단위로 설정됨. &lt;br> 2. db.settings({ databaseId: "ID" }) 코드 오류.	1. DB 권한을 컬렉션 단위로 수정. &lt;br> 2. 이틀간의 디버깅 끝에 기본 DB를 사용하는 방식으로 재설정하여 근본적으로 문제 해결.

6. 향후 개선 계획 및 과제
필터링 정확도 개선:
문제점: 태그(키워드) 기반 필터링은 본문에 다른 멤버 이름이 포함될 경우 분류 오류 발생.
해결책: 데이터 저장 시 MemNum: 5와 같이 명확한 멤버 식별 데이터를 추가하여 필터링 정확도 향상 (완료).
크롤링 대상 확장:
과제 1: '돚하이' 키워드를 사용하지 않는 게시물을 수집하기 위한 검색 로직 고도화 (검토중).
과제 2: 네이버 동영상만 업로드된 게시물 크롤링.
실패 사유: 브라우저의 CORS 정책 및 blob 데이터의 외부 사이트 접근 불가 정책으로 인해 동영상 원본 데이터 추출에 실패. 이는 현재 기술적 한계로 남아있음.
