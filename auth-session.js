import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  getDoc,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import {
  getDownloadURL,
  ref as storageRef,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js";
import { ADMIN_EMAIL_ALLOWLIST, auth, db, storage } from "./firebase-config.js";

const ROLE_KEY = "userRole";
const AUTH_USER_KEY = "authUser";
const LOGGED_IN_KEY = "loggedInUser";
const UID_KEY = "authUid";
const PHOTO_URL_KEY = "authPhotoURL";
const AUTH_EMAIL_KEY = "authEmail";
const PROFILE_KEYS = [
  "profileNick",
  "profileAvatar",
  "profileAvatarImage",
  "profileAnon",
  "profileAnonNick",
  "profileRealNick",
  "profileAnonCounter",
  "profileNotifications",
  "profileEmailAddress",
];

const getPageName = () => {
  const last = (window.location.pathname || "")
    .split("/")
    .filter(Boolean)
    .pop();
  return last || "index.html";
};

const clearSessionKeys = () => {
  localStorage.removeItem(LOGGED_IN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  localStorage.removeItem(ROLE_KEY);
  localStorage.removeItem(UID_KEY);
  localStorage.removeItem(PHOTO_URL_KEY);
  localStorage.removeItem(AUTH_EMAIL_KEY);
};

const clearProfileKeys = () => {
  PROFILE_KEYS.forEach((key) => localStorage.removeItem(key));
};

const setUsernameFromFirebase = async (user) => {
  if (!user) return;

  const prevUid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (prevUid && prevUid !== user.uid) {
    clearProfileKeys();
  }
  localStorage.setItem(UID_KEY, user.uid);
  const authEmail = String(user.email || "")
    .trim()
    .toLowerCase();
  if (authEmail) localStorage.setItem(AUTH_EMAIL_KEY, authEmail);
  else localStorage.removeItem(AUTH_EMAIL_KEY);

  if (authEmail && ADMIN_EMAIL_ALLOWLIST.includes(authEmail)) {
    localStorage.setItem(ROLE_KEY, "admin");
  } else {
    localStorage.setItem(ROLE_KEY, "user");
  }

  try {
    const [userSnap, publicSnap] = await Promise.all([
      getDoc(doc(db, "users", user.uid)),
      getDoc(doc(db, "publicProfiles", user.uid)),
    ]);
    const userData = userSnap.exists() ? userSnap.data() : null;
    const publicData = publicSnap.exists() ? publicSnap.data() : null;

    // Display name bierzemy z publicProfiles (nick), a dopiero potem z users (login).
    const displayName = String(
      publicData?.username || userData?.username || "",
    ).trim();

    let photoURL = String(
      userData?.photoURL || publicData?.photoURL || "",
    ).trim();
    const updatedAtRaw = userData?.updatedAt || publicData?.updatedAt;
    const updatedAtMs =
      typeof updatedAtRaw?.toDate === "function"
        ? updatedAtRaw.toDate().getTime()
        : Number.NaN;
    const cacheBust = Number.isFinite(updatedAtMs) ? updatedAtMs : Date.now();

    // Fallback: jeśli w Firestore nie ma photoURL, a plik istnieje w Storage (np. wrzucony ręcznie),
    // spróbuj pobrać URL bezpośrednio z Firebase Storage.
    if (!photoURL) {
      try {
        const url = await getDownloadURL(
          storageRef(storage, `Profilowe/${user.uid}/avatar.jpg`),
        );
        photoURL = String(url || "").trim();
      } catch {}
    }

    if (photoURL) {
      const joiner = photoURL.includes("?") ? "&" : "?";
      localStorage.setItem(PHOTO_URL_KEY, `${photoURL}${joiner}v=${cacheBust}`);
    } else localStorage.removeItem(PHOTO_URL_KEY);

    if (displayName) {
      localStorage.setItem(LOGGED_IN_KEY, displayName);
      localStorage.setItem(AUTH_USER_KEY, displayName);
      localStorage.setItem("profileNick", displayName);
      return {
        username: displayName,
        photoURL: localStorage.getItem(PHOTO_URL_KEY) || "",
      };
    }
  } catch {}

  const fallback = String(user.email || "").trim();
  if (fallback) {
    const fallbackName = fallback.includes("@")
      ? fallback.split("@")[0]
      : fallback;
    localStorage.setItem(LOGGED_IN_KEY, fallbackName);
    localStorage.setItem(AUTH_USER_KEY, fallbackName);
    localStorage.setItem("profileNick", fallbackName);
    localStorage.removeItem(PHOTO_URL_KEY);
    return { username: fallbackName, photoURL: "" };
  }
};

const logoutEverywhere = async () => {
  try {
    await signOut(auth);
  } finally {
    clearSessionKeys();
    clearProfileKeys();
    window.location.replace("login.html");
  }
};

let forceLogoutInProgress = false;

const setLoginNoticeAndLogout = async (notice) => {
  if (forceLogoutInProgress) return;
  forceLogoutInProgress = true;
  const msg = String(notice || "").trim();
  if (msg) localStorage.setItem("loginNotice", msg);
  await logoutEverywhere();
};

const normalizeBan = (ban) => {
  if (!ban || typeof ban !== "object") return null;
  const untilMs =
    typeof ban?.until?.toDate === "function"
      ? ban.until.toDate().getTime()
      : Number.NaN;
  return {
    permanent: Boolean(ban.permanent),
    untilMs: Number.isFinite(untilMs) ? untilMs : null,
    reason: String(ban.reason || "").trim(),
  };
};

const isActiveBan = (ban) => {
  if (!ban) return false;
  if (ban.permanent) return true;
  if (!ban.untilMs) return false;
  return ban.untilMs > Date.now();
};

const wireLogoutButtons = () => {
  const candidates = [
    document.getElementById("logoutBtn"),
    document.getElementById("btn-logout"),
  ].filter(Boolean);

  candidates.forEach((btn) => {
    btn.addEventListener(
      "click",
      (event) => {
        event.preventDefault();
        event.stopImmediatePropagation();
        logoutEverywhere();
      },
      true,
    );
  });
};

wireLogoutButtons();

let unsubscribeUserWatch = null;

onAuthStateChanged(auth, (user) => {
  if (unsubscribeUserWatch) {
    unsubscribeUserWatch();
    unsubscribeUserWatch = null;
  }

  if (!user) {
    clearSessionKeys();
    clearProfileKeys();
    window.dispatchEvent(
      new CustomEvent("authsession:changed", {
        detail: { loggedIn: false, uid: "", username: "", photoURL: "" },
      }),
    );
    return;
  }

  // Natychmiastowe reagowanie na bana / blokadę / usunięcie profilu.
  // Serwer nie "wyloguje" usera, ale możemy:
  // 1) zablokować zapisy regułami (robimy to w firestore.rules),
  // 2) wylogować w UI, gdy tylko profil zmieni się w Firestore.
  try {
    const userRef = doc(db, "users", user.uid);
    let sawDocExist = false;
    unsubscribeUserWatch = onSnapshot(
      userRef,
      (snap) => {
        if (!auth.currentUser) return;
        if (!snap.exists()) {
          // Dokument może jeszcze nie istnieć tuż po rejestracji/logowaniu (race condition).
          // Wylogowujemy tylko jeśli wcześniej realnie widzieliśmy istniejący profil, a potem zniknął.
          if (sawDocExist) {
            setLoginNoticeAndLogout("Twoje konto zostało usunięte.");
          }
          return;
        }
        sawDocExist = true;
        const data = snap.data() || {};
        if (data.isBlocked) {
          setLoginNoticeAndLogout("Twoje konto zostało zablokowane.");
          return;
        }
        const ban = normalizeBan(data.ban);
        if (isActiveBan(ban)) {
          const reason = ban?.reason ? ` Powód: ${ban.reason}` : "";
          setLoginNoticeAndLogout(`Twoje konto zostało zbanowane.${reason}`);
        }
      },
      () => {},
    );
  } catch {}

  setUsernameFromFirebase(user)
    .then((info) => {
      const username = String(
        info?.username || localStorage.getItem(LOGGED_IN_KEY) || "",
      ).trim();
      const photoURL = String(localStorage.getItem(PHOTO_URL_KEY) || "").trim();
      window.dispatchEvent(
        new CustomEvent("authsession:changed", {
          detail: { loggedIn: true, uid: user.uid, username, photoURL },
        }),
      );
    })
    .catch(() => {
      window.dispatchEvent(
        new CustomEvent("authsession:changed", {
          detail: {
            loggedIn: true,
            uid: user.uid,
            username: String(
              localStorage.getItem(LOGGED_IN_KEY) || user.email || "",
            ).trim(),
            photoURL: String(localStorage.getItem(PHOTO_URL_KEY) || "").trim(),
          },
        }),
      );
    });
});

window.AuthSession = {
  logout: logoutEverywhere,
  page: getPageName(),
};
