import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { auth, db } from "./firebase-config.js";
import { SURVEY } from "./ankieta-data.js";

const SUBMISSION_KEY = `surveySubmitted:${SURVEY.id}`;

const els = {
  eyebrow: document.getElementById("surveyEyebrow"),
  title: document.getElementById("surveyTitle"),
  lead: document.getElementById("surveyLead"),
  instruction: document.getElementById("surveyInstruction"),
  scaleText: document.getElementById("surveyScaleText"),
  currentUser: document.getElementById("currentUser"),
  loginCta: document.getElementById("loginCta"),
  form: document.getElementById("surveyForm"),
  questions: document.getElementById("surveyQuestions"),
  status: document.getElementById("surveyStatus"),
  hint: document.getElementById("surveyHint"),
  submit: document.getElementById("submitSurvey"),
  resultsSummary: document.getElementById("resultsSummary"),
  resultsGrid: document.getElementById("resultsGrid"),
};

const state = {
  loggedIn: false,
  username: "",
  uid: "",
  hasSubmitted: false,
  previousAnswers: null,
};

// Walidację robimy sami (żeby kliknięcie zawsze dawało czytelny komunikat),
// zamiast polegać na dymkach przeglądarki.
if (els.form) els.form.noValidate = true;

const safeText = (value) => String(value ?? "").trim();

const snippet = (value, maxLen = 120) => {
  const text = safeText(value);
  if (!text) return "";
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
};

const setStatus = (message, kind) => {
  if (!els.status) return;
  els.status.textContent = safeText(message);
  els.status.classList.remove("is-success", "is-error");
  if (kind === "success") els.status.classList.add("is-success");
  if (kind === "error") els.status.classList.add("is-error");
  els.status.style.display = message ? "inline" : "none";
};

const renderHeader = () => {
  els.eyebrow.textContent = safeText(SURVEY.eyebrow) || "Ankieta";
  els.title.textContent = safeText(SURVEY.title) || "Ankieta";
  els.lead.textContent = safeText(SURVEY.lead);
  els.instruction.textContent = safeText(SURVEY.instruction);
  els.scaleText.textContent = "Ta ankieta jest anonimowa — nie pokazujemy surowych odpowiedzi.";
};

const getAllQuestions = () =>
  SURVEY.sections.flatMap((section) =>
    (section.questions || []).map((q) => ({
      ...q,
      sectionId: section.id,
      sectionTitle: section.title,
      options:
        section.scaleId === "frequency"
          ? SURVEY.frequencyScale
          : Array.isArray(q.options)
            ? q.options
            : [],
    })),
  );

const getOptionIndex = (questionId, optionValue) => {
  const q = getAllQuestions().find((item) => item.id === questionId);
  if (!q) return -1;
  return (q.options || []).findIndex((o) => String(o) === String(optionValue));
};

const renderQuestions = () => {
  const questions = getAllQuestions();
  els.questions.innerHTML = "";

  const sectionOrder = SURVEY.sections.map((s) => s.id);
  const grouped = new Map(sectionOrder.map((id) => [id, []]));
  for (const q of questions) {
    if (!grouped.has(q.sectionId)) grouped.set(q.sectionId, []);
    grouped.get(q.sectionId).push(q);
  }

  for (const section of SURVEY.sections) {
    const items = grouped.get(section.id) || [];
    for (const q of items) {
      const card = document.createElement("div");
      card.className = "survey-question";

      const title = document.createElement("h3");
      title.textContent = safeText(q.text);
      card.appendChild(title);

      const optionsWrap = document.createElement("div");
      optionsWrap.className = "survey-options";

      (q.options || []).forEach((optText, idx) => {
        const label = document.createElement("label");
        label.className = "survey-option";

        const input = document.createElement("input");
        input.type = "radio";
        input.name = q.id;
        input.value = String(optText);
        input.setAttribute("aria-label", `${q.text} — ${optText}`);
        input.dataset.questionId = q.id;
        input.dataset.optionIndex = String(idx);

        const span = document.createElement("span");
        span.textContent = String(optText);

        label.appendChild(input);
        label.appendChild(span);
        optionsWrap.appendChild(label);
      });

      card.appendChild(optionsWrap);
      els.questions.appendChild(card);
    }
  }
};

const collectAnswers = () => {
  const questions = getAllQuestions();
  const answers = {};
  for (const q of questions) {
    if (!els.form) return { ok: false, error: "Brak formularza ankiety na stronie.", answers: {} };
    // q.id to proste wartości typu "q1", więc nie musimy używać CSS.escape (czasem bywa niedostępne).
    const picked = els.form.querySelector(`input[name="${q.id}"]:checked`);
    const value = safeText(picked?.value);
    if (!value) return { ok: false, error: "Uzupełnij wszystkie pytania.", answers: {} };
    answers[q.id] = value;
  }
  return { ok: true, answers };
};

const getRedirectLoginUrl = () => {
  const page = "ankieta.html";
  return `login.html?redirect=${encodeURIComponent(page)}`;
};

const checkAlreadySubmitted = async () => {
  if (!state.loggedIn || !state.uid) return false;
  const cached = safeText(localStorage.getItem(SUBMISSION_KEY));
  try {
    const ref = doc(db, "surveys", SURVEY.id, "submissions", state.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      localStorage.setItem(SUBMISSION_KEY, state.uid);
      const data = snap.data() || {};
      state.previousAnswers = data?.answers && typeof data.answers === "object" ? data.answers : null;
      return true;
    }
    if (cached === state.uid) localStorage.removeItem(SUBMISSION_KEY);
  } catch {
  }
  return false;
};

const applyAnswersToForm = (answers) => {
  if (!els.form || !answers || typeof answers !== "object") return;
  Object.entries(answers).forEach(([qid, val]) => {
    const value = safeText(val);
    if (!qid || !value) return;
    const input = els.form.querySelector(`input[type="radio"][name="${qid}"][value="${value}"]`);
    if (input) input.checked = true;
  });
};

const submitAnswers = async () => {
  if (!state.loggedIn) {
    window.location.assign(getRedirectLoginUrl());
    return;
  }

  if (!state.uid) {
    setStatus("Błąd sesji: brak UID. Odśwież stronę i zaloguj się ponownie.", "error");
    return;
  }

  if (!safeText(SURVEY?.id)) {
    setStatus("Błąd konfiguracji ankiety (brak ID).", "error");
    return;
  }

  const collected = collectAnswers();
  if (!collected.ok) {
    setStatus(collected.error, "error");
    return;
  }

  setStatus("Wysyłanie...", "");
  els.submit.disabled = true;
  const wasSubmitted = state.hasSubmitted;

  try {
    const statsCol = collection(db, "surveys", SURVEY.id, "stats");
    const metaRef = doc(statsCol, "_meta");
    const submissionRef = doc(db, "surveys", SURVEY.id, "submissions", state.uid);

    await runTransaction(db, async (tx) => {
      const existingSubmission = await tx.get(submissionRef);
      const hadSubmission = existingSubmission.exists();
      const existingData = existingSubmission.data() || {};
      if (hadSubmission && (!existingData?.answers || typeof existingData.answers !== "object")) {
        throw Object.assign(new Error("legacy-submission"), { code: "legacy-submission" });
      }
      const prevAnswers =
        hadSubmission && existingData?.answers && typeof existingData.answers === "object"
          ? existingData.answers
          : null;
      const createdAt = hadSubmission ? existingData.createdAt : serverTimestamp();

      const metaSnap = await tx.get(metaRef);
      if (!metaSnap.exists()) {
        throw Object.assign(new Error("missing-meta"), { code: "missing-meta" });
      }

      const metaData = metaSnap.data() || {};
      const currentTotal = Number(metaData.totalResponses ?? 0);
      if (!Number.isFinite(currentTotal)) {
        throw Object.assign(new Error("bad-meta"), { code: "bad-meta" });
      }

      // WAŻNE: w transakcjach Firestore wszystkie odczyty muszą być wykonane przed zapisami.
      // Najpierw zbieramy listę zmian i czytamy wszystkie dokumenty statystyk, a dopiero potem robimy set/update.
      const deltas = [];
      const statRefsToRead = new Map();

      for (const [qid, newValueRaw] of Object.entries(collected.answers)) {
        const newValue = safeText(newValueRaw);
        const oldValue = safeText(prevAnswers?.[qid]);
        if (!newValue) continue;
        if (oldValue && oldValue === newValue) continue;

        const newIdx = getOptionIndex(qid, newValue);
        if (newIdx >= 0) {
          const id = `${qid}_${newIdx}`;
          const ref = doc(statsCol, id);
          statRefsToRead.set(id, ref);
          deltas.push({ refId: id, ref, delta: 1 });
        }

        if (oldValue) {
          const oldIdx = getOptionIndex(qid, oldValue);
          if (oldIdx >= 0) {
            const id = `${qid}_${oldIdx}`;
            const ref = doc(statsCol, id);
            statRefsToRead.set(id, ref);
            deltas.push({ refId: id, ref, delta: -1 });
          }
        }
      }

      const currentCounts = new Map();
      for (const [id, ref] of statRefsToRead.entries()) {
        const snap = await tx.get(ref);
        if (!snap.exists()) throw Object.assign(new Error("missing-stats"), { code: "missing-stats" });
        const data = snap.data() || {};
        const cur = Number(data.count ?? 0);
        if (!Number.isFinite(cur)) throw Object.assign(new Error("bad-stats"), { code: "bad-stats" });
        currentCounts.set(id, Math.trunc(cur));
      }

      // 1) Zapisz/aktualizuj prywatne odpowiedzi użytkownika (żeby reguły mogły sprawdzić delta w stats).
      tx.set(
        submissionRef,
        {
          uid: state.uid,
          answers: collected.answers,
          createdAt,
          updatedAt: serverTimestamp(),
        },
        { merge: false },
      );

      // 2) Jeśli to pierwsze wypełnienie, podbij licznik uczestników.
      if (!hadSubmission) {
        tx.update(metaRef, {
          totalResponses: Math.max(0, Math.trunc(currentTotal)) + 1,
          updatedAt: serverTimestamp(),
        });
      }

      // 3) Zaktualizuj statystyki (+1 dla nowych, -1 dla starych).
      for (const change of deltas) {
        const cur = Number(currentCounts.get(change.refId) ?? 0);
        const next = Math.max(0, Math.trunc(cur) + Number(change.delta));
        tx.update(change.ref, { count: next, updatedAt: serverTimestamp() });
      }
    });
    state.hasSubmitted = true;
    state.previousAnswers = collected.answers;
    localStorage.setItem(SUBMISSION_KEY, state.uid);
    setStatus(wasSubmitted ? "Zapisano zmiany." : "Dzięki! Odpowiedzi zapisane.", "success");
  } catch (err) {
    const code = String(err?.code || "");
    const msg = String(err?.message || "");
    if (code === "permission-denied") {
      setStatus("Brak uprawnień (sprawdź, czy wdrożyłeś reguły Firestore).", "error");
    } else if (code === "missing-stats" || code === "missing-meta" || msg.includes("No document to update") || msg.includes("missing")) {
      setStatus(
        "Wyniki ankiety nie są jeszcze zainicjalizowane. Zaloguj się na konto admina i w Panelu admina zrób reset/inizjalizację ankiety.",
        "error",
      );
    } else if (code === "legacy-submission") {
      setStatus(
        "Ta ankieta była aktualizowana. Poproś admina o reset ankiety (żeby można było zmieniać odpowiedzi bez psucia statystyk).",
        "error",
      );
    } else if (code === "unauthenticated") {
      setStatus("Sesja wygasła. Zaloguj się ponownie i spróbuj jeszcze raz.", "error");
    } else if (code === "unavailable") {
      setStatus("Serwer chwilowo niedostępny. Spróbuj ponownie za chwilę.", "error");
    } else if (code === "failed-precondition") {
      setStatus("Nie udało się zapisać (błąd warunków). Odśwież stronę i spróbuj ponownie.", "error");
    } else if (code === "invalid-argument") {
      const details = snippet(msg, 140);
      setStatus(
        `Nie udało się zapisać. Spróbuj ponownie. (kod: invalid-argument)${details ? ` — ${details}` : ""}`,
        "error",
      );
    } else {
      const suffix = code ? ` (kod: ${code})` : "";
      const extra = snippet(msg, 140);
      setStatus(
        `Nie udało się zapisać. Spróbuj ponownie.${suffix}${extra ? ` — ${extra}` : ""}`,
        "error",
      );
    }
    console.error(err);
  } finally {
    els.submit.disabled = false;
  }
};

const sumCounts = (countsMap) =>
  Object.values(countsMap || {}).reduce((acc, val) => acc + (Number(val) || 0), 0);

const renderAggregateCard = (titleText, subtitleText, totalsMap, denominator) => {
  const box = document.createElement("div");
  box.className = "result-question";

  const head = document.createElement("div");
  head.className = "result-head";

  const title = document.createElement("h3");
  title.textContent = safeText(titleText);

  const subtitle = document.createElement("p");
  subtitle.textContent = safeText(subtitleText);

  head.appendChild(title);
  if (subtitle.textContent) head.appendChild(subtitle);
  box.appendChild(head);

  const options = Object.keys(totalsMap || {});
  for (const opt of options) {
    const row = document.createElement("div");
    row.className = "result-row";

    const label = document.createElement("div");
    label.textContent = String(opt);

    const bar = document.createElement("div");
    bar.className = "bar";
    const fill = document.createElement("div");
    const value = Number(totalsMap?.[opt] ?? 0);
    const pct = denominator > 0 ? (value / denominator) * 100 : 0;
    fill.style.width = `${pct.toFixed(1)}%`;
    bar.appendChild(fill);

    const count = document.createElement("div");
    count.className = "result-count";
    count.textContent = `${denominator > 0 ? pct.toFixed(0) : "0"}% (${value})`;

    row.appendChild(label);
    row.appendChild(bar);
    row.appendChild(count);
    box.appendChild(row);
  }

  return box;
};

const buildCountsFromStatsDocs = (docs) => {
  const questions = getAllQuestions();
  const counts = {};
  questions.forEach((q) => {
    counts[q.id] = {};
    (q.options || []).forEach((opt) => {
      counts[q.id][opt] = 0;
    });
  });

  docs.forEach((data) => {
    const qid = safeText(data?.qid);
    const optionIndex = Number(data?.optionIndex);
    const count = Number(data?.count ?? 0);
    if (!qid || !Number.isFinite(optionIndex) || optionIndex < 0) return;
    const q = questions.find((qq) => qq.id === qid);
    if (!q) return;
    const opt = q.options?.[optionIndex];
    if (!opt) return;
    counts[qid][opt] = count;
  });

  return counts;
};

const renderResults = (counts, totalResponses) => {
  const questions = getAllQuestions();
  els.resultsGrid.innerHTML = "";

  els.resultsSummary.innerHTML = "";
  const summaryLeft = document.createElement("div");
  summaryLeft.textContent = `Łącznie odpowiedzi: ${totalResponses}`;
  const summaryRight = document.createElement("div");
  summaryRight.textContent = "";
  els.resultsSummary.appendChild(summaryLeft);
  els.resultsSummary.appendChild(summaryRight);

  questions.forEach((q, idx) => {
    const perQuestionCounts = counts?.[q.id] || {};
    els.resultsGrid.appendChild(
      renderAggregateCard(
        `Pytanie ${idx + 1}`,
        q.text,
        perQuestionCounts,
        sumCounts(perQuestionCounts),
      ),
    );
  });
};

const wireResultsListener = () => {
  const col = collection(db, "surveys", SURVEY.id, "stats");
  onSnapshot(
    col,
    (snap) => {
      let metaTotal = 0;
      const statDocs = [];
      snap.forEach((docSnap) => {
        if (docSnap.id === "_meta") {
          metaTotal = Number(docSnap.data()?.totalResponses ?? 0);
          return;
        }
        statDocs.push(docSnap.data());
      });
      const counts = buildCountsFromStatsDocs(statDocs);
      renderResults(counts, metaTotal);
    },
    (err) => {
      console.error(err);
      setStatus("Nie udało się pobrać wyników.", "error");
    },
  );
};

const syncAuthUi = (user) => {
  state.loggedIn = Boolean(user);
  state.uid = safeText(user?.uid);
  state.username = safeText(
    localStorage.getItem("loggedInUser") || localStorage.getItem("authUser") || "",
  );

  if (els.currentUser) {
    els.currentUser.textContent = state.loggedIn ? state.username || "Użytkownik" : "Gość";
  }
  if (els.loginCta) {
    els.loginCta.style.display = state.loggedIn ? "none" : "inline-flex";
    els.loginCta.setAttribute("href", getRedirectLoginUrl());
  }
  if (els.submit) {
    els.submit.disabled = !state.loggedIn;
    els.submit.textContent = state.hasSubmitted ? "Zapisz zmiany" : "Wyślij odpowiedzi";
  }
  if (els.hint) {
    els.hint.textContent = state.loggedIn
      ? state.hasSubmitted
        ? "Możesz zmienić odpowiedzi i zapisać ponownie."
        : "Twoje odpowiedzi zapiszą się anonimowo."
      : "Aby wysłać odpowiedzi, zaloguj się.";
  }
};

renderHeader();
renderQuestions();
syncAuthUi(auth.currentUser);
wireResultsListener();

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  submitAnswers();
});

if (els.submit) {
  els.submit.addEventListener("click", () => {
    const collected = collectAnswers();
    if (!collected.ok) setStatus(collected.error, "error");
  });
}

window.addEventListener("authsession:changed", (event) => {
  const detail = event?.detail || {};
  syncAuthUi(detail.loggedIn ? auth.currentUser : null);
});

onAuthStateChanged(auth, (user) => {
  syncAuthUi(user);
  if (!user) {
    state.hasSubmitted = false;
    state.previousAnswers = null;
    return;
  }
  checkAlreadySubmitted()
    .then((done) => {
      state.hasSubmitted = done;
      applyAnswersToForm(state.previousAnswers);
      syncAuthUi(user);
    })
    .catch(() => {
    });
});
