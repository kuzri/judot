// getPostUrlsWithPuppeteer.js (개선된 버전)
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const { PubSub } = require('@google-cloud/pubsub');

const CAFE_URL = 'https://cafe.naver.com/f-e/cafes/27842958';
const BOARD_PATH = '/menus/331?viewType=L&ta=ARTICLE_COMMENT&q=%EB%8F%9A%ED%95%98%EC%9D%B4&page=1';

exports.getPostUrlsWithPuppeteer = async (req, res) => {
  console.log('Puppeteer 스크래핑 시작');
  let browser;
  let articles = [];
  
  try {
    // Firebase Functions용 Chromium 설정
    console.log('Chromium 설정 로딩 중...');
    const isLocal = process.env.FUNCTIONS_EMULATOR === 'true';
    console.log('로컬 환경:', isLocal);
{
  console.log('Cloud Functions Puppeteer 실행 중...');
  const execPath = await chromium.executablePath();
  console.log('Chromium 실행 경로:', execPath);
  browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: execPath,
    headless: chromium.headless,
  });
}
    console.log('브라우저 인스턴스 생성 완료');
    const page = await browser.newPage();
    
    // 타임아웃 설정 증가
    page.setDefaultNavigationTimeout(60000); // 60초
    page.setDefaultTimeout(60000); // 60초
    
    // 페이지 설정
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 추가 헤더 설정
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
    });
    
    console.log('네이버 카페 페이지 로딩 중...');
    const targetUrl = `${CAFE_URL}${BOARD_PATH}`;
    console.log('Target URL:', targetUrl);
    
    // 페이지 로딩 시도
    try {
      const response = await page.goto(targetUrl, { 
        waitUntil: 'networkidle0',
        timeout: 60000
      });
      
      console.log('페이지 로딩 완료, 상태:', response.status());
      
      // 페이지 내용 확인
      const title = await page.title();
      console.log('페이지 제목:', title);

        articles = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('.board-list .inner_list a.article'))
            .map(a => ({
              href: a.href,
              text: a.innerText.trim(),
            }));
        });

        console.log(articles);
      
    } catch (navError) {
      console.error('페이지 네비게이션 에러:', navError.message);
    }
    
    // PubSub으로 각 URL 전송
    const pubsub = new PubSub();
    const topic = pubsub.topic('fetch-post-details');
    
    console.log('PubSub으로 URL 전송 중...');
    const results = await Promise.allSettled(
      articles.map((url, index) => {
        const articleId = 'https://cafe.naver.com/steamindiegame/' + url.href.split('/articles/')[1].split('?')[0]
        console.log(`URL: ${articleId}`);
        return topic.publishMessage({ 
          attributes: {
            'url': articleId,
            'index': (index + 1).toString(),
            'timestamp':new Date().toISOString(),
          }
        });
      })
    );
    
    const successCount = results.filter(r => r.status === 'fulfilled').length;
    const failedCount = results.filter(r => r.status === 'rejected').length;
    
    const responseMessage = `스크래핑 완료: ${successCount}개 성공, ${failedCount}개 실패 (총 ${articles.length}개)`;
    console.log(responseMessage);
    
    res.status(200).json({
      success: true,
      message: responseMessage,
      details: {
        total: articles.length,
        success: successCount,
        failed: failedCount,
        sampleUrls: articles.slice(0, 3) // 처음 3개 URL만 응답에 포함
      }
    });
    
  } catch (err) {
    console.error('Puppeteer 스크래핑 에러:', err);
    res.status(500).json({
      success: false,
      error: 'Puppeteer 스크래핑 실패',
      message: err.message,
      stack: err.stack?.substring(0, 500)
    });
  } finally {
    if (browser) {
      await browser.close();
      console.log('브라우저 종료');
    }
  }
};