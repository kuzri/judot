const functions = require('firebase-functions');
const { getPostUrlsWithPuppeteer } = require('./getPostUrlsWithPuppeteer');
const { fetchPostWithPuppeteer } = require('./fetchPostWithPuppeteer');

// 1. 스케줄러 함수 - 주기적으로 스크래핑 시작
exports.scheduledScraping = functions
  .region('asia-northeast3')
  .pubsub.schedule('every 24 hours') // 매일 실행 (또는 '0 9 * * *' 형태로 특정 시간 설정)
  .timeZone('Asia/Seoul') // 한국 시간대
  .onRun(async (context) => {
    console.log('스케줄된 스크래핑 시작');
    
    try {
      // HTTP 함수 호출을 위한 URL
      const functionUrl = 'https://asia-northeast3-dothighju.cloudfunctions.net/getPostUrlsWithPuppeteer';
      
      // 내부 HTTP 요청으로 Puppeteer 함수 호출
      const axios = require('axios');
      const response = await axios.get(functionUrl, {
        timeout: 540000 // 9분 타임아웃
      });
      
      console.log('Puppeteer 함수 호출 완료:', response.data);
      return { success: true, message: response.data };
    } catch (error) {
      console.error('스케줄된 스크래핑 실패:', error);
      throw new Error(`스케줄 실행 실패: ${error.message}`);
    }
  });

// 2. Puppeteer로 URL 목록 가져오기 (HTTP 트리거)
exports.getPostUrlsWithPuppeteer = functions
  .region('asia-northeast3')
  .runWith({
    timeoutSeconds: 540, // 9분
    memory: '2GB'
  })
  .https.onRequest(getPostUrlsWithPuppeteer);

// 3. PubSub으로 개별 게시물 상세 수집
exports.fetchPostWithPuppeteer = functions
  .region('asia-northeast3')
  .runWith({
    timeoutSeconds: 540, // 9분
    memory: '2GB'
  })
  .pubsub.topic('fetch-post-details')
  .onPublish(fetchPostWithPuppeteer);