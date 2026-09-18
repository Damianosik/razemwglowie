(() => {
  const USERS_KEY = "registeredUsers";
  const PRESENCE_KEY = "userPresenceMap";
  const ROLE_KEY = "userRole";
  const AUTH_USER_KEY = "authUser";
  const ONLINE_THRESHOLD_MS = 90000;

  const safeParse = (raw, fallback) => {
    try {
      const parsed = raw ? JSON.parse(raw) : fallback;
      return parsed;
    } catch {
      return fallback;
    }
  };

  const normalizeUsername = (value) => String(value || "").trim().toLowerCase();
  const safeIso = (value, fallback = null) => {
    if (!value) return fallback;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toISOString();
  };
  const getSessionUser = () => {
    const uid = String(localStorage.getItem("authUid") || "").trim();
    if (!uid) return "";
    const auth = localStorage.getItem(AUTH_USER_KEY);
    if (auth && auth.trim()) return auth;
    return localStorage.getItem("loggedInUser") || "";
  };

  const readUsers = () => {
    const parsed = safeParse(localStorage.getItem(USERS_KEY), []);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((user) => ({
      ...user,
      username: String(user.username || "").trim(),
      role: String(user.role || "user").toLowerCase() === "admin" ? "admin" : "user",
      isBlocked: Boolean(user.isBlocked),
      ban: normalizeBan(user.ban),
    }));
  };

  const saveUsers = (users) => {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  };

  const normalizeBan = (ban) => {
    if (!ban || typeof ban !== "object") return null;
    const permanent = Boolean(ban.permanent);
    const until = safeIso(ban.until, null);
    return {
      permanent,
      until,
      reason: String(ban.reason || "").trim(),
      createdAt: safeIso(ban.createdAt, new Date().toISOString()),
    };
  };

  const getUser = (username) => {
    const target = normalizeUsername(username);
    return readUsers().find((user) => normalizeUsername(user.username) === target) || null;
  };

  const updateUser = (username, updater) => {
    const target = normalizeUsername(username);
    const users = readUsers();
    let changed = false;
    const updatedUsers = users.map((user) => {
      if (normalizeUsername(user.username) !== target) return user;
      changed = true;
      const next = typeof updater === "function" ? updater({ ...user }) : user;
      return {
        ...next,
        username: String(next.username || user.username || "").trim(),
        role: String(next.role || "user").toLowerCase() === "admin" ? "admin" : "user",
        isBlocked: Boolean(next.isBlocked),
        ban: normalizeBan(next.ban),
      };
    });
    if (!changed) return false;
    saveUsers(updatedUsers);
    return true;
  };

  const deleteUser = (username) => {
    const target = normalizeUsername(username);
    const users = readUsers();
    const filtered = users.filter((user) => normalizeUsername(user.username) !== target);
    if (filtered.length === users.length) return false;
    saveUsers(filtered);
    return true;
  };

  const readPresenceMap = () => {
    const parsed = safeParse(localStorage.getItem(PRESENCE_KEY), {});
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  };

  const writePresenceMap = (map) => {
    localStorage.setItem(PRESENCE_KEY, JSON.stringify(map));
  };

  const setPresence = (username, payload) => {
    const key = normalizeUsername(username);
    if (!key) return;
    const map = readPresenceMap();
    map[key] = {
      ...map[key],
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    writePresenceMap(map);
  };

  const markOnline = (username, page = "") => {
    setPresence(username, {
      isOnline: true,
      page: String(page || ""),
      lastSeen: new Date().toISOString(),
    });
  };

  const markOffline = (username) => {
    setPresence(username, {
      isOnline: false,
      lastSeen: new Date().toISOString(),
    });
  };

  const startPresenceTracking = (username, page = "") => {
    if (!normalizeUsername(username)) return () => {};
    const tick = () => markOnline(username, page);
    tick();
    const intervalId = window.setInterval(tick, 30000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    const onBeforeUnload = () => {
      markOffline(username);
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("beforeunload", onBeforeUnload);
    window.addEventListener("pagehide", onBeforeUnload);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("beforeunload", onBeforeUnload);
      window.removeEventListener("pagehide", onBeforeUnload);
    };
  };

  const getActiveBan = (user) => {
    const ban = normalizeBan(user?.ban);
    if (!ban) return null;
    if (ban.permanent) return ban;
    if (!ban.until) return null;
    const untilMs = new Date(ban.until).getTime();
    if (Number.isNaN(untilMs)) return null;
    if (untilMs > Date.now()) return ban;
    return null;
  };

  const clearExpiredBan = (username) => {
    const user = getUser(username);
    if (!user) return false;
    if (!user.ban) return false;
    if (getActiveBan(user)) return false;
    return updateUser(username, (current) => ({ ...current, ban: null }));
  };

  const formatBanMessage = (ban) => {
    if (!ban) return "";
    if (ban.permanent) {
      return ban.reason ? `Konto zbanowane na stale. Powod: ${ban.reason}` : "Konto zbanowane na stale.";
    }
    const untilText = ban.until
      ? new Date(ban.until).toLocaleString("pl-PL", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "nieznany";
    if (ban.reason) {
      return `Konto zbanowane do ${untilText}. Powod: ${ban.reason}`;
    }
    return `Konto zbanowane do ${untilText}.`;
  };

  const getAccountState = (username) => {
    const user = getUser(username);
    if (!user) return { exists: false, blocked: false, banned: false, ban: null };
    clearExpiredBan(username);
    const refreshed = getUser(username) || user;
    const ban = getActiveBan(refreshed);
    return {
      exists: true,
      blocked: Boolean(refreshed.isBlocked),
      banned: Boolean(ban),
      ban,
      user: refreshed,
    };
  };

  const isOnline = (username) => {
    const key = normalizeUsername(username);
    if (!key) return false;
    const map = readPresenceMap();
    const entry = map[key];
    if (!entry || !entry.isOnline || !entry.updatedAt) return false;
    const updatedAtMs = new Date(entry.updatedAt).getTime();
    if (Number.isNaN(updatedAtMs)) return false;
    return Date.now() - updatedAtMs <= ONLINE_THRESHOLD_MS;
  };

  const isAdminSession = () => {
    const role = normalizeUsername(localStorage.getItem(ROLE_KEY));
    return role === "admin";
  };

  const enforceCurrentSessionAccess = () => {
    const activeUser = getSessionUser();
    if (!activeUser || !activeUser.trim()) return { ok: true, reason: "" };
    if (normalizeUsername(activeUser) === "admin") return { ok: true, reason: "" };

    const account = getAccountState(activeUser);
    if (!account.exists) return { ok: true, reason: "" };
    if (account.blocked) {
      localStorage.removeItem("loggedInUser");
      localStorage.removeItem(AUTH_USER_KEY);
      localStorage.removeItem(ROLE_KEY);
      return { ok: false, reason: "Twoje konto jest zablokowane przez administratora." };
    }
    if (account.banned) {
      localStorage.removeItem("loggedInUser");
      localStorage.removeItem(AUTH_USER_KEY);
      localStorage.removeItem(ROLE_KEY);
      return { ok: false, reason: formatBanMessage(account.ban) || "Twoje konto jest zbanowane." };
    }
    return { ok: true, reason: "" };
  };

  window.UserManager = {
    USERS_KEY,
    PRESENCE_KEY,
    ROLE_KEY,
    readUsers,
    saveUsers,
    getUser,
    updateUser,
    deleteUser,
    readPresenceMap,
    writePresenceMap,
    markOnline,
    markOffline,
    startPresenceTracking,
    getActiveBan,
    clearExpiredBan,
    formatBanMessage,
    getAccountState,
    isOnline,
    isAdminSession,
    enforceCurrentSessionAccess,
    getSessionUser,
    AUTH_USER_KEY,
    normalizeUsername,
  };
})();
