import {
  onAuthStateChanged,
  deleteUser,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  deleteDoc,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ADMIN_EMAIL_ALLOWLIST, auth, db } from "./firebase-config.js";

document.addEventListener("DOMContentLoaded", () => {
  const ROLE_KEY = "userRole";
  const AUTH_USER_KEY = "authUser";
  const LOGGED_IN_KEY = "loggedInUser";
  const VERIFY_REQUIRED_MESSAGE =
    "Musisz zweryfikować konto, żeby się zalogować.";
  const loginNotice = String(localStorage.getItem("loginNotice") || "").trim();
  if (loginNotice) {
    const errorMessage = document.getElementById("errorMessage");
    const successMessage = document.getElementById("successMessage");
    if (successMessage) successMessage.style.display = "none";
    if (errorMessage) {
      errorMessage.textContent = loginNotice;
      errorMessage.style.display = "block";
    }
    localStorage.removeItem("loginNotice");
  }
  const allowedRedirects = new Set([
    "index.html",
    "forum.html",
    "wiki.html",
    "ankieta.html",
    "admin.html",
  ]);
  const loginRedirect = "index.html";
  const params = new URLSearchParams(window.location.search);
  const requestedRedirectRaw = String(params.get("redirect") || "").trim();
  const requestedRedirect = requestedRedirectRaw
    ? requestedRedirectRaw.split("?")[0].split("/").filter(Boolean).pop()
    : "";
  const postLoginRedirect = allowedRedirects.has(requestedRedirect)
    ? requestedRedirect
    : loginRedirect;
  let loginInProgress = false;

  const normalizeBan = (ban) => {
    if (!ban || typeof ban !== "object") return null;
    const mapDate = (value) => {
      if (!value) return null;
      if (typeof value?.toDate === "function")
        return value.toDate().toISOString();
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date.toISOString();
    };
    return {
      permanent: Boolean(ban.permanent),
      until: mapDate(ban.until),
      reason: String(ban.reason || "").trim(),
    };
  };

  const isActiveBan = (ban) => {
    if (!ban) return false;
    if (ban.permanent) return true;
    if (!ban.until) return false;
    const until = new Date(ban.until).getTime();
    return !Number.isNaN(until) && until > Date.now();
  };

  const getUserByUid = async (uid) => {
    const userRef = doc(db, "users", uid);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return null;
    return { id: userSnap.id, ...userSnap.data() };
  };

  const loginForm = document.getElementById("loginForm");
  const togglePassword = document.getElementById("togglePassword");
  const passwordField = document.getElementById("password");
  const forgotLink = document.getElementById("forgotPasswordLink");

  const clearSessionKeys = () => {
    localStorage.removeItem(LOGGED_IN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(ROLE_KEY);
  };

  onAuthStateChanged(auth, (user) => {
    if (user && !loginInProgress) {
      // TEMPORARY: allow login during testing without email verification.
      window.location.replace(postLoginRedirect);
    }
  });

  if (loginForm) {
    loginForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      loginInProgress = true;

      const usernameInput = document.getElementById("username");
      const passwordInput = document.getElementById("password");
      const errorMessage = document.getElementById("errorMessage");
      const successMessage = document.getElementById("successMessage");

      const loginValue = usernameInput.value.trim();
      const password = passwordInput.value;

      errorMessage.style.display = "none";
      successMessage.style.display = "none";

      if (!loginValue || !password) {
        errorMessage.textContent = "Wypełnij wszystkie pola!";
        errorMessage.style.display = "block";
        loginInProgress = false;
        return;
      }

      const emailForAuth = loginValue.includes("@") ? loginValue : "";
      if (!emailForAuth) {
        errorMessage.textContent = "Zaloguj się e-mailem.";
        errorMessage.style.display = "block";
        loginInProgress = false;
        return;
      }

      try {
        const credential = await signInWithEmailAndPassword(
          auth,
          emailForAuth,
          password,
        );

        let userProfile = null;
        let profileReadFailed = false;
        try {
          userProfile = await getUserByUid(credential.user.uid);
        } catch (profileError) {
          profileReadFailed = true;
          console.warn(
            "Nie udało się odczytać profilu Firestore:",
            profileError,
          );
        }

        if (!userProfile && !profileReadFailed) {
          const usernameFromEmail = emailForAuth.split("@")[0];
          const newUserProfileData = {
            uid: credential.user.uid,
            username: usernameFromEmail,
            usernameLower: usernameFromEmail.toLowerCase(),
            email: emailForAuth,
            emailLower: emailForAuth.toLowerCase(),
            role: "user",
            isBlocked: false,
            ban: null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            lastLoginAt: serverTimestamp(),
          };
          await setDoc(
            doc(db, "users", credential.user.uid),
            newUserProfileData,
          );
          userProfile = { id: credential.user.uid, ...newUserProfileData };
        }

        let effectiveProfile = userProfile || {
          username: emailForAuth.split("@")[0],
          role: "user",
          isBlocked: false,
          ban: null,
        };
        const needsUsername = !String(effectiveProfile?.username || "").trim();
        const needsEmail = !String(effectiveProfile?.email || "").trim();
        if ((needsUsername || needsEmail) && !profileReadFailed) {
          const usernameFromEmail = String(emailForAuth || "")
            .split("@")[0]
            .trim();
          const patchedProfile = { ...effectiveProfile };
          const patchData = {
            updatedAt: serverTimestamp(),
          };

          if (needsUsername) {
            const finalUsername =
              usernameFromEmail || `user_${credential.user.uid.slice(0, 6)}`;
            patchedProfile.username = finalUsername;
            patchedProfile.usernameLower = finalUsername.toLowerCase();
            patchData.username = patchedProfile.username;
            patchData.usernameLower = patchedProfile.usernameLower;
          }
          if (needsEmail) {
            patchedProfile.email = emailForAuth;
            patchedProfile.emailLower = String(
              emailForAuth || "",
            ).toLowerCase();
            patchData.email = patchedProfile.email;
            patchData.emailLower = patchedProfile.emailLower;
          }

          await setDoc(doc(db, "users", credential.user.uid), patchData, {
            merge: true,
          });
          effectiveProfile = patchedProfile;
        }
        const activeBan = normalizeBan(effectiveProfile.ban);

        if (effectiveProfile.isBlocked) {
          await signOut(auth);
          errorMessage.textContent = VERIFY_REQUIRED_MESSAGE;
          errorMessage.style.display = "block";
          loginInProgress = false;
          return;
        }
        if (isActiveBan(activeBan)) {
          await signOut(auth);
          const banMessage = window.UserManager?.formatBanMessage
            ? window.UserManager.formatBanMessage(activeBan)
            : "To konto jest zbanowane.";
          errorMessage.textContent = banMessage || "To konto jest zbanowane.";
          errorMessage.style.display = "block";
          loginInProgress = false;
          return;
        }

        successMessage.textContent = "Logowanie udane! Przekierowanie...";
        successMessage.style.display = "block";

        try {
          if (userProfile?.id) {
            await updateDoc(doc(db, "users", userProfile.id), {
              lastLoginAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            });
          }
        } catch (updateError) {
          console.error(
            "Nie-krytyczny błąd po zalogowaniu (aktualizacja danych):",
            updateError,
          );
        }

        const finalUsername = String(
          effectiveProfile.username || emailForAuth.split("@")[0],
        ).trim();
        const authEmailLower = String(emailForAuth || "")
          .trim()
          .toLowerCase();
        const profileRole =
          String(effectiveProfile.role || "user").toLowerCase() === "admin"
            ? "admin"
            : "user";
        const finalRole = ADMIN_EMAIL_ALLOWLIST.includes(authEmailLower)
          ? "admin"
          : profileRole;
        localStorage.setItem("loggedInUser", finalUsername);
        localStorage.setItem("authUser", finalUsername);
        localStorage.setItem(ROLE_KEY, finalRole);

        if (window.UserManager?.markOnline) {
          window.UserManager.markOnline(finalUsername, "login.html");
        }

        window.location.href = postLoginRedirect;
      } catch (error) {
        console.error("Krytyczny błąd podczas logowania:", error);
        if (
          error.code === "auth/invalid-credential" ||
          error.code === "auth/wrong-password" ||
          error.code === "auth/user-not-found"
        ) {
          errorMessage.textContent =
            "Nieprawidłowy e-mail lub hasło! (" +
            (error.code || "unknown") +
            ")";
        } else if (error.code === "permission-denied") {
          errorMessage.textContent = VERIFY_REQUIRED_MESSAGE;
        } else {
          errorMessage.textContent = `Błąd logowania: ${error.message}`;
        }
        errorMessage.style.display = "block";
        loginInProgress = false;
      }
    });
  }

  if (togglePassword && passwordField) {
    togglePassword.addEventListener("click", () => {
      const nextType = passwordField.type === "password" ? "text" : "password";
      passwordField.type = nextType;
      togglePassword.classList.toggle("fa-eye");
      togglePassword.classList.toggle("fa-eye-slash");
    });
  }

  if (forgotLink) {
    forgotLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = "forgot.html";
    });
  }
});
