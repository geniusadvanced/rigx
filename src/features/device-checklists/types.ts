import type { Timestamp } from 'firebase/firestore';

export type DeviceChecklistStatus =
  | 'not_created'
  | 'draft'
  | 'staff_completed'
  | 'completed_by_staff'
  | 'sent_to_customer'
  | 'customer_signed'
  | 'signature_overridden'
  | 'final_checked'
  | 'completed';

export type DeviceChecklistType = 'pre_repair' | 'after_repair';
export type InspectionStatus = 'good' | 'issue' | 'not_tested' | 'na';
export type AccessoryBeforeStatus = 'received' | 'not_received' | 'na';
export type AccessoryAfterStatus = 'returned' | 'not_returned' | 'na';
export type InternalComponentStatus = 'present' | 'missing' | 'not_checked' | 'na';
export type AfterRepairTestStatus = 'passed' | 'issue' | 'na';

export interface AfterRepairTestedItem {
  key: string;
  label: string;
  status: AfterRepairTestStatus;
}

export interface DeviceChecklistItem {
  key: string;
  label: string;
  notePlaceholder: string;
  beforeStatus: InspectionStatus;
  afterStatus: InspectionStatus;
  note: string;
}

export interface DeviceChecklistAccessory {
  key: string;
  label: string;
  beforeStatus: AccessoryBeforeStatus;
  afterStatus: AccessoryAfterStatus;
  note: string;
}

export interface InternalComponentRecord {
  status: InternalComponentStatus;
  quantity?: string;
  type?: string;
  capacity?: string;
  note: string;
}

export interface DeviceChecklistInternalComponents {
  ram: InternalComponentRecord;
  storage: InternalComponentRecord;
  wifiCard: InternalComponentRecord;
  other?: InternalComponentRecord;
}

export interface DeviceChecklistTechnicianVerification {
  technicianId: string;
  technicianName: string;
  technicianRole?: string;
  branchId?: string;
  checkedAt?: Timestamp;
  authUid: string;
  verificationText: string;
}

export interface DeviceChecklist {
  checklistId: string;
  jobId: string;
  checklistType?: DeviceChecklistType;
  jobNumber: string;
  customerId: string;
  customerNameSnapshot: string;
  customerPhoneSnapshot: string;
  customerEmailSnapshot?: string;
  deviceId?: string;
  deviceCategorySnapshot: string;
  deviceBrandModelSnapshot: string;
  deviceSerialOrImeiSnapshot: string;
  reportedIssueSnapshot: string;
  branchId: string;
  assignedTechnicianId?: string;
  assignedTechnicianName?: string;
  importedFromJob: boolean;
  importedFromCustomer: boolean;
  importedFromDevice: boolean;
  items?: DeviceChecklistItem[];
  accessories?: DeviceChecklistAccessory[];
  internalComponents?: DeviceChecklistInternalComponents;
  technicianVerification?: DeviceChecklistTechnicianVerification;
  externalConditionSummary: string;
  functionalChecklist: string;
  accessoriesReceived: string;
  internalComponentInventory: string;
  disclaimer: string;
  checklistStatus: DeviceChecklistStatus;
  publicSignatureToken?: string;
  publicSignatureTokenCreatedAt?: Timestamp;
  publicSignatureTokenExpiresAt?: Timestamp;
  sentToCustomerAt?: Timestamp;
  sentToCustomerBy?: string;
  customerSignedAt?: Timestamp;
  customerSignedName?: string;
  customerSignedPhone?: string;
  customerSignatureDataUrl?: string;
  customerTypedSignature?: string;
  customerAcknowledgedDisclaimer?: boolean;
  customerSignature?: {
    name?: string;
    phone?: string;
    dataUrl?: string;
    typedSignature?: string;
    signedAt?: Timestamp;
    tokenUsed?: string;
  };
  publicSignatureTokenUsed?: string;
  technicianId?: string;
  completedAt?: Timestamp;
  testedItems?: AfterRepairTestedItem[];
  remarks?: string;
  customerSignedIp?: string;
  customerSignedUserAgent?: string;
  overrideBy?: string;
  overrideAt?: Timestamp;
  overrideReason?: string;
  createdBy: string;
  createdByDisplayName: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

export const inspectionStatusOptions: Array<{ value: InspectionStatus; label: string }> = [
  { value: 'good', label: 'Good' },
  { value: 'issue', label: 'Issue' },
  { value: 'not_tested', label: 'Not Tested' },
  { value: 'na', label: 'N/A' },
];

export const accessoryBeforeStatusOptions: Array<{ value: AccessoryBeforeStatus; label: string }> = [
  { value: 'received', label: 'Received' },
  { value: 'not_received', label: 'Not Received' },
  { value: 'na', label: 'N/A' },
];

export const accessoryAfterStatusOptions: Array<{ value: AccessoryAfterStatus; label: string }> = [
  { value: 'returned', label: 'Returned' },
  { value: 'not_returned', label: 'Not Returned' },
  { value: 'na', label: 'N/A' },
];

export const internalComponentStatusOptions: Array<{ value: InternalComponentStatus; label: string }> = [
  { value: 'present', label: 'Present' },
  { value: 'missing', label: 'Missing' },
  { value: 'not_checked', label: 'Not Checked' },
  { value: 'na', label: 'N/A' },
];

export const afterRepairTestedItemDefinitions = [
  ['device_powers_on', 'Device powers on'],
  ['display_working', 'Display working'],
  ['keyboard_touchpad_buttons_tested', 'Keyboard/touchpad/buttons tested'],
  ['charging_tested', 'Charging tested'],
  ['wifi_bluetooth_tested', 'WiFi/Bluetooth tested if applicable'],
  ['speaker_mic_camera_tested', 'Speaker/mic/camera tested if applicable'],
  ['storage_ram_detected', 'Storage/RAM detected if applicable'],
  ['repair_issue_verified_fixed', 'Repair issue verified fixed'],
  ['physical_condition_checked', 'Physical condition checked'],
  ['customer_data_accessories_checked', 'Customer data/device accessories checked'],
] as const;

export function createDefaultAfterRepairTestedItems(): AfterRepairTestedItem[] {
  return afterRepairTestedItemDefinitions.map(([key, label]) => ({
    key,
    label,
    status: 'passed',
  }));
}

export const deviceChecklistItemDefinitions = [
  ['lcd_screen', 'LCD / Screen', 'crack, scratch, line, flicker, no display, dim display'],
  ['keyboard', 'Keyboard', 'some key not working, sticky key, missing key, backlight issue'],
  ['touchpad', 'Touchpad', 'not responsive, jumping cursor, button issue'],
  ['speaker', 'Speaker', 'no sound, distorted sound, low volume'],
  ['microphone', 'Microphone', 'not detected, low input, noisy sound'],
  ['camera', 'Camera', 'not detected, blurry, black screen'],
  ['power', 'Power', 'cannot power on, auto shutdown, intermittent power'],
  ['charging_port', 'Charging Port', 'loose, not charging, intermittent charging'],
  ['usb_ports', 'USB / Ports', 'not detect, loose, damaged'],
  ['battery', 'Battery', 'weak, swollen, not charging, fast drain'],
  ['wifi_bluetooth', 'WiFi / Bluetooth', 'cannot connect, not detected, weak signal'],
  ['hinge', 'Hinge', 'loose, broken, hard to open, cover gap'],
  ['screw', 'Screw', 'missing screw, wrong screw, loose screw'],
  ['body_casing', 'Body / Casing', 'dent, scratch, crack, gap, broken cover'],
  ['liquid_damage', 'Liquid Damage', 'stain, corrosion, water mark'],
] as const;

export function createDefaultChecklistItems(): DeviceChecklistItem[] {
  return deviceChecklistItemDefinitions.map(([key, label, notePlaceholder]) => ({
    key,
    label,
    notePlaceholder,
    beforeStatus: 'not_tested',
    afterStatus: 'not_tested',
    note: '',
  }));
}

export function createDefaultAccessories(): DeviceChecklistAccessory[] {
  return [
    { key: 'charger', label: 'Charger', beforeStatus: 'na', afterStatus: 'na', note: '' },
    { key: 'bag_accessories', label: 'Bag / Accessories', beforeStatus: 'na', afterStatus: 'na', note: '' },
  ];
}

export function createDefaultInternalComponents(): DeviceChecklistInternalComponents {
  return {
    ram: { status: 'not_checked', quantity: '', capacity: '', note: '' },
    storage: { status: 'not_checked', type: '', capacity: '', note: '' },
    wifiCard: { status: 'not_checked', note: '' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function cleanString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function normalizeInspectionStatus(value: unknown): InspectionStatus {
  return ['good', 'issue', 'not_tested', 'na'].includes(String(value)) ? value as InspectionStatus : 'not_tested';
}

function normalizeAccessoryBeforeStatus(value: unknown): AccessoryBeforeStatus {
  return ['received', 'not_received', 'na'].includes(String(value)) ? value as AccessoryBeforeStatus : 'na';
}

function normalizeAccessoryAfterStatus(value: unknown): AccessoryAfterStatus {
  return ['returned', 'not_returned', 'na'].includes(String(value)) ? value as AccessoryAfterStatus : 'na';
}

function normalizeInternalStatus(value: unknown): InternalComponentStatus {
  return ['present', 'missing', 'not_checked', 'na'].includes(String(value)) ? value as InternalComponentStatus : 'not_checked';
}

function normalizeAfterRepairTestStatus(value: unknown): AfterRepairTestStatus {
  return ['passed', 'issue', 'na'].includes(String(value)) ? value as AfterRepairTestStatus : 'passed';
}

export function normalizeChecklistItems(value: unknown): DeviceChecklistItem[] {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  return createDefaultChecklistItems().map((defaultItem) => {
    const row = rows.find((item) => item.key === defaultItem.key);
    if (!row) return defaultItem;
    return {
      ...defaultItem,
      beforeStatus: normalizeInspectionStatus(row.beforeStatus),
      afterStatus: normalizeInspectionStatus(row.afterStatus),
      note: cleanString(row.note),
    };
  });
}

export function normalizeAccessories(value: unknown, legacyAccessories = ''): DeviceChecklistAccessory[] {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  return createDefaultAccessories().map((defaultItem) => {
    const row = rows.find((item) => item.key === defaultItem.key);
    if (!row) {
      return defaultItem.key === 'bag_accessories' && legacyAccessories
        ? { ...defaultItem, note: legacyAccessories }
        : defaultItem;
    }
    return {
      ...defaultItem,
      beforeStatus: normalizeAccessoryBeforeStatus(row.beforeStatus),
      afterStatus: normalizeAccessoryAfterStatus(row.afterStatus),
      note: cleanString(row.note),
    };
  });
}

export function normalizeInternalComponents(value: unknown, legacyInternal = ''): DeviceChecklistInternalComponents {
  const source = isRecord(value) ? value : {};
  const defaults = createDefaultInternalComponents();
  const normalizeComponent = (key: keyof DeviceChecklistInternalComponents, fallbackNote = ''): InternalComponentRecord => {
    const row = isRecord(source[key]) ? source[key] : {};
    return {
      ...defaults[key],
      status: normalizeInternalStatus(row.status),
      quantity: cleanString(row.quantity),
      type: cleanString(row.type),
      capacity: cleanString(row.capacity),
      note: cleanString(row.note) || fallbackNote,
    };
  };
  return {
    ram: normalizeComponent('ram', legacyInternal),
    storage: normalizeComponent('storage'),
    wifiCard: normalizeComponent('wifiCard'),
  };
}

export function normalizeAfterRepairTestedItems(value: unknown): AfterRepairTestedItem[] {
  const rows = Array.isArray(value) ? value.filter(isRecord) : [];
  return createDefaultAfterRepairTestedItems().map((defaultItem) => {
    const row = rows.find((item) => item.key === defaultItem.key);
    if (!row) return defaultItem;
    return {
      ...defaultItem,
      status: normalizeAfterRepairTestStatus(row.status),
    };
  });
}
