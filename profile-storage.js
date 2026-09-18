import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import {
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db, storage } from "./firebase-config.js";

const PHOTO_URL_KEY = "authPhotoURL";
const AVATAR_COLOR_KEY = "profileAvatar";

const getInitial = (name) => {
  const value = String(name || "").trim();
  if (!value) return "G";
  return value[0].toUpperCase();
};

const getAvatarColor = (name) => {
  const palette = ["#e11d48", "#0ea5e9", "#22c55e", "#f97316", "#8b5cf6", "#14b8a6"];
  const value = String(name || "");
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash + value.charCodeAt(i) * (i + 1)) % 1000;
  }
  return palette[hash % palette.length];
};

const applyAvatarToHeader = (username, photoURL) => {
  const legacyAvatarEl = document.querySelector(".avatar");
  const legacyInitial = document.querySelector(".avatar-initial");

  const topbarAvatar = document.getElementById("topbarAvatar");
  const topbarInitial = document.getElementById("topbarAvatarInitial");

  const apply = (avatarEl, initialEl) => {
    if (!avatarEl) return;
    avatarEl.classList.remove("has-image");
    avatarEl.style.backgroundImage = "";
    avatarEl.style.backgroundSize = "";
    avatarEl.style.backgroundPosition = "";
    avatarEl.style.backgroundColor = "";

    if (photoURL) {
      avatarEl.style.backgroundImage = `url(${photoURL})`;
      avatarEl.style.backgroundSize = "cover";
      avatarEl.style.backgroundPosition = "center";
      avatarEl.style.backgroundColor = "transparent";
      avatarEl.classList.add("has-image");
    } else {
      const savedColor = localStorage.getItem("profileAvatar");
      avatarEl.style.background = savedColor || getAvatarColor(username);
    }

    if (initialEl) initialEl.textContent = getInitial(username);
  };

  apply(legacyAvatarEl, legacyInitial);
  apply(topbarAvatar, topbarInitial);
};

const setFeedback = (text) => {
  const el = document.getElementById("profileFeedback");
  if (!el) return;
  el.textContent = String(text || "");
  if (text) el.dataset.origin = "storage";
  if (!text) return;
  window.setTimeout(() => {
    if (el.textContent === text && (el.dataset.origin || "") === "storage") {
      el.textContent = "";
      delete el.dataset.origin;
    }
  }, 2200);
};

const getAvatarPath = (uid) => `Profilowe/${uid}/avatar.jpg`;
const withCacheBust = (url) => {
  const base = String(url || "").trim();
  if (!base) return "";
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}v=${Date.now()}`;
};

const normalizeUsername = (user) => {
  const fromStorage = String(localStorage.getItem("loggedInUser") || "").trim();
  if (fromStorage) return fromStorage;
  const email = String(user?.email || "").trim();
  if (email && email.includes("@")) return email.split("@")[0];
  return `user_${String(user?.uid || "").slice(0, 6)}`;
};

const wireStorageProfile = () => {
  const fileInput = document.getElementById("profileAvatarFile");
  const fileNameEl = document.getElementById("profileAvatarFileName");
  const fileBtn = document.querySelector('label.profile-file-button[for="profileAvatarFile"]');
  const removeBtn = document.getElementById("removeAvatarBtn");
  const profileForm = document.getElementById("profileForm");
  const saveBtn =
    (profileForm && profileForm.querySelector('button[type="submit"]')) || null;
  if (!fileInput && !removeBtn) return;

  if (fileBtn && fileInput) {
    fileBtn.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      fileInput.click();
    });
  }

  let activeUser = null;
  let pendingFile = null;

  const setFileName = (name) => {
    if (!fileNameEl) return;
    const trimmed = String(name || "").trim();
    fileNameEl.textContent = trimmed ? trimmed : "Nie wybrano pliku";
  };

  const doUpload = async (file) => {
    if (!activeUser) {
      setFeedback("Musisz byc zalogowany.");
      return;
    }
    if (!file) return;
    if (!String(file.type || "").startsWith("image/")) {
      setFeedback("Wybierz plik obrazu (JPG/PNG/WebP).");
      return;
    }
    if (Number(file.size || 0) > 1024 * 1024) {
      setFeedback("Plik jest za duzy (max 1 MB).");
      return;
    }

    setFeedback("Wgrywanie zdjecia...");
    try {
      const objectRef = ref(storage, getAvatarPath(activeUser.uid));
      await uploadBytes(objectRef, file, {
        contentType: file.type || "image/jpeg",
        cacheControl: "public, max-age=0",
      });
      const url = await getDownloadURL(objectRef);

      const username = normalizeUsername(activeUser);
      const avatarColor = String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim();

      const userRef = doc(db, "users", activeUser.uid);
      try {
        await updateDoc(userRef, {
          photoURL: url,
          updatedAt: serverTimestamp(),
        });
      } catch (firestoreErr) {
        await setDoc(
          userRef,
          {
          uid: activeUser.uid,
          username,
          usernameLower: String(username).toLowerCase(),
          email: String(activeUser.email || "").trim(),
          emailLower: String(activeUser.email || "").trim().toLowerCase(),
          photoURL: url,
          role: "user",
          isBlocked: false,
          ban: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          lastLoginAt: null,
          },
          { merge: false },
        );
      }

      // Firestore rules for /publicProfiles require createdAt on create, but not on update.
      const publicRef = doc(db, "publicProfiles", activeUser.uid);
      const publicSnap = await getDoc(publicRef);
      if (publicSnap.exists()) {
        await setDoc(
          publicRef,
          {
            uid: activeUser.uid,
            username,
            usernameLower: String(username).toLowerCase(),
            photoURL: url,
            avatarColor,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
      } else {
        await setDoc(
          publicRef,
          {
            uid: activeUser.uid,
            username,
            usernameLower: String(username).toLowerCase(),
            photoURL: url,
            avatarColor,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: false },
        );
      }

      const busted = withCacheBust(url);
      localStorage.setItem(PHOTO_URL_KEY, busted);
      applyAvatarToHeader(username, busted);
      setFeedback("Zapisano profilowe.");
      return true;
    } catch (err) {
      console.error("Upload avatar error:", err);
      const code = String(err?.code || "").trim();
      const msg = String(err?.message || "").trim();
      setFeedback(
        code || msg
          ? `Błąd wgrywania profilowego: ${code || msg}`
          : "Błąd wgrywania profilowego.",
      );
      return false;
    }
  };

  const doRemove = async () => {
    if (!activeUser) {
      setFeedback("Musisz być zalogowany.");
      return;
    }

    setFeedback("Usuwanie profilowego...");
    const objectRef = ref(storage, getAvatarPath(activeUser.uid));
    try {
      await deleteObject(objectRef);
    } catch (err) {
      console.warn("Delete avatar error:", err);
      const code = String(err?.code || "").trim();
      if (code && code !== "storage/object-not-found") {
        setFeedback(`Nie udało się usunąć pliku w Storage (${code}). Usuwam powiązanie z profilu...`);
      }
    }

    try {
      await setDoc(
        doc(db, "users", activeUser.uid),
        {
          photoURL: deleteField(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.error("Clear photoURL in Firestore error:", err);
      const code = String(err?.code || "").trim();
      const msg = String(err?.message || "").trim();
      setFeedback(
        code || msg
          ? `Błąd usuwania profilowego (Firestore): ${code || msg}`
          : "Błąd usuwania profilowego (Firestore).",
      );
      return;
    }

    try {
      await setDoc(
        doc(db, "publicProfiles", activeUser.uid),
        {
          photoURL: deleteField(),
          avatarColor: String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim(),
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
    } catch (err) {
      console.warn("Clear photoURL in publicProfiles error:", err);
    }

    localStorage.removeItem(PHOTO_URL_KEY);
    const username = normalizeUsername(activeUser);
    applyAvatarToHeader(username, "");
    setFeedback("Usunięto profilowe.");
    window.dispatchEvent(
      new CustomEvent("authsession:changed", {
        detail: { loggedIn: true, uid: activeUser.uid, username, photoURL: "" },
      }),
    );
  };

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      pendingFile = file || null;
      setFileName(pendingFile ? pendingFile.name : "");
      if (pendingFile) {
        setFeedback("Wybrano plik. Kliknij 'Zapisz zmiany', aby wgrac profilowe.");
      }
      fileInput.value = "";
    });
  }

  if (removeBtn) {
    removeBtn.addEventListener("click", async () => {
      removeBtn.disabled = true;
      try {
        await doRemove();
        pendingFile = null;
        setFileName("");
      } finally {
        removeBtn.disabled = false;
      }
    });
  }

  if (profileForm) {
    profileForm.addEventListener("submit", async (event) => {
      if (event && typeof event.preventDefault === "function") event.preventDefault();
      if (!pendingFile) return;
      const file = pendingFile;

      if (saveBtn) saveBtn.disabled = true;
      try {
        const ok = await doUpload(file);
        if (ok) {
          pendingFile = null;
          window.setTimeout(() => setFileName(""), 1800);
        } else {
          pendingFile = file;
          setFileName(file.name);
        }
      } finally {
        if (saveBtn) saveBtn.disabled = false;
      }
    });
  }

  onAuthStateChanged(auth, (user) => {
    activeUser = user;
  });
};

const boot = () => wireStorageProfile();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
window.addEventListener("profileui:ready", boot);
