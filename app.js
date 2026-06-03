// ---------------- FIREBASE IMPORT ----------------
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
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
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------------- INIT ----------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAILS = [
  "jungchullee@kaist.ac.kr", "joonkim@dgist.ac.kr", "choij@cau.ac.kr"
];

// ---------------- STATE ----------------
let currentEditingDocId = null;
let currentEditingData = null;

function isAdminUser(user) {
  return user && ADMIN_EMAILS.includes(user.email);
}

function requireAdmin() {
  const user = auth.currentUser;

  if (!user) {
    alert("Admin login required.");
    window.location.href = "index.html";
    return false;
  }

  if (!isAdminUser(user)) {
    alert("You are not authorized to access the admin page.");
    window.location.href = "submit.html";
    return false;
  }

  return true;
}

// ---------------- BASIC HELPERS ----------------
function byId(id) {
  return document.getElementById(id);
}

function safeValue(id) {
  const el = byId(id);
  return el ? el.value.trim() : "";
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

function normalizeEmail(email) {
  return (email || "").trim().toLowerCase();
}

function sanitizeFileName(name) {
  return (name || "abstract")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 80);
}

// ---------------- AUTH STATE ----------------
onAuthStateChanged(auth, (user) => {
  console.log("Auth state:", user ? user.email : "signed out");
});

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

// ---------------- PASSWORD RESET ----------------

window.resetPassword = async () => {

  try {

    const email = safeValue("email");

    if (!email) {

      alert("Please enter your email address first.");

      return;

    }

    await sendPasswordResetEmail(auth, email);

    alert(

      "✅ Password reset email sent.\n\n" +

      "Please check your inbox or spam folder."

    );

  } catch (err) {

    showError("❌ Failed to send password reset email:", err);

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

// ---------------- PAPER HELPERS ----------------
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

function clearAuthors() {
  const container = byId("authors");
  if (container) container.innerHTML = "";
}

function setEditingInfo(paperIdText = "New submission", statusText = "draft") {
  if (byId("editingPaperId")) byId("editingPaperId").textContent = paperIdText;
  if (byId("editingStatus")) byId("editingStatus").textContent = statusText;
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

  return String(num)
    .split("")
    .map((d) => map[d] || d)
    .join("");
}

// ---------------- AUTHORS ----------------
window.addAuthor = (author = null) => {
  const container = byId("authors");
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
    byId("presentationPreference").value =
      data.presentationPreference || "oral_or_poster";
  }

  clearAuthors();

  if (data.authors?.length) {
    data.authors.forEach((a) => window.addAuthor(a));
  } else {
    window.addAuthor();
  }

  setEditingInfo(data.paperId || currentEditingDocId || "Draft", data.status || "draft");
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
    const acknowledgement = safeValue("acknowledgement");
    const references = safeValue("references");
    const presentationPreference =
      safeValue("presentationPreference") || "oral_or_poster";
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

    const paperData = {
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
    };

    await setDoc(paperRef, paperData, { merge: true });

    currentEditingDocId = submissionKey;
    currentEditingData = { ...(existingData || {}), ...paperData };

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
    const presentationPreference =
      safeValue("presentationPreference") || "oral_or_poster";
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

    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    let paperId = existingData?.paperId || null;
    if (!paperId) {
      paperId = await generatePaperId();
    }

    const paperData = {
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
    };

    await setDoc(paperRef, paperData, { merge: true });

    currentEditingDocId = submissionKey;
    currentEditingData = { ...(existingData || {}), ...paperData };

    fillFormFromPaper(currentEditingData);
    alert("🎉 Submitted successfully!\nPaper ID: " + paperId);
  } catch (err) {
    showError("❌ Submit failed:", err);
  }
};

// ---------------- PDF GENERATION ----------------
window.previewPdf = async () => {
  try {
    const title = safeValue("title");
    const abstractText = safeValue("abstract");
    const acknowledgement = safeValue("acknowledgement");
    const references = safeValue("references");
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

    let y = margin;
    let pageNum = 1;

    function addFooter() {
      pdf.setFont("Times", "normal");
      pdf.setFontSize(9);
      pdf.text(conferenceName, margin, pageHeight - 10, { align: "left" });
      pdf.text(`Paper ID: ${paperIdText}`, pageWidth / 2, pageHeight - 10, {
        align: "center"
      });
      pdf.text(`Page ${pageNum}`, pageWidth - margin, pageHeight - 10, {
        align: "right"
      });
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

    function writeWrappedBlock(text, options = {}) {
      const {
        font = "Times",
        style = "normal",
        size = 11,
        align = "left",
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

          if (isLastLine || words.length <= 1) {
            pdf.text(line, x, y, { align: "left" });
          } else {
            const wordsWidth = words.reduce(
              (sum, word) => sum + pdf.getTextWidth(word),
              0
            );
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

    writeWrappedBlock(title, {
      font: "Times",
      style: "bold",
      size: 16,
      align: "center",
      width: usableWidth,
      lineHeight: 8,
      after: 6
    });

    const authorLine = authors
      .map((author) => {
        const aff = (author.affiliation || "").trim();
        const idx = aff ? affToIndex.get(aff) : "";
        const sup = idx ? toSuperscript(idx) : "";
        const star = author.isCorresponding ? "*" : "";
        return `${author.name}${sup}${star}`;
      })
      .join(", ");

    writeWrappedBlock(authorLine, {
      font: "Times",
      style: "normal",
      size: 11,
      align: "center",
      width: usableWidth,
      lineHeight: 6.5,
      after: 3
    });

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

    const correspondingAuthors = authors.filter((a) => a.isCorresponding);
    if (correspondingAuthors.length > 0) {
      const corrEmailLine = `*Corresponding author: ${correspondingAuthors
        .map((a) => a.email)
        .filter(Boolean)
        .join(", ")}`;

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

    if (references) {
      writeSectionTitle("References");

      const refLines = references
        .split(/\n+/)
        .map((r) => r.trim())
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

    addFooter();

    const fileName = `${paperIdText}_${sanitizeFileName(title)}.pdf`;
    pdf.save(fileName);
  } catch (err) {
    console.error(err);
    alert("Failed to generate PDF:\n" + (err.message || err));
  }
};

// ---------------- REGISTRATION CONFIG ----------------
// All participants are routed to the Eximbay hosted payment page.
// Domestic fees are shown in KRW; international fees are shown in USD.
// Adjust the amounts below to the official registration fees.
const REGISTRATION_FEES = {
  domestic: {
    student: { amount: 300000, currency: "KRW" },
    regular: { amount: 450000, currency: "KRW" },
    vip: { amount: 0, currency: "KRW" }
  },
  international: {
    student: { amount: 215, currency: "USD" },
    regular: { amount: 320, currency: "USD" },
    vip: { amount: 0, currency: "USD" }
  }
};

function getRegistrationPricePreview(participantType, registrationType) {
  const fee = REGISTRATION_FEES?.[participantType]?.[registrationType];

  if (!fee) return null;

  return {
    amount: Number(fee.amount || 0),
    currency: fee.currency || "USD"
  };
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

    const regDocId = buildRegistrationDocId(
      user.uid,
      participantType,
      registrationType
    );

    const regRef = doc(db, "registrations", regDocId);
    const existingSnap = await getDoc(regRef);
    const existingData = existingSnap.exists() ? existingSnap.data() : null;

    const registrationId =
      existingData?.registrationId || (await generateRegistrationId());

    await setDoc(
      regRef,
      {
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
      },
      { merge: true }
    );

    alert(`✅ Registration saved\nRegistration ID: ${registrationId}`);
    await window.loadMyRegistrations();
    updatePaymentPreview();
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
          <th>Name</th>
          <th>Participant</th>
          <th>Category</th>
          <th>Amount</th>
          <th>Status</th>
          <th>Confirmation</th>
        </tr>
    `;

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const paid =
        String(d.paymentStatus || "").toLowerCase() === "paid";

      html += `
        <tr>
          <td>${d.registrationId || "-"}</td>
          <td>${d.fullName || ""}</td>
          <td>${d.participantType || ""}</td>
          <td>${d.registrationType || ""}</td>
          <td>${d.amount || ""} ${d.currency || ""}</td>
          <td>${registrationStatusLabel(d.paymentStatus)}</td>
          <td>
            ${
              paid
                ? `<button type="button" onclick='downloadRegistrationConfirmation(${JSON.stringify(d)})'>
                    Download PDF
                  </button>`
                : `-`
            }
          </td>
        </tr>
      `;
    });

    html += `</table>`;
    container.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load registrations:", err);
  }
};

// ---------------- EXIMBAY PAYMENT ----------------
function getRegistrationInfoForPayment() {
  const participantType = byId("participantType")?.value;
  const registrationType = byId("registrationType")?.value;

  const fullName = byId("fullName")?.value.trim();
  const affiliation = byId("affiliation")?.value.trim();
  const email = byId("regEmail")?.value.trim();
  const phone = byId("phone")?.value.trim();

  if (!participantType || !registrationType) {
    alert("Please select participant type and registration type.");
    return null;
  }

  if (!fullName || !affiliation || !email) {
    alert("Please enter full name, affiliation, and email before payment.");
    return null;
  }

  const pricing = getRegistrationPricePreview(participantType, registrationType);

  if (!pricing) {
    alert("Invalid registration fee setting.");
    return null;
  }

  return {
    participantType,
    registrationType,
    fullName,
    affiliation,
    email,
    phone,
    amount: pricing.amount,
    currency: pricing.currency
  };
}

function formatPaymentAmount(amount, currency) {
  if (Number(amount || 0) === 0) return "Waived";

  if (currency === "KRW") {
    return `KRW ${Number(amount).toLocaleString("ko-KR")}`;
  }

  return `${currency} ${Number(amount).toFixed(2)}`;
}

function getPaymentProviderForParticipant(participantType) {
  return "EXIMBAY";
}

function updatePaymentPreview() {
  const participantType = byId("participantType")?.value;
  const registrationType = byId("registrationType")?.value;

  if (!byId("payParticipantType") || !byId("payRegistrationType") || !byId("payAmount")) {
    return;
  }

  if (!participantType || !registrationType) return;

  const pricing = getRegistrationPricePreview(participantType, registrationType);
  if (!pricing) return;

  const provider = getPaymentProviderForParticipant(participantType);

  byId("payParticipantType").innerText =
    participantType === "domestic" ? "Domestic" : "International";

  byId("payRegistrationType").innerText =
    registrationType.charAt(0).toUpperCase() + registrationType.slice(1);

  byId("payAmount").innerText =
    formatPaymentAmount(pricing.amount, pricing.currency);

  if (byId("payProvider")) {
    byId("payProvider").innerText = "Eximbay";
  }

  if (byId("registrationPayButton")) {
    byId("registrationPayButton").innerText = "Pay with Eximbay";
  }
}

// ---------------- EXIMBAY HOSTED PAYMENT CONFIG ----------------
// EximLink 없이 Eximbay 결제창을 직접 호출하는 방식입니다.
// 단, Eximbay 결제창 호출에는 fgkey가 필요하므로,
// 브라우저(app.js)에서 secret key를 직접 사용하면 안 됩니다.
// 아래 EXIMBAY_READY_ENDPOINT는 Google Apps Script Web App 또는 별도 서버 URL이어야 합니다.
// 이 endpoint가 Eximbay payment preparation / fgkey 생성 후
// { success: true, params: { ...paymentData, fgkey } } 형태로 응답해야 합니다.
const EXIMBAY_READY_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxTAnvLTrpEsV633hQthWfWJ29cVma-uHdyU4_XdOLVHBX_IEH3JG7Fq2F5txfY9OEC/exec";

// 테스트/운영 전환은 GAS 서버 쪽에서 관리하는 것을 권장합니다.
// 신버전 Eximbay는 form POST actionUrl 대신 registration.html에서 로드한
// Eximbay JavaScript SDK의 EXIMBAY.request_pay(params)를 사용합니다.

function getPaymentProviderLabel(info) {
  return "eximbay_hosted_payment";
}

function buildEximbayOrderName(info) {
  const participant =
    info.participantType === "domestic" ? "Domestic" : "International";

  const category =
    info.registrationType.charAt(0).toUpperCase() +
    info.registrationType.slice(1);

  return `JCK MEMS/NEMS 2026 Registration - ${participant} ${category}`;
}

async function savePendingRegistrationBeforePayment(info, provider) {
  const user = auth.currentUser;

  if (!user) {
    throw new Error("User is not logged in.");
  }

  const regDocId = buildRegistrationDocId(
    user.uid,
    info.participantType,
    info.registrationType
  );

  const regRef = doc(db, "registrations", regDocId);
  const existingSnap = await getDoc(regRef);
  const existingData = existingSnap.exists() ? existingSnap.data() : null;

  const registrationId =
    existingData?.registrationId || (await generateRegistrationId());

  // 이미 paid인 등록은 pending으로 되돌리지 않습니다.
  const nextPaymentStatus =
    existingData?.paymentStatus === "paid" ? "paid" : "pending_payment";

  await setDoc(
    regRef,
    {
      registrationId,
      userUid: user.uid,

      fullName: info.fullName || "",
      affiliation: info.affiliation || "",
      email: info.email || "",
      phone: info.phone || "",

      participantType: info.participantType || "",
      registrationType: info.registrationType || "",
      amount: Number(info.amount || 0),
      currency: info.currency || "",

      paymentStatus: nextPaymentStatus,
      paymentProvider: provider,
      paymentMethod: "manual_verification_eximbay_hosted_payment",

      createdAt: existingData?.createdAt || serverTimestamp(),
      paymentStartedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );

  return {
    registrationId,
    regDocId,
    paymentStatus: nextPaymentStatus
  };
}

async function requestEximbayHostedPayment(info, savedRegistration) {
  if (
    !EXIMBAY_READY_ENDPOINT ||
    EXIMBAY_READY_ENDPOINT.includes("YOUR_GOOGLE_APPS_SCRIPT_DEPLOYMENT_ID")
  ) {
    throw new Error(
      "EXIMBAY_READY_ENDPOINT is not configured. Please deploy the Google Apps Script payment preparation endpoint first."
    );
  }

  const payload = {
    registrationId: savedRegistration.registrationId,
    regDocId: savedRegistration.regDocId,

    participantType: info.participantType,
    registrationType: info.registrationType,

    fullName: info.fullName,
    affiliation: info.affiliation,
    email: info.email,
    phone: info.phone || "",

    amount: Number(info.amount || 0),
    currency: info.currency,
    orderName: buildEximbayOrderName(info)
  };

  const res = await fetch(EXIMBAY_READY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  let data;
  try {
    data = await res.json();
  } catch (err) {
    throw new Error("Invalid response from Eximbay preparation endpoint.");
  }

  if (!res.ok || !data?.success) {
    console.error("Eximbay preparation failed:", data);

    throw new Error(
      data?.error ||
      data?.message ||
      "Failed to prepare Eximbay payment."
    );
  }

  // Eximbay 신버전 SDK 방식에서는 actionUrl이 필요 없습니다.
  // GAS는 { success: true, params: { ...paymentData, fgkey } } 형태로 반환해야 합니다.
  if (!data.params) {
    console.error("Invalid Eximbay preparation response:", data);
    throw new Error("Eximbay preparation response must include params.");
  }

  return data;
}

function requestEximbayPayment(eximbayPayment) {
  if (!window.EXIMBAY || typeof window.EXIMBAY.request_pay !== "function") {
    throw new Error(
      "Eximbay JavaScript SDK is not loaded. Please check that registration.html includes https://api.eximbay.com/v2/javascriptSDK.js"
    );
  }

  if (!eximbayPayment || !eximbayPayment.params) {
    console.error("Invalid Eximbay payment object:", eximbayPayment);
    throw new Error("Invalid Eximbay payment parameters.");
  }

  console.log("Calling EXIMBAY.request_pay with params:", eximbayPayment.params);

  // 중요: GAS의 /v1/payments/ready에 보낸 paymentData 원본에 fgkey만 추가한
  // 동일 객체를 그대로 전달해야 VE00 fgkey mismatch를 피할 수 있습니다.
  window.EXIMBAY.request_pay(eximbayPayment.params);
}

window.startRegistrationPayment = async () => {
  const statusBox = byId("paymentStatus");

  try {
    const info = getRegistrationInfoForPayment();

    if (!info) return;

    if (Number(info.amount || 0) === 0) {
      alert("This registration type does not require payment. The secretariat will confirm your registration manually.");
      return;
    }

    const provider = getPaymentProviderLabel(info);

    if (statusBox) {
      statusBox.innerText =
        "Saving your registration as pending payment...";
    }

    const savedRegistration =
      await savePendingRegistrationBeforePayment(info, provider);

    if (statusBox) {
      statusBox.innerText =
        "Preparing Eximbay payment page...";
    }

    const eximbayPayment =
      await requestEximbayHostedPayment(info, savedRegistration);

    if (statusBox) {
      statusBox.innerText =
        "Redirecting to Eximbay payment page. Your registration status is Pending Payment until the secretariat confirms it.";
    }

    requestEximbayPayment(eximbayPayment);
   } catch (err) {
    console.error("Payment start error:", err);
  
    if (statusBox) {
      statusBox.innerText =
        "Payment could not be started. See the debug box below.";
    }
  
    showPaymentDebug("Payment could not be started.", {
      message: err.message || String(err),
      error: err
    });
  
    alert("Payment could not be started.\n" + (err.message || err));
  }
};

// Backward-compatible wrapper. Kept in case older buttons call it directly.
window.startEximbayPayment = async (info) => {
  const statusBox = byId("paymentStatus");

  try {
    const savedRegistration =
      await savePendingRegistrationBeforePayment(info, "eximbay_hosted_payment");

    const eximbayPayment =
      await requestEximbayHostedPayment(info, savedRegistration);

    requestEximbayPayment(eximbayPayment);
  } catch (err) {
    console.error("Eximbay payment wrapper error:", err);

    if (statusBox) {
      statusBox.innerText =
        "Payment could not be started: " + (err.message || err);
    }

    alert("Payment could not be started.\n" + (err.message || err));
  }
};

function showPaymentDebug(message, data = null) {
  const box = byId("paymentDebugBox");
  if (!box) return;

  box.style.display = "block";

  let text = message;

  if (data) {
    text += "\n\n" + JSON.stringify(data, null, 2);
  }

  box.textContent = text;
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
      <th>Action</th>
    </tr>
  `;
}

function buildRegistrationRow(docId, d) {
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
      <td>
        <button onclick="updateRegistrationStatus('${docId}', 'draft')">Draft</button>
        <button onclick="updateRegistrationStatus('${docId}', 'paid')">Mark Paid</button>
        <button onclick="updateRegistrationStatus('${docId}', 'cancelled')">Cancel</button>
      </td>
    </tr>
  `;
}

window.loadRegistrations = async () => {
  try {
    if (!requireAdmin()) return;

    const table = byId("registrationTable");
    if (!table) return;

    const snap = await getDocs(collection(db, "registrations"));
    let html = getRegistrationTableHeader();

    snap.forEach((regDoc) => {
      const d = regDoc.data();
      html += buildRegistrationRow(regDoc.id, d);
    });

    table.innerHTML = html;
  } catch (err) {
    showError("❌ Failed to load registrations:", err);
  }
};

window.searchRegistrations = async () => {
  try {
    if (!requireAdmin()) return;

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

      html += buildRegistrationRow(regDoc.id, d);
    });

    table.innerHTML = html;
  } catch (err) {
    showError("❌ Registration search failed:", err);
  }
};

window.updateRegistrationStatus = async (docId, newStatus) => {
  try {
    if (!requireAdmin()) return;

    const ok = confirm(`Change registration status to "${newStatus}"?`);
    if (!ok) return;

    await setDoc(
      doc(db, "registrations", docId),
      {
        paymentStatus: newStatus,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    alert("✅ Registration status updated");
    await window.loadRegistrations();
  } catch (err) {
    showError("❌ Failed to update registration status:", err);
  }
};

// ---------------- ADMIN PAPER HELPERS ----------------
function getRegistrationBadgeHtml(registration) {
  if (!registration) {
    return `<span class="badge badge-gray">Not registered</span>`;
  }

  const status = registration.paymentStatus || "draft";

  if (status === "paid") {
    return `<span class="badge badge-green">Paid</span>`;
  }

  if (status === "pending_payment") {
    return `<span class="badge badge-blue">Pending Payment</span>`;
  }

  if (status === "cancelled") {
    return `<span class="badge badge-red">Cancelled</span>`;
  }

  return `<span class="badge badge-yellow">Draft</span>`;
}

function isRegistrationPaid(registration) {
  return !!registration && registration.paymentStatus === "paid";
}

async function buildRegistrationMap() {
  const snap = await getDocs(collection(db, "registrations"));
  const regMap = new Map();

  snap.forEach((regDoc) => {
    const d = regDoc.data();
    const emailKey = normalizeEmail(d.email);
    if (!emailKey) return;

    const existing = regMap.get(emailKey);

    const priority = {
      paid: 4,
      pending_payment: 3,
      draft: 2,
      cancelled: 1
    };

    const currentScore = priority[d.paymentStatus || "draft"] || 0;
    const existingScore = existing
      ? priority[existing.paymentStatus || "draft"] || 0
      : -1;

    if (!existing || currentScore > existingScore) {
      regMap.set(emailKey, {
        ...d,
        _docId: regDoc.id
      });
    }
  });

  return regMap;
}

function updatePaperStats(total, paid, unregistered) {
  if (byId("statTotalPapers")) byId("statTotalPapers").textContent = String(total);
  if (byId("statRegisteredPaid")) byId("statRegisteredPaid").textContent = String(paid);
  if (byId("statUnregistered")) byId("statUnregistered").textContent = String(unregistered);
}

function shouldShowPaperByRegistrationFilter(
  registrationMap,
  paperData
) {
  const presenterEmail = normalizeEmail(
    paperData.presenterEmail ||
    paperData.submitterEmail ||
    ""
  );

  const matchedRegistration =
    registrationMap.get(presenterEmail);

  const isPaid =
    isRegistrationPaid(matchedRegistration);

  // ---------------- FILTER FLAGS ----------------
  const showPaidOnly =
    byId("showPaidOnly")?.checked;

  const showUnregisteredOnly =
    byId("showUnregisteredOnly")?.checked;

  const showSubmittedUnpaidOnly =
    byId("showSubmittedUnpaidOnly")?.checked;

  const showPosterOnly =
    byId("showPosterOnly")?.checked;

  const showOralOnly =
    byId("showOralOnly")?.checked;

  const showAcceptedOnly =
    byId("showAcceptedOnly")?.checked;

  const showRejectedOnly =
    byId("showRejectedOnly")?.checked;

  const showPendingPaymentOnly =
  byId("showPendingPaymentOnly")?.checked;

  if (
    showPendingPaymentOnly &&
    matchedRegistration?.paymentStatus !== "pending_payment"
  ) {
    return false;
  }

  // ---------------- PAID ONLY ----------------
  if (showPaidOnly && !isPaid) {
    return false;
  }

  // ---------------- UNREGISTERED ----------------
  if (showUnregisteredOnly && matchedRegistration) {
    return false;
  }

  // ---------------- SUBMITTED BUT UNPAID ----------------
  if (
    showSubmittedUnpaidOnly &&
    !(paperData.status === "submitted" && !isPaid)
  ) {
    return false;
  }

  // ---------------- POSTER ----------------
  if (showPosterOnly && paperData.status !== "poster") {
    return false;
  }

  // ---------------- ORAL ----------------
  if (showOralOnly && paperData.status !== "oral") {
    return false;
  }

  // ---------------- ACCEPTED ----------------
  if (showAcceptedOnly && paperData.status !== "accepted") {
    return false;
  }

  // ---------------- REJECTED ----------------
  if (showRejectedOnly && paperData.status !== "rejected") {
    return false;
  }

  return true;
}

function getTableHeader() {
  return `
    <tr>
      <th>Paper ID</th>
      <th>Title</th>
      <th>Status</th>
      <th>Preference</th>
      <th>Presenter</th>
      <th>Email</th>
      <th>Registration</th>
      <th>Action</th>
    </tr>
  `;
}

function buildRow(docId, d, registrationMap = new Map()) {
  const preferenceLabel = getPresentationPreferenceLabel(d.presentationPreference);

  const presenterEmail = normalizeEmail(d.presenterEmail || d.submitterEmail || "");
  const matchedRegistration = registrationMap.get(presenterEmail);
  const registrationBadge = getRegistrationBadgeHtml(matchedRegistration);

  return `
    <tr>
      <td>${d.paperId || "-"}</td>
      <td>${d.title || ""}</td>
      <td>${d.status || ""}</td>
      <td>${preferenceLabel}</td>
      <td>${d.presenterName || ""}</td>
      <td>${d.presenterEmail || d.submitterEmail || ""}</td>
      <td>${registrationBadge}</td>
      <td>
        <button onclick="updateStatus('${docId}', 'accepted')">Accept</button>
        <button onclick="updateStatus('${docId}', 'rejected')">Reject</button>
        <button onclick="updateStatus('${docId}', 'oral')">Oral</button>
        <button onclick="updateStatus('${docId}', 'poster')">Poster</button>
      </td>
    </tr>
  `;
}

window.updateStatus = async (docId, newStatus) => {
  try {
    if (!requireAdmin()) return;

    await setDoc(
      doc(db, "papers", docId),
      {
        status: newStatus,
        updatedAt: serverTimestamp()
      },
      { merge: true }
    );

    alert("✅ Status updated");
    window.loadPapers();
  } catch (err) {
    showError("❌ Failed to update status:", err);
  }
};

window.loadPapers = async () => {
  try {
    if (!requireAdmin()) return;

    const table = byId("table");
    if (!table) return;

    const registrationMap = await buildRegistrationMap();
    const snap = await getDocs(collection(db, "papers"));

    let html = getTableHeader();

    let totalPapers = 0;
    let registeredPaid = 0;
    let unregistered = 0;

    snap.forEach((paperDoc) => {
      const d = paperDoc.data();
      const presenterEmail = d.presenterEmail || d.submitterEmail || "";
      const matchedRegistration = registrationMap.get(normalizeEmail(presenterEmail));

      totalPapers += 1;

      if (isRegistrationPaid(matchedRegistration)) registeredPaid += 1;
      if (!matchedRegistration) unregistered += 1;

      if (
  !shouldShowPaperByRegistrationFilter(
    registrationMap,
    d
  )
) {
  return;
}

      html += buildRow(paperDoc.id, d, registrationMap);
    });

    table.innerHTML = html;
    updatePaperStats(totalPapers, registeredPaid, unregistered);
  } catch (err) {
    showError("❌ Failed to load papers:", err);
  }
};

window.searchPapers = async () => {
  try {
    if (!requireAdmin()) return;

    const keyword = (byId("searchInput")?.value || "").toLowerCase();
    const registrationMap = await buildRegistrationMap();
    const snap = await getDocs(collection(db, "papers"));

    let html = getTableHeader();

    let totalPapers = 0;
    let registeredPaid = 0;
    let unregistered = 0;

    snap.forEach((docSnap) => {
      const d = docSnap.data();

      const combined = `
        ${d.title || ""}
        ${d.presenterName || ""}
        ${d.presenterEmail || ""}
        ${d.paperId || ""}
      `.toLowerCase();

      if (!combined.includes(keyword)) return;

      const presenterEmail = d.presenterEmail || d.submitterEmail || "";
      const matchedRegistration = registrationMap.get(normalizeEmail(presenterEmail));

      totalPapers += 1;

      if (isRegistrationPaid(matchedRegistration)) registeredPaid += 1;
      if (!matchedRegistration) unregistered += 1;

      if (
  !shouldShowPaperByRegistrationFilter(
    registrationMap,
    d
  )
) {
  return;
}

      html += buildRow(docSnap.id, d, registrationMap);
    });

    byId("table").innerHTML = html;
    updatePaperStats(totalPapers, registeredPaid, unregistered);
  } catch (err) {
    showError("❌ Search failed:", err);
  }
};

window.loadMyPapers = async () => {
  try {
    const user = ensureLoggedIn();
    if (!user) return;

    const container = byId("myPapers");
    if (!container) return;

    const qy = query(collection(db, "papers"), where("userUid", "==", user.uid));
    const snap = await getDocs(qy);

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

// ---------------- FILTER CONTROL ----------------
document.addEventListener("change", (e) => {
  if (e.target?.id === "showUnregisteredOnly" && e.target.checked) {
    if (byId("showRegisteredPaidOnly")) {
      byId("showRegisteredPaidOnly").checked = false;
    }
  }

  if (e.target?.id === "showRegisteredPaidOnly" && e.target.checked) {
    if (byId("showUnregisteredOnly")) {
      byId("showUnregisteredOnly").checked = false;
    }
  }
});

// ---------------- PAGE INITIALIZATION ----------------
document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded");

  // ---------------- CURRENT PAGE ----------------
  const path = window.location.pathname.toLowerCase();

  const isAdminPage =
    path.endsWith("/admin") ||
    path.endsWith("/admin/") ||
    path.endsWith("/admin.html");

  // ---------------- AUTH STATE ----------------
  onAuthStateChanged(auth, (user) => {
    console.log("Current user:", user?.email || "signed out");

    // ---------------- ADMIN BUTTON ----------------
    const adminButton = byId("adminButton");

    if (adminButton) {
      if (user && isAdminUser(user)) {
        adminButton.style.display = "inline-block";
      } else {
        adminButton.style.display = "none";
      }
    }

    // ---------------- ADMIN PAGE PROTECTION ----------------
    if (isAdminPage) {

      if (!user) {
        alert("Admin login required.");
        window.location.href = "index.html";
        return;
      }

      if (!isAdminUser(user)) {
        alert(
          `Admin access only.\nCurrent login: ${user.email || "unknown"}`
        );

        window.location.href = "submit.html";
        return;
      }

      console.log("✅ Admin authenticated:", user.email);

      // ---------------- LOAD ADMIN DATA ----------------
      if (typeof window.loadPapers === "function") {
        window.loadPapers();
      }

      if (typeof window.loadRegistrations === "function") {
        window.loadRegistrations();
      }

      // ---------------- ADMIN FILTER EVENTS ----------------
      [
        "showPaidOnly",
        "showPendingPaymentOnly",
        "showUnregisteredOnly",
        "showSubmittedUnpaidOnly",
        "showPosterOnly",
        "showOralOnly",
        "showAcceptedOnly",
        "showRejectedOnly"
      ].forEach((id) => {

        byId(id)?.addEventListener("change", () => {

          console.log("Filter changed:", id);

          if (typeof window.loadPapers === "function") {
            window.loadPapers();
          }

        });

      });
    }
  });

  // ---------------- PAYMENT UI ----------------
  byId("participantType")?.addEventListener(
    "change",
    updatePaymentPreview
  );

  byId("registrationType")?.addEventListener(
    "change",
    updatePaymentPreview
  );

  updatePaymentPreview();

  // ---------------- PAYMENT BUTTON ----------------
  byId("registrationPayButton")?.addEventListener("click", () => {
    window.startRegistrationPayment();
  });
});

window.downloadRegistrationConfirmation = function (registration) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  const logoUrl =
    "https://snu404.github.io/JCK2026/assets/mns_logo.png?v=20260604-7";

  const issuedDate = new Date().toISOString().slice(0, 10);

  function formatDate(value) {
    if (!value) return "-";
    if (value.toDate) return value.toDate().toISOString().slice(0, 10);
    if (value.seconds) return new Date(value.seconds * 1000).toISOString().slice(0, 10);
    return String(value).slice(0, 10);
  }

  function labelParticipantType(value) {
    if (value === "domestic") return "Domestic Participant";
    if (value === "international") return "International Participant";
    return value || "-";
  }

  function labelRegistrationType(value) {
    if (value === "student") return "Student Registration";
    if (value === "regular") return "Regular Registration";
    if (value === "vip") return "VIP / Invited Registration";
    return value || "-";
  }

  const amountText =
    `${registration.currency || ""} ${Number(registration.amount || 0).toLocaleString()}`;

  const certificateNo =
    `JCK2026-RC-${String(registration.registrationId || "")
      .replace("REG-2026-", "")
      .padStart(6, "0")}`;

  const fileName =
    `JCK2026_Registration_Confirmation_${registration.registrationId || "confirmation"}.pdf`;

  function drawPdf(logoImg) {
    if (logoImg) {
      // 로고 원본에 여백이 많아도 찌그러짐을 줄이기 위해 작게 배치
      doc.addImage(logoImg, "PNG", 80, 4, 30, 25);
    }

    const titleY = 36;

    //doc.setFontSize(20);
    //doc.text("JCK MEMS/NEMS 2026", 105, titleY, {
    //  align: "center"
    //});

    doc.setFontSize(16);
    doc.text("JCK MEMS/NEMS 2026 Registration Confirmation", 105, titleY + 14, {
      align: "center"
    });

    doc.setFontSize(10);
    doc.text(`Certificate No.: ${certificateNo}`, 20, titleY + 29);
    doc.text(`Issued Date: ${issuedDate}`, 140, titleY + 29);

    doc.setLineWidth(0.4);
    doc.line(20, titleY + 35, 190, titleY + 35);

    doc.setFontSize(11);
    doc.text(`Registration ID: ${registration.registrationId || "-"}`, 20, 92);
    doc.text(`Name: ${registration.fullName || "-"}`, 20, 105);
    doc.text(`Affiliation: ${registration.affiliation || "-"}`, 20, 118);
    doc.text(`Email: ${registration.email || "-"}`, 20, 131);
    doc.text(`Phone: ${registration.phone || "-"}`, 20, 144);

    doc.text(
      `Participant Type: ${labelParticipantType(registration.participantType)}`,
      20,
      162
    );

    doc.text(
      `Registration Category: ${labelRegistrationType(registration.registrationType)}`,
      20,
      175
    );

    doc.text(
      `Payment Status: ${String(registration.paymentStatus || "-").toUpperCase()}`,
      20,
      188
    );

    doc.text(`Amount Paid: ${amountText}`, 20, 201);

    doc.line(20, 224, 190, 224);

    doc.setFontSize(10);
    doc.text(
      "This certifies that the above participant has successfully completed registration for JCK MEMS/NEMS 2026.",
      20,
      236,
      { maxWidth: 118 }
    );

    doc.text("JCK MEMS/NEMS 2026 Organizing Committee", 20, 262);

    const qrText =
      `JCK MEMS/NEMS 2026\nRegistration ID: ${registration.registrationId || "-"}\nName: ${registration.fullName || "-"}\nPayment Status: ${String(registration.paymentStatus || "-").toUpperCase()}`;

    const qrDiv = document.createElement("div");
    qrDiv.style.display = "none";
    document.body.appendChild(qrDiv);

    new QRCode(qrDiv, {
      text: qrText,
      width: 120,
      height: 120
    });

    setTimeout(() => {
      const qrImg = qrDiv.querySelector("img");

      if (qrImg) {
        doc.addImage(qrImg.src, "PNG", 145, 230, 38, 38);
        doc.setFontSize(8);
        doc.text("Verification QR", 151, 273);
      }

      document.body.removeChild(qrDiv);
      doc.save(fileName);
    }, 300);
  }

  const logo = new Image();
  logo.crossOrigin = "anonymous";

  logo.onload = function () {
    drawPdf(logo);
  };

  logo.onerror = function () {
    console.warn("Logo could not be loaded. Generating PDF without logo.");
    drawPdf(null);
  };

  logo.src = logoUrl;
};
