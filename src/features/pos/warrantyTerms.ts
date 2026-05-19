export interface WarrantyTermsSnapshot {
  coverage: string[];
  exclusions: string[];
  claimProcess: string[];
  claimLimit: string;
  voidConditions: string[];
  acknowledgement: string;
  version: string;
}

export const defaultWarrantyTermsSnapshot: WarrantyTermsSnapshot = {
  version: '2026-05-17',
  coverage: [
    'Warranty applies only to the specific repaired/replaced part or service stated in this warranty certificate.',
    'Warranty is valid only within the selected warranty period.',
  ],
  exclusions: [
    'Warranty does not cover unrelated faults or new faults.',
    'Warranty does not cover software issues, data loss, accessories, consumables, or customer-installed parts unless stated in writing.',
    'Warranty does not cover physical damage, liquid damage, burn marks, misuse, power surge, or accidental damage.',
    'Warranty does not cover third-party repair attempts or tampering.',
  ],
  claimProcess: [
    'Customer must contact Genius Advanced and provide the job/invoice/warranty reference.',
    'Customer must bring or send the device for inspection.',
    'Warranty approval is subject to technician verification.',
    'Replacement/repair decision is under Genius Advanced inspection result.',
  ],
  claimLimit: 'Unlimited claims within the valid warranty period, subject to inspection and verification.',
  voidConditions: [
    'Warranty is void if the device is opened, repaired, modified, or tampered with by another party.',
    'Warranty is void if warranty sticker, serial label, or identification mark is removed or altered.',
    'Warranty is void if new physical/liquid damage is found.',
    'Warranty is void if the device is misused or used outside normal operating conditions.',
  ],
  acknowledgement: 'Customer confirms they have read and understood the warranty terms and agrees that warranty approval is subject to inspection.',
};
