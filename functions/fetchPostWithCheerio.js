// fetchPostWithCheerio.js
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

exports.fetchPostWithCheerio = async (message) => {
  console.log('Cheerio 스크래핑 시작');
  // console.log('message:', JSON.stringify(message, null, 2));
  // console.log(typeof message);
  
  try {
    // // PubSub 메시지에서 데이터 추출
    // const messageBody = message.data 
    //   ? JSON.parse(message.data.toString()) 
    //   : message.json;
    

    const { url, index, title, timestamp } = message.attributes;

    const urlId = new URL(url);
    const pathname = urlId.pathname; // 👉 /f-e/cafes/27842958/articles/20188102

    const parts = pathname.split('/');
    let resUrl = parts.includes('articles') ? parts[parts.indexOf('articles') + 1] : null;
    resUrl = resUrl ? `https://cafe.naver.com/steamindiegame/${resUrl}` : null;

    console.log(`게시물 처리 중 (${index}): ${resUrl}`);
    // console.log(`게시물 처리 중 (${index}): ${title}`);
    // console.log(`게시물 처리 중 (${index}): ${timestamp}`);
    
    // HTTP 요청으로 게시물 내용 가져오기
    const response = await axios.get(resUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      },
      timeout: 10000,
      maxRedirects: 3
    });
    
    // Cheerio로 HTML 파싱
    const $ = cheerio.load(response.data);
    

    $('data-linktype').each((i, el) => {
      console.log(`[${i}]`);
    });

  // // Cheerio 객체 선택
  // $('a').attr('href').each((i, el) => {
  //   const href = $(el).attr('href');
  //   console.log(href);
  // });;


    
    // // 메타데이터 추출
    // const title = $('meta[property="og:title"]').attr('content') 
    //   || $('title').text() 
    //   || '제목 없음';
    
    // const description = $('meta[property="og:description"]').attr('content') 
    //   || $('meta[name="description"]').attr('content') 
    //   || '';
    
    // // 게시물 내용 추출 (여러 선택자 시도)
    // const contentSelectors = [
    //   '#postContent',
    //   '.ContentRenderer', 
    //   '.post-content',
    //   '.article-content',
    //   '.content',
    //   '.post_ct'
    // ];
    
    // let content = '';
    // for (const selector of contentSelectors) {
    //   content = $(selector).text().trim();
    //   if (content) break;
    // }
    
    // 작성자 정보 추출
    // const author = $('.nick, .author, .writer').first().text().trim() || '작성자 미확인';
    
    // 작성일 추출
    // const dateText = $('.date, .post-date, .write-date').first().text().trim() || '';
    
    // 데이터 검증
    if (!title) {
      throw new Error('게시물 내용을 추출할 수 없습니다.');
    }
    
    // Firestore에 저장
    const docId = Buffer.from(resUrl).toString('base64').substring(0, 100); // URL을 base64로 인코딩
    const docData = {
      url: resUrl,
      title: title.substring(0, 500), // 제목 길이 제한
      // content: content.substring(0, 5000), // 내용 길이 제한
      // description: description.substring(0, 500),
      // author: author,
      // post_date: dateText,
      scraped_at: admin.firestore.FieldValue.serverTimestamp(),
      scraping_timestamp: timestamp,
      index: index || 0,
      source: 'naver-cafe'
    };
    
    await db.collection('scraped_posts').doc(docId).set(docData, { merge: true });
    
    console.log(`게시물 저장 완료 (${index}): ${title.substring(0, 50)}...`);
    
  } catch (error) {
    console.error(`게시물 처리 실패:`, error.message);
    
    // 실패한 항목도 로그로 기록
    try {
      // const messageBody = message.data 
      //   ? JSON.parse(message.data.toString()) 
      //   : message.json;
      
      await db.collection('scraping_errors').add({
        url: messageBody.resUrl || 'unknown',
        error: error.message,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        index: messageBody.index || 0
      });
    } catch (logError) {
      console.error('에러 로깅 실패:', logError);
    }
    
    // PubSub에서는 에러를 throw하지 않고 로깅만 함
    // throw new Error(`게시물 처리 실패: ${error.message}`);
  }
};