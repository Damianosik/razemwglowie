import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

export const firebaseConfig = {
  apiKey: "AIzaSyC-bfA8amKPDfwb1Rd2APcDhnffN2fMbuo",
  authDomain: "razemwglowie-875fb.firebaseapp.com",
  projectId: "razemwglowie-875fb",
  storageBucket: "razemwglowie-875fb.appspot.com",
  messagingSenderId: "366202033554",
  appId: "1:366202033554:web:7e492d2459a4a387ea5d4b",
  measurementId: "G-H8X87PV59E",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const db = getFirestore(app);

export const ADMIN_EMAIL_ALLOWLIST = ["razemwglowie@gmail.com"];
