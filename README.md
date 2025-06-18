# judot
목적 : 돚하이의 자동 업데이트 및 보기 편하게 정리 ( 주간별 페이징 )
기능 : puppeteer로 특정 url 정보를 획득 -> 해당 url에 다시 접근하여 url 안에 있는 vod정보를 긁어모으는 기능 (현재 1일 1회로 제한)

functions(schduler) -> functions(pub/sub) -> functions(DB 저장)
