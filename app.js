// ---------------- FIREBASE IMPORT ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  setDoc,
  runTransaction,
  serverTimestamp,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------------- INIT ----------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- HELPERS ----------------
function byId(id) {
  return document.getElementById(id);
}

function safeValue(id) {
  const el = byId(id);
  return el ? el.value.trim() : "";
}

function normalizeTitle(title) {
  return (title || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^\w\s-]/g, "");
}

function makeSubmissionKey(uid, title) {
  const normalized = normalizeTitle(title)
    .replace(/\s+/g, "-")
    .slice(0, 120);

  return `${uid}__${normalized}`;
}

function showError(prefix, err) {
  console.error(prefix, err);
  alert(`${prefix}\n${err?.message || err}`);
}

function ensureLoggedIn() {
  const user = auth.currentUser;
  if (!user) {
    alert("Please login first.");
    return null;
  }
  return user;
}

// ---------------- OPTIONAL AUTH STATE INFO ----------------
onAuthStateChanged(auth, (user) => {
  console.log("Auth state:", user ? user.email : "signed out");
});

window.previewPdf = async () => {
  try {
    const title = safeValue("title");
    const abstractText = safeValue("abstract");
    const authors = collectAuthors();

    if (!title) {
      alert("Title required.");
      return;
    }

    if (!window.jspdf || !window.jspdf.jsPDF) {
      alert("jsPDF library is not loaded.");
      return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      unit: "mm",
      format: "a4"
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    const maxWidth = pageWidth - margin * 2;
    let y = 20;

    function addWrappedText(text, x, yPos, width, lineHeight = 6) {
      const lines = doc.splitTextToSize(text || "", width);
      doc.text(lines, x, yPos);
      return yPos + lines.length * lineHeight;
    }

    function ensurePageSpace(nextBlockHeight = 10) {
      if (y + nextBlockHeight > pageHeight - 20) {
        doc.addPage();
        y = 20;
      }
    }

    // Title
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    ensurePageSpace(20);
    y = addWrappedText(title, margin, y, maxWidth, 7);

    // Authors
    y += 4;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);

    const authorLine = authors.length
      ? authors.map(a => a.name).join(", ")
      : "-";
    ensurePageSpace(12);
    y = addWrappedText(`Authors: ${authorLine}`, margin, y, maxWidth, 6);

    const affLine = authors.length
      ? authors.map((a, i) => `${i + 1}. ${a.affiliation || "-"}`).join("   ")
      : "-";
    ensurePageSpace(12);
    y = addWrappedText(`Affiliations: ${affLine}`, margin, y + 2, maxWidth, 6);

    const emailLine = authors.length
      ? authors.map(a => a.email || "-").join(", ")
      : "-";
    ensurePageSpace(12);
    y = addWrappedText(`Emails: ${emailLine}`, margin, y + 2, maxWidth, 6);

    // Abstract heading
    y += 6;
    ensurePageSpace(12);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.text("Abstract", margin, y);

    // Abstract body
    y += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    ensurePageSpace(20);
    y = addWrappedText(abstractText || "-", margin, y, maxWidth, 5.5);

    // Footer
    y += 10;
    ensurePageSpace(10);
    doc.setFontSize(9);
    doc.text("Generated from JCK Abstract Submission Portal", margin, y);

    const fileName = (title || "abstract")
      .replace(/[\\/:*?"<>|]+/g, "")
      .slice(0, 80) + ".pdf";

    doc.save(fileName);
  } catch (err) {
    console.error("PDF generation error:", err);
    alert("Failed to generate PDF:\n" + (err.message || err));
  }
};

// ---------------- AUTH ----------------
window.register = async () => {
  try {
    const email = safeValue("email");
    const pw = byId("password") ? byId("password").value : "";

    if (!email || !pw) {
      alert("Please enter email and password.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pw);
    alert("✅ Registered: " + cred.user.email);
  } catch (err) {
    showError("❌ Register failed:", err);
  }
};

window.login = async () => {
  try {
    const email = safeValue("email");
    const pw = byId("password") ? byId("password").value : "";

    if (!email || !pw) {
      alert("Please enter email and password.");
      return;
    }

    await signInWithEmailAndPassword(auth, email, pw);
    alert("✅ Login success");
    location.href = "submit.html";
  } catch (err) {
    showError("❌ Login failed:", err);
  }
};

// ---------------- AUTHORS ----------------
window.addAuthor = () => {
  const container = byId("authors");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "author-block";
  div.style.marginBottom = "10px";

  div.innerHTML = `
    <input placeholder="Name" class="author-name">
    <input placeholder="Affiliation" class="author-aff">
    <input placeholder="Email" class="author-email" type="email">
  `;

  container.appendChild(div);
};

function collectAuthors() {
  const names = document.querySelectorAll(".author-name");
  const affs = document.querySelectorAll(".author-aff");
  const emails = document.querySelectorAll(".author-email");

  const authors = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i].value.trim();
    const affiliation = affs[i].value.trim();
    const email = emails[i].value.trim();

    if (!name && !affiliation && !email) continue;

    authors.push({
      order: i + 1,
      name,
      affiliation,
      email
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
      count = snap.data().count || 0;
    }

    count += 1;

    tx.set(counterRef, { count }, { merge: true });

    return "JCK2026-" + String(count).padStart(4, "0");
  });
}

// ---------------- DRAFT SAVE ----------------
window.saveDraft = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const title = safeValue("title");
    const abstractText = safeValue("abstract");
    const authors = collectAuthors();

    if (!title) {
      alert("Title required");
      return;
    }

    const submissionKey = makeSubmissionKey(user.uid, title);
    const paperRef = doc(db, "papers", submissionKey);
    const existingSnap = await getDoc(paperRef);

    if (existingSnap.exists() && existingSnap.data().status === "submitted") {
      alert("This paper has already been submitted and cannot be saved as a new draft.");
      return;
    }

    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    await setDoc(
      paperRef,
      {
        submissionKey,
        userUid: user.uid,
        submitterEmail: user.email,
        title,
        abstractText,
        authors,
        presenterName: authors[0]?.name || "",
        presenterAffiliation: authors[0]?.affiliation || "",
        status: "draft",
        createdAt: existingData?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    alert("✅ Draft saved");
  } catch (err) {
    showError("❌ Failed to save draft:", err);
  }
};

// ---------------- FINAL SUBMIT ----------------
window.finalSubmit = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const title = safeValue("title");
    const abstractText = safeValue("abstract");
    const authors = collectAuthors();

    if (!title || !abstractText) {
      alert("Title and abstract are required.");
      return;
    }

    if (authors.length === 0) {
      alert("At least one author is required.");
      return;
    }

    if (!authors[0].name || !authors[0].affiliation || !authors[0].email) {
      alert("The first author must have name, affiliation, and email.");
      return;
    }

    const submissionKey = makeSubmissionKey(user.uid, title);
    const paperRef = doc(db, "papers", submissionKey);
    const existingSnap = await getDoc(paperRef);

    if (existingSnap.exists() && existingSnap.data().status === "submitted") {
      alert("❌ Duplicate submission blocked.\nThis title has already been submitted by your account.");
      return;
    }

    let paperId = existingSnap.exists() ? existingSnap.data().paperId : null;
    if (!paperId) {
      paperId = await generatePaperId();
    }

    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    await setDoc(
      paperRef,
      {
        submissionKey,
        userUid: user.uid,
        submitterEmail: user.email,
        paperId,
        title,
        abstractText,
        authors,
        presenterName: authors[0]?.name || "",
        presenterAffiliation: authors[0]?.affiliation || "",
        presenterEmail: authors[0]?.email || "",
        status: "submitted",
        createdAt: existingData?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    alert("🎉 Submitted successfully!\nPaper ID: " + paperId);
  } catch (err) {
    showError("❌ Submit failed:", err);
  }
};

// ---------------- ADMIN LOAD ----------------
window.loadPapers = async () => {
  try {
    const table = byId("table");
    if (!table) return;

    const snap = await getDocs(collection(db, "papers"));

    let html = `
      <tr>
        <th>Paper ID</th>
        <th>Title</th>
        <th>Status</th>
        <th>Presenter</th>
        <th>Email</th>
      </tr>
    `;

    snap.forEach((paperDoc) => {
      const d = paperDoc.data();

      html += `
        <tr>
          <td>${d.paperId || "-"}</td>
          <td>${d.title || ""}</td>
          <td>${d.status || ""}</td>
          <td>${d.presenterName || ""}</td>
          <td>${d.presenterEmail || d.submitterEmail || ""}</td>
        </tr>
      `;
    });

    table.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load papers:", err);
  }
};

// ---------------- OPTIONAL: LOAD MY SUBMISSIONS ----------------
window.loadMyPapers = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const container = byId("myPapers");
    if (!container) return;

    const q = query(collection(db, "papers"), where("userUid", "==", user.uid));
    const snap = await getDocs(q);

    if (snap.empty) {
      container.innerHTML = "<p>No submissions yet.</p>";
      return;
    }

    let html = "<ul>";
    snap.forEach((paperDoc) => {
      const d = paperDoc.data();
      html += `
        <li>
          <strong>${d.paperId || "(draft)"}</strong> - ${d.title || ""}
          <br>Status: ${d.status || ""}
        </li>
      `;
    });
    html += "</ul>";

    container.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load my submissions:", err);
  }
};
