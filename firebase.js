import { initializeApp } from "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js";

import {
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js";

import {
  getDatabase,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-database.js";

import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js";

import {
  getStorage,
  ref as storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
} from "https://www.gstatic.com/firebasejs/12.16.0/firebase-storage.js";

export const firebaseConfig = {
  apiKey: "AIzaSyBfBsu81ykk11hz-jX0_E6TrAriQCTZYJ8",
  authDomain: "wiscodery-forensic.firebaseapp.com",
  databaseURL: "https://wiscodery-forensic-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "wiscodery-forensic",
  storageBucket: "wiscodery-forensic.firebasestorage.app",
  messagingSenderId: "1032205659317",
  appId: "1:1032205659317:web:4ba6efda150b1bab64e2fc",
  measurementId: "G-CK43JWDQ5C"
};

export const BOOTSTRAP_ADMIN_UID = "NkBCSA8109gLUz0lwrlvVU2Q02H3";

const firebaseApp = initializeApp(firebaseConfig);

export const auth = getAuth(firebaseApp);
export const db = getDatabase(firebaseApp);
export const firestore = getFirestore(firebaseApp);
export const storage = getStorage(firebaseApp);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });

export {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  ref,
  get,
  set,
  update,
  remove,
  push,
  onValue,
  runTransaction,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  storageRef,
  uploadBytesResumable,
  getDownloadURL,
  deleteObject
};
