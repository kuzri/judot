import { getFirestore, collection, getDocs } from "firebase/firestore";
import { initializeApp } from "firebase/app";

const firebaseConfig = {
  apiKey: "...",
  authDomain: "...",
  projectId: "...",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function fetchScrapedData() {
  const querySnapshot = await getDocs(collection(db, "scrapedData"));
  return querySnapshot.docs.map(doc => doc.data());
}
