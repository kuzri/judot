const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

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
      const puppeteerRegular = require('puppeteer');
      browser = await puppeteerRegular.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    } catch (localError) {
      console.warn('로컬 puppeteer 실패, chromium 사용:', localError.message);
      browser = await launchChromiumBrowser();
    }
  } else {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });
  }
  
  return browser;
}

// Chromium 브라우저 실행 함수
async function launchChromiumBrowser() {
  const executablePath = await chromium.executablePath();
  console.log('Chromium 실행 경로:', executablePath);

  const fs = require('fs');
  if (executablePath && fs.existsSync && fs.existsSync(executablePath)) {
    console.log('Chromium 실행 파일 확인됨');
  } else {
    console.warn('Chromium 실행 파일 경로 불확실, 계속 진행');
  }

  const launchOptions = {
    args: [
      ...chromium.args,
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-gpu',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ],
    defaultViewport: chromium.defaultViewport,
    executablePath,
    headless: chromium.headless,
    ignoreHTTPSErrors: true,
    timeout: 30000
  };

  console.log('브라우저 실행 옵션:', JSON.stringify(launchOptions, null, 2));

  try {
    const browser = await puppeteer.launch(launchOptions);
    console.log('브라우저 실행 성공');
    return browser;
  } catch (launchError) {
    console.error('브라우저 실행 실패:', launchError.message);
    console.log('간단한 옵션으로 재시도...');
    return await puppeteer.launch({
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--single-process'],
      executablePath,
      headless: true,
      timeout: 15000
    });
  }
}

// 메인 함수
exports.fetchPostWithPuppeteer = async (message) => {
  console.log('링크 추출 작업 시작');

  let browser;

  try {
    const { url, index, title } = message.data.message.attributes;
    console.log(`작업 시작 - Index: ${index}, title: ${title}, URL: ${url}`);
    const targetUrl = url;

    browser = await launchBrowser();
    console.log('브라우저 실행 완료');

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(45000);
    page.setDefaultTimeout(45000);
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8'
    });

    console.log('페이지 로딩 중...');
    let response;
    let retryCount = 0;
    const maxRetries = 2;
    while (retryCount <= maxRetries) {
      try {
        response = await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        console.log('페이지 로딩 완료, 상태:', response.status());
        break;
      } catch (navError) {
        console.error(`페이지 네비게이션 에러 (시도 ${retryCount + 1}):`, navError.message);
        if (retryCount === maxRetries) {
          const urlMatch = targetUrl.match(/\/articles\/(\d+)/);
          if (urlMatch) {
            const articleId = urlMatch[1];
            const altUrl = `https://cafe.naver.com/steamindiegame/${articleId}`;
            console.log('대안 URL 시도:', altUrl);
            response = await page.goto(altUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            break;
          } else {
            throw navError;
          }
        } else {
          retryCount++;
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    }

    try {
      await page.waitForSelector('body', { timeout: 10000 });
    } catch (waitError) {
      console.warn('body 셀렉터 대기 실패, 계속 진행:', waitError.message);
    }

    console.log('링크 추출 중...');
    const rawLinks = await page.evaluate(() => {
      const selectors = ['a[href^="http"]', '.se-module-text a', 'article a[href^="http"]'];
      const links = [];
      const seen = new Set();
      selectors.forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            if (el.href && !seen.has(el.href)) {
              seen.add(el.href);
              links.push({ href: el.href, text: el.textContent?.trim() || '' });
            }
          });
        } catch {}
      });
      return links;
    });

    console.log(`원본 링크 ${rawLinks.length}개 추출 완료`);

    const docId = Buffer.from(targetUrl).toString('base64').substring(0, 80);
    const linkData = {
      source_url: targetUrl,
      links: rawLinks.map(link => ({ href: link.href, text: link.text })),
      links_count: rawLinks.length,
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
      index: parseInt(index),
      batch_id: title,
      source: 'naver-cafe'
    };

    console.log('Firebase에 데이터 저장 중...');
    await db.collection('scraped_links').doc(docId).set(linkData, { merge: true });
    console.log(`작업 완료 - Index: ${index}, 링크 ${rawLinks.length}개 저장`);

    return { success: true, linksCount: rawLinks.length, index: parseInt(index), title };
  } catch (error) {
    const idx = message?.data?.message?.attributes?.index || 0;
    const url = message?.data?.message?.attributes?.url || 'unknown';
    console.error(`링크 추출 실패 (Index: ${idx}):`, error.message);
    console.error('에러 스택:', error.stack);

    try {
      await db.collection('link_extraction_errors').add({
        url,
        error_message: error.message,
        error_stack: error.stack?.substring(0, 1000),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        index: parseInt(idx),
        batch_id: message?.data?.message?.attributes?.title || 'unknown',
        error_type: error.name || 'UnknownError'
      });
    } catch (logErr) {
      console.error('에러 로깅 실패:', logErr.message);
    }

    throw error;
  } finally {
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
