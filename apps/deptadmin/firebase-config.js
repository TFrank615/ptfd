// firebase-config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
// Added 'limit' to the list below
import { getFirestore, collection, addDoc, getDocs, doc, getDoc, query, where, orderBy, onSnapshot, setDoc, deleteDoc, limit } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBsaM_8RjTsgaSOPrOkyaK1DXghCHumxkc",
  authDomain: "pleasant-fire.firebaseapp.com",
  projectId: "pleasant-fire",
  storageBucket: "pleasant-fire.firebasestorage.app",
  messagingSenderId: "107375626982",
  appId: "1:107375626982:web:97eed5f81377b15eba8927",
  measurementId: "G-TT4G7K37M2"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

export { db, collection, addDoc, getDocs, doc, getDoc, query, where, orderBy, onSnapshot, setDoc, deleteDoc, limit };