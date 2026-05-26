import { after, before, beforeEach, describe, it } from "node:test";
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  initializeRulesTestEnvironment,
  jobDoc,
  lifecycleUpdate,
  seedBaseFirestore,
  ts,
} from "./rulesTestHelpers.js";

describe("RIGX Firestore security rules", () => {
  let testEnv: RulesTestEnvironment;

  before(async () => {
    testEnv = await initializeRulesTestEnvironment();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seedBaseFirestore(testEnv);
  });

  after(async () => {
    await testEnv.cleanup();
  });

  function deviceChecklistAuditPayload(overrides: Record<string, unknown> = {}) {
    return {
      entityType: "device_checklist",
      entityId: "checklist1",
      action: "device_checklist_imported_customer",
      changedBy: "admin",
      changedByDisplayName: "admin user",
      changes: [],
      note: "Device checklist audit",
      createdAt: ts,
      ...overrides,
    };
  }

  async function seedDeviceChecklist(testEnv: RulesTestEnvironment) {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("deviceChecklists/checklist1").set({
        jobId: "assigned",
        jobNumber: "RIGX-260001",
        customerId: "customer1",
        customerNameSnapshot: "Test Customer",
        customerPhoneSnapshot: "60123456789",
        customerEmailSnapshot: "customer@example.com",
        deviceId: "device1",
        deviceCategorySnapshot: "Laptop",
        deviceBrandModelSnapshot: "Lenovo ThinkPad",
        deviceSerialOrImeiSnapshot: "SERIAL-1",
        reportedIssueSnapshot: "No power",
        branchId: "bangi",
        assignedTechnicianId: "tech",
        assignedTechnicianName: "technician user",
        importedFromJob: true,
        importedFromCustomer: true,
        importedFromDevice: true,
        externalConditionSummary: "",
        functionalChecklist: "",
        accessoriesReceived: "",
        internalComponentInventory: "",
        disclaimer: "Test disclaimer",
        checklistStatus: "draft",
        createdBy: "admin",
        createdByDisplayName: "admin user",
        createdAt: ts,
        updatedAt: ts,
      });
    });
  }

  async function seedCompletedDeviceChecklist(testEnv: RulesTestEnvironment) {
    await seedDeviceChecklist(testEnv);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("deviceChecklists/checklist1").update({
        checklistStatus: "staff_completed",
        technicianVerification: {
          technicianId: "tech",
          technicianName: "technician user",
          technicianRole: "technician",
          branchId: "bangi",
          checkedAt: ts,
          authUid: "tech",
          verificationText: "Auto verified by RIGX System",
        },
        updatedAt: ts,
      });
    });
  }

  function tokenUpdate(overrides: Record<string, unknown> = {}) {
    return {
      publicSignatureToken: "token-123",
      publicSignatureTokenCreatedAt: ts,
      publicSignatureTokenExpiresAt: ts,
      updatedAt: ts,
      ...overrides,
    };
  }

  it("blocks public access to private operational collections", async () => {
    const db = testEnv.unauthenticatedContext().firestore();

    await assertFails(db.doc("jobs/assigned").get());
    await assertFails(db.doc("jobs/public-write").set(jobDoc({ createdBy: "public" })));
    await assertFails(db.doc("auditLogs/audit1").get());
    await assertFails(db.doc("payroll/tech_2026-05").get());
    await assertFails(db.doc("posCommissionEntries/commission1").get());
    await assertFails(db.doc("customers/customer1").get());
    await assertFails(db.doc("devices/device1").get());
    await assertFails(db.doc("jobs/assigned").update({ customerLastTrackedAt: ts }));
  });

  it("allows admin to manage jobs and read protected back-office collections", async () => {
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertSucceeds(db.doc("jobs/assigned").get());
    const createBatch = db.batch();
    createBatch.set(db.doc("jobs/admin-created"), jobDoc({
      agnJobNumber: "AGN-ADMIN",
      jobNo: "RIGX-260099",
      jobNumber: "RIGX-260099",
      jobSheetNo: "RIGX-260099",
      createdBy: "admin",
      approvedBy: "admin",
    }));
    createBatch.set(db.doc("jobNumberRegistry/RIGX-260099"), {
      jobId: "admin-created",
      jobNo: "RIGX-260099",
      year: 2026,
      runningNumber: 99,
      createdAt: ts,
    });
    createBatch.set(db.doc("systemCounters/jobNumbers_2026"), {
      year: 2026,
      prefix: "RIGX",
      lastNumber: 99,
      lastJobNo: "RIGX-260099",
      lastJobId: "admin-created",
      updatedAt: ts,
    });
    await assertSucceeds(createBatch.commit());
    await assertSucceeds(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("diagnosis", "diagnosis", "admin", {
          diagnosisStartedAt: ts,
        }),
      }),
    );
    await assertSucceeds(db.doc("auditLogs/audit1").get());
    await assertSucceeds(db.doc("payroll/tech_2026-05").get());
    await assertSucceeds(db.doc("users/tech").get());
  });

  it("blocks standalone counter/registry writes and manual job number edits", async () => {
    const adminDb = testEnv.authenticatedContext("admin").firestore();
    const techDb = testEnv.authenticatedContext("tech").firestore();

    await assertFails(adminDb.doc("systemCounters/jobNumbers_2026").set({
      year: 2026,
      prefix: "RIGX",
      lastNumber: 1,
      lastJobNo: "RIGX-260001",
      lastJobId: "assigned",
      updatedAt: ts,
    }));
    await assertFails(adminDb.doc("jobNumberRegistry/RIGX-260001").set({
      jobId: "assigned",
      jobNo: "RIGX-260001",
      year: 2026,
      runningNumber: 1,
      createdAt: ts,
    }));
    await assertFails(techDb.doc("jobs/assigned").update({ jobNo: "RIGX-269999", updatedAt: ts }));
    await assertFails(adminDb.doc("jobs/assigned").update({ jobNo: "RIGX-269999", updatedAt: ts }));
  });

  it("rejects malformed official RIGX job numbers on job creation", async () => {
    const db = testEnv.authenticatedContext("admin").firestore();

    for (const malformed of ["RIGX-26001", "RIGX-2600001", "AGN-260001", "RIGX-AB0001"]) {
      const jobId = `bad-${malformed.replace(/[^A-Z0-9]/g, "")}`;
      const batch = db.batch();
      batch.set(db.doc(`jobs/${jobId}`), jobDoc({
        jobNo: malformed,
        jobNumber: malformed,
        jobSheetNo: malformed,
        createdBy: "admin",
        approvedBy: "admin",
      }));
      batch.set(db.doc(`jobNumberRegistry/${malformed}`), {
        jobId,
        jobNo: malformed,
        year: 2026,
        runningNumber: 1,
        createdAt: ts,
      });
      batch.set(db.doc("systemCounters/jobNumbers_2026"), {
        year: 2026,
        prefix: "RIGX",
        lastNumber: 1,
        lastJobNo: malformed,
        lastJobId: jobId,
        updatedAt: ts,
      });
      await assertFails(batch.commit());
    }
  });

  it("limits managers to matching branch jobs", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("jobs/cyberjaya-job").set(jobDoc({
        jobNo: "RIGX-260088",
        jobNumber: "RIGX-260088",
        jobSheetNo: "RIGX-260088",
        branchId: "cyberjaya",
        technicianId: "otherTech",
      }));
    });
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertSucceeds(db.doc("jobs/assigned").get());
    await assertSucceeds(db.doc("jobs/unassigned").get());
    await assertFails(db.doc("jobs/cyberjaya-job").get());
    await assertSucceeds(db.collection("jobs").where("branchId", "==", "bangi").get());
    await assertFails(db.collection("jobs").where("branchId", "==", "cyberjaya").get());
    await assertSucceeds(db.doc("payroll/tech_2026-05").get());
    await assertSucceeds(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("diagnosis", "diagnosis", "manager", {
          diagnosisStartedAt: ts,
        }),
      }),
    );
    await assertFails(
      db.doc("jobs/cyberjaya-job").update({
        ...lifecycleUpdate("diagnosis", "diagnosis", "manager", {
          diagnosisStartedAt: ts,
        }),
      }),
    );
  });

  it("limits technicians to assigned jobs and own payroll", async () => {
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(db.doc("jobs/assigned").get());
    await assertFails(db.doc("jobs/unassigned").get());
    await assertFails(db.doc("jobs/unassigned").update({ updatedAt: ts }));
    await assertSucceeds(db.doc("payroll/tech_2026-05").get());
    await assertFails(db.doc("payroll/otherTech_2026-05").get());
    await assertFails(db.doc("posCommissionEntries/commission1").get());
  });

  it("allows a technician valid lifecycle transition on an assigned job", async () => {
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("diagnosis", "diagnosis", "tech", {
          diagnosisStartedAt: ts,
        }),
      }),
    );
  });

  it("allows assigned technician to mark completed job ready for pickup with notification metadata", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("jobs/assigned").update({
        status: "completed",
        lifecycleStatus: "repair_completed",
        repairCompletedAt: ts,
        updatedAt: ts,
      });
    });
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("ready_for_collection", "ready_for_pickup", "tech", {
          readyForPickupAt: ts,
          readyForPickupBy: "tech",
          readyForPickupByDisplayName: "technician user",
          pickupNotifiedAt: ts,
          pickupNotifiedBy: "tech",
          pickupNotifiedByDisplayName: "technician user",
          repairSummaryPublic: "Your device is ready for pickup at Genius Advanced.",
        }),
      }),
    );
  });

  it("allows admin to mark a legacy completed job ready for pickup when immutable metadata is missing", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const legacyJob = jobDoc({
        status: "completed",
        lifecycleStatus: "repair_completed",
        repairCompletedAt: ts,
        updatedAt: ts,
      }) as Record<string, unknown>;
      Reflect.deleteProperty(legacyJob, "createdBy");
      Reflect.deleteProperty(legacyJob, "createdAt");
      await context.firestore().doc("jobs/legacy-ready").set(legacyJob);
    });
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertSucceeds(
      db.doc("jobs/legacy-ready").update({
        ...lifecycleUpdate("ready_for_collection", "ready_for_pickup", "admin", {
          readyForPickupAt: ts,
          readyForPickupBy: "admin",
          readyForPickupByDisplayName: "admin user",
          pickupNotifiedAt: ts,
          pickupNotifiedBy: "admin",
          pickupNotifiedByDisplayName: "admin user",
          repairSummaryPublic: "Your device is ready for pickup at Genius Advanced.",
        }),
      }),
    );
  });

  it("blocks admin lifecycle update from changing technician assignment", async () => {
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertFails(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("diagnosis", "diagnosis", "admin", {
          diagnosisStartedAt: ts,
        }),
        technicianId: "otherTech",
      }),
    );
  });

  it("blocks a technician invalid lifecycle jump on an assigned job", async () => {
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertFails(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("completed", "repair_completed", "tech", {
          repairCompletedAt: ts,
        }),
      }),
    );
  });

  it("documents current weakness: admin invalid lifecycle jumps are allowed by rules", async () => {
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertSucceeds(
      db.doc("jobs/assigned").update({
        ...lifecycleUpdate("completed", "delivered", "admin", {
          repairCompletedAt: ts,
          deliveredAt: ts,
        }),
      }),
    );
  });

  it("protects POS, quotation, invoice, warranty, and public-token records from direct public reads", async () => {
    const publicDb = testEnv.unauthenticatedContext().firestore();
    const adminDb = testEnv.authenticatedContext("admin").firestore();
    const techDb = testEnv.authenticatedContext("tech").firestore();

    await assertFails(publicDb.doc("quotations/quotation1").get());
    await assertFails(publicDb.doc("invoices/invoice1").get());
    await assertFails(publicDb.doc("warranties/warranty1").get());
    await assertFails(publicDb.doc("paymentSubmissions/submission1").get());
    await assertSucceeds(adminDb.doc("quotations/quotation1").get());
    await assertSucceeds(adminDb.doc("invoices/invoice1").get());
    await assertSucceeds(adminDb.doc("warranties/warranty1").get());
    await assertFails(techDb.doc("quotations/quotation1").get());
    await assertFails(techDb.doc("invoices/invoice1").get());
    await assertFails(techDb.doc("warranties/warranty1").get());
  });

  it("keeps pricelist readable only to authenticated users", async () => {
    await assertFails(testEnv.unauthenticatedContext().firestore().doc("priceItems/price1").get());
    await assertSucceeds(testEnv.authenticatedContext("tech").firestore().doc("priceItems/price1").get());
  });

  it("allows admin to create Device Checklist audit log", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertSucceeds(
      db.doc("auditLogs/device-checklist-admin").set(deviceChecklistAuditPayload({
        changedBy: "admin",
        changedByDisplayName: "admin user",
      })),
    );
  });

  it("allows manager with matching branch to create Device Checklist audit log", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertSucceeds(
      db.doc("auditLogs/device-checklist-manager").set(deviceChecklistAuditPayload({
        changedBy: "manager",
        changedByDisplayName: "manager user",
        action: "device_checklist_sent_whatsapp",
      })),
    );
  });

  it("allows assigned technician to create Device Checklist audit log", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("auditLogs/device-checklist-tech").set(deviceChecklistAuditPayload({
        changedBy: "tech",
        changedByDisplayName: "technician user",
        action: "device_checklist_signature_overridden",
      })),
    );
  });

  it("allows ready for pickup WhatsApp audit log", async () => {
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("auditLogs/job-ready-pickup-whatsapp").set({
        entityType: "job",
        entityId: "assigned",
        action: "job_ready_for_pickup_whatsapp_sent",
        changedBy: "tech",
        changedByDisplayName: "technician user",
        changes: [],
        note: "Ready for pickup WhatsApp message prepared",
        createdAt: ts,
      }),
    );
  });

  it("blocks unrelated technician from creating Device Checklist audit log", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("otherTech").firestore();

    await assertFails(
      db.doc("auditLogs/device-checklist-other-tech").set(deviceChecklistAuditPayload({
        changedBy: "otherTech",
        changedByDisplayName: "technician user",
      })),
    );
  });

  it("blocks Device Checklist audit log with invalid action", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertFails(
      db.doc("auditLogs/device-checklist-invalid-action").set(deviceChecklistAuditPayload({
        action: "device_checklist_deleted",
      })),
    );
  });

  it("blocks audit log with invalid entity type", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertFails(
      db.doc("auditLogs/device-checklist-invalid-entity").set(deviceChecklistAuditPayload({
        entityType: "device_checklists",
      })),
    );
  });

  it("allows manager to query Device Checklist with matching branch", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertSucceeds(
      db.collection("deviceChecklists")
        .where("jobId", "==", "assigned")
        .where("branchId", "==", "bangi")
        .get(),
    );
  });

  it("blocks manager from querying or reading Device Checklist from another branch", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc("jobs/cheras-assigned").set(jobDoc({
        branchId: "cheras",
        technicianId: "otherTech",
        technicianName: "other technician user",
      }));
      await db.doc("deviceChecklists/checklist-cheras").set({
        jobId: "cheras-assigned",
        jobNumber: "RIGX-260002",
        customerId: "customer1",
        customerNameSnapshot: "Test Customer",
        customerPhoneSnapshot: "60123456789",
        customerEmailSnapshot: "customer@example.com",
        deviceId: "device1",
        deviceCategorySnapshot: "Laptop",
        deviceBrandModelSnapshot: "Lenovo ThinkPad",
        deviceSerialOrImeiSnapshot: "SERIAL-1",
        reportedIssueSnapshot: "No power",
        branchId: "cheras",
        assignedTechnicianId: "otherTech",
        assignedTechnicianName: "other technician user",
        importedFromJob: true,
        importedFromCustomer: true,
        importedFromDevice: true,
        externalConditionSummary: "",
        functionalChecklist: "",
        accessoriesReceived: "",
        internalComponentInventory: "",
        disclaimer: "Test disclaimer",
        checklistStatus: "draft",
        createdBy: "admin",
        createdByDisplayName: "admin user",
        createdAt: ts,
        updatedAt: ts,
      });
    });
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertFails(db.doc("deviceChecklists/checklist-cheras").get());
    await assertFails(
      db.collection("deviceChecklists")
        .where("jobId", "==", "cheras-assigned")
        .where("branchId", "==", "cheras")
        .get(),
    );
  });

  it("allows assigned technician to query Device Checklist using assignedTechnicianId", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.collection("deviceChecklists")
        .where("jobId", "==", "assigned")
        .where("assignedTechnicianId", "==", "tech")
        .get(),
    );
  });

  it("blocks unrelated technician from reading Device Checklist", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("otherTech").firestore();

    await assertFails(db.doc("deviceChecklists/checklist1").get());
  });

  it("allows admin to read Device Checklist with job and branch query", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("admin").firestore();

    await assertSucceeds(
      db.collection("deviceChecklists")
        .where("jobId", "==", "assigned")
        .where("branchId", "==", "bangi")
        .get(),
    );
  });

  it("allows valid staff update after public signature fields are stored", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("deviceChecklists/checklist1").update({
        checklistStatus: "customer_signed",
        customerSignedAt: ts,
        customerSignedName: "Test Customer",
        customerSignedPhone: "60123456789",
        customerSignatureDataUrl: "data:image/png;base64,test",
        customerTypedSignature: "",
        customerAcknowledgedDisclaimer: true,
        customerSignature: {
          name: "Test Customer",
          phone: "60123456789",
          dataUrl: "data:image/png;base64,test",
          typedSignature: "",
          signedAt: ts,
          tokenUsed: "token-123",
        },
        publicSignatureTokenUsed: "token-123",
        customerSignedIp: "127.0.0.1",
        customerSignedUserAgent: "rules-test",
        updatedAt: ts,
      });
    });
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertSucceeds(
      db.doc("deviceChecklists/checklist1").update({
        checklistStatus: "final_checked",
        updatedAt: ts,
      }),
    );
  });

  it("blocks broad technician Device Checklist query by jobId only", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertFails(
      db.collection("deviceChecklists")
        .where("jobId", "==", "assigned")
        .get(),
    );
  });

  it("allows original completing user to write Device Checklist technician verification", async () => {
    await seedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("deviceChecklists/checklist1").update({
        checklistStatus: "staff_completed",
        technicianVerification: {
          technicianId: "tech",
          technicianName: "technician user",
          technicianRole: "technician",
          branchId: "bangi",
          checkedAt: ts,
          authUid: "tech",
          verificationText: "Auto verified by RIGX System",
        },
        updatedAt: ts,
      }),
    );
  });

  it("allows authorized manager to send Device Checklist token without changing technician verification", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertSucceeds(
      db.doc("deviceChecklists/checklist1").update(tokenUpdate({
        checklistStatus: "sent_to_customer",
        sentToCustomerAt: ts,
        sentToCustomerBy: "manager",
      })),
    );
  });

  it("blocks authorized staff from replacing Device Checklist technician verification during token update", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertFails(
      db.doc("deviceChecklists/checklist1").update(tokenUpdate({
        checklistStatus: "sent_to_customer",
        sentToCustomerAt: ts,
        sentToCustomerBy: "manager",
        technicianVerification: {
          technicianId: "manager",
          technicianName: "manager user",
          technicianRole: "manager",
          branchId: "bangi",
          checkedAt: ts,
          authUid: "manager",
          verificationText: "Auto verified by RIGX System",
        },
      })),
    );
  });

  it("blocks unrelated technician from updating Device Checklist token", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("otherTech").firestore();

    await assertFails(
      db.doc("deviceChecklists/checklist1").update(tokenUpdate({
        checklistStatus: "sent_to_customer",
      })),
    );
  });

  it("allows assigned technician to send Device Checklist token without matching existing verifier UID requirement", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context.firestore().doc("deviceChecklists/checklist1").update({
        technicianVerification: {
          technicianId: "admin",
          technicianName: "admin user",
          technicianRole: "admin",
          branchId: "bangi",
          checkedAt: ts,
          authUid: "admin",
          verificationText: "Auto verified by RIGX System",
        },
      });
    });
    const db = testEnv.authenticatedContext("tech").firestore();

    await assertSucceeds(
      db.doc("deviceChecklists/checklist1").update(tokenUpdate({
        checklistStatus: "sent_to_customer",
        sentToCustomerAt: ts,
        sentToCustomerBy: "tech",
      })),
    );
  });

  it("blocks Device Checklist update with invalid status", async () => {
    await seedCompletedDeviceChecklist(testEnv);
    const db = testEnv.authenticatedContext("manager").firestore();

    await assertFails(
      db.doc("deviceChecklists/checklist1").update(tokenUpdate({
        checklistStatus: "sent",
      })),
    );
  });
});
