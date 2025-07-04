# judot
아래는 제공하신 내용을 `README.md` 형식으로 마크다운 스타일을 적용한 예시입니다. 제목, 섹션, 코드, 표 등을 활용하여 가독성을 높였습니다:

---

# **Judot-Crawler: 돚하이 클립 수집기 (Backend)**

## 📌 **1. 프로젝트 개요**

`Judot-Next` 프론트엔드 프로젝트에 데이터를 제공하는 백엔드 시스템입니다.
특정 **네이버 카페 게시판(‘돚하이’ 검색 결과)** 의 영상 게시물을 주기적으로 **자동 수집(크롤링)** 하고, 추출한 데이터를 정제하여 **Firebase Firestore** 데이터베이스에 저장합니다.

---

## 🏗 **2. 최종 시스템 아키텍처 (데이터 파이프라인)**

본 백엔드 시스템은 **GCP와 Firebase의 서버리스(Serverless)** 서비스들을 기반으로 구축되었습니다.

```
GCP Scheduler → GCP Pub/Sub → Firebase Functions → Firestore
```

* **GCP Scheduler**
  : 정해진 시간마다 Pub/Sub 토픽에 메시지를 발행하여 전체 크롤링 프로세스를 트리거

* **GCP Pub/Sub**
  : Scheduler로부터 메시지를 받아 지정된 Firebase Function 호출

* **Firebase Functions**
  : 핵심 로직 실행

  * Puppeteer와 Chromium으로 동적 페이지 접속
  * 게시글 목록 및 SOOP VOD 정보 추출
  * 추출한 데이터를 Firestore에 저장

---

## ⚙️ **3. 핵심 기능**

* ✅ **자동화된 스케줄링**
  → GCP Scheduler + Pub/Sub으로 서버 없이 주기적인 크롤링 수행

* 🧠 **동적 페이지 크롤링**
  → Puppeteer로 JS 렌더링이 완료된 DOM에서 안정적으로 데이터 추출

* 🔁 **데이터 중복 방지**
  → 게시물의 고유 URL을 Firestore 문서 ID로 사용하여 **Upsert 방식 저장**

---

## 🧪 **4. 기술 스택**

| 구분            | 내용                                                                                |
| ------------- | --------------------------------------------------------------------------------- |
| **Cloud**     | Firebase (Functions, Firestore), GCP (Scheduler, Pub/Sub)                         |
| **Libraries** | `puppeteer-core`, `@sparticuz/chromium`, `firebase-admin`, `@google-cloud/pubsub` |
| **Runtime**   | Node.js v20                                                                       |
| **AI**        | Claude, ChatGPT                                                                   |

---

## 🧱 **5. 개발 과정 및 주요 문제 해결 로그**

| 문제 발생               | 원인                                                          | 해결 방안                                       |
| ------------------- | ----------------------------------------------------------- | ------------------------------------------- |
| **정적 크롤링 실패**       | 네이버 카페는 JS 렌더링이 필요한 동적 페이지 → Cheerio가 iframe 내부 콘텐츠 불러오기 실패 | → Puppeteer로 전면 전환하여 JS 실행 후 최종 DOM 기준으로 추출 |
| **Puppeteer 타임아웃**  | 게시글 50개를 동시에 처리 → Firebase Functions 실행 시간(1분) 초과           | → 처리 단위를 15개로 축소                            |
| **병렬 작업 누락**        | `Promise.all` 병렬 처리 시 일부 크롤링 실패                             | → 동시 작업 수를 1개로 제한하여 순차 처리                   |
| **Firebase 버전 충돌**  | 로컬(Node.js v22) ↔ Functions(Node.js v20) 호환 오류              | → 로컬 개발 환경을 Node.js v20으로 다운그레이드            |
| **Firestore 쓰기 실패** | 1. 문서 단위 권한 설정<br>2. `db.settings({ databaseId: "ID" })` 오류 | → 권한을 컬렉션 단위로 조정<br>→ 기본 DB 설정으로 변경         |

---

## 🔧 **6. 향후 개선 계획 및 과제**

### ✅ **필터링 정확도 개선 (완료)**

* 문제: 키워드 기반 필터링 시, 본문에 다른 멤버 이름 포함 시 분류 오류
* 해결: 데이터 저장 시 `MemNum: 5` 와 같은 명확한 식별자 추가

### 🔍 **크롤링 대상 확장 (진행 중)**

* **과제 1**: `'돚하이'` 키워드를 사용하지 않는 게시물 크롤링 → 검색 로직 고도화 필요
* **과제 2**: **네이버 동영상 업로드 게시물**의 크롤링

  * **실패 사유**:

    * 브라우저의 **CORS 정책**
    * `blob:` URL은 외부 사이트 접근 불가 → 현재 기술적 한계로 남아있음

---

