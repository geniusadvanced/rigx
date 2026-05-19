import { readFileSync } from "node:fs";
import firebase from "firebase/compat/app";
import "firebase/compat/firestore";
import "firebase/compat/storage";
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";

export const TEST_PROJECT_ID = "demo-rigx-rules-test";
export const TEST_BUCKET = `gs://${TEST_PROJECT_ID}.appspot.com`;
export const ts = firebase.firestore.Timestamp.fromDate(
  new Date("2026-05-07T00:00:00.000Z"),
);

export async function initializeRulesTestEnvironment(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: TEST_PROJECT_ID,
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
    },
    storage: {
      rules: readFileSync("storage.rules", "utf8"),
    },
  });
}

export function userDoc(role: "admin" | "manager" | "technician", branchId = "bangi") {
  return {
    role,
    branchId,
    displayName: `${role} user`,
    name: `${role} user`,
    active: true,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function jobDoc(overrides: Record<string, unknown> = {}) {
  return {
    agnJobNumber: "JOB-001",
    jobNo: "RIGX-260001",
    jobNumber: "RIGX-260001",
    jobSheetNo: "RIGX-260001",
    customerName: "Test Customer",
    customerPhone: "60123456789",
    device: "Laptop",
    deviceModel: "ThinkPad",
    branchId: "bangi",
    technicianId: "tech",
    technicianName: "technician user",
    totalSale: 0,
    createdBy: "admin",
    createdByDisplayName: "admin user",
    commissionAmount: 0,
    commissionStatus: "pending_documents",
    costProfile: "parts_required",
    requiredDocuments: ["checklist", "invoice"],
    status: "received",
    lifecycleStatus: "received",
    statusHistory: [
      {
        status: "received",
        changedBy: "admin",
        changedByDisplayName: "admin user",
        changedAt: ts,
      },
    ],
    lifecycleHistory: [
      {
        from: null,
        to: "received",
        changedBy: "admin",
        changedByDisplayName: "admin user",
        changedAt: ts,
      },
    ],
    approvalStatus: "approved",
    approvedBy: "admin",
    approvedAt: ts,
    quotationAmount: 0,
    quotationStatus: "draft",
    quotationApprovedBy: "",
    customerApprovalStatus: "pending",
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

export function lifecycleUpdate(
  status: string,
  lifecycleStatus: string,
  actorId = "tech",
  extra: Record<string, unknown> = {},
) {
  return {
    status,
    lifecycleStatus,
    statusHistory: [
      {
        status,
        changedBy: actorId,
        changedByDisplayName: `${actorId} user`,
        changedAt: ts,
      },
    ],
    lifecycleHistory: [
      {
        from: "received",
        to: lifecycleStatus,
        changedBy: actorId,
        changedByDisplayName: `${actorId} user`,
        changedAt: ts,
      },
    ],
    updatedAt: ts,
    ...extra,
  };
}

export async function seedBaseFirestore(testEnv: RulesTestEnvironment) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await db.doc("users/admin").set(userDoc("admin"));
    await db.doc("users/manager").set(userDoc("manager"));
    await db.doc("users/tech").set(userDoc("technician"));
    await db.doc("users/otherTech").set(userDoc("technician"));
    await db.doc("jobs/assigned").set(jobDoc());
    await db.doc("jobs/unassigned").set(jobDoc({ technicianId: "otherTech" }));
    await db.doc("customers/customer1").set({
      name: "Test Customer",
      phone: "60123456789",
      email: "customer@example.com",
      branchId: "bangi",
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("devices/device1").set({
      customerId: "customer1",
      brand: "Lenovo",
      model: "ThinkPad",
      serialNumber: "SERIAL-1",
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("auditLogs/audit1").set({
      action: "job_lifecycle_status_changed",
      actorId: "admin",
      targetCollection: "jobs",
      targetId: "assigned",
      createdAt: ts,
    });
    await db.doc("payroll/tech_2026-05").set({
      technicianId: "tech",
      month: "2026-05",
      status: "draft",
      grossPay: 0,
      netPay: 0,
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("payroll/otherTech_2026-05").set({
      technicianId: "otherTech",
      month: "2026-05",
      status: "draft",
      grossPay: 0,
      netPay: 0,
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("quotations/quotation1").set({
      quotationNo: "Q-001",
      customerId: "customer1",
      customerName: "Test Customer",
      customerPhone: "60123456789",
      branchId: "bangi",
      items: [],
      subtotal: 0,
      discountAmount: 0,
      total: 0,
      status: "draft",
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("invoices/invoice1").set({
      invoiceNo: "INV-001",
      customerId: "customer1",
      customerName: "Test Customer",
      customerPhone: "60123456789",
      branchId: "bangi",
      items: [],
      total: 100,
      amountPaid: 0,
      balance: 100,
      paymentStatus: "unpaid",
      createdAt: ts,
      updatedAt: ts,
    });
    await db.doc("warranties/warranty1").set({
      invoiceId: "invoice1",
      invoiceItemKey: "invoice1:0",
      customerId: "customer1",
      customerName: "Test Customer",
      customerPhone: "60123456789",
      branchId: "bangi",
      itemName: "Screen Replacement",
      warrantyDurationDays: 30,
      claimLimit: "unlimited",
      status: "active",
      createdBy: "admin",
      createdAt: ts,
    });
    await db.doc("posCommissionEntries/commission1").set({
      sourceType: "invoice",
      sourceId: "invoice1",
      invoiceId: "invoice1",
      invoiceItemKey: "invoice1:0",
      itemName: "Screen Replacement",
      branchId: "bangi",
      sourceTotal: 100,
      commissionAmount: 10,
      status: "pending",
      createdBy: "admin",
      createdAt: ts,
    });
    await db.doc("priceItems/price1").set({
      name: "Diagnosis",
      category: "Diagnostic",
      type: "diagnostic",
      basePrice: 30,
      commissionEligible: false,
      active: true,
      createdAt: ts,
      updatedAt: ts,
    });
  });
}
