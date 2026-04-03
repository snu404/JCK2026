// ---------------- FIREBASE IMPORT ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
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
  //orderBy
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------------- INIT ----------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------------- STATE ----------------
let currentEditingDocId = null;
let currentEditingData = null;

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

function toSuperscript(num) {
  const map = {
    "0": "⁰",
    "1": "¹",
    "2": "²",
    "3": "³",
    "4": "⁴",
    "5": "⁵",
    "6": "⁶",
    "7": "⁷",
    "8": "⁸",
    "9": "⁹"
  };
  return String(num).split("").map(d => map[d] || d).join("");
}

function clearAuthors() {
  const container = byId("authors");
  if (container) container.innerHTML = "";
}

function setEditingInfo(paperIdText = "New submission", statusText = "draft") {
  if (byId("editingPaperId")) byId("editingPaperId").textContent = paperIdText;
  if (byId("editingStatus")) byId("editingStatus").textContent = statusText;
}

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

  div.querySelector(".remove-author-btn").onclick = () => div.remove();
  container.appendChild(div);
};

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
    data.authors.forEach(a => window.addAuthor(a));
  } else {
    window.addAuthor();
  }

  setEditingInfo(data.paperId || currentEditingDocId || "Draft", data.status || "draft");
}

// ---------------- OPTIONAL AUTH STATE INFO ----------------
onAuthStateChanged(auth, (user) => {
  console.log("Auth state:", user ? user.email : "signed out");
});

// ---------------- PDF GENERATION ----------------
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
    const pdf = new jsPDF({
      unit: "mm",
      format: "a4"
    });

    const pageWidth = 210;
    const pageHeight = 297;
    const margin = 20;
    const usableWidth = pageWidth - margin * 2;

    const paperIdText = currentEditingData?.paperId || "DRAFT";
    const conferenceName = "JCK MEMS/NEMS 2026";
    const generatedDate = new Date().toISOString().slice(0, 10);

    let y = margin;
    let pageNum = 1;

    function addFooter() {
      pdf.setFont("Times", "normal");
      pdf.setFontSize(9);
      pdf.text(conferenceName, margin, pageHeight - 10, { align: "left" });
      pdf.text(`Paper ID: ${paperIdText}`, pageWidth / 2, pageHeight - 10, { align: "center" });
      pdf.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 10, { align: "right" });
      pageNum += 1;
    }

    function ensurePageSpace(neededHeight) {
      if (y + neededHeight > pageHeight - margin - 10) {
        addFooter();
        pdf.addPage();
        y = margin;
      }
    }

    function splitLongText(text, maxWidth) {
      return pdf.splitTextToSize(text || "", maxWidth);
    }
    
    function drawJustifiedText(doc, text, x, y, maxWidth, lineHeight) {
      const words = text.split(" ");
      let line = [];
      let lineWidth = 0;
    
      const spaceWidth = doc.getTextWidth(" ");
    
      const lines = [];
      let currentLine = [];
    
      words.forEach((word) => {
        const wordWidth = doc.getTextWidth(word);
    
        if (lineWidth + wordWidth > maxWidth) {
          lines.push(currentLine);
          currentLine = [word];
          lineWidth = wordWidth + spaceWidth;
        } else {
          currentLine.push(word);
          lineWidth += wordWidth + spaceWidth;
        }
      });
    
      if (currentLine.length) lines.push(currentLine);
    
      lines.forEach((wordsInLine, i) => {
        const isLastLine = i === lines.length - 1;
    
        let lineText = wordsInLine.join(" ");
    
        if (isLastLine) {
          doc.text(lineText, x, y);
        } else {
          let totalWordsWidth = wordsInLine.reduce(
            (sum, w) => sum + doc.getTextWidth(w),
            0
          );
    
          let totalSpaces = wordsInLine.length - 1;
          let space = (maxWidth - totalWordsWidth) / totalSpaces;
    
          let cursorX = x;
    
          wordsInLine.forEach((word, idx) => {
            doc.text(word, cursorX, y);
            if (idx < totalSpaces) {
              cursorX += doc.getTextWidth(word) + space;
            }
          });
        }
    
        y += lineHeight;
      });
    
      return y;
    }
    
    function writeWrappedBlock(text, options = {}) {
      const {
        font = "Times",
        style = "normal",
        size = 11,
        align = "left",     // "left" | "center" | "justify"
        x = margin,
        width = usableWidth,
        lineHeight = 5.5,
        after = 0
      } = options;
    
      pdf.setFont(font, style);
      pdf.setFontSize(size);
    
      const cleanText = (text || "")
        .replace(/\s+/g, " ")
        .replace(/ﬁ/g, "fi")
        .replace(/ﬂ/g, "fl")
        .trim();
    
      const lines = splitLongText(cleanText, width);
    
      lines.forEach((line, idx) => {
        ensurePageSpace(lineHeight + 1);
    
        if (align === "center") {
          pdf.text(line, pageWidth / 2, y, { align: "center" });
    
        } else if (align === "justify") {
          const isLastLine = idx === lines.length - 1;
          const words = line.trim().split(/\s+/);
    
          // 마지막 줄이거나 단어가 1개뿐이면 왼쪽 정렬
          if (isLastLine || words.length <= 1) {
            pdf.text(line, x, y, { align: "left" });
          } else {
            const wordsWidth = words.reduce((sum, word) => sum + pdf.getTextWidth(word), 0);
            const gaps = words.length - 1;
            const gapWidth = (width - wordsWidth) / gaps;
    
            let cursorX = x;
            words.forEach((word, wIdx) => {
              pdf.text(word, cursorX, y);
              if (wIdx < gaps) {
                cursorX += pdf.getTextWidth(word) + gapWidth;
              }
            });
          }
    
        } else {
          pdf.text(line, x, y, { align: "left" });
        }
    
        y += lineHeight;
      });
    
      y += after;
    }
    
    function writeSectionTitle(text) {
      ensurePageSpace(10);
      pdf.setFont("Times", "bold");
      pdf.setFontSize(12);
      pdf.text(text, margin, y);
      y += 7;
    }

    const { affToIndex, orderedAffiliations } = buildAffiliationMap(authors);

    // Title
    writeWrappedBlock(title, {
      font: "Times",
      style: "bold",
      size: 16,
      align: "center",
      width: usableWidth,
      lineHeight: 8,
      after: 6
    });

    // Authors
    const authorLine = authors.map((author) => {
      const aff = (author.affiliation || "").trim();
      const idx = aff ? affToIndex.get(aff) : "";
      const sup = idx ? toSuperscript(idx) : "";
      const star = author.isCorresponding ? "*" : "";
      return `${author.name}${sup}${star}`;
    }).join(", ");

    writeWrappedBlock(authorLine, {
      font: "Times",
      style: "normal",
      size: 11,
      align: "center",
      width: usableWidth,
      lineHeight: 6.5,
      after: 3
    });

    // Affiliations
    orderedAffiliations.forEach((aff, i) => {
      writeWrappedBlock(`${toSuperscript(i + 1)}${aff}`, {
        font: "Times",
        style: "normal",
        size: 10,
        align: "center",
        width: usableWidth,
        lineHeight: 5
      });
    });

    // Corresponding author
    const correspondingAuthors = authors.filter(a => a.isCorresponding);
    if (correspondingAuthors.length > 0) {
      const corrEmailLine = `*Corresponding author: ${correspondingAuthors.map(a => a.email).filter(Boolean).join(", ")}`;
      y += 2;
      writeWrappedBlock(corrEmailLine, {
        font: "Times",
        style: "italic",
        size: 10,
        align: "center",
        width: usableWidth,
        lineHeight: 5,
        after: 2
      });
    }

    // Presentation preference
   /* writeWrappedBlock(`Presentation Preference: ${getPresentationPreferenceLabel(presentationPreference)}`, {
      font: "Times",
      style: "normal",
      size: 10,
      align: "center",
      width: usableWidth,
      lineHeight: 5,
      after: 4
    }); */

    // Abstract
    writeSectionTitle("Abstract");
    writeWrappedBlock(abstractText || "-", {
      font: "Times",
      style: "normal",
      size: 11,
      align: "justify",
      width: usableWidth,
      lineHeight: 5.8,
      after: 5
    });

    // Acknowledgement
    if (acknowledgement) {
      writeSectionTitle("Acknowledgement");
      writeWrappedBlock(acknowledgement, {
        font: "Times",
        style: "normal",
        size: 11,
        align: "justify",
        width: usableWidth,
        lineHeight: 5.8,
        after: 5
      });
    }

    // References
    if (references) {
      writeSectionTitle("References");

      const refLines = references
        .split(/\n+/)
        .map(r => r.trim())
        .filter(Boolean);

      if (refLines.length === 0) {
        writeWrappedBlock(references, {
          font: "Times",
          style: "normal",
          size: 10.5,
          align: "justify",
          width: usableWidth,
          lineHeight: 5.2,
          after: 4
        });
      } else {
        refLines.forEach((refText) => {
          writeWrappedBlock(refText, {
            font: "Times",
            style: "normal",
            size: 10.5,
            align: "justify",
            width: usableWidth,
            lineHeight: 5.2,
            after: 1
          });
        });
        y += 3;
      }
    }

    // Final footer
    addFooter();

    const fileName = `${paperIdText}_${sanitizeFileName(title)}.pdf`;
    pdf.save(fileName);

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

window.logout = async () => {
  try {
    await signOut(auth);
    alert("Logged out");
    window.location.href = "index.html";
  } catch (err) {
    showError("Logout failed:", err);
  }
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
        acknowledgement,
        references,
        presentationPreference,
        authors,
        presenterName: authors[0]?.name || "",
        presenterAffiliation: authors[0]?.affiliation || "",
        presenterEmail: authors[0]?.email || "",
        status: "draft",
        createdAt: existingData?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    currentEditingDocId = submissionKey;
    currentEditingData = {
      ...(existingData || {}),
      submissionKey,
      title,
      abstractText,
      acknowledgement,
      references,
      presentationPreference,
      authors,
      presenterName: authors[0]?.name || "",
      presenterAffiliation: authors[0]?.affiliation || "",
      presenterEmail: authors[0]?.email || "",
      status: "draft"
    };

    fillFormFromPaper(currentEditingData);
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

    currentEditingDocId = submissionKey;
    currentEditingData = {
      ...(existingData || {}),
      submissionKey,
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
      status: "submitted"
    };

    fillFormFromPaper(currentEditingData);
    alert("🎉 Submitted successfully!\nPaper ID: " + paperId);
  } catch (err) {
    showError("❌ Submit failed:", err);
  }
};

// ---------------- ADMIN HELPERS ----------------
function getTableHeader() {
  return `
    <tr>
      <th>Paper ID</th>
      <th>Title</th>
      <th>Status</th>
      <th>Preference</th>
      <th>Presenter</th>
      <th>Email</th>
      <th>Action</th>
    </tr>
  `;
}

function buildRow(docId, d) {
  const preferenceLabel = getPresentationPreferenceLabel(d.presentationPreference);

  return `
    <tr>
      <td>${d.paperId || "-"}</td>
      <td>${d.title || ""}</td>
      <td>${d.status || ""}</td>
      <td>${preferenceLabel}</td>
      <td>${d.presenterName || ""}</td>
      <td>${d.presenterEmail || d.submitterEmail || ""}</td>
      <td>
        <button onclick="updateStatus('${docId}', 'accepted')">Accept</button>
        <button onclick="updateStatus('${docId}', 'rejected')">Reject</button>
        <button onclick="updateStatus('${docId}', 'oral')">Oral</button>
        <button onclick="updateStatus('${docId}', 'poster')">Poster</button>
      </td>
    </tr>
  `;
}

// ---------------- ADMIN ACTIONS ----------------
window.updateStatus = async (docId, newStatus) => {
  try {
    await setDoc(doc(db, "papers", docId), {
      status: newStatus,
      updatedAt: serverTimestamp()
    }, { merge: true });

    alert("✅ Status updated");
    window.loadPapers();
  } catch (err) {
    showError("❌ Failed to update status:", err);
  }
};

window.searchPapers = async () => {
  try {
    const keyword = (byId("searchInput")?.value || "").toLowerCase();
    const snap = await getDocs(collection(db, "papers"));

    let html = getTableHeader();

    snap.forEach((docSnap) => {
      const d = docSnap.data();

      const combined = `
        ${d.title || ""}
        ${d.presenterName || ""}
        ${d.presenterEmail || ""}
      `.toLowerCase();

      if (!combined.includes(keyword)) return;
      html += buildRow(docSnap.id, d);
    });

    byId("table").innerHTML = html;
  } catch (err) {
    showError("❌ Search failed:", err);
  }
};

// ---------------- ADMIN LOAD ----------------
window.loadPapers = async () => {
  try {
    const table = byId("table");
    if (!table) return;

    const snap = await getDocs(collection(db, "papers"));

    let html = getTableHeader();

    snap.forEach((paperDoc) => {
      const d = paperDoc.data();
      html += buildRow(paperDoc.id, d);
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
          <br>Preference: ${getPresentationPreferenceLabel(d.presentationPreference)}
        </li>
      `;
    });
    html += "</ul>";

    container.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load my submissions:", err);
  }
};

// ---------------- LOGOUT ----------------
window.logout = async () => {
  try {
    await signOut(auth);
    alert("Logged out");
    window.location.href = "index.html";
  } catch (err) {
    showError("Logout failed:", err);
  }
};

// ---------------- REGISTRATION HELPERS ----------------
function getRegistrationPricePreview(participantType, registrationType) {
  if (participantType === "domestic") {
    if (registrationType === "student") return { amount: TBA, currency: "KRW" };
    if (registrationType === "regular") return { amount: TBA, currency: "KRW" };
    if (registrationType === "vip") return { amount: TBA, currency: "KRW" };
  }

  if (participantType === "international") {
    if (registrationType === "student") return { amount: TBA, currency: "USD" };
    if (registrationType === "regular") return { amount: TBA, currency: "USD" };
    if (registrationType === "vip") return { amount: TBA, currency: "USD" };
  }

  return null;
}

async function generateRegistrationId() {
  const counterRef = doc(db, "counters", "registrations");

  return await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);

    let count = 0;
    if (snap.exists()) {
      count = snap.data().count || 0;
    }

    count += 1;
    tx.set(counterRef, { count }, { merge: true });

    return "REG-2026-" + String(count).padStart(4, "0");
  });
}

function buildRegistrationDocId(userUid, participantType, registrationType) {
  return `${userUid}__${participantType}__${registrationType}`;
}

function registrationStatusLabel(status) {
  if (status === "paid") return "Paid";
  if (status === "pending_payment") return "Pending Payment";
  if (status === "cancelled") return "Cancelled";
  return "Draft";
}

// ---------------- REGISTRATION ADMIN HELPERS ----------------
function getRegistrationTableHeader() {
  return `
    <tr>
      <th>Registration ID</th>
      <th>Name</th>
      <th>Affiliation</th>
      <th>Email</th>
      <th>Participant</th>
      <th>Category</th>
      <th>Amount</th>
      <th>Status</th>
    </tr>
  `;
}

function buildRegistrationRow(d) {
  return `
    <tr>
      <td>${d.registrationId || "-"}</td>
      <td>${d.fullName || ""}</td>
      <td>${d.affiliation || ""}</td>
      <td>${d.email || ""}</td>
      <td>${d.participantType || ""}</td>
      <td>${d.registrationType || ""}</td>
      <td>${d.amount || ""} ${d.currency || ""}</td>
      <td>${registrationStatusLabel(d.paymentStatus)}</td>
    </tr>
  `;
}

// ---------------- ADMIN LOAD REGISTRATIONS ----------------
window.loadRegistrations = async () => {
  try {
    const table = byId("registrationTable");
    if (!table) return;

    const snap = await getDocs(collection(db, "registrations"));

    let html = getRegistrationTableHeader();

    snap.forEach((regDoc) => {
      const d = regDoc.data();
      html += buildRegistrationRow(d);
    });

    table.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load registrations:", err);
  }
};

// ---------------- ADMIN SEARCH REGISTRATIONS ----------------
window.searchRegistrations = async () => {
  try {
    const keyword = (byId("registrationSearchInput")?.value || "").toLowerCase();
    const table = byId("registrationTable");
    if (!table) return;

    const snap = await getDocs(collection(db, "registrations"));

    let html = getRegistrationTableHeader();

    snap.forEach((regDoc) => {
      const d = regDoc.data();

      const combined = `
        ${d.fullName || ""}
        ${d.email || ""}
        ${d.affiliation || ""}
        ${d.registrationId || ""}
      `.toLowerCase();

      if (!combined.includes(keyword)) return;

      html += buildRegistrationRow(d);
    });

    table.innerHTML = html;
  } catch (err) {
    showError("❌ Registration search failed:", err);
  }
};

// ---------------- SAVE REGISTRATION DRAFT ----------------
window.saveRegistrationDraft = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const participantType = safeValue("participantType");
    const registrationType = safeValue("registrationType");
    const fullName = safeValue("fullName");
    const affiliation = safeValue("affiliation");
    const email = safeValue("regEmail");
    const phone = safeValue("phone");

    if (!participantType || !registrationType || !fullName || !email) {
      alert("Please fill in participant type, registration type, full name, and email.");
      return;
    }

    const pricing = getRegistrationPricePreview(participantType, registrationType);
    if (!pricing) {
      alert("Invalid registration information.");
      return;
    }

    const regDocId = buildRegistrationDocId(user.uid, participantType, registrationType);
    const regRef = doc(db, "registrations", regDocId);
    const existingSnap = await getDoc(regRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    const registrationId = existingData?.registrationId || await generateRegistrationId();

    await setDoc(regRef, {
      registrationId,
      userUid: user.uid,
      fullName,
      affiliation,
      email,
      phone,
      participantType,
      registrationType,
      amount: pricing.amount,
      currency: pricing.currency,
      paymentStatus: existingData?.paymentStatus || "draft",
      createdAt: existingData?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp()
    }, { merge: true });

    alert(`✅ Registration saved\nRegistration ID: ${registrationId}`);
    await loadMyRegistrations();
  } catch (err) {
    showError("❌ Failed to save registration:", err);
  }
};

// ---------------- LOAD MY REGISTRATIONS ----------------
window.loadMyRegistrations = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const container = byId("myRegistrations");
    if (!container) return;

    const qy = query(
      collection(db, "registrations"),
      where("userUid", "==", user.uid)
    );

    const snap = await getDocs(qy);

    if (snap.empty) {
      container.innerHTML = "<p>No registrations yet.</p>";
      return;
    }

    let html = `
      <table>
        <tr>
          <th>Registration ID</th>
          <th>Participant</th>
          <th>Type</th>
          <th>Category</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
    `;

    snap.forEach((docSnap) => {
      const d = docSnap.data();

      html += `
        <tr>
          <td>${d.registrationId || "-"}</td>
          <td>${d.fullName || ""}</td>
          <td>${d.participantType || ""}</td>
          <td>${d.registrationType || ""}</td>
          <td>${d.amount || ""} ${d.currency || ""}</td>
          <td>${registrationStatusLabel(d.paymentStatus)}</td>
        </tr>
      `;
    });

    html += `</table>`;
    container.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load registrations:", err);
  }
};
