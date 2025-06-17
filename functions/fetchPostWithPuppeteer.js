// fetchPostWithPuppeteer.js

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();



// 메인 함수
exports.fetchPostWithPuppeteer = async (message) => {
  console.log('링크 추출 작업 시작');

  let browser;

  try {
    const { url, index } = message.data.message.attributes;
    console.log(`작업 시작 - Index: ${index}, URL: ${url}`);

    // browser = await launchBrowser();
    console.log('Chromium 설정 로딩 중...');
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
    const page = await browser.newPage();
    
    // 페이지 설정 최소화
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');

    console.log('페이지 로딩 중...');
    // 단일 시도, 타입아웃 단축
    await page.goto(url, { 
      waitUntil: 'networkidle0', 
      waitForSelector: '.se-link',
      timeout: 45000
    });

    console.log('링크 추출 중...');
    // 단일 링크만 추출 (첫 번째 .se-link)
    const linkData = await page.evaluate(() => {

      // 1. iframe 접근
    const iframe = document.querySelector('iframe[name="cafe_main"]');
    const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;

      const linkElement = iframeDoc.querySelector('.se-oglink-info');
      const uploadedDate = iframeDoc.querySelector('.date').innerText;
      const conversionDate = uploadedDate.split(" ")[0].replace(/\./g, '-').slice(0, -1);
      console.log('업로드 날짜:', conversionDate);
      const linkTitle = iframeDoc.querySelector('.title_text').innerText;
      const nickname = iframeDoc.querySelector('.nickname').innerText;
      // 
      if (linkElement && linkElement.href) {
        return {
          title: linkTitle,
          href: linkElement.href,
          uploadedDate: conversionDate,
          nickname: nickname,
          text: linkElement.textContent?.trim() || ''
        };
      }
      return null;
    });

    const docId = url.split('/').pop();// URL의 마지막 부분을 문서 ID로 사용
    // const docId = Buffer.from(url).toString('base64').substring(0, 80);
    const saveData = {
      ...linkData, // 단일 링크 또는 null
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
    };

    console.log('Firebase에 데이터 저장 중...');
    await db.collection('scraped_links').doc(docId).set(saveData, { merge: true });
    
    const resultMessage = linkData 
      ? `링크 1개 추출: ${linkData.href}`
      : '링크 없음';
    console.log(`작업 완료 - Index: ${index}, ${resultMessage}`);

    return { 
      success: true, 
      hasLink: !!linkData, 
      link: linkData?.href,
      uploadedDate: linkData?.uploadedDate || null,
      index: parseInt(index), 
    };

  } catch (error) {
    const idx = message?.data?.message?.attributes?.index || 0;
    const url = message?.data?.message?.attributes?.url || 'unknown';
    console.error(`링크 추출 실패 (Index: ${idx}):`, error.message);

    // 에러 로깅 간소화
    try {
      await db.collection('link_extraction_errors').add({
        url,
        error_message: error.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        index: parseInt(idx),
        
      });
    } catch (logErr) {
      console.error('에러 로깅 실패:', logErr.message);
    }

    throw error;
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeError) {
        console.error('브라우저 종료 실패:', closeError.message);
      }
    }
    console.log('링크 추출 작업 종료');
  }
};