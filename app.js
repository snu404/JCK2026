// ---------------- FIREBASE IMPORT ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------------- INIT ----------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- AUTH ----------------

window.register = async () => {
  try {
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("password").value;

    if (!email || !pw) {
      alert("Please enter email and password.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pw);

    alert("✅ Registered: " + cred.user.email);

  } catch (err) {
    console.error("Register error:", err);
    alert("❌ Register failed:\n" + err.message);
  }
};

window.login = async () => {
  try {
    const email = document.getElementById("email").value.trim();
    const pw = document.getElementById("password").value;

    if (!email || !pw) {
      alert("Please enter email and password.");
      return;
    }

    const cred = await signInWithEmailAndPassword(auth, email, pw);

    alert("✅ Login success");
    location.href = "submit.html";

  } catch (err) {
    console.error("Login error:", err);
    alert("❌ Login failed:\n" + err.message);
  }
};

// ---------------- AUTHORS ----------------

window.addAuthor = () => {
  const container = document.getElementById("authors");

  const div = document.createElement("div");
  div.style.marginBottom = "10px";

  div.innerHTML = `
    <input placeholder="Name" class="author-name">
    <input placeholder="Affiliation" class="author-aff">
    <input placeholder="Email" class="author-email">
  `;

  container.appendChild(div);
};

function collectAuthors() {
  const names = document.querySelectorAll(".author-name");
  const affs = document.querySelectorAll(".author-aff");
  const emails = document.querySelectorAll(".author-email");

  const authors = [];

  for (let i = 0; i < names.length; i++) {
    if (!names[i].value) continue;

    authors.push({
      name: names[i].value,
      affiliation: affs[i].value,
      email: emails[i].value
    });
  }

  return authors;
}

// ---------------- PAPER ID ----------------

async function generatePaperId() {
  const counterRef = doc(db, "counters", "papers");

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);

    let count = 0;
    if (snap.exists()) {
      count = snap.data().count;
    }

    count++;

    tx.set(counterRef, { count });

    return "JCK2026-" + String(count).padStart(4, "0");
  });
}

// ---------------- SAVE DRAFT ----------------

window.saveDraft = async () => {
  try {
    const title = document.getElementById("title").value;
    const abstract = document.getElementById("abstract").value;
    const authors = collectAuthors();

    if (!title) {
      alert("Title required");
      return;
    }

    await addDoc(collection(db, "papers"), {
      title,
      abstract,
      authors,
      status: "draft",
      createdAt: serverTimestamp()
    });

    alert("✅ Draft saved");

  } catch (err) {
    console.error("Draft error:", err);
    alert("❌ Failed to save draft:\n" + err.message);
  }
};

// ---------------- FINAL SUBMIT ----------------

window.finalSubmit = async () => {
  try {
    const title = document.getElementById("title").value;
    const abstract = document.getElementById("abstract").value;
    const authors = collectAuthors();

    if (!title || !abstract) {
      alert("Title and abstract required");
      return;
    }

    if (authors.length === 0) {
      alert("At least one author required");
      return;
    }

    const paperId = await generatePaperId();

    await addDoc(collection(db, "papers"), {
      paperId,
      title,
      abstract,
      authors,
      presenterName: authors[0].name,
      presenterAffiliation: authors[0].affiliation,
      status: "submitted",
      createdAt: serverTimestamp()
    });

    alert("🎉 Submitted successfully!\nPaper ID: " + paperId);

  } catch (err) {
    console.error("Submit error:", err);
    alert("❌ Submit failed:\n" + err.message);
  }
};

// ---------------- ADMIN LOAD ----------------

window.loadPapers = async () => {
  try {
    const snap = await getDocs(collection(db, "papers"));

    let html = `
      <tr>
        <th>Paper ID</th>
        <th>Title</th>
        <th>Status</th>
      </tr>
    `;

    snap.forEach(doc => {
      const d = doc.data();

      html += `
        <tr>
          <td>${d.paperId || "-"}</td>
          <td>${d.title || ""}</td>
          <td>${d.status || ""}</td>
        </tr>
      `;
    });

    document.getElementById("table").innerHTML = html;

  } catch (err) {
    console.error("Admin load error:", err);
    alert("❌ Failed to load papers:\n" + err.message);
  }
};
