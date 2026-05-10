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
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { firebaseConfig } from "./firebase-config.js";

// ---------------- INIT ----------------
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const ADMIN_EMAILS = [
  "jungchullee@kaist.ac.kr",
  "admin@example.com"
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
const REGISTRATION_FEES_USD = {
  domestic: {
    student: 215,
    regular: 320,
    vip: 0
  },
  international: {
    student: 215,
    regular: 320,
    vip: 0
  }
};

function getRegistrationPricePreview(participantType, registrationType) {
  const amount = REGISTRATION_FEES_USD?.[participantType]?.[registrationType];

  if (amount === undefined) return null;

  return {
    amount,
    currency: "USD"
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

// ---------------- PAYPAL PAYMENT ----------------
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

function updatePaymentPreview() {
  const participantType = byId("participantType")?.value;
  const registrationType = byId("registrationType")?.value;

  if (!byId("payParticipantType") || !byId("payRegistrationType") || !byId("payAmount")) {
    return;
  }

  if (!participantType || !registrationType) return;

  const pricing = getRegistrationPricePreview(participantType, registrationType);
  if (!pricing) return;

  byId("payParticipantType").innerText =
    participantType === "domestic" ? "Domestic" : "International";

  byId("payRegistrationType").innerText =
    registrationType.charAt(0).toUpperCase() + registrationType.slice(1);

  byId("payAmount").innerText =
    pricing.amount === 0 ? "Waived" : `USD ${pricing.amount.toFixed(2)}`;
}

async function savePaidRegistration(orderData, info) {
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

  const payerName = orderData.payer?.name
    ? `${orderData.payer.name.given_name || ""} ${orderData.payer.name.surname || ""}`.trim()
    : "";

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
      currency: "USD",

      paymentStatus: "paid",
      paymentProvider: "PayPal",
      paypalOrderId: orderData.id || "",
      paypalStatus: orderData.status || "APPROVED",
      payerEmail: orderData.payer?.email_address || "",
      payerName: "",
      
      createdAt: existingData?.createdAt || serverTimestamp(),
      paidAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    },
    { merge: true }
  );
}

function renderPayPalButton() {
  const container = byId("paypal-button-container");
  if (!container) return;

  const statusBox = byId("paymentStatus");

  if (!window.paypal) {
    console.error("❌ PayPal SDK not loaded.");

    if (statusBox) {
      statusBox.innerText =
        "PayPal SDK was not loaded. Please check the PayPal Client ID.";
    }

    return;
  }

  container.innerHTML = "";

  paypal
    .Buttons({
      style: {
        layout: "vertical",
        color: "gold",
        shape: "rect",
        label: "paypal",
        height: 50
      },

      createOrder: function (data, actions) {
        const info = getRegistrationInfoForPayment();

        if (!info) {
          throw new Error("Missing registration information.");
        }

        if (info.amount === 0) {
          alert("This registration type does not require payment.");
          throw new Error("Payment amount is zero.");
        }

        const invoiceId = `JCKMEMS2026-${Date.now()}`;

        return actions.order.create({
          purchase_units: [
            {
              description: `JCK MEMS/NEMS 2026 Registration - ${info.registrationType}`,
              custom_id: `${info.participantType}-${info.registrationType}`,
              invoice_id: invoiceId,
              amount: {
                currency_code: "USD",
                value: info.amount.toFixed(2)
              }
            }
          ],
          application_context: {
            shipping_preference: "NO_SHIPPING"
          }
        });
      },

onApprove: async function (data, actions) {
  const statusBox = byId("paymentStatus");

  if (statusBox) {
    statusBox.innerText = "Payment approved. Saving registration...";
  }

  try {
    const info = getRegistrationInfoForPayment();

    if (!info) {
      throw new Error("Registration information is missing after payment.");
    }

    const orderData = {
      id: data.orderID,
      status: "APPROVED",
      payerID: data.payerID || "",
      paymentID: data.paymentID || ""
    };

    await savePaidRegistration(orderData, info);

    if (statusBox) {
      statusBox.innerText = "✅ Payment approved and registration saved.";
    }

    alert("Payment approved and registration saved.");

    if (typeof window.loadMyRegistrations === "function") {
      await window.loadMyRegistrations();
    }

  } catch (err) {
    console.error("Payment save error:", err);

    if (statusBox) {
      statusBox.innerText =
        "Payment was approved, but registration saving failed: " +
        (err.message || err);
    }
  }
},

      onCancel: function () {
        const statusBox = byId("paymentStatus");

        if (statusBox) {
          statusBox.innerText = "Payment was cancelled.";
        }
      },

      onError: function (err) {
        console.error("PayPal error:", err);

        const statusBox = byId("paymentStatus");

        if (statusBox) {
          statusBox.innerText =
            "Payment error occurred. Please try again or contact the secretariat.";
        }
      }
    })
    .render("#paypal-button-container");
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
    
  try {
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
    
  try {
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

function shouldShowPaperByRegistrationFilter(registrationMap, presenterEmail) {
  const showUnregisteredOnly = byId("showUnregisteredOnly")?.checked;
  const showRegisteredPaidOnly = byId("showRegisteredPaidOnly")?.checked;

  const matchedRegistration = registrationMap.get(normalizeEmail(presenterEmail));

  if (showUnregisteredOnly && matchedRegistration) return false;

  if (showRegisteredPaidOnly && !isRegistrationPaid(matchedRegistration)) {
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
    
  try {
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
    
  try {
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

      if (isRegistrationPaid(matchedRegistration)) {
        registeredPaid += 1;
      }

      if (!matchedRegistration) {
        unregistered += 1;
      }

      if (!shouldShowPaperByRegistrationFilter(registrationMap, presenterEmail)) {
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
    
  try {
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

      if (isRegistrationPaid(matchedRegistration)) {
        registeredPaid += 1;
      }

      if (!matchedRegistration) {
        unregistered += 1;
      }

      if (!shouldShowPaperByRegistrationFilter(registrationMap, presenterEmail)) {
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

  if (location.pathname.includes("/admin")) {
    onAuthStateChanged(auth, (user) => {
      if (!user || !isAdminUser(user)) {
        alert("Admin access only.");
        window.location.href = "index.html";
        return;
      }

      if (typeof window.loadPapers === "function") {
        window.loadPapers();
      }

      if (typeof window.loadRegistrations === "function") {
        window.loadRegistrations();
      }
    });
  }

  byId("participantType")?.addEventListener("change", updatePaymentPreview);
  byId("registrationType")?.addEventListener("change", updatePaymentPreview);

  updatePaymentPreview();

  setTimeout(() => {
    renderPayPalButton();
  }, 500);
});

