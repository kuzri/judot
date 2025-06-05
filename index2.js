/**
 * Import function triggers from their respective submodules:
 *
 * const {onCall} = require("firebase-functions/v2/https");
 * const {onDocumentWritten} = require("firebase-functions/v2/firestore");
 *
 * See a full list of supported triggers at https://firebase.google.com/docs/functions
 */

// const {onRequest} = require("firebase-functions/v2/https");
// const logger = require("firebase-functions/logger");

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const axios = require("axios");
const cheerio = require("cheerio");

admin.initializeApp();
const db = admin.firestore();

exports.scrapeNaverCafe = functions.region("asia-northeast3").pubsub.schedule("every 60 minutes").onRun(async (context) => {
  const url = "https://cafe.naver.com/f-e/cafes/27842958/menus/331?ta=SUBJECT&q=%EB%8F%9A%ED%95%98%EC%9D%B4&page=1&size=50";

  try {
    const response = await axios.get(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
        "Referer": "https://cafe.naver.com/",
      },
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // 예시: 모든 제목을 콘솔에 출력
    $("a.article").each((_, el) => {
      const title = $(el).text().trim();
      console.log("제목:", title);
    });
  } catch (error) {
    console.error("크롤링 실패:", error.message);
  }
});

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
