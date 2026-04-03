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

function getPresentationPreferenceLabel(value) {
  if (value === "poster_only") return "Poster only";
  return "Oral or Poster";
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

function sanitizeFileName(name) {
  return (name || "abstract")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

function buildAffiliationMap(authors) {
  const affToIndex = new Map();
  const orderedAffiliations = [];

  authors.forEach((author) => {
    const aff = (author.affiliation || "").trim();
    if (!aff) return;

    if (!affToIndex.has(aff)) {
      affToIndex.set(aff, orderedAffiliations.length + 1);
      orderedAffiliations.push(aff);
    }
  });

  return { affToIndex, orderedAffiliations };
}

function splitLongText(doc, text, maxWidth) {
  return doc.splitTextToSize(text || "", maxWidth);
}

function ensurePageSpace(doc, y, neededHeight, pageHeight, margin, addPageNumberFn) {
  if (y + neededHeight > pageHeight - margin) {
    addPageNumberFn();
    doc.addPage();
    return margin;
  }
  return y;
}

function collectAuthors() {
  const names = document.querySelectorAll(".author-name");
  const affs = document.querySelectorAll(".author-aff");
  const emails = document.querySelectorAll(".author-email");
  const corresponding = document.querySelectorAll(".author-corresponding");

  const authors = [];

  for (let i = 0; i < names.length; i++) {
    const name = names[i].value.trim();
    const affiliation = affs[i].value.trim();
    const email = emails[i].value.trim();
    const isCorresponding = corresponding[i].checked;

    if (!name && !affiliation && !email) continue;

    authors.push({
      order: i + 1,
      name,
      affiliation,
      email,
      isCorresponding
    });
  }

  return authors;
}

function fillFormFromPaper(data) {
  if (byId("title")) byId("title").value = data.title || "";
  if (byId("abstract")) byId("abstract").value = data.abstractText || "";
  if (byId("acknowledgement")) byId("acknowledgement").value = data.acknowledgement || "";
  if (byId("references")) byId("references").value = data.references || "";
  if (byId("presentationPreference")) {
  byId("presentationPreference").value = data.presentationPreference || "oral_or_poster";
  }

  clearAuthors();
  if (data.authors?.length) {
    data.authors.forEach(a => addAuthor(a));
  } else {
    addAuthor();
  }

  setEditingInfo(data.paperId || currentEditingDocId || "Draft", data.status || "draft");
}

function toSuperscript(num) {
  const map = {
    "0":"⁰","1":"¹","2":"²","3":"³","4":"⁴",
    "5":"⁵","6":"⁶","7":"⁷","8":"⁸","9":"⁹"
  };
  return String(num).split("").map(d => map[d] || d).join("");
}

// ---------------- OPTIONAL AUTH STATE INFO ----------------
onAuthStateChanged(auth, (user) => {
  console.log("Auth state:", user ? user.email : "signed out");
});

window.previewPdf = async () => {
  try {
    const title = safeValue("title");
    const abstractText = safeValue("abstract");
    const acknowledgement = safeValue("acknowledgement");
    const references = safeValue("references");
    const presentationPreference = safeValue("presentationPreference") || "oral_or_poster";
    const authors = collectAuthors();

    if (!title) {
      alert("Title required.");
      return;
    }

    if (authors.length === 0) {
      alert("At least one author is required.");
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
    const usableWidth = pageWidth - margin * 2;

    let y = margin;
    let pageNum = 1;

    function sanitizeFileName(name) {
      return (name || "abstract")
        .replace(/[\\/:*?"<>|]+/g, "")
        .replace(/\s+/g, "_")
        .slice(0, 80);
    }

    function buildAffiliationMap(authors) {
      const affToIndex = new Map();
      const orderedAffiliations = [];

      authors.forEach((author) => {
        const aff = (author.affiliation || "").trim();
        if (!aff) return;

        if (!affToIndex.has(aff)) {
          affToIndex.set(aff, orderedAffiliations.length + 1);
          orderedAffiliations.push(aff);
        }
      });

      return { affToIndex, orderedAffiliations };
    }

    function splitLongText(text, maxWidth) {
      return doc.splitTextToSize(text || "", maxWidth);
    }

    function addPageNumber() {
      doc.setFont("times", "normal");
      doc.setFontSize(10);
      doc.text(String(pageNum), pageWidth / 2, pageHeight - 10, { align: "center" });
      pageNum += 1;
    }

    function ensurePageSpace(neededHeight) {
      if (y + neededHeight > pageHeight - margin) {
        addPageNumber();
        doc.addPage();
        y = margin;
      }
    }

    function writeWrappedBlock(text, options = {}) {
      const {
        font = "times",
        style = "normal",
        size = 11,
        align = "left",
        x = margin,
        width = usableWidth,
        lineHeight = 5.5,
        after = 0
      } = options;

      doc.setFont(font, style);
      doc.setFontSize(size);

      const lines = splitLongText(text, width);
      lines.forEach((line) => {
        ensurePageSpace(lineHeight + 1);
        if (align === "center") {
          doc.text(line, pageWidth / 2, y, { align: "center" });
        } else {
          doc.text(line, x, y, { align: "left" });
        }
        y += lineHeight;
      });

      y += after;
    }

    function writeSectionTitle(text) {
      ensurePageSpace(10);
      doc.setFont("times", "bold");
      doc.setFontSize(12);
      doc.text(text, margin, y);
      y += 7;
    }

    const { affToIndex, orderedAffiliations } = buildAffiliationMap(authors);

    // ---------------------------
    // 1) Title
    // ---------------------------
    writeWrappedBlock(title, {
      font: "times",
      style: "bold",
      size: 16,
      align: "center",
      width: usableWidth,
      lineHeight: 8,
      after: 4
    });

  // ---------------------------
// 2) Authors with superscript affiliation number + corresponding author *
// ---------------------------
const authorLine = authors.map((author) => {
  const aff = (author.affiliation || "").trim();
  const idx = aff ? affToIndex.get(aff) : "";
  const sup = idx ? toSuperscript(idx) : "";
  const star = author.isCorresponding ? "*" : "";

  return `${author.name}${sup}${star}`;
}).join(", ");

writeWrappedBlock(authorLine, {
  font: "times",
  style: "normal",
  size: 11,
  align: "center",
  width: usableWidth,
  lineHeight: 6.5,
  after: 3
});

    // ---------------------------
    // 3) Affiliation mapping
    // ---------------------------
    orderedAffiliations.forEach((aff, i) => {
      writeWrappedBlock(`${toSuperscript(i + 1)} ${aff}`, {
        font: "times",
        style: "normal",
        size: 10,
        align: "center",
        width: usableWidth,
        lineHeight: 5
      });
    });

    // ---------------------------
    // 4) Corresponding author email
    // ---------------------------
    const correspondingAuthors = authors.filter(a => a.isCorresponding);
    if (correspondingAuthors.length > 0) {
      const corrEmailLine = `* Corresponding author: ${correspondingAuthors.map(a => a.email).filter(Boolean).join(", ")}`;
      y += 2;
      writeWrappedBlock(corrEmailLine, {
        font: "times",
        style: "italic",
        size: 10,
        align: "center",
        width: usableWidth,
        lineHeight: 5,
        after: 2
      });
    }


    // ---------------------------
    // 6) Abstract
    // ---------------------------
    writeSectionTitle("Abstract");
    writeWrappedBlock(abstractText || "-", {
      font: "times",
      style: "normal",
      size: 11,
      align: "left",
      width: usableWidth,
      lineHeight: 5.5,
      after: 5
    });

    // ---------------------------
    // 7) Acknowledgement
    // ---------------------------
    if (acknowledgement) {
      writeSectionTitle("Acknowledgement");
      writeWrappedBlock(acknowledgement, {
        font: "times",
        style: "normal",
        size: 11,
        align: "left",
        width: usableWidth,
        lineHeight: 5.5,
        after: 5
      });
    }

    // ---------------------------
    // 8) References
    // ---------------------------
    if (references) {
      writeSectionTitle("References");

      const refLines = references
        .split(/\n+/)
        .map(r => r.trim())
        .filter(Boolean);

      if (refLines.length === 0) {
        writeWrappedBlock(references, {
          font: "times",
          style: "normal",
          size: 10.5,
          align: "left",
          width: usableWidth,
          lineHeight: 5.2,
          after: 4
        });
      } else {
        refLines.forEach((refText) => {
          writeWrappedBlock(refText, {
            font: "times",
            style: "normal",
            size: 10.5,
            align: "left",
            width: usableWidth,
            lineHeight: 5.2,
            after: 1
          });
        });
        y += 3;
      }
    }

    // ---------------------------
    // 9) Author information
    // ---------------------------
    //Author Information removed for submission version
    /*
    writeSectionTitle("Author Information");

    authors.forEach((author, idx) => {
      const marker = author.isCorresponding ? " (Corresponding author)" : "";
      const block = [
        `${idx + 1}. ${author.name || ""}${marker}`,
        `Affiliation: ${author.affiliation || "-"}`,
        `Email: ${author.email || "-"}`
      ];

      block.forEach((line) => {
        writeWrappedBlock(line, {
          font: "times",
          style: "normal",
          size: 10.5,
          align: "left",
          width: usableWidth,
          lineHeight: 5.2
        });
      });

      y += 2;
    });
    */

    // final page number
    addPageNumber();

    const fileName = sanitizeFileName(title) + ".pdf";
    doc.save(fileName);

  } catch (err) {
    console.error(err);
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
window.addAuthor = (author = null) => {
  const container = document.getElementById("authors");
  if (!container) return;

  const div = document.createElement("div");
  div.className = "author-block";
  div.style.marginBottom = "10px";

  div.innerHTML = `
    <input placeholder="Name" class="author-name" value="${author?.name || ""}">
    <input placeholder="Affiliation" class="author-aff" value="${author?.affiliation || ""}">
    <input placeholder="Email" class="author-email" type="email" value="${author?.email || ""}">
    
    <label style="display:block; margin:6px 0;">
      <input type="radio" name="correspondingAuthor" class="author-corresponding" ${author?.isCorresponding ? "checked" : ""}>
      Corresponding author
    </label>

    <button type="button" class="remove-author-btn">Remove</button>
  `;

  // 삭제 버튼 동작
  div.querySelector(".remove-author-btn").onclick = () => div.remove();

  container.appendChild(div);
};


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
    const acknowledgement = safeValue("acknowledgement");
    const references = safeValue("references");
    const presentationPreference = safeValue("presentationPreference") || "oral_or_poster";
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
        presentationPreference,
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
    const acknowledgement = safeValue("acknowledgement");
    const references = safeValue("references");
    const presentationPreference = safeValue("presentationPreference") || "oral_or_poster";
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
        acknowledgement,
        references,
        presentationPreference,
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
