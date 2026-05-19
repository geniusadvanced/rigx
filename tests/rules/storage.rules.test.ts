import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  initializeRulesTestEnvironment,
  seedBaseFirestore,
  TEST_BUCKET,
} from "./rulesTestHelpers.js";
import firebase from "firebase/compat/app";
import "firebase/compat/storage";

const imageMetadata = { contentType: "image/png" };
const unsafeMetadata = { contentType: "application/x-msdownload" };

function putString(
  ref: firebase.storage.Reference,
  value: string,
  metadata: firebase.storage.UploadMetadata,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    ref.putString(value, "raw", metadata).then(resolve, reject);
  });
}

describe("RIGX Storage security rules", () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    testEnv = await initializeRulesTestEnvironment();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.clearStorage();
    await seedBaseFirestore(testEnv);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const storage = context.storage(TEST_BUCKET);
      await storage.ref("pos-payments/invoice1/payment1/proof.png").putString("proof", "raw", imageMetadata);
      await storage.ref("job-documents/assigned/intake.png").putString("doc", "raw", imageMetadata);
      await storage.ref("job-documents/unassigned/intake.png").putString("doc", "raw", imageMetadata);
      await storage.ref("ai-pricelist-imports/import1/source.png").putString("source", "raw", imageMetadata);
      await storage.ref("payment-submissions/invoice1/submission1/proof.png").putString("proof", "raw", imageMetadata);
      await storage.ref("whatsapp-media/bangi/60123456789/msg1/photo.png").putString("media", "raw", imageMetadata);
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("blocks public reads and arbitrary writes", async () => {
    const storage = testEnv.unauthenticatedContext().storage(TEST_BUCKET);

    await assertFails(storage.ref("pos-payments/invoice1/payment1/proof.png").getDownloadURL());
    await assertFails(storage.ref("job-documents/assigned/intake.png").getDownloadURL());
    await assertFails(putString(storage.ref("random/file.png"), "bad", imageMetadata));
  });

  it("allows admin payment proof and AI import uploads with safe file metadata", async () => {
    const storage = testEnv.authenticatedContext("admin").storage(TEST_BUCKET);

    await assertSucceeds(putString(storage.ref("pos-payments/invoice2/payment2/proof.png"), "proof", imageMetadata));
    await assertSucceeds(putString(storage.ref("ai-pricelist-imports/import2/source.png"), "source", imageMetadata));
    await assertFails(putString(storage.ref("pos-payments/invoice2/payment3/proof.exe"), "proof", unsafeMetadata));
  });

  it("allows assigned technician job-document access only for assigned jobs", async () => {
    const storage = testEnv.authenticatedContext("tech").storage(TEST_BUCKET);

    await assertSucceeds(putString(storage.ref("job-documents/assigned/diagnosis.png"), "doc", imageMetadata));
    await assertSucceeds(storage.ref("job-documents/assigned/intake.png").getDownloadURL());
    await assertFails(putString(storage.ref("job-documents/unassigned/diagnosis.png"), "doc", imageMetadata));
    await assertFails(storage.ref("job-documents/unassigned/intake.png").getDownloadURL());
  });

  it("protects restricted POS, public-submission, and WhatsApp media paths", async () => {
    const adminStorage = testEnv.authenticatedContext("admin").storage(TEST_BUCKET);
    const techStorage = testEnv.authenticatedContext("tech").storage(TEST_BUCKET);

    await assertSucceeds(adminStorage.ref("pos-payments/invoice1/payment1/proof.png").getDownloadURL());
    await assertFails(techStorage.ref("pos-payments/invoice1/payment1/proof.png").getDownloadURL());
    await assertFails(putString(adminStorage.ref("payment-submissions/invoice1/submission2/proof.png"), "proof", imageMetadata));
    await assertSucceeds(adminStorage.ref("payment-submissions/invoice1/submission1/proof.png").getDownloadURL());
    await assertSucceeds(adminStorage.ref("whatsapp-media/bangi/60123456789/msg1/photo.png").getDownloadURL());
    await assertFails(techStorage.ref("whatsapp-media/bangi/60123456789/msg1/photo.png").getDownloadURL());
  });
});
