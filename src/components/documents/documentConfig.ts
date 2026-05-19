import type { PosBranch } from '@/features/pos/types';

export interface GeniusBranchDetails {
  branchId: Extract<PosBranch, 'bangi' | 'cyberjaya'>;
  branchName: string;
  companyName: string;
  address: string;
  whatsapp: string;
  email: string;
  website: string;
  bank: string;
  accountName: string;
  accountNumber: string;
}

export const geniusBranchDetails: Record<Extract<PosBranch, 'bangi' | 'cyberjaya'>, GeniusBranchDetails> = {
  bangi: {
    branchId: 'bangi',
    branchName: 'Genius Advanced Bangi',
    companyName: 'Genius Advanced Technology',
    address: '11-1-1B, Jalan Medan PB2A,\nSeksyen 9, Bandar Baru Bangi,\n43650 Bangi, Selangor.',
    whatsapp: '01114888499',
    email: 'hq.geniusadvanced@gmail.com',
    website: 'www.geniusadvanced.com',
    bank: 'Maybank',
    accountName: 'Genius Advanced Technology',
    accountNumber: '512268900987',
  },
  cyberjaya: {
    branchId: 'cyberjaya',
    branchName: 'Genius Advanced Cyberjaya',
    companyName: 'Titans Prestige Services',
    address: 'GF-04 Menara Paragon Pangaea,\nPersiaran Bestari, Cyber 11,\n63000 Cyberjaya, Selangor.',
    whatsapp: '0199933371',
    email: 'geniuscyberjaya@gmail.com',
    website: 'www.geniusadvanced.com',
    bank: 'Maybank',
    accountName: 'Titans Prestige Services',
    accountNumber: '554026285011',
  },
};

export function getGeniusBranchDetails(branch?: string): GeniusBranchDetails {
  const normalized = String(branch || '').toLowerCase().replace(/[^a-z]/g, '');
  if (normalized.includes('cyberjaya')) return geniusBranchDetails.cyberjaya;
  if (!normalized || !normalized.includes('bangi')) {
    // Missing or unknown branch falls back to Bangi for customer-facing documents.
    if (typeof console !== 'undefined') console.warn('Invoice branch missing or unknown; falling back to Bangi document details.');
  }
  return geniusBranchDetails.bangi;
}

export const officialRepairTerms = [
  {
    title: 'GENIUS ADVANCED TERMS & CONDITIONS',
    body: '',
  },
  {
    title: '1. Consent to Inspection, Diagnosis and Repair',
    body: 'By signing this Job Sheet or providing consent in any form, including through an authorised representative or electronic communication, the Customer grants Genius Advanced full authorisation to inspect, diagnose and repair the device.\n\nSuch consent shall be treated as valid, binding and enforceable, whether or not a physical signature is provided. Any action taken by Genius Advanced based on such consent shall be deemed fully authorised by the Customer.\n\nGenius Advanced reserves the right to amend these Terms & Conditions at any time without prior notice. The applicable Terms & Conditions shall be the version in effect at the time the device is submitted for service.',
  },
  {
    title: '2. Approval via Electronic Communication',
    body: 'Any approval to proceed with repair provided via WhatsApp, SMS, phone call, email or any other communication method shall be deemed as official authorisation for Genius Advanced to proceed with the repair.',
  },
  {
    title: '3. Pre-existing Faults, Hidden Defects and Prior Repairs',
    body: 'Genius Advanced shall not be liable for any loss, damage, malfunction or additional issues arising from pre-existing faults, hidden defects, prior repairs, liquid damage, wear and tear, physical damage, motherboard failure or the overall condition of the device.',
  },
  {
    title: '4. Data Responsibility',
    body: 'Genius Advanced shall not be responsible for any loss, corruption or damage to data stored in the device. Customers are strongly advised to back up all important data before submitting the device for inspection, diagnosis or repair.',
  },
  {
    title: '5. Payment and Collection',
    body: 'Full payment of all approved repair charges must be made upon collection of the device, unless otherwise agreed in writing by Genius Advanced.\n\nThe Customer must collect the device within seven (7) days from the date of notification by Genius Advanced via call, WhatsApp, SMS or any other communication method.',
  },
  {
    title: '6. Abandoned Devices',
    body: 'Any device that remains uncollected for more than sixty (60) days after notification has been sent by Genius Advanced shall be deemed abandoned.\n\nThis applies whether the device has been repaired, remains unrepaired, or the repair quotation was not approved by the Customer.',
  },
  {
    title: '7. Disposition of Abandoned Devices',
    body: 'Genius Advanced reserves the right to dispose of, recycle, sell, dismantle or otherwise handle any abandoned device without further notice.\n\nGenius Advanced shall not be liable for any claim, loss, damage, compensation or dispute arising after the device has been deemed abandoned.',
  },
  {
    title: '8. Warranty Limitation',
    body: 'Any warranty provided by Genius Advanced shall apply only to the specific part or service stated in the invoice, receipt or warranty document.\n\nWarranty does not cover unrelated faults, new issues, physical damage, liquid damage, software issues, data loss, misuse, third-party repair attempts or damage caused after the device has been collected.',
  },
  {
    title: '9. Customer Acknowledgement',
    body: 'The Customer confirms that they have read, understood and agreed to the Terms & Conditions stated above before submitting the device to Genius Advanced.',
  },
];
