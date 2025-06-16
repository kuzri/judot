// functions/index.js

const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onRequest } = require("firebase-functions/v2/https");
const { onMessagePublished } = require('firebase-functions/v2/pubsub');
const { logger } = require("firebase-functions");

const { getPostUrlsWithPuppeteer } = require("./getPostUrlsWithPuppeteer");
const { fetchPostWithPuppeteer } = require("./fetchPostWithPuppeteer");
const axios = require("axios");

// 1. 스케줄러 함수 - 매일 스크래핑 시작
exports.scheduledScraping = onSchedule(
  {
    schedule: "every 24 hours", // 또는 cron: '0 9 * * *'
    timeZone: "Asia/Seoul",
    region: "asia-northeast3",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async (event) => {
    logger.info("스케줄된 스크래핑 시작");

    try {
      const functionUrl =
        "https://asia-northeast3-dothighju.cloudfunctions.net/getPostUrlsWithPuppeteer";

      const response = await axios.get(functionUrl, {
        timeout: 540000, // 9분
      });

      logger.info("Puppeteer 함수 호출 완료", response.data);
      return { success: true, message: response.data };
    } catch (error) {
      logger.error("스케줄된 스크래핑 실패", error);
      throw new Error(`스케줄 실행 실패: ${error.message}`);
    }
  }
);

// 2. Puppeteer로 URL 목록 가져오기 (HTTP 트리거)
exports.getPostUrlsWithPuppeteer = onRequest(
  {
    region: "asia-northeast3",
    memory: "1GiB",
    timeoutSeconds: 500,
    invoker: "public", // 필요시 "private"
  },
  getPostUrlsWithPuppeteer
);

// 3. PubSub 트리거로 게시물 상세 수집
exports.fetchPostWithPuppeteer = onMessagePublished(
  {
    topic: 'fetch-post-details',
    region: 'asia-northeast3',
    timeoutSeconds: 300,
    memory: '2GiB',
  },
  fetchPostWithPuppeteer
);