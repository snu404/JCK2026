import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";

admin.initializeApp();
const db = admin.firestore();

// ---- Secrets ----
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

// ---- Helpers ----
function getRegistrationPricing(participantType, registrationType) {
  if (participantType === "domestic") {
    if (registrationType === "student") return { amount: 100000, currency: "KRW", provider: "toss" };
    if (registrationType === "regular") return { amount: 200000, currency: "KRW", provider: "toss" };
    if (registrationType === "vip") return { amount: 300000, currency: "KRW", provider: "toss" };
  }

  if (participantType === "international") {
    if (registrationType === "student") return { amount: 100, currency: "USD", provider: "stripe" };
    if (registrationType === "regular") return { amount: 200, currency: "USD", provider: "stripe" };
    if (registrationType === "vip") return { amount: 300, currency: "USD", provider: "stripe" };
  }

  throw new Error("Invalid registration type.");
}

function makeRegistrationDocId(userUid, participantType, registrationType) {
  return `${userUid}__${participantType}__${registrationType}`;
}

// ---- Stripe Checkout ----
export const createStripeCheckoutSession = onRequest(
  {
    cors: true,
    region: "asia-northeast3",
    secrets: [STRIPE_SECRET_KEY]
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const {
        userUid,
        participantType,
        registrationType,
        fullName,
        affiliation,
        email,
        phone
      } = req.body || {};

      if (!userUid || !participantType || !registrationType || !fullName || !email) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const pricing = getRegistrationPricing(participantType, registrationType);

      if (pricing.provider !== "stripe") {
        res.status(400).json({ error: "This route is for international/Stripe payments only" });
        return;
      }

      const regDocId = makeRegistrationDocId(userUid, participantType, registrationType);
      const regRef = db.collection("registrations").doc(regDocId);
      const regSnap = await regRef.get();

      if (!regSnap.exists) {
        res.status(400).json({ error: "Registration draft not found. Save registration first." });
        return;
      }

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: "https://YOUR_USERNAME.github.io/YOUR_REPO/payment-success.html?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://YOUR_USERNAME.github.io/YOUR_REPO/payment-cancel.html",
        customer_email: email,
        client_reference_id: regDocId,
        metadata: {
          registrationDocId: regDocId,
          userUid,
          participantType,
          registrationType
        },
        line_items: [
          {
            price_data: {
              currency: pricing.currency.toLowerCase(),
              product_data: {
                name: `JCK MEMS/NEMS 2026 Registration (${registrationType})`
              },
              unit_amount: pricing.amount * 100
            },
            quantity: 1
          }
        ]
      });

      await regRef.set({
        fullName,
        affiliation,
        email,
        phone,
        participantType,
        registrationType,
        amount: pricing.amount,
        currency: pricing.currency,
        paymentProvider: "stripe",
        paymentStatus: "pending_payment",
        stripeCheckoutSessionId: session.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.status(200).json({
        url: session.url
      });
    } catch (err) {
      logger.error(err);
      res.status(500).json({
        error: err.message || "Failed to create Stripe Checkout Session"
      });
    }
  }
);

// ---- Toss Payment bootstrap ----
// 여기서는 checkoutUrl을 내려주는 초안만 제공합니다.
// 실제 Toss 승인(confirm)은 success URL에서 paymentKey/orderId/amount를 받아
// 별도 confirmTossPayment 함수에서 처리하는 방식으로 가는 것이 맞습니다.
export const createTossPayment = onRequest(
  {
    cors: true,
    region: "asia-northeast3",
    secrets: [TOSS_SECRET_KEY]
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const {
        userUid,
        participantType,
        registrationType,
        fullName,
        affiliation,
        email,
        phone
      } = req.body || {};

      if (!userUid || !participantType || !registrationType || !fullName || !email) {
        res.status(400).json({ error: "Missing required fields" });
        return;
      }

      const pricing = getRegistrationPricing(participantType, registrationType);

      if (pricing.provider !== "toss") {
        res.status(400).json({ error: "This route is for domestic/Toss payments only" });
        return;
      }

      const regDocId = makeRegistrationDocId(userUid, participantType, registrationType);
      const regRef = db.collection("registrations").doc(regDocId);
      const regSnap = await regRef.get();

      if (!regSnap.exists) {
        res.status(400).json({ error: "Registration draft not found. Save registration first." });
        return;
      }

      // orderId는 Toss에서 주문 식별에 사용
      const orderId = `toss_${regDocId}_${Date.now()}`;

      await regRef.set({
        fullName,
        affiliation,
        email,
        phone,
        participantType,
        registrationType,
        amount: pricing.amount,
        currency: pricing.currency,
        paymentProvider: "toss",
        paymentStatus: "pending_payment",
        tossOrderId: orderId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      // 실제 프런트에서 Toss 결제위젯/SDK를 쓰도록 연결하는 방식도 가능하고,
      // 여기서는 success/fail URL이 포함된 결제 진입 페이지로 넘기는 초안.
      const checkoutUrl =
        `https://YOUR_USERNAME.github.io/YOUR_REPO/toss-checkout.html` +
        `?orderId=${encodeURIComponent(orderId)}` +
        `&amount=${encodeURIComponent(pricing.amount)}` +
        `&orderName=${encodeURIComponent("JCK MEMS/NEMS 2026 Registration")}` +
        `&customerEmail=${encodeURIComponent(email)}` +
        `&customerName=${encodeURIComponent(fullName)}`;

      res.status(200).json({ checkoutUrl });
    } catch (err) {
      logger.error(err);
      res.status(500).json({
        error: err.message || "Failed to create Toss payment request"
      });
    }
  }
);

// ---- Toss confirm (success callback에서 호출) ----
export const confirmTossPayment = onRequest(
  {
    cors: true,
    region: "asia-northeast3",
    secrets: [TOSS_SECRET_KEY]
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
      }

      const { paymentKey, orderId, amount } = req.body || {};
      if (!paymentKey || !orderId || !amount) {
        res.status(400).json({ error: "Missing paymentKey, orderId, or amount" });
        return;
      }

      const secretKey = TOSS_SECRET_KEY.value();
      const encoded = Buffer.from(`${secretKey}:`).toString("base64");

      const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${encoded}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount: Number(amount)
        })
      });

      const tossData = await tossRes.json();

      if (!tossRes.ok) {
        res.status(tossRes.status).json({
          error: tossData.message || "Toss confirm failed",
          details: tossData
        });
        return;
      }

      const snap = await db.collection("registrations")
        .where("tossOrderId", "==", orderId)
        .limit(1)
        .get();

      if (snap.empty) {
        res.status(404).json({ error: "Matching registration not found" });
        return;
      }

      const regRef = snap.docs[0].ref;

      await regRef.set({
        paymentStatus: "paid",
        tossPaymentKey: paymentKey,
        tossPaymentData: tossData,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      res.status(200).json({
        success: true,
        paymentStatus: "paid"
      });
    } catch (err) {
      logger.error(err);
      res.status(500).json({
        error: err.message || "Failed to confirm Toss payment"
      });
    }
  }
);
