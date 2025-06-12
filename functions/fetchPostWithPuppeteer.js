// fetchPostWithPuppeteer.js
const chromium = require('@sparticuz/chromium');
const puppeteer = require('puppeteer');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// Chrome 경로 감지 함수 (Cloud Functions 최적화)
async function getChromePath() {
  const fs = require('fs');
  
  // 환경변수에서 우선 확인
  if (process.env.PUPPETEER_EXECUTABLE_PATH && fs.existsSync(process.env.PUPPETEER_EXECUTABLE_PATH)) {
    console.log('환경변수에서 Chrome 경로 발견:', process.env.PUPPETEER_EXECUTABLE_PATH);
    return process.env.PUPPETEER_EXECUTABLE_PATH;
  }

  // Cloud Functions Gen 2에서 사용 가능한 Chrome 경로들
  const possiblePaths = [
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/opt/google/chrome/chrome',
    '/usr/local/bin/google-chrome-stable',
    '/usr/local/bin/google-chrome',
    // Cloud Run/Functions에서 자주 사용되는 경로들
    '/opt/render/project/.render/chrome/opt/google/chrome/chrome',
    '/layers/google.nodejs.runtime/nodejs/bin/chrome'
  ];
  
  // 경로 확인
  for (const chromePath of possiblePaths) {
    try {
      if (fs.existsSync(chromePath)) {
        console.log('Chrome 경로 발견:', chromePath);
        return chromePath;
      }
    } catch (error) {
      continue;
    }
  }

  // Chrome 다운로드 시도 (Cloud Functions에서 런타임에 다운로드)
  try {
    console.log('Chrome을 런타임에 다운로드 시도...');
    const { execSync } = require('child_process');
    
    // Chrome 설치 시도
    execSync('apt-get update && apt-get install -y wget gnupg', { stdio: 'inherit' });
    execSync('wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add -', { stdio: 'inherit' });
    execSync('echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list', { stdio: 'inherit' });
    execSync('apt-get update', { stdio: 'inherit' });
    execSync('apt-get install -y google-chrome-stable', { stdio: 'inherit' });
    
    if (fs.existsSync('/usr/bin/google-chrome-stable')) {
      console.log('Chrome 설치 성공');
      return '/usr/bin/google-chrome-stable';
    }
  } catch (installError) {
    console.log('Chrome 설치 실패:', installError.message);
  }
  
  console.log('Chrome 경로를 찾을 수 없음');
  throw new Error('Chrome을 찾을 수 없습니다. Cloud Functions 설정을 확인하세요.');
}

// 설정값들
const CONFIG = {
  TIMEOUT: 20000, // 타임아웃 증가 (JS 로딩 시간 고려)
  MAX_RETRIES: 3, // 재시도 횟수 증가
  RATE_LIMIT_DELAY: 1000, // 딜레이 증가
  MAX_CONCURRENT_REQUESTS: 3, // 동시 요청 수 감소 (안정성)
  PAGE_LOAD_DELAY: 2000 // 페이지 로드 후 대기 시간
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
      await new Promise(resolve => setTimeout(resolve, delay * Math.pow(2, i))); // 지수 백오프
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
    if (!link.href || typeof link.href !== 'string' || !validateUrl(link.href)) {
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

    // 네이버 카페 내부 링크 제거 (외부 링크만 수집)
    try {
      const linkUrl = new URL(link.href);
      if (linkUrl.hostname.includes('cafe.naver.com')) {
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

// 브라우저 설정 최적화 (Cloud Functions)
function getBrowserArgs() {
  return [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--single-process', // Cloud Functions에서 중요
    '--disable-gpu',
    '--disable-web-security',
    '--disable-features=VizDisplayCompositor',
    '--disable-extensions',
    '--disable-plugins',
    '--disable-default-apps',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--memory-pressure-off',
    '--max_old_space_size=512', // Cloud Functions 메모리 제한 고려
    '--disable-blink-features=AutomationControlled',
    '--disable-software-rasterizer',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-sync',
    '--disable-translate',
    '--hide-scrollbars',
    '--metrics-recording-only',
    '--mute-audio',
    '--no-default-browser-check',
    '--safebrowsing-disable-auto-update',
    '--disable-ipc-flooding-protection'
  ];
}

exports.fetchPostWithPuppeteer = async (message) => {
  // 동시 요청 수 제한
  if (currentRequests >= CONFIG.MAX_CONCURRENT_REQUESTS) {
    throw new Error('동시 요청 수 제한 초과');
  }


  console.log("message:", message);

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
    index = parseInt(msgIndex) || 0;

    if (!url || typeof url !== 'string') {
      throw new Error('URL이 제공되지 않음');
    }

    // URL 처리 및 검증
    if (!validateUrl(url)) {
      throw new Error('유효하지 않은 URL');
    }

    const urlId = new URL(url);
    const pathname = urlId.pathname;
    const parts = pathname.split('/').filter(part => part.length > 0);
    let articleId = parts.includes('articles') ? parts[parts.indexOf('articles') + 1] : null;
    
    if (!articleId || !/^\d+$/.test(articleId)) {
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

    // Puppeteer 실행 - 링크 추출
    const extractedLinks = await retryWithDelay(async () => {
      try {
        const chromePath = await getChromePath();
        
      const launchOptions = {
        headless: chromium.headless,
        args: chromium.args,
        executablePath: await chromium.executablePath()
      };
        
        console.log('Puppeteer 실행 중...', { chromePath });
        browser = await puppeteer.launch(launchOptions);
        
      } catch (launchError) {
        console.error('Puppeteer 실행 실패:', launchError.message);
        throw launchError;
      }

      page = await browser.newPage();
      
      // 필요한 리소스만 로드하도록 설정 (JavaScript는 허용)
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        const resourceType = request.resourceType();
        const url = request.url();
        
        // 필요한 리소스만 허용
        if (resourceType === 'document' || 
            resourceType === 'script' || 
            (resourceType === 'xhr' && url.includes('cafe.naver.com'))) {
          request.continue();
        } else {
          // 이미지, CSS, 폰트 등 불필요한 리소스 차단
          request.abort();
        }
      });

      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
      page.setDefaultTimeout(CONFIG.TIMEOUT);

      // 페이지 로드
      await page.goto(resUrl, {
        waitUntil: 'networkidle2', // 네트워크 요청이 완료될 때까지 대기
        timeout: CONFIG.TIMEOUT
      });

      // 페이지 로드 후 추가 대기 (동적 콘텐츠 로딩)
      await new Promise(resolve => setTimeout(resolve, CONFIG.PAGE_LOAD_DELAY));

      // 링크 추출
      const rawLinks = await page.evaluate(() => {
        const selectors = [
          'a.se-link.__se_link',
          'a[href^="http"]',
          '.se-module-text a',
          '.se-text-paragraph a'
        ];
        
        const links = [];
        const seenHrefs = new Set();
        
        selectors.forEach(selector => {
          const elements = document.querySelectorAll(selector);
          elements.forEach((element, index) => {
            const href = element.href;
            if (href && !seenHrefs.has(href)) {
              seenHrefs.add(href);
              links.push({
                href: href,
                text: element.textContent?.trim() || '',
                selector: selector,
                index: index
              });
            }
          });
        });
        
        return links;
      });

      return rawLinks;
    });

    // 링크 유효성 검사 및 필터링
    const validLinks = await validateAndFilterLinks(extractedLinks, resUrl);
    console.log(`총 링크: ${extractedLinks.length}, 유효한 외부 링크: ${validLinks.length}`);

    // 링크가 없으면 저장하지 않음
    if (validLinks.length === 0) {
      console.log(`유효한 외부 링크 없음 - 저장 스킵 (${index})`);
      return { success: true, skipped: true, reason: 'no_valid_links' };
    }

    // Firebase에 링크 저장
    const docId = Buffer.from(resUrl).toString('base64').substring(0, 100);
    const linkData = {
      source_url: resUrl,
      links: validLinks.map(link => ({
        href: link.href,
        text: link.text?.substring(0, 100) || '' // 텍스트도 저장하되 길이 제한
      })),
      links_count: validLinks.length,
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
      index: parseInt(index) || 0,
      source: 'naver-cafe',
      article_id: articleId
    };

    await db.collection('scraped_links').doc(docId).set(linkData, { merge: true });

    console.log(`외부 링크 ${validLinks.length}개 저장 완료 (${index})`);
    
    return { 
      success: true, 
      linksCount: validLinks.length,
      articleId: articleId
    };

  } catch (error) {
    console.error(`링크 추출 실패 (${index}):`, error.message);

    // 에러 분류 및 로깅
    const errorTypes = {
      timeout: ['timeout', 'Navigation timeout'],
      network: ['net::ERR_', 'ERR_NETWORK'],
      parsing: ['게시물 ID를 찾을 수 없음', '잘못된 메시지 형식'],
      access: ['403', '404', 'Access denied']
    };

    let errorType = 'unknown';
    for (const [type, patterns] of Object.entries(errorTypes)) {
      if (patterns.some(pattern => error.message.includes(pattern))) {
        errorType = type;
        break;
      }
    }

    // 중요한 에러만 데이터베이스에 로깅
    if (errorType !== 'unknown') {
      try {
        await db.collection('link_extraction_errors').add({
          url: resUrl || url || 'unknown',
          error_message: error.message.substring(0, 300),
          error_type: errorType,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          index: parseInt(index) || 0,
          source: 'puppeteer'
        });
      } catch (logError) {
        console.error('에러 로깅 실패:', logError.message);
      }
    }

    throw error;

  } finally {
    // 리소스 정리
    try {
      if (page && !page.isClosed()) {
        await page.close();
      }
      if (browser && browser.isConnected()) {
        await browser.close();
      }
    } catch (cleanupError) {
      console.error('리소스 정리 실패:', cleanupError.message);
    }

    currentRequests--;
    console.log(`링크 추출 완료. 현재 요청 수: ${currentRequests}`);

    // 요청 간 딜레이
    if (currentRequests > 0) {
      await new Promise(resolve => setTimeout(resolve, CONFIG.RATE_LIMIT_DELAY));
    }
  }
};