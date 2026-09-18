import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAfter,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";
import { ADMIN_EMAIL_ALLOWLIST, auth, db } from "./firebase-config.js";
import { checkTextAllowed } from "./content-filter.js";

const POSTS_LIMIT = 20;
const COMMENTS_LIMIT = 20;

const postForm = document.getElementById("postForm");
const postsList = document.getElementById("postsList");
const currentUserSpan = document.getElementById("currentUser");
const feedSection = document.querySelector(".feed");

let postsCursor = null;
let postsAllLoaded = false;
let postsLoading = false;
let targetPostId = "";
let targetScrolled = false;
const renderedPostIds = new Set();

const UID_KEY = "authUid";
const PHOTO_URL_KEY = "authPhotoURL";
const AVATAR_COLOR_KEY = "profileAvatar";
const ANON_KEY = "profileAnon";
const ANON_NICK_KEY = "profileAnonNick";

const publicProfileCache = new Map();

const withCacheBust = (url, updatedAt) => {
  const base = String(url || "").trim();
  if (!base) return "";
  const ms =
    typeof updatedAt?.toDate === "function"
      ? updatedAt.toDate().getTime()
      : Number.NaN;
  const stamp = Number.isFinite(ms) ? ms : Date.now();
  const joiner = base.includes("?") ? "&" : "?";
  return `${base}${joiner}v=${stamp}`;
};

const getPublicProfile = async (uid) => {
  const id = String(uid || "").trim();
  if (!id) return null;
  if (publicProfileCache.has(id)) return publicProfileCache.get(id);

  const promise = getDoc(doc(db, "publicProfiles", id))
    .then((snap) => (snap.exists() ? snap.data() || null : null))
    .catch((err) => {
      console.warn("publicProfiles get failed:", err);
      return null;
    });

  publicProfileCache.set(id, promise);
  return promise;
};

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

const formatDateTime = (createdAt) => {
  if (!createdAt) return "";
  const date =
    typeof createdAt?.toDate === "function"
      ? createdAt.toDate()
      : createdAt instanceof Date
        ? createdAt
        : null;
  if (!date) return "";
  try {
    return new Intl.DateTimeFormat("pl-PL", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

const applyAvatarToEl = (wrapper, { name, photoURL, color }) => {
  if (!wrapper) return;
  const url = String(photoURL || "").trim();
  const label = String(name || "").trim();

  wrapper.innerHTML = "";
  wrapper.style.background = "";

  if (url) {
    const img = document.createElement("img");
    img.src = url;
    img.alt = "";
    img.loading = "lazy";
    wrapper.appendChild(img);
    return;
  }

  wrapper.style.background = String(color || "").trim() || getAvatarColor(label);
  const initial = document.createElement("span");
  initial.textContent = getInitial(label);
  wrapper.appendChild(initial);
};

const buildAvatarEl = ({ name, photoURL, color, size = 34 }) => {
  const wrapper = document.createElement("div");
  wrapper.className = "user-avatar";
  wrapper.style.width = `${size}px`;
  wrapper.style.height = `${size}px`;
  applyAvatarToEl(wrapper, { name, photoURL, color });
  return wrapper;
};

const ensureComposeStatusEl = () => {
  let statusEl = document.getElementById("composeStatus");
  if (statusEl) return statusEl;
  const headerEl = document.querySelector(".compose-header");
  if (!headerEl) return null;
  statusEl = document.createElement("div");
  statusEl.id = "composeStatus";
  statusEl.className = "compose-status";
  statusEl.setAttribute("aria-live", "polite");
  headerEl.appendChild(statusEl);
  return statusEl;
};

const ensureLoadMoreUI = () => {
  if (!feedSection) return null;
  let wrap = document.getElementById("loadMorePostsWrap");
  if (wrap) return wrap;

  wrap = document.createElement("div");
  wrap.id = "loadMorePostsWrap";
  wrap.className = "load-more-wrap";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = "loadMorePostsBtn";
  btn.className = "btn-load-more";
  btn.textContent = "Zaladuj wiecej";
  btn.addEventListener("click", () => {
    loadMorePosts().catch(() => {
    });
  });

  const note = document.createElement("div");
  note.id = "loadMorePostsNote";
  note.className = "load-more-note";

  wrap.appendChild(btn);
  wrap.appendChild(note);
  feedSection.appendChild(wrap);
  return wrap;
};

const setLoadMoreUI = ({ hidden, disabled, note }) => {
  const wrap = document.getElementById("loadMorePostsWrap");
  const btn = document.getElementById("loadMorePostsBtn");
  const noteEl = document.getElementById("loadMorePostsNote");
  if (wrap) wrap.hidden = Boolean(hidden);
  if (btn) btn.disabled = Boolean(disabled);
  if (noteEl) noteEl.textContent = String(note || "");
};

const showFormFeedback = (message, type = "error") => {
  const statusEl = ensureComposeStatusEl();
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.remove("is-success", "is-error");
  statusEl.classList.add(type === "success" ? "is-success" : "is-error");
  statusEl.style.display = "block";
};

const hideFormFeedback = () => {
  const statusEl =
    document.getElementById("composeStatus") ||
    document.getElementById("formFeedback");
  if (!statusEl) return;
  statusEl.textContent = "";
  statusEl.classList.remove("is-success", "is-error");
  statusEl.style.display = "none";
};

const maybeScrollToTarget = ({ card, replies, ensureRepliesLoaded }) => {
  if (!card || targetScrolled) return;
  targetScrolled = true;
  window.setTimeout(async () => {
    try {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch {
    }
    if (replies) replies.hidden = false;
    if (typeof ensureRepliesLoaded === "function") {
      try {
        await ensureRepliesLoaded();
      } catch {
      }
    }
  }, 120);
};

const isLoggedIn = () => Boolean(String(localStorage.getItem(UID_KEY) || "").trim());
const isAnonModeOn = () => String(localStorage.getItem(ANON_KEY) || "").trim() === "on";
const getAnonNick = () => String(localStorage.getItem(ANON_NICK_KEY) || "").trim();
const getCurrentUid = () =>
  String(auth.currentUser?.uid || localStorage.getItem(UID_KEY) || "").trim();
const getDisplayName = (user) => {
  const anon = String(localStorage.getItem(ANON_KEY) || "").trim() === "on";
  if (anon) {
    const anonNick = String(localStorage.getItem(ANON_NICK_KEY) || "").trim();
    if (anonNick) return anonNick;
  }
  return (
    String(localStorage.getItem("loggedInUser") || "").trim() ||
    String(user?.email || "").trim() ||
    "Anonim"
  );
};

const shouldMaskOwnUid = (uid) => {
  const targetUid = String(uid || "").trim();
  if (!targetUid) return false;
  if (!isAnonModeOn()) return false;
  const currentUid = getCurrentUid();
  return Boolean(currentUid) && targetUid === currentUid;
};
const isAdmin = () => {
  const role = String(localStorage.getItem("userRole") || "").trim().toLowerCase();
  if (role === "admin") return true;
  const email =
    String(auth.currentUser?.email || localStorage.getItem("authEmail") || "")
      .trim()
      .toLowerCase();
  return Boolean(email) && ADMIN_EMAIL_ALLOWLIST.includes(email);
};

onAuthStateChanged(auth, (user) => {
  const composeSection = document.querySelector(".compose");
  const loginCta = document.getElementById("loginCta");

  if (user) {
    if (currentUserSpan) currentUserSpan.innerText = getDisplayName(user);
    if (loginCta) loginCta.style.display = "none";
    if (composeSection) composeSection.style.display = "block";
  } else {
    if (currentUserSpan) currentUserSpan.innerText = "Gość";
    if (loginCta) loginCta.style.display = "block";
    if (composeSection) composeSection.style.display = "none";
  }
});

if (postForm) {
  postForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideFormFeedback();

    if (!auth.currentUser || !isLoggedIn()) {
      window.location.href = "login.html?redirect=forum.html";
      return;
    }

    const title = String(document.getElementById("postTitle")?.value || "").trim();
    const content = String(document.getElementById("postContent")?.value || "").trim();

    if (!title || !content) {
      showFormFeedback("Tytuł i treść posta nie mogą być puste.", "error");
      return;
    }

    const titleCheck = checkTextAllowed(title);
    if (!titleCheck.allowed) {
      showFormFeedback("Tytuł zawiera zakazane słowa.", "error");
      return;
    }
    const contentCheck = checkTextAllowed(content);
    if (!contentCheck.allowed) {
      showFormFeedback("Treść posta zawiera zakazane słowa.", "error");
      return;
    }

    const payload = {
      title,
      content,
      category: String(document.getElementById("postCategory")?.value || "Ogólne"),
      tags: String(document.getElementById("postTags")?.value || "")
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      author: getDisplayName(auth.currentUser),
      authorUid: auth.currentUser.uid,
      authorPhotoURL: String(localStorage.getItem(PHOTO_URL_KEY) || "").trim(),
      authorAvatarColor: String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim(),
      createdAt: serverTimestamp(),
    };

    const submitButton = postForm.querySelector('button[type="submit"]');
    if (submitButton) submitButton.disabled = true;

    try {
      await addDoc(collection(db, "posts"), payload);
      postForm.reset();
      showFormFeedback("Post został pomyślnie dodany!", "success");
      setTimeout(() => {
        hideFormFeedback();
        loadPosts();
      }, 900);
    } catch (err) {
      console.error("Błąd dodawania posta:", err);
      showFormFeedback(`Błąd przy wysyłaniu posta: ${err.message}`, "error");
    } finally {
      if (submitButton) submitButton.disabled = false;
    }
  });
}

const renderRepliesEmpty = (container, message) => {
  container.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "reply-empty";
  empty.textContent = message;
  container.appendChild(empty);
};

const createRepliesSection = ({ postId, postAuthorUid, postTitle }) => {
  const replies = document.createElement("div");
  replies.className = "replies";
  replies.hidden = true;

  const repliesHeader = document.createElement("div");
  repliesHeader.className = "replies-header";
  const repliesTitle = document.createElement("span");
  repliesTitle.textContent = "Komentarze";
  const repliesCount = document.createElement("span");
  repliesCount.textContent = "";
  repliesHeader.appendChild(repliesTitle);
  repliesHeader.appendChild(repliesCount);

  const repliesList = document.createElement("div");
  repliesList.className = "replies-list";

  const replyForm = document.createElement("form");
  replyForm.className = "reply-form";

  const replyTextarea = document.createElement("textarea");
  replyTextarea.rows = 3;
  replyTextarea.placeholder = "Napisz komentarz...";
  replyTextarea.maxLength = 600;

  const replyBtn = document.createElement("button");
  replyBtn.className = "reply-btn";
  replyBtn.type = "submit";
  replyBtn.textContent = "Dodaj komentarz";

  const replyFeedback = document.createElement("div");
  replyFeedback.className = "reply-feedback";

  replyForm.appendChild(replyTextarea);
  replyForm.appendChild(replyBtn);
  replyForm.appendChild(replyFeedback);

  let commentsCursor = null;
  let commentsAllLoaded = false;
  let commentsLoadedCount = 0;
  let commentsLoadingMore = false;

  const loadMoreWrap = document.createElement("div");
  loadMoreWrap.className = "load-more-wrap";
  loadMoreWrap.hidden = true;

  const loadMoreBtn = document.createElement("button");
  loadMoreBtn.type = "button";
  loadMoreBtn.className = "btn-load-more";
  loadMoreBtn.textContent = "Zaladuj wiecej komentarzy";

  const loadMoreNote = document.createElement("div");
  loadMoreNote.className = "load-more-note";

  loadMoreWrap.appendChild(loadMoreBtn);
  loadMoreWrap.appendChild(loadMoreNote);

  const setLoadMoreUI = ({ hidden, disabled, note }) => {
    loadMoreWrap.hidden = Boolean(hidden);
    loadMoreBtn.disabled = Boolean(disabled);
    loadMoreNote.textContent = String(note || "");
  };

  const loadReplies = async () => {
    renderRepliesEmpty(repliesList, "Ładowanie komentarzy...");
    try {
      commentsCursor = null;
      commentsAllLoaded = false;
      commentsLoadedCount = 0;
      setLoadMoreUI({ hidden: true, disabled: true, note: "" });
      const commentsQ = query(
        collection(db, "posts", postId, "comments"),
        orderBy("createdAt", "asc"),
        limit(COMMENTS_LIMIT),
      );
      const commentsSnap = await getDocs(commentsQ);
      repliesList.innerHTML = "";

      if (commentsSnap.empty) {
        renderRepliesEmpty(repliesList, "Brak komentarzy. Bądź pierwszy!");
        repliesCount.textContent = "0";
        setLoadMoreUI({ hidden: true, disabled: true, note: "" });
        return;
      }

      commentsCursor = commentsSnap.docs[commentsSnap.docs.length - 1] || null;
      commentsLoadedCount = commentsSnap.size;
      commentsAllLoaded = commentsSnap.size < COMMENTS_LIMIT;
      repliesCount.textContent = commentsAllLoaded
        ? String(commentsLoadedCount)
        : `${commentsLoadedCount}+`;
      const showMore = commentsLoadedCount >= COMMENTS_LIMIT;
      setLoadMoreUI({
        hidden: !showMore,
        disabled: commentsAllLoaded || !showMore,
        note: commentsAllLoaded ? "To już wszystko." : "",
      });

      commentsSnap.forEach((commentDoc) => {
        const c = commentDoc.data();
        const item = document.createElement("div");
        item.className = "reply-item";

        const row = document.createElement("div");
        row.className = "reply-row";

        const cUid = String(c.authorUid || "").trim();
        const maskSelf = shouldMaskOwnUid(cUid);
        const cAuthor = maskSelf ? getAnonNick() || "Anonimowy" : String(c.author || "Anonim");
        const cColor = maskSelf
          ? String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim()
          : String(c.authorAvatarColor || "").trim();
        const cPhoto = maskSelf ? "" : String(c.authorPhotoURL || "").trim();
        const avatar = buildAvatarEl({ name: cAuthor, photoURL: cPhoto, color: cColor, size: 30 });
        row.appendChild(avatar);

        const bodyWrap = document.createElement("div");
        bodyWrap.className = "reply-content";

        const metaEl = document.createElement("div");
        metaEl.className = "reply-meta";
        const metaText = document.createElement("span");
        metaText.className = "reply-meta-text";
        const when = formatDateTime(c.createdAt);
        metaText.textContent = when ? `${cAuthor} • ${when}` : cAuthor;
        metaEl.appendChild(metaText);

        const canDelete =
          Boolean(auth.currentUser) &&
          (isAdmin() || String(c.authorUid || "").trim() === String(auth.currentUser.uid || "").trim());
        if (canDelete) {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "action-btn action-btn-danger reply-delete";
          delBtn.textContent = "Usuń";
          delBtn.addEventListener("click", async () => {
            const ok = window.confirm("Usunąć komentarz?");
            if (!ok) return;
            delBtn.disabled = true;
            try {
              await deleteDoc(doc(db, "posts", postId, "comments", commentDoc.id));
              await loadReplies();
            } catch (err) {
              console.error("Błąd usuwania komentarza:", err);
              replyFeedback.textContent = "Nie udało się usunąć komentarza.";
            } finally {
              delBtn.disabled = false;
            }
          });
          metaEl.appendChild(delBtn);
        }

        const body = document.createElement("p");
        body.className = "reply-body";
        body.textContent = String(c.text || "");

        bodyWrap.appendChild(metaEl);
        bodyWrap.appendChild(body);

        row.appendChild(bodyWrap);
        item.appendChild(row);
        repliesList.appendChild(item);

        if (cUid && !maskSelf) {
          getPublicProfile(cUid).then((profile) => {
            if (!profile) return;
            const nextName = String(profile.username || cAuthor).trim() || cAuthor;
            const nextColor = String(profile.avatarColor || cColor).trim() || cColor;
            const nextPhoto = withCacheBust(profile.photoURL, profile.updatedAt) || cPhoto;
            applyAvatarToEl(avatar, { name: nextName, photoURL: nextPhoto, color: nextColor });
            metaText.textContent = when ? `${nextName} • ${when}` : nextName;
          });
        }
      });
    } catch (err) {
      console.error("Błąd ładowania komentarzy:", err);
      renderRepliesEmpty(repliesList, "Nie udało się załadować komentarzy.");
    }
  };

  const loadMoreReplies = async () => {
    if (commentsLoadingMore || commentsAllLoaded || !commentsCursor) return;
    commentsLoadingMore = true;
    setLoadMoreUI({ hidden: false, disabled: true, note: "Ladowanie..." });

    try {
      const moreQ = query(
        collection(db, "posts", postId, "comments"),
        orderBy("createdAt", "asc"),
        startAfter(commentsCursor),
        limit(COMMENTS_LIMIT),
      );
      const moreSnap = await getDocs(moreQ);

      if (moreSnap.empty) {
        commentsAllLoaded = true;
        repliesCount.textContent = String(commentsLoadedCount || 0);
        setLoadMoreUI({ hidden: false, disabled: true, note: "To już wszystko." });
        return;
      }

      commentsCursor = moreSnap.docs[moreSnap.docs.length - 1] || commentsCursor;
      commentsLoadedCount += moreSnap.size;
      commentsAllLoaded = moreSnap.size < COMMENTS_LIMIT;

      moreSnap.forEach((commentDoc) => {
        const c = commentDoc.data();
        const item = document.createElement("div");
        item.className = "reply-item";

        const row = document.createElement("div");
        row.className = "reply-row";

        const cUid = String(c.authorUid || "").trim();
        const maskSelf = shouldMaskOwnUid(cUid);
        const cAuthor = maskSelf ? getAnonNick() || "Anonimowy" : String(c.author || "Anonim");
        const cColor = maskSelf
          ? String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim()
          : String(c.authorAvatarColor || "").trim();
        const cPhoto = maskSelf ? "" : String(c.authorPhotoURL || "").trim();
        const avatar = buildAvatarEl({ name: cAuthor, photoURL: cPhoto, color: cColor, size: 30 });
        row.appendChild(avatar);

        const bodyWrap = document.createElement("div");
        bodyWrap.className = "reply-content";

        const metaEl = document.createElement("div");
        metaEl.className = "reply-meta";
        const metaText = document.createElement("span");
        metaText.className = "reply-meta-text";
        const when = formatDateTime(c.createdAt);
        metaText.textContent = when ? `${cAuthor} • ${when}` : cAuthor;
        metaEl.appendChild(metaText);

        const canDelete =
          Boolean(auth.currentUser) &&
          (isAdmin() || String(c.authorUid || "").trim() === String(auth.currentUser.uid || "").trim());
        if (canDelete) {
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.className = "action-btn action-btn-danger reply-delete";
          delBtn.textContent = "Usuń";
          delBtn.addEventListener("click", async () => {
            const ok = window.confirm("Usunąć komentarz?");
            if (!ok) return;
            delBtn.disabled = true;
            try {
              await deleteDoc(doc(db, "posts", postId, "comments", commentDoc.id));
              await loadReplies();
            } catch (err) {
              console.error("Błąd usuwania komentarza:", err);
              replyFeedback.textContent = "Nie udało się usunąć komentarza.";
            } finally {
              delBtn.disabled = false;
            }
          });
          metaEl.appendChild(delBtn);
        }

        const body = document.createElement("p");
        body.className = "reply-body";
        body.textContent = String(c.text || "");

        bodyWrap.appendChild(metaEl);
        bodyWrap.appendChild(body);

        row.appendChild(bodyWrap);
        item.appendChild(row);
        repliesList.appendChild(item);

        if (cUid && !maskSelf) {
          getPublicProfile(cUid).then((profile) => {
            if (!profile) return;
            const nextName = String(profile.username || cAuthor).trim() || cAuthor;
            const nextColor = String(profile.avatarColor || cColor).trim() || cColor;
            const nextPhoto = withCacheBust(profile.photoURL, profile.updatedAt) || cPhoto;
            applyAvatarToEl(avatar, { name: nextName, photoURL: nextPhoto, color: nextColor });
            metaText.textContent = when ? `${nextName} • ${when}` : nextName;
          });
        }
      });

      repliesCount.textContent = commentsAllLoaded
        ? String(commentsLoadedCount)
        : `${commentsLoadedCount}+`;
      setLoadMoreUI({
        hidden: false,
        disabled: commentsAllLoaded,
        note: commentsAllLoaded ? "To już wszystko." : "",
      });
    } catch (err) {
      console.error("Błąd ładowania komentarzy:", err);
      setLoadMoreUI({ hidden: false, disabled: false, note: "Błąd ładowania. Spróbuj ponownie." });
    } finally {
      commentsLoadingMore = false;
    }
  };

  loadMoreBtn.addEventListener("click", () => {
    loadMoreReplies().catch(() => {
    });
  });

  const ensureRepliesLoaded = async () => {
    if (replies.dataset.loaded === "1") return;
    replies.dataset.loaded = "1";
    await loadReplies();
  };

  replyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    replyFeedback.textContent = "";

    if (!auth.currentUser || !isLoggedIn()) {
      window.location.href = `login.html?redirect=${encodeURIComponent("forum.html")}`;
      return;
    }

    const text = String(replyTextarea.value || "").trim();
    if (!text) {
      replyFeedback.textContent = "Komentarz nie może być pusty.";
      return;
    }

    const textCheck = checkTextAllowed(text);
    if (!textCheck.allowed) {
      replyFeedback.textContent =
        "Komentarz zawiera zakazane słowa i nie został wysłany.";
      return;
    }

    replyBtn.disabled = true;
    try {
      const payload = {
        text,
        author: getDisplayName(auth.currentUser),
        authorUid: auth.currentUser.uid,
        authorPhotoURL: String(localStorage.getItem(PHOTO_URL_KEY) || "").trim(),
        authorAvatarColor: String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim(),
        createdAt: serverTimestamp(),
      };
      await addDoc(collection(db, "posts", postId, "comments"), payload);

      try {
        let recipientUid = String(postAuthorUid || "").trim();
        let resolvedPostTitle = String(postTitle || "").trim();

        if (!recipientUid || !resolvedPostTitle) {
          try {
            const postSnap = await getDoc(doc(db, "posts", postId));
            if (postSnap.exists()) {
              const postData = postSnap.data() || {};
              if (!recipientUid) recipientUid = String(postData.authorUid || "").trim();
              if (!resolvedPostTitle) resolvedPostTitle = String(postData.title || "").trim();
            }
          } catch {
          }
        }

        if (recipientUid && recipientUid !== auth.currentUser.uid) {
          const safeTitle = resolvedPostTitle.slice(0, 120);
          const safeText = text.slice(0, 160);
          const fromName = getDisplayName(auth.currentUser);
          const notifPayload = {
            type: "comment",
            recipientUid,
            postId,
            postTitle: safeTitle,
            fromUid: auth.currentUser.uid,
            fromName,
            text: safeText,
            createdAt: serverTimestamp(),
            readAt: null,
          };
          await addDoc(collection(db, "users", recipientUid, "notifications"), notifPayload);
        }
      } catch (notifErr) {
        console.warn("Nie udało się utworzyć powiadomienia:", notifErr);
      }
      replyTextarea.value = "";
      replyFeedback.textContent = "Dodano komentarz.";
      await loadReplies();
      setTimeout(() => {
        replyFeedback.textContent = "";
      }, 1500);
    } catch (err) {
      console.error("Błąd dodawania komentarza:", err);
      replyFeedback.textContent = "Nie udało się dodać komentarza. Sprawdź reguły Firebase.";
    } finally {
      replyBtn.disabled = false;
    }
  });

  replies.appendChild(repliesHeader);
  replies.appendChild(repliesList);
  replies.appendChild(loadMoreWrap);
  replies.appendChild(replyForm);

  return { replies, ensureRepliesLoaded, loadReplies };
};

const appendPostFromDoc = (docSnap) => {
  if (!postsList || !docSnap) return null;
  const postId = docSnap.id;
  if (!postId) return null;
  if (renderedPostIds.has(postId)) return null;
  renderedPostIds.add(postId);

  const p = docSnap.data();

  const card = document.createElement("div");
  card.className = "post-card";
  card.id = `post-${postId}`;
  if (targetPostId && postId === targetPostId) {
    card.classList.add("is-target");
  }

  const authorUid = String(p.authorUid || "").trim();
  const maskOwnPost = shouldMaskOwnUid(authorUid);
  const authorName = maskOwnPost ? getAnonNick() || "Anonimowy" : String(p.author || "Anonim");
  const authorPhotoURL = String(p.authorPhotoURL || "").trim();
  const authorColor = maskOwnPost
    ? String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim()
    : String(p.authorAvatarColor || "").trim();

  const meta = document.createElement("div");
  meta.className = "post-meta";

  const authorWrap = document.createElement("div");
  authorWrap.className = "post-author";
  const avatar = buildAvatarEl({
    name: authorName,
    photoURL: authorPhotoURL,
    color: authorColor,
    size: 34,
  });
  authorWrap.appendChild(avatar);

  const metaText = document.createElement("div");
  metaText.className = "post-meta-text";

  const metaPrimary = document.createElement("span");
  metaPrimary.className = "post-meta-primary";
  metaPrimary.textContent = `${String(p.category || "Ogólne")} | ${authorName}`;

  const metaSecondary = document.createElement("span");
  metaSecondary.className = "post-meta-secondary";
  metaSecondary.textContent = formatDateTime(p.createdAt);

  metaText.appendChild(metaPrimary);
  if (metaSecondary.textContent) metaText.appendChild(metaSecondary);
  authorWrap.appendChild(metaText);
  meta.appendChild(authorWrap);

  if (authorUid && !maskOwnPost) {
    getPublicProfile(authorUid).then((profile) => {
      if (!profile) return;
      const nextName = String(profile.username || authorName).trim() || authorName;
      const nextColor = String(profile.avatarColor || authorColor).trim() || authorColor;
      const nextPhoto = withCacheBust(profile.photoURL, profile.updatedAt) || authorPhotoURL;
      applyAvatarToEl(avatar, { name: nextName, photoURL: nextPhoto, color: nextColor });
      metaPrimary.textContent = `${String(p.category || "Ogólne")} | ${nextName}`;
    });
  }

  const title = document.createElement("h3");
  title.className = "post-title";
  title.textContent = String(p.title || "");

  const content = document.createElement("p");
  content.className = "post-body";
  content.textContent = String(p.content || "");

  const tagsContainer = document.createElement("div");
  tagsContainer.className = "tag-list";
  const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",");
  tags.forEach((tag) => {
    const value = String(tag || "").trim();
    if (!value) return;
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = `#${value}`;
    tagsContainer.appendChild(tagEl);
  });

  const actions = document.createElement("div");
  actions.className = "post-actions";

  const repliesToggle = document.createElement("button");
  repliesToggle.className = "action-btn";
  repliesToggle.type = "button";
  repliesToggle.textContent = "Komentarze";

  const { replies, ensureRepliesLoaded } = createRepliesSection({
    postId,
    postAuthorUid: authorUid,
    postTitle: String(p.title || ""),
  });

  repliesToggle.addEventListener("click", async () => {
    replies.hidden = !replies.hidden;
    if (!replies.hidden) await ensureRepliesLoaded();
  });

  actions.appendChild(repliesToggle);

  const canDeletePost =
    Boolean(auth.currentUser) &&
    (isAdmin() || String(authorUid || "").trim() === String(auth.currentUser.uid || "").trim());
  if (canDeletePost) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "action-btn action-btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Usuń post";
    deleteBtn.addEventListener("click", async () => {
      const ok = window.confirm("Usunąć ten post?");
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await deleteDoc(doc(db, "posts", postId));
        loadPosts();
      } catch (err) {
        console.error("Błąd usuwania posta:", err);
        alert("Nie udało się usunąć posta. Sprawdź uprawnienia.");
      } finally {
        deleteBtn.disabled = false;
      }
    });
    actions.appendChild(deleteBtn);
  }

  card.appendChild(meta);
  card.appendChild(title);
  card.appendChild(content);
  if (tagsContainer.childElementCount) card.appendChild(tagsContainer);
  card.appendChild(actions);
  card.appendChild(replies);

  postsList.appendChild(card);

  if (targetPostId && postId === targetPostId) {
    return { card, replies, ensureRepliesLoaded };
  }
  return null;
};

async function loadPosts() {
  if (!postsList) return;

  ensureLoadMoreUI();
  postsCursor = null;
  postsAllLoaded = false;
  postsLoading = false;
  renderedPostIds.clear();
  targetPostId = String(new URLSearchParams(window.location.search).get("post") || "").trim();
  targetScrolled = false;
  setLoadMoreUI({ hidden: true, disabled: true, note: "" });
  postsList.innerHTML = `<p class="loading-message">Ładowanie postów...</p>`;
  const q = query(collection(db, "posts"), orderBy("createdAt", "desc"), limit(POSTS_LIMIT));

  try {
    const snap = await getDocs(q);
    postsList.innerHTML = "";

    if (snap.empty) {
      postsList.innerHTML = `<p class="empty-message">Nie ma jeszcze żadnych postów. Bądź pierwszy!</p>`;
      return;
    }

    postsCursor = snap.docs[snap.docs.length - 1] || null;
    if (snap.size < POSTS_LIMIT) postsAllLoaded = true;

    let found = null;
    let targetCard = null;
    let targetReplies = null;
    let targetEnsureRepliesLoaded = null;

    snap.forEach((docSnap) => {
      const handle = appendPostFromDoc(docSnap);
      if (handle) found = handle;
      return;
      const postId = docSnap.id;
      const p = docSnap.data();

      const card = document.createElement("div");
      card.className = "post-card";
      card.id = `post-${postId}`;

      const authorUid = String(p.authorUid || "").trim();
      const maskOwnPost = shouldMaskOwnUid(authorUid);
      const authorName = maskOwnPost ? getAnonNick() || "Anonimowy" : String(p.author || "Anonim");
      const authorPhotoURL = String(p.authorPhotoURL || "").trim();
      const authorColor = maskOwnPost
        ? String(localStorage.getItem(AVATAR_COLOR_KEY) || "").trim()
        : String(p.authorAvatarColor || "").trim();

      const meta = document.createElement("div");
      meta.className = "post-meta";

      const authorWrap = document.createElement("div");
      authorWrap.className = "post-author";
      const avatar = buildAvatarEl({
        name: authorName,
        photoURL: authorPhotoURL,
        color: authorColor,
        size: 34,
      });
      authorWrap.appendChild(avatar);

      const metaText = document.createElement("div");
      metaText.className = "post-meta-text";

      const metaPrimary = document.createElement("span");
      metaPrimary.className = "post-meta-primary";
      metaPrimary.textContent = `${String(p.category || "Ogólne")} | ${authorName}`;

      const metaSecondary = document.createElement("span");
      metaSecondary.className = "post-meta-secondary";
      metaSecondary.textContent = formatDateTime(p.createdAt);

      metaText.appendChild(metaPrimary);
      if (metaSecondary.textContent) metaText.appendChild(metaSecondary);
      authorWrap.appendChild(metaText);
      meta.appendChild(authorWrap);

      if (authorUid && !maskOwnPost) {
        getPublicProfile(authorUid).then((profile) => {
          if (!profile) return;
          const nextName = String(profile.username || authorName).trim() || authorName;
          const nextColor = String(profile.avatarColor || authorColor).trim() || authorColor;
          const nextPhoto = withCacheBust(profile.photoURL, profile.updatedAt) || authorPhotoURL;
          applyAvatarToEl(avatar, { name: nextName, photoURL: nextPhoto, color: nextColor });
          metaPrimary.textContent = `${String(p.category || "Ogólne")} | ${nextName}`;
        });
      }

      const title = document.createElement("h3");
      title.className = "post-title";
      title.textContent = String(p.title || "");

      const content = document.createElement("p");
      content.className = "post-body";
      content.textContent = String(p.content || "");

      const tagsContainer = document.createElement("div");
      tagsContainer.className = "tag-list";
      const tags = Array.isArray(p.tags) ? p.tags : String(p.tags || "").split(",");
      tags.forEach((tag) => {
        const value = String(tag || "").trim();
        if (!value) return;
        const tagEl = document.createElement("span");
        tagEl.className = "tag";
        tagEl.textContent = `#${value}`;
        tagsContainer.appendChild(tagEl);
      });

      const actions = document.createElement("div");
      actions.className = "post-actions";

      const repliesToggle = document.createElement("button");
      repliesToggle.className = "action-btn";
      repliesToggle.type = "button";
      repliesToggle.textContent = "Komentarze";

      const { replies, ensureRepliesLoaded } = createRepliesSection({
        postId,
        postAuthorUid: authorUid,
        postTitle: String(p.title || ""),
      });

      repliesToggle.addEventListener("click", async () => {
        replies.hidden = !replies.hidden;
        if (!replies.hidden) await ensureRepliesLoaded();
      });

      actions.appendChild(repliesToggle);

      const canDeletePost =
        Boolean(auth.currentUser) &&
        (isAdmin() || String(authorUid || "").trim() === String(auth.currentUser.uid || "").trim());
      if (canDeletePost) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "action-btn action-btn-danger";
        deleteBtn.type = "button";
        deleteBtn.textContent = "Usuń post";
        deleteBtn.addEventListener("click", async () => {
          const ok = window.confirm("Usunąć ten post?");
          if (!ok) return;
          deleteBtn.disabled = true;
          try {
            await deleteDoc(doc(db, "posts", postId));
            loadPosts();
          } catch (err) {
            console.error("Błąd usuwania posta:", err);
            alert("Nie udało się usunąć posta. Sprawdź uprawnienia.");
          } finally {
            deleteBtn.disabled = false;
          }
        });
        actions.appendChild(deleteBtn);
      }

      card.appendChild(meta);
      card.appendChild(title);
      card.appendChild(content);
      if (tagsContainer.childElementCount) card.appendChild(tagsContainer);
      card.appendChild(actions);
      card.appendChild(replies);

      postsList.appendChild(card);

      if (targetPostId && postId === targetPostId) {
        targetCard = card;
        targetReplies = replies;
        targetEnsureRepliesLoaded = ensureRepliesLoaded;
      }
    });

    if (targetCard) {
      window.setTimeout(async () => {
        try {
          targetCard.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch {
        }
        if (targetReplies) targetReplies.hidden = false;
        if (typeof targetEnsureRepliesLoaded === "function") {
          try {
            await targetEnsureRepliesLoaded();
          } catch {
          }
        }
      }, 120);
    }

    if (found) maybeScrollToTarget(found);
    const showMore = renderedPostIds.size >= POSTS_LIMIT;
    setLoadMoreUI({
      hidden: !showMore,
      disabled: postsAllLoaded || !showMore,
      note: postsAllLoaded ? "To już wszystko." : "",
    });
  } catch (err) {
    console.error("Błąd ładowania postów:", err);
    postsList.innerHTML = `<p class="error-message">Wystąpił błąd podczas ładowania postów. Sprawdź reguły bezpieczeństwa w Firebase.</p>`;
  }
}

const loadMorePosts = async () => {
  if (!postsList || postsLoading || postsAllLoaded) return;
  if (!postsCursor) {
    await loadPosts();
    return;
  }

  postsLoading = true;
  ensureLoadMoreUI();
  setLoadMoreUI({ hidden: false, disabled: true, note: "Ladowanie..." });

  try {
    const snap = await getDocs(
      query(
        collection(db, "posts"),
        orderBy("createdAt", "desc"),
        startAfter(postsCursor),
        limit(POSTS_LIMIT),
      ),
    );

    if (snap.empty) {
      postsAllLoaded = true;
      setLoadMoreUI({ hidden: false, disabled: true, note: "To już wszystko." });
      return;
    }

    postsCursor = snap.docs[snap.docs.length - 1] || postsCursor;
    if (snap.size < POSTS_LIMIT) postsAllLoaded = true;

    let found = null;
    snap.forEach((docSnap) => {
      const handle = appendPostFromDoc(docSnap);
      if (handle) found = handle;
    });
    if (found) maybeScrollToTarget(found);

    setLoadMoreUI({
      hidden: false,
      disabled: postsAllLoaded,
      note: postsAllLoaded ? "To już wszystko." : "",
    });
  } catch (err) {
    console.error("Błąd ładowania postów:", err);
    setLoadMoreUI({ hidden: false, disabled: false, note: "Błąd ładowania. Spróbuj ponownie." });
  } finally {
    postsLoading = false;
  }
};

loadPosts();
