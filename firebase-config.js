import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyDuVOsZnORrIzdbXSDLrSRSo9f0LpbPAgw",
  authDomain: "razem-w-glowie.firebaseapp.com",
  projectId: "razem-w-glowie",
  storageBucket: "razem-w-glowie.firebasestorage.app",
  messagingSenderId: "190187681083",
  appId: "1:190187681083:web:54ae5f9387c94118eef31e",
};

export const ADMIN_EMAIL_ALLOWLIST = ["razemwglowie@gmail.com"].map((e) =>
  String(e || "").trim().toLowerCase(),
);

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const storage = getStorage(app);
export const db = getFirestore(app);
