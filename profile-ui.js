const UID_KEY = "authUid";
const USER_KEY = "loggedInUser";
const NICK_KEY = "profileNick";
const AVATAR_COLOR_KEY = "profileAvatar";
const PHOTO_URL_KEY = "authPhotoURL";
const THEME_KEY = "profileTheme";
const ANON_KEY = "profileAnon";
const ANON_NICK_KEY = "profileAnonNick";
const REAL_NICK_KEY = "profileRealNick";
const ANON_COUNTER_KEY = "profileAnonCounter";
const REDUCE_MOTION_KEY = "profileReduceMotion";
const EMAIL_NOTIFS_KEY = "profileEmailNotifs";
const EMAIL_ADDR_KEY = "profileEmailAddress";
const NOTIFS_LIMIT = 25;
const ANNOUNCEMENTS_LIMIT = 3;

const randomFourDigits = () => {
  try {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const n = 1000 + (buf[0] % 9000);
    return String(n);
  } catch {
    const n = 1000 + Math.floor(Math.random() * 9000);
    return String(n);
  }
};

const getGreeting = () => "Witaj";

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

const isLoggedIn = () => Boolean(String(localStorage.getItem(UID_KEY) || "").trim());

const getDisplayName = () => {
  const anon = String(localStorage.getItem(ANON_KEY) || "").trim() === "on";
  if (anon) {
    const current = String(localStorage.getItem(ANON_NICK_KEY) || "").trim();
    const m = current.match(/^Anonimowy\s+(\d+)$/i);
    const digits = m ? String(m[1] || "") : "";
    if (!current || (m && digits.length !== 4)) {
      const next = `Anonimowy ${randomFourDigits()}`;
      localStorage.setItem(ANON_NICK_KEY, next);
      return next;
    }
    return current;
  }
  if (isLoggedIn()) {
    const fromAuth = String(localStorage.getItem(USER_KEY) || "").trim();
    if (fromAuth) return fromAuth;
  }
  const nick = String(localStorage.getItem(NICK_KEY) || "").trim();
  return nick || "Gość";
};

const applyPrefs = () => {
  const theme = String(localStorage.getItem(THEME_KEY) || "").trim();
  if (theme === "dark") document.body.classList.remove("light-mode");
  else document.body.classList.add("light-mode");

  const reduce = String(localStorage.getItem(REDUCE_MOTION_KEY) || "").trim();
  if (reduce === "on") document.body.classList.add("reduce-motion");
  else document.body.classList.remove("reduce-motion");
};

const getEmailAddrStorageKey = () => {
  const uid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (!uid) return "";
  return `${EMAIL_ADDR_KEY}:${uid}`;
};

const resetPrefs = () => {
  const restore =
    String(localStorage.getItem(REAL_NICK_KEY) || "").trim() ||
    String(localStorage.getItem(NICK_KEY) || "").trim() ||
    String(localStorage.getItem(USER_KEY) || "").trim() ||
    "Gość";

  localStorage.removeItem(THEME_KEY);
  localStorage.removeItem(REDUCE_MOTION_KEY);
  localStorage.removeItem(EMAIL_NOTIFS_KEY);
  localStorage.removeItem(EMAIL_ADDR_KEY);
  const emailKey = getEmailAddrStorageKey();
  if (emailKey) localStorage.removeItem(emailKey);
  localStorage.removeItem(ANON_KEY);
  localStorage.removeItem(ANON_NICK_KEY);
  localStorage.removeItem(REAL_NICK_KEY);
  localStorage.removeItem(ANON_COUNTER_KEY);
  localStorage.removeItem("profileNotifications");
  localStorage.removeItem(AVATAR_COLOR_KEY);
  localStorage.removeItem(PHOTO_URL_KEY);

  localStorage.setItem(USER_KEY, restore);
  applyPrefs();
  applyTopbarUI();
  window.dispatchEvent(new CustomEvent("profileui:changed"));
  syncPublicProfile();
};

const syncPublicProfile = async () => {
  if (!isLoggedIn()) return;
  const uid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (!uid) return;

  const username = String(localStorage.getItem(USER_KEY) || localStorage.getItem(NICK_KEY) || "").trim();
  const avatarColor = String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim();

  try {
    const [{ db }, { doc, getDoc, setDoc, serverTimestamp }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
    ]);

    const ref = doc(db, "publicProfiles", uid);
    const snap = await getDoc(ref);
    const payload = {
      uid,
      username: username || "Gość",
      usernameLower: String(username || "Gość").toLowerCase(),
      avatarColor,
      updatedAt: serverTimestamp(),
    };
    if (snap.exists()) {
      await setDoc(ref, payload, { merge: true });
    } else {
      await setDoc(ref, { ...payload, createdAt: serverTimestamp() }, { merge: false });
    }
  } catch (err) {
    console.warn("publicProfiles sync failed:", err);
  }
};

const hydrateFromPublicProfile = async () => {
  if (!isLoggedIn()) return;
  const uid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (!uid) return;

  try {
    const [{ db }, { doc, getDoc }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
    ]);

    const snap = await getDoc(doc(db, "publicProfiles", uid));
    if (!snap.exists()) return;
    const data = snap.data() || {};

    const avatarColor = String(data.avatarColor || "").trim();
    if (avatarColor && !String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim()) {
      localStorage.setItem(AVATAR_COLOR_KEY, avatarColor);
    }

    const username = String(data.username || "").trim();
    if (username && !String(localStorage.getItem(USER_KEY) || "").trim()) {
      localStorage.setItem(USER_KEY, username);
      localStorage.setItem(NICK_KEY, username);
    }

    applyTopbarUI();
  } catch (err) {
    console.warn("publicProfiles hydrate failed:", err);
  }
};

const ensureTopbarRight = () => {
  const inner = document.querySelector(".topbar-inner");
  if (!inner) return null;

  let right = inner.querySelector(".topbar-right");
  if (!right) {
    right = document.createElement("div");
    right.className = "topbar-right";
    inner.appendChild(right);
  }

  let login = document.getElementById("topbarLogin");
  if (!login) {
    login = document.createElement("a");
    login.className = "topbar-login";
    login.id = "topbarLogin";
    login.href = "login.html";
    login.textContent = "Zaloguj się";
    right.appendChild(login);
  }

  let trigger = document.getElementById("topbarProfileTrigger");
  if (!trigger) {
    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "topbar-profile-trigger";
    trigger.id = "topbarProfileTrigger";
    trigger.setAttribute("aria-haspopup", "true");
    trigger.setAttribute("aria-expanded", "false");

    const greeting = document.createElement("span");
    greeting.className = "topbar-greeting";
    greeting.id = "topbarGreeting";

    const notifIndicator = document.createElement("span");
    notifIndicator.className = "topbar-notif-indicator";
    notifIndicator.id = "topbarNotifIndicator";
    notifIndicator.textContent = "!";
    notifIndicator.hidden = true;
    notifIndicator.setAttribute("aria-hidden", "true");

    const avatar = document.createElement("div");
    avatar.className = "topbar-avatar";
    avatar.id = "topbarAvatar";
    avatar.setAttribute("aria-hidden", "true");

    const initial = document.createElement("span");
    initial.className = "topbar-avatar-initial";
    initial.id = "topbarAvatarInitial";
    initial.textContent = "G";

    avatar.appendChild(initial);
    trigger.appendChild(greeting);
    trigger.appendChild(notifIndicator);
    trigger.appendChild(avatar);
    right.appendChild(trigger);
  }

  return right;
};

const ensureMenuAndModals = () => {
  let menu = document.getElementById("profileMenu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "profile-menu";
    menu.id = "profileMenu";
    menu.setAttribute("aria-hidden", "true");
    menu.innerHTML = `
      <div class="profile-menu-header">
        <span class="profile-title">Centrum profilu</span>
        <span class="profile-subtitle" id="profileUser">Gość</span>
      </div>
      <div class="profile-menu-list">
        <a href="#" class="profile-link" id="openProfileSettings">Mój profil</a>
        <a href="#" class="profile-link" id="openAccountSettings">Ustawienia konta</a>
        <a href="#" class="profile-link profile-link-notifications" id="openNotifications">
          Powiadomienia
          <span class="profile-badge" id="notifBadge" hidden>0</span>
        </a>
      </div>
      <button class="profile-logout" type="button" id="logoutBtn">Wyloguj się</button>
    `;
    document.body.appendChild(menu);
  }

  let profileModal = document.getElementById("profileModal");
  if (!profileModal) {
    profileModal = document.createElement("div");
    profileModal.className = "profile-modal";
    profileModal.id = "profileModal";
    profileModal.setAttribute("aria-hidden", "true");
    profileModal.innerHTML = `
      <div class="profile-modal-card" role="dialog" aria-modal="true">
        <div class="profile-modal-header">
          <h3>Moje ustawienia</h3>
          <button class="profile-modal-close" id="closeProfileModal" type="button">Zamknij</button>
        </div>
        <form class="profile-form" id="profileForm">
          <div class="settings-section">
            <p class="settings-title">Profil</p>
            <div class="profile-field">
              <label for="profileNick">Nick</label>
              <input type="text" id="profileNick" name="profileNick" placeholder="Twój nick" maxlength="24" required />
            </div>
          </div>
          <div class="settings-section">
            <p class="settings-title">Awatar</p>
            <div class="profile-field">
              <label for="profileAvatar">Kolor awatara</label>
              <input type="color" id="profileAvatar" name="profileAvatar" />
              <span class="profile-hint">Jeśli nie ma zdjęcia, pokażemy literę nicku</span>
            </div>
            <div class="profile-field">
              <label for="profileAvatarFile">Zdjęcie profilowe</label>
              <div class="profile-file-picker">
                <input class="profile-file-input" type="file" id="profileAvatarFile" name="profileAvatarFile" accept="image/*" />
                <label class="profile-file-button" for="profileAvatarFile" role="button" tabindex="0">Wybierz plik</label>
                <span class="profile-file-name" id="profileAvatarFileName">Nie wybrano pliku</span>
              </div>
              <span class="profile-hint">JPG/PNG/WebP, zapis w Firebase Storage</span>
              <button class="profile-reset" type="button" id="removeAvatarBtn">Usuń profilowe</button>
            </div>
          </div>
          <button class="profile-save" type="submit">Zapisz zmiany</button>
          <div class="profile-feedback" id="profileFeedback"></div>
        </form>
      </div>
    `;
    document.body.appendChild(profileModal);
  }

  let accountModal = document.getElementById("accountModal");
  if (!accountModal) {
    accountModal = document.createElement("div");
    accountModal.className = "profile-modal";
    accountModal.id = "accountModal";
    accountModal.setAttribute("aria-hidden", "true");
    accountModal.innerHTML = `
      <div class="profile-modal-card" role="dialog" aria-modal="true">
        <div class="profile-modal-header">
          <h3>Ustawienia konta</h3>
          <button class="profile-modal-close" id="closeAccountModal" type="button">Zamknij</button>
        </div>
        <form class="profile-form" id="accountForm">
          <div class="settings-section">
            <p class="settings-title">Dane konta</p>
            <div class="profile-field">
              <label for="accountEmailAddress">Adres e-mail</label>
              <input type="email" id="accountEmailAddress" name="accountEmailAddress" placeholder="np. twoj@mail.pl" autocomplete="email" />
              <span class="profile-hint">Zmień adres do powiadomień</span>
            </div>
            <div class="profile-field">
              <label for="accountEmailPassword">Potwierdź hasło</label>
              <input type="password" id="accountEmailPassword" name="accountEmailPassword" placeholder="Wpisz hasło, by zmienić e-mail" autocomplete="current-password" />
              <span class="profile-hint">Wymagane przy zmianie e-maila</span>
            </div>
          </div>
          <div class="settings-section">
            <p class="settings-title">Preferencje</p>
            <label class="setting-toggle" for="accountTheme">
              <span class="setting-text">
                <strong>Ciemny kolor strony</strong>
                <small>Włącz ciemniejszy tryb we wszystkich zakładkach</small>
              </span>
              <input type="checkbox" id="accountTheme" name="accountTheme" />
            </label>
            <label class="setting-toggle" for="accountAnon">
              <span class="setting-text">
                <strong>Tryb anonimowy</strong>
                <small>Nadaj nick Anonimowy 1, 2, 3...</small>
              </span>
              <input type="checkbox" id="accountAnon" name="accountAnon" />
            </label>
            <label class="setting-toggle" for="accountEmail">
              <span class="setting-text">
                <strong>Powiadomienia mailowe</strong>
                <small>Wysyłaj informacje o nowych odpowiedziach i wiadomościach</small>
              </span>
              <input type="checkbox" id="accountEmail" name="accountEmail" />
            </label>
            <label class="setting-toggle" for="accountReduceMotion">
              <span class="setting-text">
                <strong>Mniej animacji</strong>
                <small>Wyłącz rozbudowane przejścia</small>
              </span>
              <input type="checkbox" id="accountReduceMotion" name="accountReduceMotion" />
            </label>
          </div>
          <button class="profile-save" type="submit">Zapisz ustawienia</button>
          <div class="profile-feedback" id="accountFeedback"></div>
          <div class="settings-section">
            <p class="settings-title">Przywróć ustawienia</p>
            <p class="profile-hint">Przywraca domyślne ustawienia profilu i preferencji.</p>
            <button class="profile-reset profile-reset-restore" type="button" id="resetSettings">Przywróć ustawienia początkowe</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(accountModal);
  }

  let resetModal = document.getElementById("resetModal");
  if (!resetModal) {
    resetModal = document.createElement("div");
    resetModal.className = "profile-modal";
    resetModal.id = "resetModal";
    resetModal.setAttribute("aria-hidden", "true");
    resetModal.innerHTML = `
      <div class="profile-modal-card" role="dialog" aria-modal="true">
        <div class="profile-modal-header">
          <h3>Potwierdzenie</h3>
        </div>
        <div class="reset-body">
          <p>
            Czy na pewno chcesz przywrócić ustawienia początkowe? Stracisz zdjęcie, kolor avatara, anonimowy nick,
            powiadomienia i tryb strony.
          </p>
        </div>
        <div class="reset-actions">
          <button class="profile-reset" type="button" id="cancelReset">Anuluj</button>
          <button class="profile-save" type="button" id="confirmReset">Tak, resetuj</button>
        </div>
      </div>
    `;
    document.body.appendChild(resetModal);
  }

  const accountForm = document.getElementById("accountForm");
  if (accountForm && !document.getElementById("deleteAccountBtn")) {
    const danger = document.createElement("div");
    danger.className = "settings-section";
    danger.innerHTML = `
      <p class="settings-title">Usuń konto</p>
      <p class="profile-hint">
        Usuwa konto na zawsze. Posty i komentarze usun samodzielnie przed skasowaniem konta.
      </p>
      <button class="profile-reset" type="button" id="deleteAccountBtn">Usuń konto</button>
      <div class="profile-feedback" id="deleteAccountFeedback"></div>
    `;
    accountForm.appendChild(danger);
  }

  let notificationsModal = document.getElementById("notificationsModal");
  if (!notificationsModal) {
    notificationsModal = document.createElement("div");
    notificationsModal.className = "profile-modal";
    notificationsModal.id = "notificationsModal";
    notificationsModal.setAttribute("aria-hidden", "true");
    notificationsModal.innerHTML = `
      <div class="profile-modal-card" role="dialog" aria-modal="true">
        <div class="profile-modal-header">
          <h3>Powiadomienia</h3>
          <button class="profile-modal-close" id="closeNotificationsModal" type="button">Zamknij</button>
        </div>
        <div class="notif-tools">
          <button class="notif-mark" type="button" id="markAllNotificationsRead">Oznacz wszystkie jako przeczytane</button>
        </div>
        <div class="notif-list" id="notificationsList"></div>
        <div class="profile-feedback" id="notificationsFeedback"></div>
      </div>
    `;
    document.body.appendChild(notificationsModal);
  }

  window.dispatchEvent(new CustomEvent("profileui:ready"));
};

const openModal = (modal) => {
  if (!modal) return;
  modal.classList.add("open");
  modal.setAttribute("aria-hidden", "false");
};

const closeModal = (modal) => {
  if (!modal) return;
  modal.classList.remove("open");
  modal.setAttribute("aria-hidden", "true");
};

const setFeedback = (id, text) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = String(text || "");
  if (text) el.dataset.origin = "profileui";
  if (!text) return;
  window.setTimeout(() => {
    if (el.textContent === text && (el.dataset.origin || "") === "profileui") {
      el.textContent = "";
      delete el.dataset.origin;
    }
  }, 2200);
};

let notificationsUnsub = null;
let notificationsUid = "";
let notificationsItems = [];

let announcementUnsub = null;
let announcementDocId = "";

const toMillis = (value) => {
  if (!value) return Number.NaN;
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  const date = new Date(value);
  const ms = date.getTime();
  return Number.isNaN(ms) ? Number.NaN : ms;
};

const formatNotifTime = (createdAt) => {
  const ms = toMillis(createdAt);
  if (!Number.isFinite(ms)) return "";
  try {
    return new Date(ms).toLocaleString("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
};

const setNotifBadge = (count) => {
  const badge = document.getElementById("notifBadge");
  const indicator = document.getElementById("topbarNotifIndicator");
  if (!badge) {
    if (indicator) indicator.hidden = true;
    return;
  }
  const n = Number(count || 0);
  if (!Number.isFinite(n) || n <= 0) {
    badge.hidden = true;
    badge.textContent = "0";
    if (indicator) indicator.hidden = true;
    return;
  }
  badge.hidden = false;
  badge.textContent = n > 9 ? "9+" : String(n);
  if (indicator) indicator.hidden = false;
};

const renderNotifications = () => {
  const list = document.getElementById("notificationsList");
  if (!list) return;
  list.innerHTML = "";

  if (!notificationsItems.length) {
    const empty = document.createElement("div");
    empty.className = "notif-empty";
    empty.textContent = "Brak powiadomień.";
    list.appendChild(empty);
    return;
  }

  notificationsItems.forEach((n) => {
    const unread = !n.readAt;
    const item = document.createElement("button");
    item.type = "button";
    item.className = `notif-item${unread ? " unread" : ""}`;
    item.dataset.notifId = String(n.id || "");
    item.dataset.postId = String(n.postId || "");

    const title = document.createElement("div");
    title.className = "notif-title";
    const from = String(n.fromName || "Ktoś").trim() || "Ktoś";
    const postTitle = String(n.postTitle || "").trim();
    title.textContent = postTitle ? `${from} skomentował: ${postTitle}` : `${from} skomentował Twój wpis`;

    const body = document.createElement("div");
    body.className = "notif-body";
    body.textContent = String(n.text || "").trim();

    const meta = document.createElement("div");
    meta.className = "notif-meta";
    meta.textContent = formatNotifTime(n.createdAt);

    item.appendChild(title);
    if (body.textContent) item.appendChild(body);
    if (meta.textContent) item.appendChild(meta);

    item.addEventListener("click", async () => {
      const postId = String(item.dataset.postId || "").trim();
      const notifId = String(item.dataset.notifId || "").trim();
      if (notifId) {
        markNotificationsRead([notifId]).catch(() => {
        });
      }
      closeModal(document.getElementById("notificationsModal"));
      if (postId) window.location.href = `forum.html?post=${encodeURIComponent(postId)}`;
      else window.location.href = "forum.html";
    });

    list.appendChild(item);
  });
};

const stopNotificationsListener = () => {
  if (typeof notificationsUnsub === "function") {
    try {
      notificationsUnsub();
    } catch {
    }
  }
  notificationsUnsub = null;
  notificationsUid = "";
  notificationsItems = [];
  setNotifBadge(0);
};

const ensureAnnouncementBanner = () => {
  let banner = document.getElementById("announcementBanner");
  if (banner) return banner;
  banner = document.createElement("div");
  banner.id = "announcementBanner";
  banner.className = "announcement-banner";
  banner.hidden = true;
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-live", "polite");

  const inner = document.createElement("div");
  inner.className = "announcement-inner";

  const icon = document.createElement("span");
  icon.className = "announcement-icon";
  icon.textContent = "!";
  icon.setAttribute("aria-hidden", "true");

  const text = document.createElement("div");
  text.className = "announcement-text";
  text.id = "announcementText";

  const close = document.createElement("button");
  close.type = "button";
  close.className = "announcement-close";
  close.textContent = "Ukryj";

  close.addEventListener("click", () => {
    banner.hidden = true;
    const docId = String(announcementDocId || "").trim();
    if (docId) localStorage.setItem("announcementDismissed", docId);
  });

  inner.appendChild(icon);
  inner.appendChild(text);
  inner.appendChild(close);
  banner.appendChild(inner);

  const topbar = document.querySelector(".topbar");
  if (topbar && topbar.parentNode) {
    topbar.parentNode.insertBefore(banner, topbar);
  } else if (document.body.firstChild) {
    document.body.insertBefore(banner, document.body.firstChild);
  } else {
    document.body.appendChild(banner);
  }
  return banner;
};

const stopAnnouncementListener = () => {
  if (typeof announcementUnsub === "function") {
    try {
      announcementUnsub();
    } catch {
    }
  }
  announcementUnsub = null;
  announcementDocId = "";
  const banner = document.getElementById("announcementBanner");
  if (banner) banner.hidden = true;
};

const isAnnouncementActive = (data) => {
  if (!data) return false;
  const message = String(data.message || "").trim();
  if (!message) return false;
  const now = Date.now();
  const startMs = toMillis(data.startsAt);
  const endMs = toMillis(data.endsAt);
  if (Number.isFinite(startMs) && startMs > now) return false;
  if (Number.isFinite(endMs) && endMs < now) return false;
  return true;
};

const renderAnnouncement = (docId, data) => {
  const banner = ensureAnnouncementBanner();
  const text = document.getElementById("announcementText");
  const message = String(data?.message || "").trim();
  announcementDocId = String(docId || "").trim();

  const dismissed = String(localStorage.getItem("announcementDismissed") || "").trim();
  const shouldHide = dismissed && announcementDocId && dismissed === announcementDocId;

  if (!announcementDocId || !isAnnouncementActive(data) || shouldHide) {
    banner.hidden = true;
    if (text) text.textContent = "";
    document.body.classList.remove("has-announcement");
    return;
  }

  if (text) text.textContent = message;
  banner.hidden = false;
  document.body.classList.add("has-announcement");
};

const startAnnouncementListener = async () => {
  if (announcementUnsub) return;
  ensureAnnouncementBanner();

  try {
    const [{ db }, { collection, query, orderBy, limit, onSnapshot }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
    ]);

    const q = query(
      collection(db, "announcements"),
      orderBy("createdAt", "desc"),
      limit(ANNOUNCEMENTS_LIMIT),
    );

    announcementUnsub = onSnapshot(
      q,
      (snap) => {
        if (snap.empty) {
          renderAnnouncement("", null);
          return;
        }

        let picked = null;
        snap.forEach((docSnap) => {
          if (picked) return;
          const data = docSnap.data() || {};
          if (isAnnouncementActive(data)) picked = { id: docSnap.id, data };
        });

        if (!picked) {
          renderAnnouncement("", null);
          return;
        }
        renderAnnouncement(picked.id, picked.data);
      },
      (err) => {
        console.warn("Ogłoszenia (onSnapshot) error:", err);
        stopAnnouncementListener();
      },
    );
  } catch (err) {
    console.warn("Ogłoszenia init failed:", err);
    stopAnnouncementListener();
  }
};

const markNotificationsRead = async (notifIds) => {
  if (!isLoggedIn()) return;
  const uid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (!uid) return;
  const ids = Array.isArray(notifIds) ? notifIds.map((x) => String(x || "").trim()).filter(Boolean) : [];
  if (!ids.length) return;

  const [{ db }, { writeBatch, doc, serverTimestamp }] = await Promise.all([
    import("./firebase-config.js"),
    import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
  ]);

  const batch = writeBatch(db);
  ids.forEach((id) => {
    batch.update(doc(db, "users", uid, "notifications", id), { readAt: serverTimestamp() });
  });
  await batch.commit();
};

const startNotificationsListener = async () => {
  if (!isLoggedIn()) {
    stopNotificationsListener();
    return;
  }

  const uid = String(localStorage.getItem(UID_KEY) || "").trim();
  if (!uid) {
    stopNotificationsListener();
    return;
  }
  if (notificationsUid === uid && notificationsUnsub) return;

  stopNotificationsListener();
  notificationsUid = uid;

  try {
    const [{ db }, { collection, query, orderBy, limit, onSnapshot }] = await Promise.all([
      import("./firebase-config.js"),
      import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
    ]);

    const q = query(
      collection(db, "users", uid, "notifications"),
      orderBy("createdAt", "desc"),
      limit(NOTIFS_LIMIT),
    );

    notificationsUnsub = onSnapshot(
      q,
      (snap) => {
        const next = [];
        let unread = 0;
        snap.forEach((docSnap) => {
          const data = docSnap.data() || {};
          const item = { id: docSnap.id, ...data };
          next.push(item);
          if (!data.readAt) unread += 1;
        });
        notificationsItems = next;
        setNotifBadge(unread);
        renderNotifications();
      },
      (err) => {
        console.warn("Powiadomienia (onSnapshot) error:", err);
        setNotifBadge(0);
        setFeedback(
          "notificationsFeedback",
          "Nie udało się wczytać powiadomień. Sprawdź, czy opublikowałeś reguły Firestore i czy jesteś zalogowany.",
        );
      },
    );
  } catch (err) {
    console.warn("Powiadomienia init failed:", err);
    setNotifBadge(0);
    setFeedback(
      "notificationsFeedback",
      "Nie udało się uruchomić powiadomień. Sprawdź konfigurację Firebase w konsoli.",
    );
  }
};

const applyTopbarUI = () => {
  const login = document.getElementById("topbarLogin");
  const trigger = document.getElementById("topbarProfileTrigger");
  const greeting = document.getElementById("topbarGreeting");
  const avatar = document.getElementById("topbarAvatar");
  const initial = document.getElementById("topbarAvatarInitial");
  const menuUser = document.getElementById("profileUser");
  const logoutBtn = document.getElementById("logoutBtn");
  const menu = document.getElementById("profileMenu");

  const loggedIn = isLoggedIn();
  const name = getDisplayName();

  if (login) {
    login.classList.toggle("is-hidden", loggedIn);
    login.setAttribute("aria-hidden", loggedIn ? "true" : "false");
    if (loggedIn) login.tabIndex = -1;
    else login.removeAttribute("tabindex");
  }

  if (!loggedIn) {
    if (trigger) trigger.style.display = "none";
    if (menu) {
      menu.classList.remove("open");
      menu.setAttribute("aria-hidden", "true");
    }
    return;
  }

  if (trigger) trigger.style.display = "flex";
  if (greeting) greeting.textContent = `${getGreeting()}, ${name}`;
  if (menuUser) menuUser.textContent = name;
  if (logoutBtn) logoutBtn.style.display = "";

  const photo = String(localStorage.getItem(PHOTO_URL_KEY) || "").trim();
  const color =
    String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim() || getAvatarColor(name);

  if (avatar) {
    avatar.classList.remove("has-image");
    avatar.style.backgroundImage = "";
    avatar.style.backgroundColor = "";
    if (photo) {
      avatar.style.backgroundImage = `url(${photo})`;
      avatar.style.backgroundColor = "transparent";
      avatar.classList.add("has-image");
    } else {
      avatar.style.background = color;
    }
  }
  if (initial) initial.textContent = getInitial(name);
};

const wireInteractions = () => {
  const trigger = document.getElementById("topbarProfileTrigger");
  const menu = document.getElementById("profileMenu");
  const openProfile = document.getElementById("openProfileSettings");
  const openAccount = document.getElementById("openAccountSettings");
  const openNotifications = document.getElementById("openNotifications");
  const logoutBtn = document.getElementById("logoutBtn");

  const profileModal = document.getElementById("profileModal");
  const closeProfileModal = document.getElementById("closeProfileModal");
  const profileForm = document.getElementById("profileForm");
  const profileNick = document.getElementById("profileNick");
  const profileAvatar = document.getElementById("profileAvatar");

  const accountModal = document.getElementById("accountModal");
  const closeAccountModal = document.getElementById("closeAccountModal");
  const accountForm = document.getElementById("accountForm");
  const accountTheme = document.getElementById("accountTheme");
  const accountAnon = document.getElementById("accountAnon");
  const accountReduceMotion = document.getElementById("accountReduceMotion");
  const accountEmail = document.getElementById("accountEmail");
  const accountEmailAddress = document.getElementById("accountEmailAddress");
  const accountEmailPassword = document.getElementById("accountEmailPassword");
  const resetSettings = document.getElementById("resetSettings");
  const deleteAccountBtn = document.getElementById("deleteAccountBtn");

  const notificationsModal = document.getElementById("notificationsModal");
  const closeNotificationsModal = document.getElementById("closeNotificationsModal");
  const markAllNotificationsRead = document.getElementById("markAllNotificationsRead");

  const resetModal = document.getElementById("resetModal");
  const cancelReset = document.getElementById("cancelReset");
  const confirmReset = document.getElementById("confirmReset");

  const closeMenu = () => {
    if (!menu) return;
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  };
  const positionMenu = () => {
    if (!menu || !trigger) return;
    if (!menu.classList.contains("open")) return;

    const rect = trigger.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const padding = 12;

    let left = rect.right - menuRect.width;
    let top = rect.bottom + 10;

    left = Math.max(padding, Math.min(left, window.innerWidth - menuRect.width - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - menuRect.height - padding));

    menu.style.position = "fixed";
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.style.right = "auto";
  };
  const toggleMenu = () => {
    if (!isLoggedIn()) {
      window.location.href = "login.html";
      return;
    }
    if (!menu) return;
    const open = menu.classList.toggle("open");
    menu.setAttribute("aria-hidden", open ? "false" : "true");
    if (trigger) trigger.setAttribute("aria-expanded", open ? "true" : "false");
    if (open) positionMenu();
  };

  if (trigger) {
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleMenu();
    });
  }

  window.addEventListener(
    "scroll",
    () => {
      positionMenu();
    },
    { passive: true },
  );
  window.addEventListener("resize", () => positionMenu());

  document.addEventListener("click", (e) => {
    if (!menu || !menu.classList.contains("open")) return;
    const insideMenu = menu.contains(e.target);
    const insideTrigger = trigger && trigger.contains(e.target);
    if (!insideMenu && !insideTrigger) closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      closeModal(profileModal);
      closeModal(accountModal);
      closeModal(notificationsModal);
      closeModal(resetModal);
    }
  });

  if (openProfile) {
    openProfile.addEventListener("click", (e) => {
      e.preventDefault();
      closeMenu();
      if (profileNick) profileNick.value = getDisplayName();
      if (profileAvatar) {
        const saved = String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim();
        const savedValid = /^#[0-9a-fA-F]{6}$/.test(saved) ? saved : "";
        profileAvatar.value = savedValid || getAvatarColor(getDisplayName());
      }
      if (profileNick) {
        const anon = String(localStorage.getItem(ANON_KEY) || "").trim() === "on";
        profileNick.disabled = anon;
      }
      openModal(profileModal);
    });
  }

  if (closeProfileModal) {
    closeProfileModal.addEventListener("click", () => closeModal(profileModal));
  }
  if (profileModal) {
    profileModal.addEventListener("click", (e) => {
      if (e.target === profileModal) closeModal(profileModal);
    });
  }

  if (openAccount) {
    openAccount.addEventListener("click", (e) => {
      e.preventDefault();
      closeMenu();
      if (accountTheme) {
        accountTheme.checked = localStorage.getItem(THEME_KEY) === "dark";
      }
      if (accountAnon) accountAnon.checked = localStorage.getItem(ANON_KEY) === "on";
      if (accountReduceMotion) {
        accountReduceMotion.checked = localStorage.getItem(REDUCE_MOTION_KEY) === "on";
      }
      if (accountEmail) accountEmail.checked = localStorage.getItem(EMAIL_NOTIFS_KEY) === "on";
      if (accountEmailAddress) {
        const emailKey = getEmailAddrStorageKey();
        accountEmailAddress.value = (emailKey && localStorage.getItem(emailKey)) || "";
      }
      if (accountEmailPassword) accountEmailPassword.value = "";
      openModal(accountModal);
    });
  }

  if (openNotifications) {
    openNotifications.addEventListener("click", async (e) => {
      e.preventDefault();
      closeMenu();
      renderNotifications();
      openModal(notificationsModal);

      const unreadIds = notificationsItems
        .filter((n) => !n.readAt && String(n.id || "").trim())
        .map((n) => String(n.id || "").trim());
      if (unreadIds.length) {
        markNotificationsRead(unreadIds).catch(() => {
        });
      }
    });
  }

  if (closeNotificationsModal) {
    closeNotificationsModal.addEventListener("click", () => closeModal(notificationsModal));
  }
  if (notificationsModal) {
    notificationsModal.addEventListener("click", (e) => {
      if (e.target === notificationsModal) closeModal(notificationsModal);
    });
  }

  if (markAllNotificationsRead) {
    markAllNotificationsRead.addEventListener("click", () => {
      const allUnreadIds = notificationsItems
        .filter((n) => !n.readAt && String(n.id || "").trim())
        .map((n) => String(n.id || "").trim());
      if (!allUnreadIds.length) {
        setFeedback("notificationsFeedback", "Brak nowych powiadomień.");
        return;
      }
      markNotificationsRead(allUnreadIds)
        .then(() => setFeedback("notificationsFeedback", "Oznaczono jako przeczytane."))
        .catch(() => setFeedback("notificationsFeedback", "Nie udało się oznaczyć."));
    });
  }

  if (closeAccountModal) {
    closeAccountModal.addEventListener("click", () => closeModal(accountModal));
  }
  if (accountModal) {
    accountModal.addEventListener("click", (e) => {
      if (e.target === accountModal) closeModal(accountModal);
    });
  }

  if (resetSettings) {
    resetSettings.addEventListener("click", () => {
      if (!resetModal) return;
      openModal(resetModal);
    });
  }

  if (cancelReset) {
    cancelReset.addEventListener("click", () => closeModal(resetModal));
  }

  if (confirmReset) {
    confirmReset.addEventListener("click", () => {
      resetPrefs();
      closeModal(resetModal);
      closeModal(accountModal);
      setFeedback("accountFeedback", "Przywrócono ustawienia.");
    });
  }

  if (resetModal) {
    resetModal.addEventListener("click", (e) => {
      if (e.target === resetModal) closeModal(resetModal);
    });
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeMenu();
      if (window.AuthSession?.logout) {
        window.AuthSession.logout();
        return;
      }
      localStorage.removeItem(UID_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem(PHOTO_URL_KEY);
      window.location.href = "login.html";
    });
  }

  if (profileForm) {
    profileForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const nick = String(profileNick?.value || "").trim();
      if (nick.length < 3) {
        setFeedback("profileFeedback", "Nick musi mieć min. 3 znaki.");
        return;
      }
      const anon = String(localStorage.getItem(ANON_KEY) || "").trim() === "on";
      if (!anon) {
        localStorage.setItem(NICK_KEY, nick);
        if (isLoggedIn()) localStorage.setItem(USER_KEY, nick);
      }
      const color = String(profileAvatar?.value || "").trim();
      if (color) localStorage.setItem(AVATAR_COLOR_KEY, color);
      applyTopbarUI();
      setFeedback("profileFeedback", "Zapisano zmiany.");
      window.dispatchEvent(new CustomEvent("profileui:changed"));
      syncPublicProfile();
    });
  }

  if (accountForm) {
    accountForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const dark = Boolean(accountTheme?.checked);
      localStorage.setItem(THEME_KEY, dark ? "dark" : "light");

      const reduce = Boolean(accountReduceMotion?.checked);
      localStorage.setItem(REDUCE_MOTION_KEY, reduce ? "on" : "off");

      const emailOn = Boolean(accountEmail?.checked);
      localStorage.setItem(EMAIL_NOTIFS_KEY, emailOn ? "on" : "off");

      const emailValue = String(accountEmailAddress?.value || "").trim();
      localStorage.removeItem(EMAIL_ADDR_KEY);
      const emailKey = getEmailAddrStorageKey();
      if (emailKey) {
        if (emailValue) localStorage.setItem(emailKey, emailValue);
        else localStorage.removeItem(emailKey);
      }

      let extraFeedback = "";
      const passValue = String(accountEmailPassword?.value || "").trim();

      if (accountEmailPassword && emailValue && isLoggedIn()) {
        if (!passValue) {
          extraFeedback = "Aby zmienić e-mail logowania, wpisz hasło i zapisz ponownie.";
        } else {
          try {
            const [{ auth, db }, authApi, firestoreApi] = await Promise.all([
              import("./firebase-config.js"),
              import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"),
              import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
            ]);

            const user = auth.currentUser;
            const currentEmail = String(user?.email || "").trim();
            const nextEmail = String(emailValue || "").trim();

            if (!user) {
              extraFeedback = "Brak aktywnej sesji.";
            } else if (!currentEmail) {
              extraFeedback = "To konto nie ma ustawionego e-maila.";
            } else if (nextEmail.toLowerCase() !== currentEmail.toLowerCase()) {
              const cred = authApi.EmailAuthProvider.credential(currentEmail, passValue);
              await authApi.reauthenticateWithCredential(user, cred);

              if (typeof authApi.verifyBeforeUpdateEmail === "function") {
                await authApi.verifyBeforeUpdateEmail(user, nextEmail);
                extraFeedback = "Wysłano link weryfikacyjny na nowy e-mail.";
              } else if (typeof authApi.updateEmail === "function") {
                await authApi.updateEmail(user, nextEmail);
                extraFeedback = "Zmieniono e-mail.";
              } else {
                extraFeedback = "Brak funkcji zmiany e-maila w tej wersji Firebase.";
              }

              try {
                const { doc, setDoc, serverTimestamp } = firestoreApi;
                await setDoc(
                  doc(db, "users", user.uid),
                  {
                    email: nextEmail,
                    emailLower: nextEmail.toLowerCase(),
                    updatedAt: serverTimestamp(),
                  },
                  { merge: true },
                );
              } catch (firestoreErr) {
                console.warn("Email update in Firestore failed:", firestoreErr);
              }

              localStorage.setItem("authEmail", nextEmail.toLowerCase());
            }
          } catch (err) {
            console.error("Email update error:", err);
            const code = String(err?.code || "").trim();
            if (code === "auth/wrong-password") {
              extraFeedback = "Błędne hasło.";
            } else if (code === "auth/requires-recent-login") {
              extraFeedback = "Firebase wymaga ponownego logowania. Wyloguj się i zaloguj ponownie, potem spróbuj jeszcze raz.";
            } else if (code === "auth/invalid-email") {
              extraFeedback = "Niepoprawny adres e-mail.";
            } else if (code === "auth/email-already-in-use") {
              extraFeedback = "Ten e-mail jest już zajęty.";
            } else {
              const msg = String(err?.message || "").trim();
              extraFeedback = msg ? `Błąd: ${msg}` : "Błąd zmiany e-maila.";
            }
          }
        }
      }

      const anonNext = Boolean(accountAnon?.checked);
      if (anonNext) {
        localStorage.setItem(ANON_KEY, "on");
        const currentReal =
          String(localStorage.getItem(REAL_NICK_KEY) || "").trim() ||
          String(localStorage.getItem(NICK_KEY) || "").trim() ||
          String(localStorage.getItem(USER_KEY) || "").trim() ||
          "Gość";
        localStorage.setItem(REAL_NICK_KEY, currentReal);
        const anonNick = `Anonimowy ${randomFourDigits()}`;
        localStorage.setItem(ANON_NICK_KEY, anonNick);
        localStorage.setItem(USER_KEY, anonNick);
        if (profileNick) profileNick.disabled = true;
      } else {
        localStorage.setItem(ANON_KEY, "off");
        localStorage.removeItem(ANON_NICK_KEY);
        const restore =
          String(localStorage.getItem(REAL_NICK_KEY) || "").trim() ||
          String(localStorage.getItem(NICK_KEY) || "").trim() ||
          String(localStorage.getItem(USER_KEY) || "").trim() ||
          "Gość";
        localStorage.setItem(USER_KEY, restore);
        if (profileNick) profileNick.disabled = false;
      }

      applyPrefs();
      applyTopbarUI();
      if (accountEmailPassword) accountEmailPassword.value = "";
      setFeedback("accountFeedback", extraFeedback || "Zapisano ustawienia.");
    });
  }

  if (deleteAccountBtn) {
    const deleteSection = deleteAccountBtn.closest(".settings-section");
    const applyDeleteVisibility = () => {
      const isAdminLocal =
        String(localStorage.getItem("userRole") || "").trim().toLowerCase() === "admin";
      if (!deleteSection) return;
      deleteSection.style.display = isAdminLocal ? "none" : "";
    };
    applyDeleteVisibility();
    window.addEventListener("authsession:changed", applyDeleteVisibility);

    deleteAccountBtn.addEventListener("click", async () => {
      if (!isLoggedIn()) {
        window.location.href = "login.html";
        return;
      }

      const ok = window.confirm(
        "Na pewno usunąć konto? To cofnie tylko ponowna rejestracja. Posty/komentarze usuń wcześniej ręcznie.",
      );
      if (!ok) return;

      const confirmText = String(window.prompt('Wpisz: USUN, aby potwierdzić.', "") || "").trim();
      if (confirmText !== "USUN") {
        setFeedback("deleteAccountFeedback", "Anulowano.");
        return;
      }

      deleteAccountBtn.disabled = true;
      setFeedback("deleteAccountFeedback", "Usuwanie konta...");

      try {
        const [{ auth, db, storage, ADMIN_EMAIL_ALLOWLIST }, authApi, firestoreApi, storageApi] = await Promise.all([
          import("./firebase-config.js"),
          import("https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js"),
          import("https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js"),
          import("https://www.gstatic.com/firebasejs/10.8.0/firebase-storage.js"),
        ]);

        const user = auth.currentUser;
        if (!user) {
          setFeedback("deleteAccountFeedback", "Brak aktywnej sesji.");
          return;
        }

        try {
          const email = String(user.email || "").trim().toLowerCase();
          const adminAllowlist = Array.isArray(ADMIN_EMAIL_ALLOWLIST) ? ADMIN_EMAIL_ALLOWLIST : [];
          if (email && adminAllowlist.includes(email)) {
            setFeedback("deleteAccountFeedback", "Konta administratora nie mozna usunac.");
            return;
          }
          const token = await user.getIdTokenResult();
          if (token?.claims?.admin === true) {
            setFeedback("deleteAccountFeedback", "Konta administratora nie mozna usunac.");
            return;
          }
        } catch {
        }

        const uid = String(user.uid || "").trim();
        if (!uid) {
          setFeedback("deleteAccountFeedback", "Brak UID.");
          return;
        }

        // Reautoryzacja (wymagana przez Firebase, żeby móc skasować konto z Authentication).
        // Robimy ją NAJPIERW — jeśli się nie uda, nie kasujemy danych w Firestore/Storage,
        // żeby nie zostawić "pół-usuniętego" konta.
        try {
          const providerIds = Array.isArray(user.providerData)
            ? user.providerData.map((p) => String(p?.providerId || "").trim()).filter(Boolean)
            : [];
          const email = String(user.email || "").trim();
          const isPassword = providerIds.includes("password");
          const isGoogle = providerIds.includes("google.com");

          if (isPassword && email) {
            const pass = String(
              window.prompt(
                "Dla bezpieczeństwa podaj hasło do konta (zostanie użyte tylko do reautoryzacji):",
                "",
              ) || "",
            );
            if (!pass) {
              setFeedback("deleteAccountFeedback", "Anulowano. Usunięcie konta wymaga podania hasła.");
              return;
            }
            const cred = authApi.EmailAuthProvider.credential(email, pass);
            await authApi.reauthenticateWithCredential(user, cred);
          } else if (isGoogle) {
            const provider = new authApi.GoogleAuthProvider();
            await authApi.reauthenticateWithPopup(user, provider);
          } else {
            setFeedback(
              "deleteAccountFeedback",
              "Firebase wymaga ponownego logowania do usunięcia konta. Wyloguj się, zaloguj ponownie i spróbuj jeszcze raz.",
            );
            return;
          }
        } catch (reauthErr) {
          console.warn("Reauth failed:", reauthErr);
          const code = String(reauthErr?.code || "").trim();
          if (code === "auth/wrong-password") {
            setFeedback("deleteAccountFeedback", "Nieprawidłowe hasło. Anulowano.");
          } else if (code === "auth/popup-closed-by-user") {
            setFeedback("deleteAccountFeedback", "Anulowano (zamknięto okno logowania).");
          } else {
            const msg = String(reauthErr?.message || "").trim();
            setFeedback(
              "deleteAccountFeedback",
              msg ? `Nie udało się potwierdzić logowania: ${msg}` : "Nie udało się potwierdzić logowania.",
            );
          }
          return;
        }

        const { doc, getDoc, writeBatch, deleteDoc } = firestoreApi;
        const { ref, deleteObject } = storageApi;

        const usernameCandidates = new Set();
        const pushCandidate = (value) => {
          const normalized = String(value || "").trim().toLowerCase();
          if (!normalized) return;
          usernameCandidates.add(normalized);
        };

        try {
          const snap = await getDoc(doc(db, "users", uid));
          const data = snap.exists() ? snap.data() : null;
          pushCandidate(data?.usernameLower);
          pushCandidate(data?.username);
        } catch {
        }

        try {
          const snap = await getDoc(doc(db, "publicProfiles", uid));
          const data = snap.exists() ? snap.data() : null;
          pushCandidate(data?.usernameLower);
          pushCandidate(data?.username);
        } catch {
        }

        // Fallback z localStorage (np. dla starych kont bez usernameLower w Firestore).
        // Uwaga: próbę usunięcia i tak zweryfikują reguły po `resource.data.uid`.
        pushCandidate(localStorage.getItem(REAL_NICK_KEY));
        pushCandidate(localStorage.getItem(NICK_KEY));

        try {
          await deleteObject(ref(storage, `Profilowe/${uid}/avatar.jpg`));
        } catch {
        }

        try {
          for (const candidate of usernameCandidates) {
            try {
              await deleteDoc(doc(db, "usernames", candidate));
            } catch {
            }
          }

          const batch = writeBatch(db);
          batch.delete(doc(db, "users", uid));
          batch.delete(doc(db, "publicProfiles", uid));
          await batch.commit();
        } catch (err) {
          try {
            await deleteDoc(doc(db, "publicProfiles", uid));
          } catch {
          }
        }

        await authApi.deleteUser(user);

        try {
          if (window.AuthSession?.logout) {
            window.AuthSession.logout();
            return;
          }
        } catch {
        }
        localStorage.removeItem(UID_KEY);
        localStorage.removeItem(USER_KEY);
        localStorage.removeItem(PHOTO_URL_KEY);
        window.location.href = "login.html";
      } catch (err) {
        console.error("Delete account error:", err);
        const code = String(err?.code || "");
        if (code === "auth/requires-recent-login") {
          setFeedback(
            "deleteAccountFeedback",
            "Firebase wymaga ponownego logowania. Wyloguj się i zaloguj ponownie, potem spróbuj jeszcze raz.",
          );
        } else {
          const msg = String(err?.message || "").trim();
          setFeedback("deleteAccountFeedback", msg ? `Błąd: ${msg}` : "Błąd usuwania konta.");
        }
      } finally {
        deleteAccountBtn.disabled = false;
      }
    });
  }
};

const boot = () => {
  applyPrefs();
  localStorage.removeItem(EMAIL_ADDR_KEY);
  if (document.body.classList.contains("page-dashboard")) {
    const legacy = document.getElementById("userProfile");
    if (legacy) legacy.remove();
  }
  ensureTopbarRight();
  ensureMenuAndModals();
  applyTopbarUI();
  wireInteractions();
  startAnnouncementListener();
  startNotificationsListener();
  hydrateFromPublicProfile();
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

window.addEventListener("authsession:changed", () => {
  const menu = document.getElementById("profileMenu");
  const trigger = document.getElementById("topbarProfileTrigger");
  if (!isLoggedIn() && menu) {
    menu.classList.remove("open");
    menu.setAttribute("aria-hidden", "true");
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }
  applyTopbarUI();
  hydrateFromPublicProfile();
  startAnnouncementListener();
  startNotificationsListener();
});
