// fetchPostWithPuppeteer.js (에러 수정 버전)
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// 링크 유효성 검사 및 필터링 함수
async function validateAndFilterLinks(links, sourceUrl) {
  if (!links || links.length === 0) return [];
  
  const validLinks = [];
  const seenHrefs = new Set();
  
  for (const link of links) {
    // 중복 제거 (같은 페이지 내에서)
    if (seenHrefs.has(link.href)) {
      continue;
    }
    
    // 자기 자신 링크 제거
    if (link.href === sourceUrl) {
      continue;
    }

    // 네이버 카페 내부 링크 제거 (외부 링크만 수집)
    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname.includes('cafe.naver.com')) {
        continue;
      }
      
      // 기타 불필요한 도메인 필터링
      const excludedDomains = ['javascript:', 'mailto:', 'tel:', '#'];
      if (excludedDomains.some(domain => link.href.startsWith(domain))) {
        continue;
      }
    } catch {
      continue; // URL 파싱 실패시 스킵
    }
    
    seenHrefs.add(link.href);
    validLinks.push(link);
  }
  
  return validLinks;
}

// 브라우저 실행 함수 (에러 처리 강화)
async function launchBrowser() {
  const isLocal = process.env.FUNCTIONS_EMULATOR === 'true' || process.env.NODE_ENV === 'development';
  
  console.log('환경 확인:', { 
    isLocal, 
    NODE_ENV: process.env.NODE_ENV,
    FUNCTIONS_EMULATOR: process.env.FUNCTIONS_EMULATOR 
  });

  let browser;
  
  if (isLocal) {
    console.log('로컬 환경에서 실행');
    try {
      // 로컬에서는 일반 puppeteer 사용
      const puppeteerRegular = require('puppeteer');
      browser = await puppeteerRegular.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } catch (localError) {
      console.warn('로컬 puppeteer 실패, chromium 사용:', localError.message);
      // 로컬에서도 chromium 사용 시도
      browser = await launchChromiumBrowser();
    }
  } else {
      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,      });
  }
  
  return browser;
}

// Chromium 브라우저 실행 함수
async function launchChromiumBrowser() {
  // @sparticuz/chromium 설정 최적화
  const executablePath = await chromium.executablePath();
  
  console.log('Chromium 실행 경로:', executablePath);
  
  // 실행 파일 존재 확인 (선택적)
  const fs = require('fs');
  if (executablePath && fs.existsSync && fs.existsSync(executablePath)) {
    console.log('Chromium 실행 파일 확인됨');
  } else {
    console.warn('Chromium 실행 파일 경로 불확실, 계속 진행');
  }

  // 브라우저 실행 옵션 최적화
  const launchOptions = {
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process', // 메모리 사용량 감소
      '--disable-gpu',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath: executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    timeout: 30000 // 브라우저 시작 타임아웃
  };

  console.log('브라우저 실행 옵션:', JSON.stringify(launchOptions, null, 2));

  try {
    const browser = await puppeteer.launch(launchOptions);
    console.log('브라우저 실행 성공');
    return browser;
  } catch (launchError) {
    console.error('브라우저 실행 실패:', launchError.message);
    console.error('실행 경로:', executablePath);
    
    // 대안 시도: 더 간단한 옵션으로 재시도
    console.log('간단한 옵션으로 재시도...');
    const fallbackOptions = {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--single-process'
      ],
      executablePath: executablePath,
      headless: true,
      timeout: 15000
    };
    
    return await puppeteer.launch(fallbackOptions);
  }
}

// 메인 함수
exports.fetchPostWithPuppeteer = async (message) => {
  console.log('링크 추출 작업 시작');
  
  let browser;
  let parsedData;

  try {
    const { url, index, title } = message.data.message.attributes;
    
    console.log(`작업 시작 - Index: ${index}, title: ${title}, URL: ${url}`);

    const targetUrl = url;
    console.log(`대상 URL: ${targetUrl}`);

    // 브라우저 실행 (에러 처리 강화)
    console.log('브라우저 설정 시작...');
    browser = await launchBrowser();
    console.log('브라우저 실행 완료');
    
    const page = await browser.newPage();
    
    // 타임아웃 설정 감소 (안정성 향상)
    page.setDefaultNavigationTimeout(45000);
    page.setDefaultTimeout(45000);
    
    // 페이지 설정
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
    });

    console.log('페이지 로딩 중...');
    
    // 페이지 로딩 (재시도 로직 추가)
    let response;
    let retryCount = 0;
    const maxRetries = 2;
    
    while (retryCount <= maxRetries) {
      try {
        response = await page.goto(targetUrl, { 
          waitUntil: 'domcontentloaded', // networkidle2 대신 더 빠른 옵션
          timeout: 45000
        });
        
        console.log('페이지 로딩 완료, 상태:', response.status());
        break;
        
      } catch (navError) {
        console.error(`페이지 네비게이션 에러 (시도 ${retryCount + 1}):`, navError.message);
        
        if (retryCount === maxRetries) {
          // 마지막 시도에서 대안 URL 시도
          const urlMatch = targetUrl.match(/\/articles\/(\d+)/);
          if (urlMatch) {
            const articleId = urlMatch[1];
            const alternativeUrl = `https://cafe.naver.com/steamindiegame/${articleId}`;
            console.log('대안 URL 시도:', alternativeUrl);
            
            response = await page.goto(alternativeUrl, { 
              waitUntil: 'domcontentloaded',
              timeout: 45000
            });
          } else {
            throw navError;
          }
        } else {
          retryCount++;
          await new Promise(resolve => setTimeout(resolve, 2000)); // 2초 대기
        }
      }
    }

    // 페이지 로딩 완료 대기
    try {
      await page.waitForSelector('body', { timeout: 10000 });
    } catch (waitError) {
      console.warn('body 셀렉터 대기 실패, 계속 진행:', waitError.message);
    }

    const pageTitle = await page.title();
    console.log('페이지 제목:', pageTitle);

    // ===== 전체 페이지 정보 로깅 =====
    console.log('========== 페이지 전체 정보 로깅 시작 ==========');
    
    try {
      // 기본 페이지 정보
      const pageInfo = await page.evaluate(() => {
        return {
          url: window.location.href,
          title: document.title,
          readyState: document.readyState,
          domain: document.domain,
          referrer: document.referrer,
          lastModified: document.lastModified,
          characterSet: document.characterSet,
          contentType: document.contentType,
          doctype: document.doctype ? document.doctype.name : null,
          bodyExists: !!document.body,
          headExists: !!document.head,
          bodyTagName: document.body ? document.body.tagName : null,
          bodyClasses: document.body ? document.body.className : null,
          bodyId: document.body ? document.body.id : null
        };
      });
      console.log('기본 페이지 정보:', JSON.stringify(pageInfo, null, 2));

      // HTML 구조 정보
      const structureInfo = await page.evaluate(() => {
        const allElements = document.querySelectorAll('*');
        const tagCount = {};
        
        allElements.forEach(el => {
          const tagName = el.tagName.toLowerCase();
          tagCount[tagName] = (tagCount[tagName] || 0) + 1;
        });

        return {
          totalElements: allElements.length,
          tagDistribution: tagCount,
          hasFrames: document.querySelectorAll('iframe, frame').length > 0,
          frameCount: document.querySelectorAll('iframe, frame').length,
          formCount: document.querySelectorAll('form').length,
          inputCount: document.querySelectorAll('input').length,
          linkCount: document.querySelectorAll('a').length,
          imageCount: document.querySelectorAll('img').length,
          scriptCount: document.querySelectorAll('script').length,
          styleCount: document.querySelectorAll('style, link[rel="stylesheet"]').length
        };
      });
      console.log('HTML 구조 정보:', JSON.stringify(structureInfo, null, 2));

      // 네이버 카페 특화 정보
      const naverCafeInfo = await page.evaluate(() => {
        const cafeInfo = {
          isCafePage: window.location.hostname.includes('cafe.naver.com'),
          hasArticleContent: !!document.querySelector('.se-main-container, .article_container, #tbody'),
          hasComments: !!document.querySelector('.comment_area, .reply_area'),
          hasNaverHeader: !!document.querySelector('#header, .gnb_area'),
          articleSelectors: []
        };

        // 일반적인 네이버 카페 셀렉터들 확인
        const commonSelectors = [
          '.se-main-container',
          '.article_container', 
          '#tbody',
          '.ArticleContentBox',
          '.article_viewer',
          '.se-module-text',
          'article',
          '.post_content',
          '.content_area'
        ];

        commonSelectors.forEach(selector => {
          const element = document.querySelector(selector);
          if (element) {
            cafeInfo.articleSelectors.push({
              selector: selector,
              exists: true,
              textLength: element.textContent ? element.textContent.length : 0,
              innerHTML: element.innerHTML ? element.innerHTML.substring(0, 200) + '...' : ''
            });
          }
        });

        return cafeInfo;
      });
      console.log('네이버 카페 특화 정보:', JSON.stringify(naverCafeInfo, null, 2));

      // 링크 미리보기 (추출 전)
      const linkPreview = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href]');
        const linkInfo = {
          totalLinks: links.length,
          externalLinks: 0,
          internalLinks: 0,
          linkSamples: []
        };

        const currentDomain = window.location.hostname;
        
        for (let i = 0; i < Math.min(links.length, 10); i++) {
          const link = links[i];
          const href = link.href;
          const isExternal = !href.includes(currentDomain);
          
          if (isExternal) linkInfo.externalLinks++;
          else linkInfo.internalLinks++;
          
          linkInfo.linkSamples.push({
            href: href,
            text: link.textContent.trim().substring(0, 50),
            isExternal: isExternal,
            hasTarget: !!link.target,
            target: link.target || ''
          });
        }

        return linkInfo;
      });
      console.log('링크 미리보기:', JSON.stringify(linkPreview, null, 2));

      // 페이지 성능 정보
      const performanceInfo = await page.evaluate(() => {
        if (window.performance && window.performance.timing) {
          const timing = window.performance.timing;
          return {
            loadTime: timing.loadEventEnd - timing.navigationStart,
            domReady: timing.domContentLoadedEventEnd - timing.navigationStart,
            firstPaint: window.performance.getEntriesByType ? 
              window.performance.getEntriesByType('paint').find(entry => entry.name === 'first-paint')?.startTime : null
          };
        }
        return { message: 'Performance API not available' };
      });
      console.log('페이지 성능 정보:', JSON.stringify(performanceInfo, null, 2));

      // 에러 정보 (콘솔 에러)
      const consoleErrors = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      
      if (consoleErrors.length > 0) {
        console.log('페이지 콘솔 에러들:', consoleErrors.slice(0, 5)); // 최대 5개만
      }

      // 현재 뷰포트에서 보이는 요소들
      const visibleElements = await page.evaluate(() => {
        const isElementVisible = (el) => {
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0 && 
                 rect.top < window.innerHeight && rect.bottom > 0;
        };

        const visibleLinks = [];
        const links = document.querySelectorAll('a[href]');
        
        for (let i = 0; i < Math.min(links.length, 20); i++) {
          const link = links[i];
          if (isElementVisible(link)) {
            visibleLinks.push({
              href: link.href,
              text: link.textContent.trim().substring(0, 30),
              position: {
                top: link.getBoundingClientRect().top,
                left: link.getBoundingClientRect().left
              }
            });
          }
        }

        return {
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          scrollPosition: { x: window.scrollX, y: window.scrollY },
          visibleLinksCount: visibleLinks.length,
          visibleLinks: visibleLinks.slice(0, 10) // 상위 10개만
        };
      });
      console.log('뷰포트 내 가시 요소:', JSON.stringify(visibleElements, null, 2));

    } catch (debugError) {
      console.error('페이지 정보 로깅 중 에러:', debugError.message);
    }
    
    console.log('========== 페이지 전체 정보 로깅 완료 ==========');

    // 링크 추출 로직
    console.log('링크 추출 중...');
    const rawLinks = await page.evaluate(() => {
      const selectors = [
        'a[href^="http"]',
        '.se-module-text a',
        'article a[href^="http"]'
      ];
      
      const links = [];
      const seenHrefs = new Set();
      
      selectors.forEach(selector => {
        try {
          const elements = document.querySelectorAll(selector);
          
          elements.forEach((element, index) => {
            const href = element.href;
            if (href && !seenHrefs.has(href)) {
              seenHrefs.add(href);
              links.push({
                href: href,
                text: element.textContent?.trim() || ''
              });
            }
          });
        } catch (selectorError) {
          console.error('선택자 에러:', selectorError);
        }
      });
      
      return links;
    });

    console.log(`원본 링크 ${rawLinks.length}개 추출 완료`);

    // 링크 유효성 검사 및 필터링
    const validLinks = await validateAndFilterLinks(rawLinks, targetUrl);
    console.log(`유효한 외부 링크: ${validLinks.length}개`);

    // Firebase에 데이터 저장
    console.log('Firebase에 데이터 저장 중...');
    const docId = Buffer.from(targetUrl).toString('base64').substring(0, 80);
    const linkData = {
      source_url: targetUrl,
      links: validLinks.map(link => ({
        href: link.href,
        text: link.text
      })),
      links_count: validLinks.length,
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
      index: parseInt(index),
      batch_id: title,
      source: 'naver-cafe'
    };

    await db.collection('scraped_links').doc(docId).set(linkData, { merge: true });

    console.log(`작업 완료 - Index: ${index}, 링크 ${validLinks.length}개 저장`);
    
    return { 
      success: true, 
      linksCount: validLinks.length,
      index: parseInt(index),
      title: title
    };

  } catch (error) {
    const index = message?.data?.message?.attributes?.index || 0;
    const url = message?.data?.message?.attributes?.url || 'unknown';
    
    console.error(`링크 추출 실패 (Index: ${index}):`, error.message);
    console.error('에러 스택:', error.stack);

    // 에러 로깅
    try {
      await db.collection('link_extraction_errors').add({
        url: url,
        error_message: error.message,
        error_stack: error.stack?.substring(0, 1000),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        index: parseInt(index),
        batch_id: message?.data?.message?.attributes?.title || 'unknown',
        error_type: error.name || 'UnknownError'
      });
    } catch (logError) {
      console.error('에러 로깅 실패:', logError.message);
    }

    throw error;

  } finally {
    // 리소스 정리
    if (browser) {
      try {
        await browser.close();
        console.log('브라우저 종료');
      } catch (closeError) {
        console.error('브라우저 종료 실패:', closeError.message);
      }
    }
    console.log('링크 추출 작업 종료');
  }
};