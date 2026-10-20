/* The live rooms' connection to Firebase Realtime Database.
 *
 * A thin adapter: roomEngine.js asks for get / set / update / txn / listen /
 * presence and does not know which database answers. Every device signs in
 * anonymously (no name, no email): the anonymous id is what the database rules
 * use to let a phone write only its own answers, and the lecturer only their
 * own rooms. The id is kept by the browser, so a reload is the same student.
 *
 * The project's web configuration is public by design — it ships in every
 * Firebase web page; the database rules (firebase/database.rules.json) are what
 * protect the data. */
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously, onAuthStateChanged } from "firebase/auth";
import {
  getDatabase, ref, get, set, update, runTransaction, onValue, onDisconnect,
} from "firebase/database";
import { FIREBASE_CONFIG } from "./firebaseConfig.js";

let ready = null;

export const firebaseConfigured = () => Boolean(FIREBASE_CONFIG?.databaseURL && FIREBASE_CONFIG?.apiKey);

export function firebaseDb() {
  if (ready) return ready;
  ready = (async () => {
    if (!firebaseConfigured()) throw new Error("The live rooms are not set up yet: the Firebase project has not been connected (see the course README).");
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    const user = await new Promise((resolve, reject) => {
      const off = onAuthStateChanged(auth, (u) => { if (u) { off(); resolve(u); } });
      signInAnonymously(auth).catch((e) => { off(); reject(new Error(`Could not sign in to the room service (${e.code || e.message}).`)); });
    });
    const db = getDatabase(app);
    let offset = 0;
    onValue(ref(db, ".info/serverTimeOffset"), (s) => { offset = s.val() || 0; });
    const listeners = new Set();
    let connected = false;
    onValue(ref(db, ".info/connected"), (s) => { connected = s.val() === true; for (const f of listeners) f(connected); });
    return {
      uid: user.uid,
      now: () => Date.now() + offset,
      get: async (path) => (await get(ref(db, path))).val(),
      set: (path, value) => set(ref(db, path), value),
      update: (path, values) => update(ref(db, path), values),
      txn: async (path, fn) => {
        const r = await runTransaction(ref(db, path), (cur) => fn(cur), { applyLocally: false });
        return { committed: r.committed, value: r.snapshot.val() };
      },
      listen: (path, cb) => onValue(ref(db, path), (s) => cb(s.val())),
      presence: (path) => {
        const r = ref(db, path);
        const mark = (on) => { if (on) onDisconnect(r).remove().then(() => set(r, true)).catch(() => {}); };
        listeners.add(mark);
        mark(connected);
      },
      onConnection: (f) => { listeners.add(f); f(connected); return () => listeners.delete(f); },
    };
  })();
  ready.catch(() => { ready = null; });
  return ready;
}
