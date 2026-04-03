import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore, collection, addDoc, getDocs, doc, getDoc, runTransaction
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- AUTH ----------------

window.register = async () => {
  const email = document.getElementById("email").value;
  const pw = document.getElementById("password").value;

  await createUserWithEmailAndPassword(auth, email, pw);
  alert("Registered");
};

window.login = async () => {
  const email = document.getElementById("email").value;
  const pw = document.getElementById("password").value;

  await signInWithEmailAndPassword(auth, email, pw);
  location.href = "submit.html";
};

// ---------------- AUTHORS ----------------

window.addAuthor = () => {
  const div = document.createElement("div");
  div.innerHTML = `
    <input placeholder="Name">
    <input placeholder="Affiliation">
    <input placeholder="Email">
  `;
  document.getElementById("authors").appendChild(div);
};

// ---------------- PAPER ID ----------------

async function generatePaperId() {
  const counterRef = doc(db, "counters", "papers");

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    let count = snap.exists() ? snap.data().count : 0;
    count++;

    tx.set(counterRef, { count });

    return "JCK2026-" + String(count).padStart(4, "0");
  });
}

// ---------------- SUBMIT ----------------

window.saveDraft = async () => {
  await addDoc(collection(db, "papers"), {
    title: document.getElementById("title").value,
    abstract: document.getElementById("abstract").value,
    status: "draft",
    createdAt: new Date()
  });

  alert("Draft saved");
};

window.finalSubmit = async () => {

  const paperId = await generatePaperId();

  await addDoc(collection(db, "papers"), {
    paperId,
    title: document.getElementById("title").value,
    abstract: document.getElementById("abstract").value,
    status: "submitted",
    createdAt: new Date()
  });

  alert("Submitted: " + paperId);
};

// ---------------- ADMIN ----------------

window.loadPapers = async () => {
  const snap = await getDocs(collection(db, "papers"));
  let html = "";

  snap.forEach(doc => {
    const d = doc.data();
    html += `<tr><td>${d.paperId || "-"}</td><td>${d.title}</td></tr>`;
  });

  document.getElementById("table").innerHTML = html;
};
