import React, { useState, useMemo } from 'react';
import {
  Search,
  Plus,
  Building,
  Mail,
  User,
  Globe,
  ShieldCheck,
  Edit,
  X,
  AlertCircle,
  CheckCircle2,
  Lock,
} from 'lucide-react';
import { BuyerEntity } from '../../db/types';

interface BuyerManagementViewProps {
  buyers: BuyerEntity[];
  onCreateBuyer: (buyer: Omit<BuyerEntity, 'id' | 'createdAt' | 'updatedAt' | 'isSimulated'>) => Promise<any>;
  onUpdateBuyer: (id: string, updates: Partial<BuyerEntity>) => Promise<any>;
}

export const BuyerManagementView: React.FC<BuyerManagementViewProps> = ({
  buyers,
  onCreateBuyer,
  onUpdateBuyer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [buyerToEdit, setBuyerToEdit] = useState<BuyerEntity | null>(null);

  // Form Fields
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [country, setCountry] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('LC 60 Days');
  const [complianceRating, setComplianceRating] = useState('Grade A Gold Standard');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');

  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filtered Buyers
  const filteredBuyers = useMemo(() => {
    return buyers.filter((b) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        b.name.toLowerCase().includes(q) ||
        b.code.toLowerCase().includes(q) ||
        b.country.toLowerCase().includes(q) ||
        (b.contactPerson && b.contactPerson.toLowerCase().includes(q)) ||
        b.contactEmail.toLowerCase().includes(q);

      const matchesStatus =
        statusFilter === 'ALL' || (b.status || 'ACTIVE') === statusFilter;

      return matchesSearch && matchesStatus;
    });
  }, [buyers, searchQuery, statusFilter]);

  const handleOpenCreate = () => {
    setBuyerToEdit(null);
    setName('');
    setCode('');
    setCountry('');
    setContactPerson('');
    setContactEmail('');
    setPaymentTerms('LC 60 Days');
    setComplianceRating('Grade A Gold Standard');
    setStatus('ACTIVE');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleOpenEdit = (buyer: BuyerEntity) => {
    setBuyerToEdit(buyer);
    setName(buyer.name);
    setCode(buyer.code);
    setCountry(buyer.country);
    setContactPerson(buyer.contactPerson || '');
    setContactEmail(buyer.contactEmail);
    setPaymentTerms(buyer.paymentTerms);
    setComplianceRating(buyer.complianceRating);
    setStatus(buyer.status || 'ACTIVE');
    setFormError(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!name.trim()) {
      setFormError('Buyer Company Name is required.');
      return;
    }
    if (!code.trim()) {
      setFormError('Buyer Unique Code is required (e.g. ZARA, NIKE).');
      return;
    }
    if (!country.trim()) {
      setFormError('Country is required.');
      return;
    }
    if (!contactEmail.trim()) {
      setFormError('Contact Email is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      if (buyerToEdit) {
        await onUpdateBuyer(buyerToEdit.id, {
          name: name.trim(),
          code: code.trim().toUpperCase(),
          country: country.trim(),
          contactPerson: contactPerson.trim(),
          contactEmail: contactEmail.trim(),
          paymentTerms,
          complianceRating,
          status,
        });
      } else {
        await onCreateBuyer({
          name: name.trim(),
          code: code.trim().toUpperCase(),
          country: country.trim(),
          contactPerson: contactPerson.trim() || 'Procurement In-Charge',
          contactEmail: contactEmail.trim(),
          paymentTerms,
          complianceRating,
          status,
        });
      }
      setIsModalOpen(false);
    } catch (err: any) {
      setFormError(err?.message || 'Failed to save buyer record.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-zinc-900/90 border border-zinc-800 rounded-lg">
        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search buyers by name, code, country, contact..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-md pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-hidden focus:border-amber-500 transition-colors font-mono"
          />
        </div>

        {/* Status Filter & Add Button */}
        <div className="flex items-center gap-2">
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-md p-0.5 text-xs font-mono">
            {(['ALL', 'ACTIVE', 'INACTIVE'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  statusFilter === st
                    ? 'bg-zinc-800 text-amber-400 font-bold'
                    : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-md text-xs font-bold font-mono flex items-center gap-1.5 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4 stroke-[2.5]" />
            New Buyer
          </button>
        </div>
      </div>

      {/* Buyer Table */}
      <div className="rounded-lg bg-zinc-900/90 border border-zinc-800 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="bg-zinc-950/70 border-b border-zinc-800 text-zinc-400 font-mono text-[11px]">
                <th className="py-3 px-4 font-medium">Buyer Code</th>
                <th className="py-3 px-4 font-medium">Customer / Brand Name</th>
                <th className="py-3 px-3 font-medium">Country</th>
                <th className="py-3 px-4 font-medium">Contact Person & Email</th>
                <th className="py-3 px-3 font-medium">Payment Terms</th>
                <th className="py-3 px-3 font-medium">Audit Compliance</th>
                <th className="py-3 px-3 font-medium text-center">Status</th>
                <th className="py-3 px-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60 font-mono">
              {filteredBuyers.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-zinc-500 font-mono">
                    No buyers matching the current search filters.
                  </td>
                </tr>
              ) : (
                filteredBuyers.map((buyer) => (
                  <tr key={buyer.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-bold text-amber-400 tracking-tight">
                        {buyer.code}
                      </div>
                      <div className="text-[10px] text-zinc-500">{buyer.id}</div>
                    </td>

                    <td className="py-3 px-4 font-sans font-semibold text-zinc-100">
                      {buyer.name}
                    </td>

                    <td className="py-3 px-3 font-sans text-zinc-300">
                      <div className="flex items-center gap-1.5">
                        <Globe className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{buyer.country}</span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-sans text-zinc-200">
                        {buyer.contactPerson || 'Procurement Team'}
                      </div>
                      <div className="text-[10px] text-zinc-400 flex items-center gap-1">
                        <Mail className="w-3 h-3 text-zinc-500" />
                        <span>{buyer.contactEmail}</span>
                      </div>
                    </td>

                    <td className="py-3 px-3 text-zinc-300">
                      {buyer.paymentTerms}
                    </td>

                    <td className="py-3 px-3">
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                        <ShieldCheck className="w-3.5 h-3.5" />
                        <span>{buyer.complianceRating}</span>
                      </span>
                    </td>

                    <td className="py-3 px-3 text-center">
                      {(buyer.status || 'ACTIVE') === 'ACTIVE' ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-950/80 text-emerald-300 border border-emerald-800/80">
                          ACTIVE
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-zinc-800 text-zinc-400 border border-zinc-700">
                          INACTIVE
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(buyer)}
                        className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded text-[11px] font-mono flex items-center gap-1 ml-auto transition-colors border border-zinc-700"
                      >
                        <Edit className="w-3 h-3 text-amber-400" />
                        Edit
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Buyer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900 border border-zinc-700 rounded-lg max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <div className="text-[11px] font-mono text-amber-400 uppercase tracking-wider font-semibold">
                  Buyer Master Maintenance
                </div>
                <div className="text-base font-bold text-zinc-100">
                  {buyerToEdit ? `Edit Buyer: ${buyerToEdit.name}` : 'Register New Buyer'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {formError && (
              <div className="p-2.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Buyer Unique Code *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. NIKE, ZARA, GAP"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Country *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Spain, USA, Japan"
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Customer / Corporate Name *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Nike Global Sourcing B.V."
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Contact Person
                </label>
                <input
                  type="text"
                  placeholder="e.g. Sarah Connor"
                  value={contactPerson}
                  onChange={(e) => setContactPerson(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Contact Email *
                </label>
                <input
                  type="email"
                  required
                  placeholder="e.g. sourcing@buyer.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                />
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Payment Terms
                </label>
                <select
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                >
                  <option value="LC 30 Days">LC 30 Days</option>
                  <option value="LC 60 Days">LC 60 Days</option>
                  <option value="LC 90 Days">LC 90 Days</option>
                  <option value="TT 30 Days">TT 30 Days</option>
                  <option value="TT 45 Days">TT 45 Days</option>
                  <option value="CAD at Sight">CAD at Sight</option>
                </select>
              </div>

              <div>
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Account Status
                </label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value as 'ACTIVE' | 'INACTIVE')}
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-mono"
                >
                  <option value="ACTIVE">ACTIVE (Receiving Orders)</option>
                  <option value="INACTIVE">INACTIVE (Frozen)</option>
                </select>
              </div>

              <div className="col-span-2">
                <label className="block font-mono text-zinc-400 text-[11px] mb-1">
                  Compliance Audit Rating
                </label>
                <input
                  type="text"
                  value={complianceRating}
                  onChange={(e) => setComplianceRating(e.target.value)}
                  placeholder="e.g. Grade A Gold Standard, WRAP Certified"
                  className="w-full bg-zinc-950 border border-zinc-800 focus:border-amber-500 rounded px-2.5 py-1.5 text-zinc-200 font-sans"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded text-xs font-mono transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded text-xs font-bold font-mono transition-colors"
              >
                {isSubmitting ? 'Saving...' : buyerToEdit ? 'Save Changes' : 'Create Buyer'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
