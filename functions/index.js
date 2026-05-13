import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import admin from "firebase-admin";
import Stripe from "stripe";

admin.initializeApp();
const db = admin.firestore();

// ---- Secrets ----
// Set these with:
// firebase functions:secrets:set STRIPE_SECRET_KEY
// firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
// firebase functions:secrets:set TOSS_SECRET_KEY
const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
const STRIPE_WEBHOOK_SECRET = defineSecret("STRIPE_WEBHOOK_SECRET");
const TOSS_SECRET_KEY = defineSecret("TOSS_SECRET_KEY");

// ---- Frontend URLs ----
// Replace these with your actual GitHub Pages URLs.
const FRONTEND_BASE_URL = "https://YOUR_USERNAME.github.io/YOUR_REPO";
const STRIPE_SUCCESS_URL = `${FRONTEND_BASE_URL}/payment-success.html?session_id={CHECKOUT_SESSION_ID}`;
const STRIPE_CANCEL_URL = `${FRONTEND_BASE_URL}/payment-cancel.html`;
const TOSS_CHECKOUT_URL = `${FRONTEND_BASE_URL}/toss-checkout.html`;

// ---- Helpers ----
function getRegistrationPricing(participantType, registrationType) {
  // Must match app.js REGISTRATION_FEES.
  if (participantType === "domestic") {
    if (registrationType === "student") return { amount: 300000, currency: "KRW", provider: "toss" };
    if (registrationType === "regular") return { amount: 450000, currency: "KRW", provider: "toss" };
    if (registrationType === "vip") return { amount: 0, currency: "KRW", provider: "toss" };
  }

  if (participantType === "international") {
    if (registrationType === "student") return { amount: 215, currency: "USD", provider: "stripe" };
    if (registrationType === "regular") return { amount: 320, currency: "USD", provider: "stripe" };
    if (registrationType === "vip") return { amount: 0, currency: "USD", provider: "stripe" };
  }

  throw new Error("Invalid participant or registration type.");
}

function makeRegistrationDocId(userUid, participantType, registrationType) {
  return `${userUid}__${participantType}__${registrationType}`;
}

function makeTossOrderId() {
  // Toss orderId should be compact and URL-safe.
  return `JCKMEMS2026_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function requirePost(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return false;
  }
  return true;
}

function validateRegistrationPayload(body) {
  const {
    userUid,
    participantType,
    registrationType,
    fullName,
    affiliation,
    email,
    phone
  } = body || {};

  if (!userUid || !participantType || !registrationType || !fullName || !email) {
    throw new Error("Missing required fields");
  }

  return {
    userUid,
    participantType,
    registrationType,
    fullName,
    affiliation: affiliation || "",
    email,
    phone: phone || ""
  };
}

async function getExistingRegistrationOrFail(regDocId) {
  const regRef = db.collection("registrations").doc(regDocId);
  const regSnap = await regRef.get();

  if (!regSnap.exists) {
    throw new Error("Registration draft not found. Save registration first.");
  }

  return { regRef, regData: regSnap.data() || {} };
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
      if (!requirePost(req, res)) return;

      const payload = validateRegistrationPayload(req.body);
      const pricing = getRegistrationPricing(payload.participantType, payload.registrationType);

      if (pricing.provider !== "stripe") {
        res.status(400).json({ error: "This route is for international/Stripe payments only." });
        return;
      }

      if (pricing.amount <= 0) {
        res.status(400).json({ error: "This registration type does not require payment." });
        return;
      }

      const regDocId = makeRegistrationDocId(
        payload.userUid,
        payload.participantType,
        payload.registrationType
      );

      const { regRef } = await getExistingRegistrationOrFail(regDocId);

      const stripe = new Stripe(STRIPE_SECRET_KEY.value());

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        success_url: STRIPE_SUCCESS_URL,
        cancel_url: STRIPE_CANCEL_URL,
        customer_email: payload.email,
        client_reference_id: regDocId,
        metadata: {
          registrationDocId: regDocId,
          userUid: payload.userUid,
          participantType: payload.participantType,
          registrationType: payload.registrationType
        },
        line_items: [
          {
            price_data: {
              currency: pricing.currency.toLowerCase(),
              product_data: {
                name: `JCK MEMS/NEMS 2026 Registration (${payload.registrationType})`
              },
              unit_amount: pricing.amount * 100
            },
            quantity: 1
          }
        ]
      });

      await regRef.set(
        {
          ...payload,
          amount: pricing.amount,
          currency: pricing.currency,
          paymentProvider: "stripe",
          paymentStatus: "pending_payment",
          stripeCheckoutSessionId: session.id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      res.status(200).json({
        url: session.url,
        sessionId: session.id
      });
    } catch (err) {
      logger.error("createStripeCheckoutSession error", err);
      res.status(500).json({
        error: err.message || "Failed to create Stripe Checkout Session"
      });
    }
  }
);

// ---- Stripe Webhook ----
// Add this endpoint to Stripe Dashboard as a webhook URL.
// Event needed: checkout.session.completed
export const stripeWebhook = onRequest(
  {
    cors: false,
    region: "asia-northeast3",
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET]
  },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).send("Method not allowed");
      return;
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value());
    const signature = req.headers["stripe-signature"];

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        signature,
        STRIPE_WEBHOOK_SECRET.value()
      );
    } catch (err) {
      logger.error("Stripe webhook signature verification failed", err);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const regDocId = session.metadata?.registrationDocId || session.client_reference_id;

        if (!regDocId) {
          logger.warn("Stripe webhook missing registrationDocId", session.id);
          res.status(200).json({ received: true, warning: "missing registrationDocId" });
          return;
        }

        const regRef = db.collection("registrations").doc(regDocId);
        const regSnap = await regRef.get();

        if (!regSnap.exists) {
          logger.warn("Stripe webhook registration not found", { regDocId, sessionId: session.id });
          res.status(200).json({ received: true, warning: "registration not found" });
          return;
        }

        const regData = regSnap.data() || {};
        const expectedPricing = getRegistrationPricing(regData.participantType, regData.registrationType);
        const paidAmountMinor = Number(session.amount_total || 0);
        const expectedAmountMinor = expectedPricing.amount * 100;

        if (paidAmountMinor !== expectedAmountMinor) {
          logger.error("Stripe amount mismatch", {
            regDocId,
            sessionId: session.id,
            paidAmountMinor,
            expectedAmountMinor
          });

          await regRef.set(
            {
              paymentStatus: "amount_mismatch",
              stripeCheckoutSessionId: session.id,
              stripePaymentIntentId: session.payment_intent || "",
              stripeRawStatus: session.payment_status || "",
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          res.status(200).json({ received: true, warning: "amount mismatch" });
          return;
        }

        await regRef.set(
          {
            paymentStatus: "paid",
            paymentProvider: "stripe",
            stripeCheckoutSessionId: session.id,
            stripePaymentIntentId: session.payment_intent || "",
            stripeCustomerEmail: session.customer_details?.email || session.customer_email || "",
            stripeRawStatus: session.payment_status || "paid",
            paidAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      res.status(200).json({ received: true });
    } catch (err) {
      logger.error("Stripe webhook processing error", err);
      res.status(500).send("Webhook processing failed");
    }
  }
);

// ---- Toss Payment Bootstrap ----
// The frontend redirects to toss-checkout.html with order info.
// toss-checkout.html then opens Toss Payments SDK.
export const createTossPayment = onRequest(
  {
    cors: true,
    region: "asia-northeast3",
    secrets: [TOSS_SECRET_KEY]
  },
  async (req, res) => {
    try {
      if (!requirePost(req, res)) return;

      const payload = validateRegistrationPayload(req.body);
      const pricing = getRegistrationPricing(payload.participantType, payload.registrationType);

      if (pricing.provider !== "toss") {
        res.status(400).json({ error: "This route is for domestic/Toss payments only." });
        return;
      }

      if (pricing.amount <= 0) {
        res.status(400).json({ error: "This registration type does not require payment." });
        return;
      }

      const regDocId = makeRegistrationDocId(
        payload.userUid,
        payload.participantType,
        payload.registrationType
      );

      const { regRef } = await getExistingRegistrationOrFail(regDocId);
      const orderId = makeTossOrderId();

      await regRef.set(
        {
          ...payload,
          amount: pricing.amount,
          currency: pricing.currency,
          paymentProvider: "toss",
          paymentStatus: "pending_payment",
          tossOrderId: orderId,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      const checkoutUrl =
        `${TOSS_CHECKOUT_URL}` +
        `?orderId=${encodeURIComponent(orderId)}` +
        `&amount=${encodeURIComponent(pricing.amount)}` +
        `&orderName=${encodeURIComponent(`JCK MEMS/NEMS 2026 Registration (${payload.registrationType})`)}` +
        `&customerEmail=${encodeURIComponent(payload.email)}` +
        `&customerName=${encodeURIComponent(payload.fullName)}`;

      res.status(200).json({
        checkoutUrl,
        orderId,
        amount: pricing.amount,
        currency: pricing.currency
      });
    } catch (err) {
      logger.error("createTossPayment error", err);
      res.status(500).json({
        error: err.message || "Failed to create Toss payment request"
      });
    }
  }
);

// ---- Toss Confirm ----
// payment-success-toss.html should call this endpoint with paymentKey, orderId, and amount.
export const confirmTossPayment = onRequest(
  {
    cors: true,
    region: "asia-northeast3",
    secrets: [TOSS_SECRET_KEY]
  },
  async (req, res) => {
    try {
      if (!requirePost(req, res)) return;

      const { paymentKey, orderId, amount } = req.body || {};

      if (!paymentKey || !orderId || amount === undefined || amount === null) {
        res.status(400).json({ error: "Missing paymentKey, orderId, or amount" });
        return;
      }

      const requestedAmount = Number(amount);

      if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
        res.status(400).json({ error: "Invalid amount" });
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
      const regData = snap.docs[0].data() || {};
      const expectedPricing = getRegistrationPricing(regData.participantType, regData.registrationType);

      if (requestedAmount !== expectedPricing.amount) {
        await regRef.set(
          {
            paymentStatus: "amount_mismatch",
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        res.status(400).json({
          error: "Amount mismatch",
          expectedAmount: expectedPricing.amount,
          requestedAmount
        });
        return;
      }

      const secretKey = TOSS_SECRET_KEY.value();
      const encoded = Buffer.from(`${secretKey}:`).toString("base64");

      const tossRes = await fetch("https://api.tosspayments.com/v1/payments/confirm", {
        method: "POST",
        headers: {
          Authorization: `Basic ${encoded}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          paymentKey,
          orderId,
          amount: requestedAmount
        })
      });

      const tossData = await tossRes.json();

      if (!tossRes.ok) {
        await regRef.set(
          {
            paymentStatus: "confirm_failed",
            tossPaymentKey: paymentKey,
            tossConfirmError: tossData,
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          },
          { merge: true }
        );

        res.status(tossRes.status).json({
          error: tossData.message || "Toss confirm failed",
          details: tossData
        });
        return;
      }

      await regRef.set(
        {
          paymentStatus: "paid",
          paymentProvider: "toss",
          tossPaymentKey: paymentKey,
          tossPaymentData: tossData,
          paidAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      res.status(200).json({
        success: true,
        paymentStatus: "paid"
      });
    } catch (err) {
      logger.error("confirmTossPayment error", err);
      res.status(500).json({
        error: err.message || "Failed to confirm Toss payment"
      });
    }
  }
);
