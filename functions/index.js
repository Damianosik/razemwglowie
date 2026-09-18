const admin = require("firebase-admin");
const { onSchedule } = require("firebase-functions/v2/scheduler");

admin.initializeApp();

const ADMIN_EMAIL_ALLOWLIST = ["razemwglowie@gmail.com"].map((e) =>
  String(e || "").trim().toLowerCase(),
);

const HOURS_24_MS = 24 * 60 * 60 * 1000;

async function deleteFirestoreUserData(uid) {
  const db = admin.firestore();
  const userRef = db.doc(`users/${uid}`);
  const publicProfileRef = db.doc(`publicProfiles/${uid}`);

  let usernameLower = "";
  try {
    const snap = await userRef.get();
    if (snap.exists) {
      usernameLower = String(snap.data()?.usernameLower || "").trim();
    }
  } catch {
    // ignore
  }

  const batch = db.batch();
  batch.delete(publicProfileRef);
  batch.delete(userRef);
  if (usernameLower) {
    batch.delete(db.doc(`usernames/${usernameLower}`));
  }
  try {
    await batch.commit();
  } catch (err) {
    console.warn("cleanupUnverifiedUsers: Firestore delete batch failed:", uid, err?.message || err);
  }
}

exports.cleanupUnverifiedUsers = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Europe/Warsaw" },
  async () => {
    const cutoffMs = Date.now() - HOURS_24_MS;
    let pageToken = undefined;
    let scanned = 0;
    let deleted = 0;

    while (true) {
      const res = await admin.auth().listUsers(1000, pageToken);
      for (const user of res.users) {
        scanned += 1;
        const emailLower = String(user.email || "").trim().toLowerCase();
        if (emailLower && ADMIN_EMAIL_ALLOWLIST.includes(emailLower)) continue;
        if (user.emailVerified) continue;
        const createdMs = new Date(user.metadata.creationTime || "").getTime();
        if (!Number.isFinite(createdMs)) continue;
        if (createdMs > cutoffMs) continue;

        try {
          await deleteFirestoreUserData(user.uid);
          await admin.auth().deleteUser(user.uid);
          deleted += 1;
          console.log("cleanupUnverifiedUsers: deleted", user.uid, user.email || "");
        } catch (err) {
          console.warn(
            "cleanupUnverifiedUsers: failed to delete",
            user.uid,
            user.email || "",
            err?.message || err,
          );
        }
      }
      pageToken = res.pageToken;
      if (!pageToken) break;
      // Hard-stop safety in case of huge user base
      if (scanned > 50000) break;
    }

    console.log("cleanupUnverifiedUsers: done", { scanned, deleted });
  },
);

