// fetchPostWithPuppeteer.js (Playwright 사용)
const { chromium } = require('playwright-chromium');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// 설정값들
const CONFIG = {
  TIMEOUT: 15000,
  MAX_RETRIES: 2,
  RATE_LIMIT_DELAY: 500,
  MAX_CONCURRENT_REQUESTS: 5
};

// 현재 실행 중인 요청 수 추적
let currentRequests = 0;

// 재시도 로직을 위한 헬퍼 함수
async function retryWithDelay(fn, maxRetries = CONFIG.MAX_RETRIES, delay = CONFIG.RATE_LIMIT_DELAY) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.log(`시도 ${i + 1}/${maxRetries} 실패:`, error.message);
      if (i === maxRetries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
    }
  }
}

// URL 유효성 검사
function validateUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.protocol === 'http:' || urlObj.protocol === 'https:';
  } catch {
    return false;
  }
}

// 중복 체크 함수
async function checkDuplicatePost(url) {
  try {
    const docId = Buffer.from(url).toString('base64').substring(0, 100);
    const doc = await db.collection('scraped_links').doc(docId).get();
    return doc.exists;
  } catch (error) {
    console.error('중복 체크 실패:', error);
    return false;
  }
}

// 링크 중복 체크 및 유효성 검사 함수
async function validateAndFilterLinks(links, sourceUrl) {
  if (!links || links.length === 0) return [];
  
  const validLinks = [];
  const seenHrefs = new Set();
  
  for (const link of links) {
    // 기본 유효성 검사
    if (!link.href || !validateUrl(link.href)) {
      continue;
    }
    
    // 중복 제거 (같은 페이지 내에서)
    if (seenHrefs.has(link.href)) {
      continue;
    }
    
    // 자기 자신 링크 제거
    if (link.href === sourceUrl) {
      continue;
    }
    
    seenHrefs.add(link.href);
    validLinks.push(link);
  }
  
  return validLinks;
}

exports.fetchPostWithPuppeteer = async (message) => {
  // 동시 요청 수 제한
  if (currentRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
    throw new Error('동시 요청 수 제한 초과');
  }

  currentRequests++;
  console.log(`링크 추출 시작 (현재 요청: ${currentRequests})`);

  let browser;
  let page;
  let resUrl;
  let index = 0;

  try {
    // 메시지 속성 검증
    if (!message || !message.attributes) {
      throw new Error('잘못된 메시지 형식');
    }

    const { url, index: msgIndex } = message.attributes;
    index = msgIndex || 0;

    if (!url) {
      throw new Error('URL이 제공되지 않음');
    }

    // URL 처리 및 검증
    if (!validateUrl(url)) {
      throw new Error('유효하지 않은 URL');
    }

    const urlId = new URL(url);
    const pathname = urlId.pathname;
    const parts = pathname.split('/');
    let articleId = parts.includes('articles') ? parts[parts.indexOf('articles') + 1] : null;
    
    if (!articleId) {
      throw new Error('게시물 ID를 찾을 수 없음');
    }

    resUrl = `https://cafe.naver.com/steamindiegame/${articleId}`;

    // 중복 체크
    const isDuplicate = await checkDuplicatePost(resUrl);
    if (isDuplicate) {
      console.log(`중복 게시물 스킵 (${index}): ${resUrl}`);
      return { success: true, skipped: true, reason: 'duplicate' };
    }

    console.log(`링크 추출 중 (${index}): ${resUrl}`);

    // Playwright 실행 - 링크만 추출
    const extractedLinks = await retryWithDelay(async () => {
      browser = await chromium.launch({
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--no-first-run',
          '--no-zygote',
          '--single-process',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor',
          '--disable-extensions',
          '--disable-plugins',
          '--disable-images',
          '--disable-default-apps',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--memory-pressure-off'
        ]
      });

      const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });

      page = await context.newPage();

      // 리소스 차단 (HTML만 로드)
      await page.route('**/*', (route) => {
        const resourceType = route.request().resourceType();
        if (resourceType === 'document') {
          route.continue();
        } else {
          route.abort();
        }
      });

      // 페이지 로드
      await page.goto(resUrl, {
        waitUntil: 'domcontentloaded',
        timeout: CONFIG.TIMEOUT
      });

      // 링크 추출
      const rawLinks = await page.evaluate(() => {
        const linkElements = document.querySelectorAll('a.se-link.__se_link');
        const links = [];
        
        linkElements.forEach((element, index) => {
          const href = element.href;
          if (href) {
            links.push({
              href: href,
              index: index
            });
          }
        });
        
        return links;
      });

      return rawLinks;
    });

    // 링크 유효성 검사 및 필터링
    const validLinks = await validateAndFilterLinks(extractedLinks, resUrl);
    console.log(`총 링크: ${extractedLinks.length}, 유효한 링크: ${validLinks.length}`);

    // 링크가 없으면 저장하지 않음
    if (validLinks.length === 0) {
      console.log(`링크 없음 - 저장 스킵 (${index})`);
      return { success: true, skipped: true, reason: 'no_links' };
    }

    // Firebase에 링크만 저장
    const docId = Buffer.from(resUrl).toString('base64').substring(0, 100);
    const linkData = {
      source_url: resUrl,
      links: validLinks.map(link => link.href),
      links_count: validLinks.length,
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
      index: parseInt(index) || 0,
      source: 'naver-cafe'
    };

    await db.collection('scraped_links').doc(docId).set(linkData, { merge: true });

    console.log(`링크 ${validLinks.length}개 저장 완료 (${index})`);
    
    return { 
      success: true, 
      linksCount: validLinks.length
    };

  } catch (error) {
    console.error(`링크 추출 실패 (${index}):`, error.message);

    const importantErrors = [
      'Navigation timeout',
      'net::ERR_',
      '게시물 ID를 찾을 수 없음'
    ];

    const shouldLog = importantErrors.some(err => error.message.includes(err));
    
    if (shouldLog) {
      try {
        await db.collection('link_extraction_errors').add({
          url: resUrl || 'unknown',
          error_message: error.message.substring(0, 200),
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          index: parseInt(index) || 0,
          source: 'playwright'
        });
      } catch (logError) {
        console.error('에러 로깅 실패:', logError.message);
      }
    }

    throw error;

  } finally {
    // 리소스 정리
    try {
      if (page) await page.close();
      if (browser) await browser.close();
    } catch (cleanupError) {
      console.error('리소스 정리 실패:', cleanupError.message);
    }

    currentRequests--;
    console.log(`링크 추출 완료. 현재 요청 수: ${currentRequests}`);

    if (currentRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY));
    }
  }
};