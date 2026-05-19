import { DEFAULT_COMMISSION_RATE } from './constants';

export interface TechnicianCommissionInput {
  amountCollected: number;
  partsCost?: number;
  outsourceCost?: number;
  otherDirectCost?: number;
  commissionRate?: number;
}

export interface TechnicianCommissionResult {
  basis: 'net_profit';
  rate: number;
  amountCollected: number;
  partsCost: number;
  outsourceCost: number;
  otherDirectCost: number;
  totalDirectCost: number;
  netProfit: number;
  commissionAmount: number;
  commissionEligible: boolean;
  reason: string;
}

function money(value: number): number {
  return Number((Number.isFinite(value) ? value : 0).toFixed(2));
}

function positiveNumber(value: number | undefined): number {
  return Math.max(0, money(Number(value || 0)));
}

export function calculateTechnicianCommission(input: TechnicianCommissionInput): TechnicianCommissionResult {
  const amountCollected = positiveNumber(input.amountCollected);
  const partsCost = positiveNumber(input.partsCost);
  const outsourceCost = positiveNumber(input.outsourceCost);
  const otherDirectCost = positiveNumber(input.otherDirectCost);
  const rate = Number.isFinite(Number(input.commissionRate)) ? Number(input.commissionRate) : DEFAULT_COMMISSION_RATE;
  const totalDirectCost = money(partsCost + outsourceCost + otherDirectCost);
  const netProfit = money(amountCollected - totalDirectCost);
  const commissionEligible = netProfit > 0;
  const commissionAmount = commissionEligible ? money(netProfit * rate) : 0;

  return {
    basis: 'net_profit',
    rate,
    amountCollected,
    partsCost,
    outsourceCost,
    otherDirectCost,
    totalDirectCost,
    netProfit,
    commissionAmount,
    commissionEligible,
    reason: commissionEligible ? 'Positive net profit' : 'No positive net profit',
  };
}
