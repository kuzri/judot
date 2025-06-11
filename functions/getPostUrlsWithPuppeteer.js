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
    const isLocal = process.env.FUNCTIONS_EMULATOR === 'true';
    
    if (isLocal) {
      const puppeteerRegular = require('puppeteer');
      browser = await puppeteerRegular.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } else {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      });
    }
    
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
        waitUntil: 'networkidle2',
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
      
      // 대안 URL 시도
      const alternativeUrl = `https://cafe.naver.com/f-e/cafes/27842958/menus/331`;
      console.log('대안 URL 시도:', alternativeUrl);
      
      await page.goto(alternativeUrl, { 
        waitUntil: 'networkidle0',
        timeout: 60000
      });
    }
    
    // // 여러 방법으로 iframe 찾기 시도
    // let frame = null;
    // const iframeSelectors = [
    //   'iframe#cafe_main',
    //   'iframe[name="cafe_main"]',
    //   'iframe[src*="cafe.naver.com"]',
    //   'iframe'
    // ];
    
    // for (const selector of iframeSelectors) {
    //   try {
    //     console.log(`iframe 선택자 시도: ${selector}`);
        
    //     await page.waitForSelector(selector, { timeout: 30000 });
    //     const iframe = await page.$(selector);
        
    //     if (iframe) {
    //       frame = await iframe.contentFrame();
    //       if (frame) {
    //         console.log(`iframe 접근 성공: ${selector}`);
    //         break;
    //       }
    //     }
    //   } catch (selectorError) {
    //     console.log(`iframe 선택자 실패: ${selector}`, selectorError.message);
    //   }
    // }
    
    // // iframe을 찾지 못한 경우 직접 페이지에서 시도
    // if (!frame) {
    //   console.log('iframe을 찾을 수 없음, 메인 페이지에서 직접 시도');
    //   frame = page;
      
    //   // 페이지가 완전히 로드될 때까지 기다리기
    //   await page.waitForLoadState('networkidle');
    // }
    
    // 게시물 링크 추출 시도
    // console.log('게시물 URL 추출 중...');
    
    // const linkSelectors = [
    //   'a.article',
    //   // 'a[href*="/articles/"]',
    //   // 'a[href*="articleid"]',
    //   // '.board-list a',
    //   // '.article-board a',
    //   // 'td.gall_tit a',
    //   // '.list_tit a'
    // ];
    
    // let postUrls = [];
    
    // for (const selector of linkSelectors) {
    //   try {
    //     console.log(`링크 선택자 시도: ${selector}`);
        
    //     // 요소가 나타날 때까지 대기
    //     await frame.waitForSelector(selector, { timeout: 10000 });
        
    //     postUrls = await frame.evaluate((sel) => {
    //       const links = Array.from(document.querySelectorAll(sel));
    //       console.log(`찾은 링크 수: ${links.length}`);
          
    //       return links.map(link => {
    //         const href = link.getAttribute('href') || link.href;
    //         if (!href) return null;
            
    //         // 절대 URL로 변환
    //         if (href.startsWith('http')) {
    //           return href;
    //         } else if (href.startsWith('/')) {
    //           return `https://cafe.naver.com${href}`;
    //         } else {
    //           return `https://cafe.naver.com/f-e/cafes/27842958/${href}`;
    //         }
    //       }).filter(url => url && url.includes('cafe.naver.com'));
    //     }, selector);
        
    //     if (postUrls.length > 0) {
    //       console.log(`링크 추출 성공: ${selector}, 총 ${postUrls.length}개`);
    //       break;
    //     }
    //   } catch (linkError) {
    //     console.log(`링크 선택자 실패: ${selector}`, linkError.message);
    //   }
    // }
    
    // // 게시물을 찾지 못한 경우 페이지 스크린샷 및 HTML 로깅
    // if (postUrls.length === 0) {
    //   console.log('게시물을 찾을 수 없음, 디버깅 정보 수집 중...');
      
    //   try {
    //     // 현재 페이지의 HTML 일부 로깅
    //     const bodyHTML = await frame.evaluate(() => {
    //       return document.body ? document.body.innerHTML.substring(0, 1000) : 'No body found';
    //     });
    //     console.log('페이지 HTML 일부:', bodyHTML);
        
    //     // 모든 링크 요소 확인
    //     const allLinks = await frame.evaluate(() => {
    //       const links = Array.from(document.querySelectorAll('a'));
    //       return links.slice(0, 10).map(link => ({
    //         href: link.href || link.getAttribute('href'),
    //         text: link.textContent?.trim().substring(0, 50),
    //         className: link.className
    //       }));
    //     });
    //     console.log('페이지의 모든 링크 (처음 10개):', JSON.stringify(allLinks, null, 2));
        
    //   } catch (debugError) {
    //     console.error('디버깅 정보 수집 실패:', debugError);
    //   }
      
    //   return res.status(200).json({
    //     success: false,
    //     message: '게시물을 찾을 수 없습니다. 페이지 구조가 변경되었거나 로그인이 필요할 수 있습니다.',
    //     debug: {
    //       url: targetUrl,
    //       pageTitle: await page.title()
    //     }
    //   });
    // }
    
    // console.log(`총 ${postUrls.length}개의 게시물 URL 발견`);
    
    // // 중복 제거
    // postUrls = [...new Set(postUrls)];
    // console.log(`중복 제거 후: ${postUrls.length}개`);
    
    // PubSub으로 각 URL 전송
    const pubsub = new PubSub();
    const topic = pubsub.topic('fetch-post-details');
    
    console.log('PubSub으로 URL 전송 중...');
    const results = await Promise.allSettled(
      articles.map((url, index) => {
        const messageData = {
          url: url.href,
          title: url.text,
          index: index + 1,
          timestamp: new Date().toISOString()
        };
        
        return topic.publishMessage({ 
          attributes: {
            'url': url.href,
            'title': url.text,
            'index': (index + 1).toString(),
            'timestamp': messageData.timestamp,
            'source': 'naver-cafe-scraping'
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