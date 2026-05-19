'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { DEFAULT_COMMISSION_PERCENTAGE, DEFAULT_COMMISSION_RULE_NAME } from '@/features/commissions/constants';
import { createCommissionRule, ensureStandardCommissionRule, getCommissionRules, getPriceItems, updateCommissionRule } from '@/features/pos/posService';
import type { CommissionRule, PriceItem, PriceItemType } from '@/features/pos/types';
import { useUser } from '@/lib/hooks/useUser';
import { can } from '@/lib/rbac/can';

const initialForm = {
  name: DEFAULT_COMMISSION_RULE_NAME,
  category: '',
  itemType: '' as PriceItemType | '',
  priceItemId: '',
  calculationType: 'percentage' as 'fixed' | 'percentage',
  value: String(DEFAULT_COMMISSION_PERCENTAGE),
  branchId: '',
  active: true,
};

export default function PosCommissionRulesPage() {
  const { profile, loading } = useUser();
  const [rules, setRules] = useState<CommissionRule[]>([]);
  const [priceItems, setPriceItems] = useState<PriceItem[]>([]);
  const [form, setForm] = useState(initialForm);
  const [editingRule, setEditingRule] = useState<CommissionRule | null>(null);
  const [message, setMessage] = useState('');
  const canManage = can(profile?.role, 'pos.manage');

  async function loadRules() {
    if (!profile || !canManage) return;
    try {
      await ensureStandardCommissionRule(profile);
      const [ruleRows, itemRows] = await Promise.all([getCommissionRules(profile), getPriceItems(profile)]);
      setRules(ruleRows);
      setPriceItems(itemRows);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to load commission rules');
    }
  }

  useEffect(() => { void loadRules(); }, [profile?.uid, profile?.role, canManage]);

  function editRule(rule: CommissionRule) {
    setEditingRule(rule);
    setForm({
      name: rule.name,
      category: rule.category || '',
      itemType: rule.itemType || '',
      priceItemId: rule.priceItemId || '',
      calculationType: rule.calculationType,
      value: String(rule.value || 0),
      branchId: rule.branchId || '',
      active: rule.active,
    });
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profile) return;
    try {
      const payload = { ...form, value: Number(form.value || 0) };
      if (editingRule) await updateCommissionRule(editingRule, payload, profile);
      else await createCommissionRule(payload, profile);
      setForm(initialForm);
      setEditingRule(null);
      setMessage(editingRule ? 'Commission rule updated' : 'Commission rule created');
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to save commission rule');
    }
  }

  async function toggleRule(rule: CommissionRule) {
    if (!profile) return;
    try {
      await updateCommissionRule(rule, {
        name: rule.name,
        category: rule.category || '',
        itemType: rule.itemType || '',
        priceItemId: rule.priceItemId || '',
        calculationType: rule.calculationType,
        value: rule.value,
        branchId: rule.branchId || '',
        active: !rule.active,
      }, profile);
      setMessage(!rule.active ? 'Commission rule activated' : 'Commission rule deactivated');
      await loadRules();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to update rule status');
    }
  }

  if (loading) return <div className="text-sm text-zinc-400">Loading commission rules</div>;
  if (!canManage) return <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-6 text-sm text-zinc-400">Access denied</div>;

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-white/10 bg-[#151515]/90 p-5">
        <h1 className="text-2xl font-semibold text-white">POS Commission Rules</h1>
        <p className="mt-2 text-sm text-zinc-400">Default technician commission is 2% of Net Profit. Priority: 1. priceItemId rule 2. category rule 3. itemType rule 4. Standard Technician Net Profit Commission.</p>
      </div>
      {message ? <div className="rounded-2xl border border-white/10 bg-[#151515]/90 p-3 text-sm text-zinc-300">{message}</div> : null}
      <div className="rounded-3xl border border-orange-500/20 bg-[#1F160E]/80 p-4 text-sm text-orange-100">
        Active system default: {DEFAULT_COMMISSION_RULE_NAME} is {DEFAULT_COMMISSION_PERCENTAGE}% of Net Profit when no more specific active rule matches.
      </div>
      <form onSubmit={handleSubmit} className="rounded-3xl border border-white/10 bg-[#111111]/90 p-5">
        <h2 className="text-lg font-semibold text-white">{editingRule ? 'Edit Commission Rule' : 'Create Commission Rule'}</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <input required value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} placeholder="Standard Technician Net Profit Commission" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={form.priceItemId} onChange={(event) => setForm((current) => ({ ...current, priceItemId: event.target.value }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="">Any price item</option>
            {priceItems.map((item) => <option key={item.priceItemId} value={item.priceItemId}>{item.name}</option>)}
          </select>
          <input value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))} placeholder="Category" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={form.itemType} onChange={(event) => setForm((current) => ({ ...current, itemType: event.target.value as PriceItemType | '' }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="">Any item type</option>
            <option value="service">service</option>
            <option value="part">part</option>
            <option value="package">package</option>
            <option value="diagnostic">diagnostic</option>
            <option value="labor">labor</option>
          </select>
          <select value={form.calculationType} onChange={(event) => setForm((current) => ({ ...current, calculationType: event.target.value as 'fixed' | 'percentage' }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
            <option value="percentage">percentage</option>
            <option value="fixed">fixed</option>
          </select>
          <input required type="number" min="0.01" step="0.01" value={form.value} onChange={(event) => setForm((current) => ({ ...current, value: event.target.value }))} placeholder="2" className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white" />
          <select value={form.branchId} onChange={(event) => setForm((current) => ({ ...current, branchId: event.target.value }))} className="rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white">
	            <option value="">All branches</option>
	            <option value="bangi">bangi</option>
	            <option value="cyberjaya">cyberjaya</option>
	          </select>
          <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#050505] px-3 py-2 text-sm text-white"><input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} /> Active</label>
          <button className="rounded-xl bg-gradient-to-r from-[#C96A2B] to-[#F97316] px-4 py-2 text-sm font-semibold text-white md:col-span-4">{editingRule ? 'Save rule' : 'Create rule'}</button>
        </div>
      </form>
      <div className="overflow-x-auto rounded-3xl border border-white/10 bg-[#111111]/90">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-white/10 text-xs uppercase text-zinc-500"><tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Target</th><th className="px-4 py-3">Calculation</th><th className="px-4 py-3">Branch</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Action</th></tr></thead>
          <tbody>{rules.map((rule) => <tr key={rule.ruleId} className="border-b border-white/10 last:border-b-0"><td className="px-4 py-3 text-white">{rule.name}</td><td className="px-4 py-3 text-zinc-300">{rule.priceItemId || rule.category || rule.itemType || (rule.name === DEFAULT_COMMISSION_RULE_NAME ? 'default' : '-')}</td><td className="px-4 py-3 text-zinc-300">{rule.calculationType} · {rule.calculationType === 'percentage' ? `${rule.value}% of Net Profit` : `${rule.value} if net profit is positive`}</td><td className="px-4 py-3 text-zinc-300">{rule.branchId || 'all'}</td><td className="px-4 py-3 text-zinc-300">{rule.active ? 'active' : 'inactive'}</td><td className="px-4 py-3"><div className="flex gap-2"><button type="button" onClick={() => editRule(rule)} className="text-orange-200">Edit</button><button type="button" onClick={() => toggleRule(rule)} className="text-orange-200">{rule.active ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody>
        </table>
      </div>
    </section>
  );
}
