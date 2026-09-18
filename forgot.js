import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { auth } from "./firebase-config.js";

const emailForm = document.getElementById("emailForm");
const emailInput = document.getElementById("email");
const errorDiv = document.getElementById("errorMessage");
const successDiv = document.getElementById("successMessage");
const instruction = document.getElementById("instructionText");
const resetBtn = document.getElementById("resetBtn");

const setError = (text) => {
  if (!errorDiv || !successDiv) return;
  errorDiv.textContent = String(text || "");
  errorDiv.style.display = text ? "block" : "none";
  successDiv.style.display = "none";
};

const setSuccess = (text) => {
  if (!errorDiv || !successDiv) return;
  successDiv.textContent = String(text || "");
  successDiv.style.display = text ? "block" : "none";
  errorDiv.style.display = "none";
};

if (emailForm) {
  emailForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = String(emailInput?.value || "").trim();

    if (!email) {
      setError("Podaj adres e-mail.");
      return;
    }

    setError("");
    setSuccess("Wysylanie linku...");
    if (resetBtn) resetBtn.disabled = true;

    const actionCodeSettings = {
      url: new URL("reset-password.html", window.location.href).toString(),
      handleCodeInApp: true,
    };

    try {
      await sendPasswordResetEmail(auth, email, actionCodeSettings);
      if (emailForm) emailForm.style.display = "none";
      if (instruction) instruction.style.display = "none";
      setSuccess("Pomyślnie wysłano link do resetowania hasła. Sprawdź też SPAM.");
    } catch (error) {
      const code = String(error?.code || "");

      if (code === "auth/user-not-found") {
        setError("Nie znaleziono konta z tym adresem e-mail.");
      } else if (code === "auth/invalid-email") {
        setError("Wpisany adres e-mail jest niepoprawny.");
      } else if (code === "auth/too-many-requests") {
        setError("Za dużo prób. Spróbuj ponownie za chwilę.");
      } else if (code === "auth/network-request-failed") {
        setError("Brak połączenia z internetem. Spróbuj ponownie.");
      } else if (code === "auth/unauthorized-domain") {
        setError("Domena nieautoryzowana w Firebase Auth (dodaj ją w konsoli).");
      } else {
        setError(`Wystąpił błąd: ${error?.message || "Nieznany błąd."}`);
      }
      setSuccess("");
    } finally {
      if (resetBtn) resetBtn.disabled = false;
    }
  });
}
