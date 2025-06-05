const functions = require("firebase-functions");
const admin = require("firebase-admin");

// Firebase Admin 초기화
admin.initializeApp({
  projectId: "dothighju", // ✅ 본인의 Firebase projectId 정확히 입력
});

// Firestore 인스턴스
const db = admin.firestore();

// 테스트용 Cloud Function
exports.testInsertToFirestore = functions
  .region("asia-northeast3")
  .https.onRequest(async (req, res) => {
    console.log("📌 테스트 시작");

    try {
      const result = await db.collection("videos").add({
        title: "Test video",
        createdAt: new Date(),
      });

      console.log("✅ 문서 ID:", result.id);
      res.status(200).send("Success: " + result.id);
    } catch (error) {
      console.error("❌ Firestore 오류:", error);
      res.status(500).send("Error: " + error.message);
    }
  });
