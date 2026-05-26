import type { Timestamp } from 'firebase/firestore';

export type PartnerOutsourceType = 'motherboard_repair' | 'data_recovery' | 'macbook_repair';
export type PartnerJobStatus = 'sent' | 'in_progress' | 'waiting_parts' | 'completed' | 'returned' | 'cancelled';

export interface PartnerHardwareChecklistPart {
  included: boolean;
  unitCount: number | null;
  capacity: string;
  type: string;
  notes: string;
}

export interface PartnerHardwareChecklistWifiCard {
  included: boolean;
  model: string;
  notes: string;
}

export interface PartnerHardwareChecklist {
  ram: PartnerHardwareChecklistPart;
  ssd: PartnerHardwareChecklistPart;
  hdd: PartnerHardwareChecklistPart;
  wifiCard: PartnerHardwareChecklistWifiCard;
  otherRemarks: string;
  checkedBy: string;
  checkedAt: Timestamp;
}

export interface PartnerHardwareChecklistPartInput {
  included: boolean | null;
  unitCount: number | null;
  capacity: string;
  type: string;
  notes: string;
}

export interface PartnerHardwareChecklistWifiCardInput {
  included: boolean | null;
  model: string;
  notes: string;
}

export interface PartnerHardwareChecklistInput {
  ram: PartnerHardwareChecklistPartInput;
  ssd: PartnerHardwareChecklistPartInput;
  hdd: PartnerHardwareChecklistPartInput;
  wifiCard: PartnerHardwareChecklistWifiCardInput;
  otherRemarks: string;
}

export interface PartnerJob {
  partnerJobId: string;
  sourceJobId?: string;
  rigxJobNumber?: string;
  geniusJobSheetNo: string;
  partnerName: string;
  partnerExternalJobId?: string;
  partnerJobSheetNo: string;
  outsourceType: PartnerOutsourceType;
  customerName: string;
  customerPhone?: string;
  device?: string;
  deviceBrand: string;
  deviceModel: string;
  deviceSerial: string;
  issueDescription: string;
  branchId?: string;
  branch?: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  sentDate: Timestamp;
  expectedReturnDate: Timestamp | null;
  status: PartnerJobStatus;
  remarks: string;
  hardwareChecklist?: PartnerHardwareChecklist;
  hardwareChecklistSummary?: string;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export interface PartnerJobFormInput {
  sourceJobId: string;
  rigxJobNumber: string;
  geniusJobSheetNo: string;
  partnerName: string;
  partnerExternalJobId: string;
  partnerJobSheetNo: string;
  outsourceType: PartnerOutsourceType;
  customerName: string;
  customerPhone: string;
  device: string;
  deviceBrand: string;
  deviceModel: string;
  deviceSerial: string;
  issueDescription: string;
  branchId: string;
  branch: string;
  assignedTechnicianId: string;
  assignedTechnicianName: string;
  sentDate: string;
  expectedReturnDate: string;
  status: PartnerJobStatus;
  remarks: string;
  hardwareChecklist: PartnerHardwareChecklistInput;
}
