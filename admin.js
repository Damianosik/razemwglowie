import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  addDoc,
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  writeBatch,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ADMIN_EMAIL_ALLOWLIST, auth, db } from "./firebase-config.js";
import { SURVEY } from "./ankieta-data.js";

document.addEventListener("DOMContentLoaded", () => {
  const manager = window.UserManager;
  if (!manager) {
    window.location.href = "index.html";
    return;
  }

  const announcementForm = document.getElementById("announcementForm");
  const announcementMessage = document.getElementById("announcementMessage");
  const announcementStart = document.getElementById("announcementStart");
  const announcementEnd = document.getElementById("announcementEnd");
  const publishAnnouncementBtn = document.getElementById("publishAnnouncementBtn");
  const deleteAnnouncementBtn = document.getElementById("deleteAnnouncementBtn");
  const announcementStatus = document.getElementById("announcementStatus");
  const currentAnnouncement = document.getElementById("currentAnnouncement");
  const surveyResetForm = document.getElementById("surveyResetForm");
  const surveyResetConfirm = document.getElementById("surveyResetConfirm");
  const surveyResetBtn = document.getElementById("surveyResetBtn");
  const surveyResetStatus = document.getElementById("surveyResetStatus");
  let currentAnnouncementId = "";
  let initialized = false;
  let selfUid = "";

  const isAdminUser = async (user) => {
    if (!user) return false;
    const email = String(user.email || "").trim().toLowerCase();
    if (email && ADMIN_EMAIL_ALLOWLIST.includes(email)) return true;
    try {
      const token = await user.getIdTokenResult();
      return token?.claims?.admin === true;
    } catch {
      return false;
    }
  };

  const setAnnStatus = (text) => {
    if (!announcementStatus) return;
    announcementStatus.textContent = String(text || "");
  };

  const setSurveyStatus = (text) => {
    if (!surveyResetStatus) return;
    surveyResetStatus.textContent = String(text || "");
  };

  const getSurveyQuestions = () =>
    SURVEY.sections.flatMap((section) =>
      (section.questions || []).map((q) => ({
        id: q.id,
        options:
          section.scaleId === "frequency"
            ? SURVEY.frequencyScale
            : Array.isArray(q.options)
              ? q.options
              : [],
      })),
    );

  const toTimestampOrNull = (inputValue) => {
    const raw = String(inputValue || "").trim();
    if (!raw) return null;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) return null;
    return Timestamp.fromDate(d);
  };

  try {
    const q = query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(3));
    onSnapshot(
      q,
      (snap) => {
        currentAnnouncementId = "";
        if (!currentAnnouncement) return;
        if (snap.empty) {
          currentAnnouncement.textContent = "Brak";
          return;
        }
        let picked = null;
        snap.forEach((docSnap) => {
          if (picked) return;
          const data = docSnap.data() || {};
          const msg = String(data.message || "").trim();
          if (!msg) return;
          picked = { id: docSnap.id, message: msg };
        });
        if (!picked) {
          currentAnnouncement.textContent = "Brak";
          return;
        }
        currentAnnouncementId = picked.id;
        currentAnnouncement.textContent = picked.message;
      },
      () => {
      },
    );
  } catch {
  }

  const countAll = document.getElementById("countAll");
  const countOnline = document.getElementById("countOnline");
  const countOffline = document.getElementById("countOffline");
  const countBlocked = document.getElementById("countBlocked");
  const countBanned = document.getElementById("countBanned");
  const statusFilter = document.getElementById("statusFilter");
  const searchUsers = document.getElementById("searchUsers");
  const refreshBtn = document.getElementById("refreshBtn");
  const usersTableBody = document.getElementById("usersTableBody");
  const tableNote = document.getElementById("tableNote");

  const escapeHtml = (value) =>
    String(value || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");

  const formatDate = (iso) => {
    if (!iso) return "-";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "-";
    return date.toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const toIsoFromFirestore = (value) => {
    if (!value) return "";
    if (typeof value?.toDate === "function") {
      const converted = value.toDate();
      return Number.isNaN(converted.getTime()) ? "" : converted.toISOString();
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toISOString();
  };

  const normalizeBan = (ban) => {
    if (!ban || typeof ban !== "object") return null;
    const untilIso = toIsoFromFirestore(ban.until);
    return {
      permanent: Boolean(ban.permanent),
      until: untilIso || null,
      reason: String(ban.reason || "").trim(),
      createdAt: toIsoFromFirestore(ban.createdAt) || new Date().toISOString(),
    };
  };

  const getActiveBan = (ban) => {
    const normalized = normalizeBan(ban);
    if (!normalized) return null;
    if (normalized.permanent) return normalized;
    if (!normalized.until) return null;
    const untilMs = new Date(normalized.until).getTime();
    if (Number.isNaN(untilMs)) return null;
    if (untilMs > Date.now()) return normalized;
    return null;
  };

  const toIso = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  const minutesMs = (min) => Math.max(0, Number(min) || 0) * 60 * 1000;
  const hoursMs = (h) => minutesMs((Number(h) || 0) * 60);
  const daysMs = (d) => hoursMs((Number(d) || 0) * 24);

  const applyTimedBan = async (uid, durationMs, promptLabel) => {
    const reason = window.prompt(promptLabel || "Powód bana (opcjonalnie):", "") || "";
    const until = new Date(Date.now() + Math.max(0, Number(durationMs) || 0));
    await updateDoc(doc(db, "users", uid), {
      ban: {
        permanent: false,
        until,
        reason: reason.trim(),
        createdAt: new Date(),
      },
      updatedAt: serverTimestamp(),
    });
  };

  const syncLocalRecord = (row) => {
    const users = manager.readUsers();
    const idx = users.findIndex(
      (user) => manager.normalizeUsername(user.username) === manager.normalizeUsername(row.username),
    );

    const record = {
      username: row.username,
      email: row.email,
      role: row.role,
      isBlocked: row.isBlocked,
      ban: row.activeBan,
      createdAt: row.createdAt || new Date().toISOString(),
    };

    if (idx >= 0) {
      users[idx] = { ...users[idx], ...record };
    } else {
      users.push(record);
    }
    manager.saveUsers(users);
  };

  const fetchFirestoreUsers = async () => {
    const snap = await getDocs(collection(db, "users"));
    const presence = manager.readPresenceMap();
    const rows = snap.docs.map((docSnap) => {
      const data = docSnap.data() || {};
      const username = String(data.username || "").trim();
      const email = String(data.email || "").trim();
      const emailLower = email.toLowerCase();
      const roleFromDoc = String(data.role || "user").toLowerCase() === "admin" ? "admin" : "user";
      const role = emailLower && ADMIN_EMAIL_ALLOWLIST.includes(emailLower) ? "admin" : roleFromDoc;
      const key = manager.normalizeUsername(username);
      const presenceEntry = presence[key] || null;
      const ban = getActiveBan(data.ban);
      const createdAt = toIsoFromFirestore(data.createdAt);
      const lastLoginAt = toIsoFromFirestore(data.lastLoginAt);

      return {
        id: docSnap.id,
        username,
        email,
        role,
        isBlocked: Boolean(data.isBlocked),
        activeBan: ban,
        online: manager.isOnline(username),
        lastSeen: presenceEntry?.lastSeen || presenceEntry?.updatedAt || lastLoginAt || createdAt || "",
        createdAt,
      };
    });

    const hasAdminAccount = rows.some((row) => manager.normalizeUsername(row.username) === "admin");
    if (!hasAdminAccount) {
      const adminPresence = presence.admin || null;
      rows.unshift({
        id: "virtual-admin",
        username: "admin",
        email: "konto systemowe",
        role: "admin",
        isBlocked: false,
        activeBan: null,
        online: manager.isOnline("admin"),
        lastSeen: adminPresence?.lastSeen || adminPresence?.updatedAt || "",
        createdAt: "",
        isVirtualAdmin: true,
      });
    }

    rows.forEach((row) => {
      if (!row.isVirtualAdmin) {
        syncLocalRecord(row);
      }
    });

    return rows;
  };

  const applyFilter = (rows) => {
    const mode = statusFilter.value;
    const query = searchUsers.value.trim().toLowerCase();
    return rows.filter((row) => {
      if (mode === "online" && !row.online) return false;
      if (mode === "offline" && row.online) return false;
      if (mode === "blocked" && !row.isBlocked) return false;
      if (mode === "banned" && !row.activeBan) return false;
      if (!query) return true;
      return (
        String(row.username || "").toLowerCase().includes(query) ||
        String(row.email || "").toLowerCase().includes(query)
      );
    });
  };

  const updateStats = (rows) => {
    const online = rows.filter((row) => row.online).length;
    const blocked = rows.filter((row) => row.isBlocked).length;
    const banned = rows.filter((row) => row.activeBan).length;
    countAll.textContent = String(rows.length);
    countOnline.textContent = String(online);
    countOffline.textContent = String(rows.length - online);
    countBlocked.textContent = String(blocked);
    countBanned.textContent = String(banned);
  };

  const createActionButton = (label, onClick, options = {}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (options.danger) button.classList.add("danger");
    if (options.disabled) button.disabled = true;
    if (!options.disabled) button.addEventListener("click", onClick);
    return button;
  };

  const performAndRefresh = async (action) => {
    try {
      if (refreshBtn) refreshBtn.disabled = true;
      await action();
    } catch (error) {
      window.alert(`Błąd operacji Firebase: ${error.message}`);
    } finally {
      if (refreshBtn) refreshBtn.disabled = false;
      renderRows();
    }
  };

  let renderRunId = 0;
  const renderRows = async () => {
    const runId = ++renderRunId;
    usersTableBody.innerHTML = "";
    tableNote.textContent = "Ładowanie użytkowników z Firebase...";
    if (refreshBtn) refreshBtn.disabled = true;

    let rows;
    try {
      rows = await fetchFirestoreUsers();
    } catch (error) {
      if (runId !== renderRunId) return;
      updateStats([]);
      tableNote.textContent = `Nie udało się pobrać użytkowników z Firebase: ${error.message}`;
      if (refreshBtn) refreshBtn.disabled = false;
      return;
    }
    if (runId !== renderRunId) return;

    updateStats(rows);
    const filtered = applyFilter(rows);

    if (filtered.length === 0) {
      tableNote.textContent = "Brak wyników dla aktualnego filtra.";
      if (refreshBtn) refreshBtn.disabled = false;
      return;
    }

    tableNote.textContent =
      "Uzytkownicy sa pobierani z Firebase (kolekcja users), status online jest lokalny i odswiezany cyklicznie.";

    filtered.forEach((row) => {
      const tr = document.createElement("tr");

      const tdUser = document.createElement("td");
      const userName = document.createElement("strong");
      userName.textContent = row.username || "-";
      const userMail = document.createElement("span");
      userMail.className = "mail";
      userMail.textContent = row.email || "-";
      tdUser.appendChild(userName);
      tdUser.appendChild(userMail);

      const tdRole = document.createElement("td");
      tdRole.textContent = row.role === "admin" ? "admin" : "user";

      const tdStatus = document.createElement("td");
      const status = document.createElement("span");
      status.className = `status-pill ${row.online ? "online" : "offline"}`;
      status.textContent = row.online ? "online" : "offline";
      tdStatus.appendChild(status);

      const tdBan = document.createElement("td");
      const banLines = [];
      if (row.isBlocked) {
        banLines.push('<span class="blocked-text">Konto zablokowane</span>');
      }
      if (row.activeBan) {
        if (row.activeBan.permanent) {
          banLines.push('<span class="banned-text">Ban staly</span>');
        } else {
          banLines.push(
            `<span class="banned-text">Ban do ${formatDate(row.activeBan.until)}</span>`,
          );
        }
        if (row.activeBan.reason) {
          banLines.push(`<span class="mail">Powod: ${escapeHtml(row.activeBan.reason)}</span>`);
        }
      }
      tdBan.innerHTML = banLines.length > 0 ? banLines.join("<br>") : "-";

      const tdLast = document.createElement("td");
      tdLast.textContent = formatDate(row.lastSeen);

      const tdActions = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "actions";

      const isSelf = Boolean(selfUid) && row.id === selfUid;
      const isAdminRow = row.role === "admin";
      const lockActions = isSelf || isAdminRow || row.isVirtualAdmin;

      actions.appendChild(
        createActionButton(
          row.isBlocked ? "Odblokuj" : "Zablokuj",
          () =>
            performAndRefresh(async () => {
              await updateDoc(doc(db, "users", row.id), {
                isBlocked: !row.isBlocked,
                updatedAt: serverTimestamp(),
              });
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 15 min",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, minutesMs(15), "Powód bana 15 min (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 30 min",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, minutesMs(30), "Powód bana 30 min (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 1 godz.",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, hoursMs(1), "Powód bana 1 godz. (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 1 dzień",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, daysMs(1), "Powód bana 1 dzień (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 3 dni",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, daysMs(3), "Powód bana 3 dni (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban 7 dni",
          () =>
            performAndRefresh(async () => {
              await applyTimedBan(row.id, daysMs(7), "Powód bana 7 dni (opcjonalnie):");
            }),
          { disabled: lockActions },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Ban staly",
          () =>
            performAndRefresh(async () => {
              const reason = window.prompt("Powód bana stałego (opcjonalnie):", "") || "";
              await updateDoc(doc(db, "users", row.id), {
                ban: {
                  permanent: true,
                  until: null,
                  reason: reason.trim(),
                  createdAt: new Date(),
                },
                updatedAt: serverTimestamp(),
              });
            }),
          { disabled: lockActions, danger: true },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Zdejmij bana",
          () =>
            performAndRefresh(async () => {
              await updateDoc(doc(db, "users", row.id), {
                ban: null,
                updatedAt: serverTimestamp(),
              });
            }),
          { disabled: lockActions || !row.activeBan },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Przywroc konto",
          () =>
            performAndRefresh(async () => {
              const ok = window.confirm(`Przywrocic konto ${row.username}? (usunie blokade i bana)`);
              if (!ok) return;
              await updateDoc(doc(db, "users", row.id), {
                isBlocked: false,
                ban: null,
                updatedAt: serverTimestamp(),
              });
            }),
          { disabled: lockActions || (!row.isBlocked && !row.activeBan) },
        ),
      );

      actions.appendChild(
        createActionButton(
          "Dezaktywuj konto",
          () =>
            performAndRefresh(async () => {
              const ok = window.confirm(
                `Dezaktywowac konto ${row.username}? (ustawi blokade i bana stalego)`,
              );
              if (!ok) return;
              const reason = window.prompt("Powod dezaktywacji (opcjonalnie):", "") || "";
              await updateDoc(doc(db, "users", row.id), {
                isBlocked: true,
                ban: {
                  permanent: true,
                  until: null,
                  reason: reason.trim(),
                  createdAt: new Date(),
                },
                updatedAt: serverTimestamp(),
              });
            }),
          { disabled: lockActions, danger: true },
        ),
      );

      tdActions.appendChild(actions);

      tr.appendChild(tdUser);
      tr.appendChild(tdRole);
      tr.appendChild(tdStatus);
      tr.appendChild(tdBan);
      tr.appendChild(tdLast);
      tr.appendChild(tdActions);
      usersTableBody.appendChild(tr);
    });

    if (refreshBtn) refreshBtn.disabled = false;
  };

  statusFilter.addEventListener("change", () => {
    renderRows();
  });
  searchUsers.addEventListener("input", () => {
    renderRows();
  });
  refreshBtn.addEventListener("click", () => {
    renderRows();
  });
  window.addEventListener("storage", () => {
    renderRows();
  });

  const initAdmin = (user) => {
    if (initialized) return;
    initialized = true;
    selfUid = String(user?.uid || "").trim();

    const presenceName =
      (typeof manager.getSessionUser === "function" && manager.getSessionUser()) ||
      String(user?.email || "").split("@")[0] ||
      "";
    if (presenceName) manager.startPresenceTracking(presenceName, "admin.html");

    if (announcementForm) {
      announcementForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setAnnStatus("");

        const message = String(announcementMessage?.value || "").trim();
        if (!message) {
          setAnnStatus("Wpisz treść ogłoszenia.");
          return;
        }

        const startsAt = toTimestampOrNull(announcementStart?.value);
        const endsAt = toTimestampOrNull(announcementEnd?.value);
        if (startsAt && endsAt && endsAt.toMillis() < startsAt.toMillis()) {
          setAnnStatus("Koniec nie może być wcześniej niż start.");
          return;
        }

        if (publishAnnouncementBtn) publishAnnouncementBtn.disabled = true;
        try {
          const payload = {
            message: message.slice(0, 220),
            startsAt,
            endsAt,
            createdAt: serverTimestamp(),
            createdByUid: user.uid,
          };
          await addDoc(collection(db, "announcements"), payload);
          setAnnStatus("Opublikowano ogłoszenie.");
          if (announcementMessage) announcementMessage.value = "";
        } catch (err) {
          console.error("Błąd publikacji ogłoszenia:", err);
          setAnnStatus("Nie udało się opublikować. Sprawdź reguły Firestore.");
        } finally {
          if (publishAnnouncementBtn) publishAnnouncementBtn.disabled = false;
        }
      });
    }

    if (deleteAnnouncementBtn) {
      deleteAnnouncementBtn.addEventListener("click", async () => {
        setAnnStatus("");
        if (!currentAnnouncementId) {
          setAnnStatus("Brak ogłoszenia do usunięcia.");
          return;
        }
        const ok = window.confirm("Usunąć aktualne ogłoszenie?");
        if (!ok) return;
        deleteAnnouncementBtn.disabled = true;
        try {
          await deleteDoc(doc(db, "announcements", currentAnnouncementId));
          setAnnStatus("Usunięto ogłoszenie.");
        } catch (err) {
          console.error("Błąd usuwania ogłoszenia:", err);
          setAnnStatus("Nie udało się usunąć. Sprawdź uprawnienia.");
        } finally {
          deleteAnnouncementBtn.disabled = false;
        }
      });
    }

    if (surveyResetForm) {
      surveyResetForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        setSurveyStatus("");

        const typed = String(surveyResetConfirm?.value || "").trim().toUpperCase();
        if (typed !== "RESET") {
          setSurveyStatus("Wpisz RESET, żeby potwierdzić.");
          return;
        }

        const ok = window.confirm(
          "Na pewno zresetować wyniki ankiety? To usunie WSZYSTKIE odpowiedzi.",
        );
        if (!ok) return;

        if (surveyResetBtn) surveyResetBtn.disabled = true;
        if (surveyResetConfirm) surveyResetConfirm.disabled = true;

        const statsCol = collection(db, "surveys", SURVEY.id, "stats");
        const submissionsCol = collection(db, "surveys", SURVEY.id, "submissions");
        const responsesCol = collection(db, "surveys", SURVEY.id, "responses");

        let deletedSubmissions = 0;
        let deletedResponses = 0;

        try {
          setSurveyStatus("Resetowanie statystyk ankiety...");
          const batch = writeBatch(db);
          const now = serverTimestamp();
          batch.set(
            doc(statsCol, "_meta"),
            { totalResponses: 0, createdAt: now, updatedAt: now },
            { merge: false },
          );

          getSurveyQuestions().forEach((q) => {
            (q.options || []).forEach((label, optionIndex) => {
              const id = `${q.id}_${optionIndex}`;
              batch.set(
                doc(statsCol, id),
                {
                  qid: q.id,
                  optionIndex,
                  label: String(label),
                  count: 0,
                  createdAt: now,
                  updatedAt: now,
                },
                { merge: false },
              );
            });
          });
          await batch.commit();

          while (true) {
            setSurveyStatus(`Usuwanie zgłoszeń... (${deletedSubmissions})`);
            const snap = await getDocs(query(submissionsCol, orderBy("__name__"), limit(200)));
            if (snap.empty) break;
            const b = writeBatch(db);
            snap.forEach((docSnap) => b.delete(docSnap.ref));
            await b.commit();
            deletedSubmissions += snap.size;
          }

          while (true) {
            setSurveyStatus(`Czyszczenie starych odpowiedzi... (${deletedResponses})`);
            const snap = await getDocs(query(responsesCol, orderBy("__name__"), limit(200)));
            if (snap.empty) break;
            const b = writeBatch(db);
            snap.forEach((docSnap) => b.delete(docSnap.ref));
            await b.commit();
            deletedResponses += snap.size;
          }

          setSurveyStatus(
            `Zresetowano ankietę. Statystyki = 0. Usunięto zgłoszeń: ${deletedSubmissions}, starych odpowiedzi: ${deletedResponses}.`,
          );
          if (surveyResetConfirm) surveyResetConfirm.value = "";
        } catch (err) {
          console.error("Błąd resetu ankiety:", err);
          setSurveyStatus("Nie udało się zresetować. Sprawdź reguły Firestore.");
        } finally {
          if (surveyResetBtn) surveyResetBtn.disabled = false;
          if (surveyResetConfirm) surveyResetConfirm.disabled = false;
        }
      });
    }

    renderRows();
  };

  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    isAdminUser(user).then((ok) => {
      if (!ok) {
        window.location.replace("index.html");
        return;
      }
      initAdmin(user);
    });
  });
});
