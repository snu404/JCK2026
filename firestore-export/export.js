const admin = require("firebase-admin");
const fs = require("fs");

const serviceAccount = require("./serviceAccountKey.json");

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function exportCollection(name) {
  const snapshot = await db.collection(name).get();

  const data = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  fs.writeFileSync(
    `${name}.json`,
    JSON.stringify(data, null, 2)
  );

  console.log(`Exported ${data.length} docs from ${name}`);
}

async function main() {
  await exportCollection("registrations");
  await exportCollection("papers");
}

main();
