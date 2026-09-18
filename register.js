import {
  createUserWithEmailAndPassword,
  deleteUser,
  fetchSignInMethodsForEmail,
  sendEmailVerification,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  doc,
  serverTimestamp,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";

document.addEventListener("DOMContentLoaded", () => {
  const registerForm = document.getElementById("registerForm");
  if (!registerForm) return;
  let registrationCompleted = false;

  const params = new URLSearchParams(window.location.search);
  const prefillEmail = params.get("email") || "";
  const createFirebase = params.get("createFirebase") === "1";

  const emailInputInit = document.getElementById("email");
  const successInit = document.getElementById("successMessage");
  if (emailInputInit && prefillEmail) {
    emailInputInit.value = prefillEmail;
  }
  if (successInit && createFirebase) {
    successInit.textContent =
      "Uzupelnij dane i kliknij rejestracje, aby utworzyc konto w Firebase.";
    successInit.style.display = "block";
  }

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (registrationCompleted) return;

    const usernameInput = document.getElementById("username");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const confirmInput = document.getElementById("confirmPassword");
    const errorMessage = document.getElementById("errorMessage");
    const successMessage = document.getElementById("successMessage");
    const submitBtn = registerForm.querySelector('button[type="submit"]');

    const username = usernameInput.value.trim();
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    const confirmPassword = confirmInput.value;

    errorMessage.style.display = "none";
    successMessage.style.display = "none";

    if (!username || !email || !password || !confirmPassword) {
      errorMessage.textContent = "Wypełnij wszystkie pola!";
      errorMessage.style.display = "block";
      return;
    }

    if (password.length < 6) {
      errorMessage.textContent = "Hasło musi mieć minimum 6 znaków.";
      errorMessage.style.display = "block";
      return;
    }

    if (password !== confirmPassword) {
      errorMessage.textContent = "Hasła nie są takie same!";
      errorMessage.style.display = "block";
      return;
    }

    if (username.toLowerCase() === "admin") {
      errorMessage.textContent = "Login 'admin' jest zarezerwowany.";
      errorMessage.style.display = "block";
      return;
    }

    const usernameLower = username.toLowerCase();
    const emailLower = email.toLowerCase();

    try {
      const signInMethods = await fetchSignInMethodsForEmail(auth, email);
      if (Array.isArray(signInMethods) && signInMethods.length > 0) {
        errorMessage.textContent = "Ten e-mail jest już użyty w Firebase Auth.";
        errorMessage.style.display = "block";
        return;
      }
    } catch (error) {
      errorMessage.textContent = `Błąd sprawdzania loginu: ${error.message}`;
      errorMessage.style.display = "block";
      return;
    }

    let credential;
    try {
      credential = await createUserWithEmailAndPassword(auth, email, password);
    } catch (error) {
      if (error.code === "auth/network-request-failed") {
        errorMessage.textContent =
          "Brak połączenia z internetem lub Firebase. Spróbuj ponownie.";
      } else if (error.code === "auth/email-already-in-use") {
        errorMessage.textContent = "Ten e-mail jest już zarejestrowany.";
      } else if (error.code === "auth/invalid-email") {
        errorMessage.textContent = "Nieprawidłowy adres e-mail.";
      } else if (error.code === "auth/weak-password") {
        errorMessage.textContent = "Hasło jest za słabe (min. 6 znaków).";
      } else {
        errorMessage.textContent = `Błąd Firebase: ${error.message}`;
      }
      errorMessage.style.display = "block";
      return;
    }

    try {
      await credential.user.getIdToken(true);

      const userDocRef = doc(db, "users", credential.user.uid);
      const usernameDocRef = doc(db, "usernames", usernameLower);
      const publicProfileRef = doc(db, "publicProfiles", credential.user.uid);

      const batch = writeBatch(db);
      batch.set(userDocRef, {
        uid: credential.user.uid,
        username,
        usernameLower,
        email,
        emailLower,
        photoURL: "",
        role: "user",
        isBlocked: false,
        ban: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        lastLoginAt: null,
      });
      batch.set(publicProfileRef, {
        uid: credential.user.uid,
        username,
        usernameLower,
        photoURL: "",
        avatarColor: "",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await batch.commit();

      const usernameBatch = writeBatch(db);
      usernameBatch.set(usernameDocRef, {
        uid: credential.user.uid,
        username,
        usernameLower,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await usernameBatch.commit();
    } catch (error) {
      try {
        const uid = String(credential?.user?.uid || "").trim();
        if (uid) {
          const cleanupBatch = writeBatch(db);
          cleanupBatch.delete(doc(db, "users", uid));
          cleanupBatch.delete(doc(db, "publicProfiles", uid));
          cleanupBatch.delete(doc(db, "usernames", usernameLower));
          await cleanupBatch.commit();
        }
      } catch {
      }
      try {
        await deleteUser(credential.user);
      } catch {
      }
      const code = String(error?.code || "");
      if (code === "permission-denied") {
        errorMessage.textContent = "Ten login jest już zajęty. Wybierz inny.";
      } else if (error.code === "unavailable" || error.code === "failed-precondition") {
        errorMessage.textContent =
          "Firebase Firestore jest chwilowo niedostępny. Spróbuj ponownie za moment.";
      } else {
        errorMessage.textContent = `Nie udało się zapisać konta w Firebase (Firestore): ${error.message}`;
      }
      errorMessage.style.display = "block";
      return;
    }

    registrationCompleted = true;
    if (submitBtn) submitBtn.disabled = true;

    let verificationSent = false;
    let verificationError = null;
    try {
      await sendEmailVerification(credential.user);
      verificationSent = true;
    } catch (error) {
      verificationError = error;
      console.error("Błąd wysyłki maila weryfikacyjnego:", error);
    }

    try {
      await signOut(auth);
    } catch {
    }

    localStorage.removeItem("loggedInUser");
    localStorage.removeItem("authUser");
    localStorage.removeItem("userRole");

    const errorCode = String(verificationError?.code || "");
    const hint =
      errorCode === "auth/too-many-requests"
        ? "Za dużo prób — spróbuj ponownie za chwilę."
        : verificationError?.message
          ? String(verificationError.message)
          : "";

    successMessage.textContent = verificationSent
      ? "Konto utworzone! Wyslaliśmy link weryfikacyjny na e-mail (sprawdź spam). Po kliknięciu linku zaloguj się."
      : `Konto utworzone, ale nie udało się wysłać maila weryfikacyjnego. ${hint}`.trim();
    successMessage.style.display = "block";

    window.setTimeout(() => {
      window.location.href = "login.html";
    }, 1200);
  });
});
