/* The Firebase project of the live rooms (web configuration — public by design;
 * the database rules in firebase/database.rules.json protect the data).
 * A build can override it with VITE_FIREBASE_CONFIG (the same object as JSON). */
const FROM_ENV = (() => {
  try { return import.meta.env?.VITE_FIREBASE_CONFIG ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG) : null; } catch { return null; }
})();

export const FIREBASE_CONFIG = FROM_ENV ?? {
  // Project ufv-price-rooms (Spark, free) — Project settings → Your apps → Web app.
  apiKey: "AIzaSyC_anFeXdJw0ZT1oF96H9iOqplFl7Xl7-0",
  authDomain: "ufv-price-rooms.firebaseapp.com",
  databaseURL: "https://ufv-price-rooms-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "ufv-price-rooms",
  storageBucket: "ufv-price-rooms.firebasestorage.app",
  messagingSenderId: "1077723304460",
  appId: "1:1077723304460:web:dcc80428d4201ffab89429",
};
