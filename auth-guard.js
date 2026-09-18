import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { ADMIN_EMAIL_ALLOWLIST, auth } from "./firebase-config.js";

const getPageName = () => {
  const last = (window.location.pathname || "").split("/").filter(Boolean).pop();
  return last || "index.html";
};

const isProtectedPage = (pageName) =>
  new Set(["admin.html"]).has(String(pageName || "").toLowerCase());

const pageName = getPageName();
if (isProtectedPage(pageName)) {
  onAuthStateChanged(auth, (user) => {
    const normalizedPage = String(pageName || "").toLowerCase();
    if (!user) {
      const redirect = encodeURIComponent(normalizedPage);
      window.location.replace(`login.html?redirect=${redirect}`);
      return;
    }

    if (normalizedPage !== "admin.html") return;

    const email = String(user.email || "").trim().toLowerCase();
    if (email && ADMIN_EMAIL_ALLOWLIST.includes(email)) return;

    user
      .getIdTokenResult()
      .then((result) => {
        if (result?.claims?.admin === true) return;
        window.location.replace("index.html");
      })
      .catch(() => {
        window.location.replace("index.html");
      });
  });
}
