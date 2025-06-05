const functions = require("firebase-functions");
const axios = require("axios");
const cheerio = require("cheerio");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

exports.scrapeNaverCafe = functions
  .region("asia-northeast3")
  .pubsub.schedule("every 60 minutes")
  .onRun(async (context) => {
    const boardUrl =
      "https://cafe.naver.com/f-e/cafes/27842958/menus/331?ta=SUBJECT&q=%EB%8F%9A%ED%95%98%EC%9D%B4&page=1&size=50";

    try {
      const listResp = await axios.get(boardUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
          Referer: "https://cafe.naver.com/",
        },
      });

      const $ = cheerio.load(listResp.data);
      const articleLinks = [];

      $(".board-list .article").each((_, el) => {
        const href = $(el).attr("href");
        if (href && href.startsWith("/")) {
          const fullUrl = "https://cafe.naver.com" + href;
          articleLinks.push(fullUrl);
        }
      });

      const results = [];

      for (const url of articleLinks) {
        try {
          const articleResp = await axios.get(url, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Referer: "https://cafe.naver.com/",
            },
          });

          const $$ = cheerio.load(articleResp.data);
          const src = $$("iframe").attr("src");

          const data = {
            src: src || null,
            url,
            timestamp: new Date(),
          };

          results.push(data);

          // Firestore 저장 (중복 방지: src 기준)
          if (data.src) {
            const snapshot = await db
              .collection("videos")
              .where("src", "==", data.src)
              .get();

            if (snapshot.empty) {
              await db.collection("videos").add(data);
            } else {
              console.log(`이미 존재하는 src: ${data.src}`);
            }
          }
        } catch (err) {
          console.error(`게시글 처리 중 오류 (${url}):`, err.message);
          results.push({
            url,
            error: err.message,
          });
        }
      }

      console.log(`총 ${results.length}건 처리됨`);
      return null; // onRun은 return 값 없이 끝낼 수 있음
    } catch (error) {
      console.error("전체 처리 중 오류:", error.message);
      return null;
    }
  });
