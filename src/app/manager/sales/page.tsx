'use client';

import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Share2, Printer, Check, Download } from 'lucide-react';
import { create } from 'zustand';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { exportToExcel } from '@/lib/export/excel';
import { exportToPDF } from '@/lib/export/pdf';
import html2canvas from 'html2canvas';
import { toast } from 'sonner';

interface SaleItem {
  productCategory: string;
  brand: string;
  wireType: string;
  qty: string;
  pricePerKg: string;
  saudaContractId?: string;
}

interface CartStore {
  items: SaleItem[];
  addItem: () => void;
  removeItem: (index: number) => void;
  updateItem: (index: number, field: keyof SaleItem, value: string) => void;
  setItems: (items: SaleItem[]) => void;
  reset: () => void;
}

const useCartStore = create<CartStore>((set) => ({
  items: [{ productCategory: 'CC Wires', brand: 'Poly Vansh', wireType: '1mm', qty: '', pricePerKg: '', saudaContractId: '' }],
  addItem: () => set((state) => ({ items: [...state.items, { productCategory: 'CC Wires', brand: 'Poly Vansh', wireType: '1mm', qty: '', pricePerKg: '', saudaContractId: '' }] })),
  removeItem: (index) => set((state) => ({ items: state.items.filter((_, i) => i !== index) })),
  updateItem: (index, field, value) => set((state) => {
    const newItems = [...state.items];
    newItems[index] = { ...newItems[index], [field]: value };
    if (field === 'productCategory' && value === 'Raw Copper Bundle') {
       newItems[index].brand = '';
       newItems[index].wireType = '';
    } else if (field === 'productCategory') {
       const brands = getBrands(value);
       newItems[index].brand = brands.length > 0 ? brands[0] : '';
       newItems[index].wireType = '1mm';
    }
    return { items: newItems };
  }),
  setItems: (items) => set({ items }),
  reset: () => set({ items: [{ productCategory: 'CC Wires', brand: 'Poly Vansh', wireType: '1mm', qty: '', pricePerKg: '', saudaContractId: '' }] })
}));

function getBrands(category: string) {
  if (category === 'CC Wires') return ['Poly Vansh', 'Poly Unnati', 'Poly Unique Plus', 'Poly Unique Plus Premium'];
  if (category === 'Submersible Winding Wire') return ['Poly Lifeline', 'Poly Life Plus'];
  return [];
}

function calculateItemTotal(item: any) {
  const q = parseFloat(item.qty) || 0;
  const p = parseFloat(item.pricePerKg) || 0;
  return (q * 1000) * p;
}

function formatDateIST(dateStr: string) {
  return new Date(dateStr).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
}

export default function RecordSale() {
  const queryClient = useQueryClient();
  const [customerId, setCustomerId] = useState('');
  const [date, setDate] = useState('');
  const [showPinModal, setShowPinModal] = useState(false);
  const [pinReason, setPinReason] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [overridePin, setOverridePin] = useState('');
  const [pinError, setPinError] = useState('');
  const [createdSaleForSlip, setCreatedSaleForSlip] = useState<any>(null);
  const [sharing, setSharing] = useState(false);
  const [pendingSaudaChange, setPendingSaudaChange] = useState<{ index: number; sauId: string; price: string } | null>(null);
  const [excessSaudaSplit, setExcessSaudaSplit] = useState<{
    itemIndex: number;
    item: SaleItem;
    sauda: any;
    saudaQty: number;
    excessQty: number;
  } | null>(null);

  const { items, addItem, removeItem, updateItem, setItems, reset } = useCartStore();

  const { data: customersData } = useQuery({ queryKey: ['customers'], queryFn: () => fetch('/api/customers').then(res => res.json()) });
  const customers = customersData?.customers || [];
  const selectedCustomer = customers.find((c: any) => c.id === customerId);

  const { data: saudaData } = useQuery({
    queryKey: ['saudaContracts', customerId],
    queryFn: () => customerId ? fetch(`/api/manager/sauda?customerId=${customerId}&status=ACTIVE`).then(res => res.json()) : { contracts: [] },
    enabled: !!customerId
  });
  const customerSaudaContracts = saudaData?.contracts || [];

  const { data: salesData } = useQuery({ queryKey: ['recentSales'], queryFn: () => fetch('/api/manager/sales').then(res => res.json()) });
  const recentSales = salesData?.sales || [];

  const { data: costData } = useQuery({ queryKey: ['copperCost'], queryFn: () => fetch('/api/copper-cost').then(res => res.json()) });
  const currentCost = costData?.costPerTon || 0;

  const { data: finishedData } = useQuery({ queryKey: ['finishedInventory'], queryFn: () => fetch('/api/shared/inventory/finished').then(res => res.json()) });
  const finishedTree = finishedData?.tree || [];

  const getItemStock = (item: any) => {
    if (item.productCategory === 'Raw Copper Bundle') {
      return costData?.remainingStockTons || 0;
    }
    const catNode = finishedTree.find((c: any) => c.name === item.productCategory);
    if (!catNode) return 0;
    const brandNode = catNode.brands.find((b: any) => b.name === (item.brand || 'Unbranded'));
    if (!brandNode) return 0;
    const sizeNode = brandNode.sizes.find((s: any) => s.size === (item.wireType || 'N/A'));
    return sizeNode ? sizeNode.available : 0;
  };

  useEffect(() => {
    if (customers.length > 0 && !customerId) {
       setCustomerId(customers[0].id);
     }
  }, [customers, customerId]);

  // Auto-apply earliest active Sauda contract (FIFO) when customer Sauda bookings are loaded
  useEffect(() => {
    if (customerSaudaContracts && customerSaudaContracts.length > 0) {
      const sorted = [...customerSaudaContracts].sort((a, b) => new Date(a.startDate || a.createdAt).getTime() - new Date(b.startDate || b.createdAt).getTime());
      const earliest = sorted[0];
      items.forEach((item, idx) => {
        if (!item.saudaContractId) {
          updateItem(idx, 'saudaContractId', earliest.id);
          updateItem(idx, 'pricePerKg', String(earliest.ratePerKg));
        }
      });
    } else {
      // Customer has NO active Sauda contracts: clear saudaContractId on all items
      items.forEach((item, idx) => {
        if (item.saudaContractId) {
          updateItem(idx, 'saudaContractId', '');
        }
      });
    }
  }, [customerSaudaContracts, customerId]);

  // Instant Owner PIN check when manager modifies Sauda contract or switches to Spot Price
  const handleSaudaDropdownChange = (index: number, newSauId: string) => {
    const currentItemId = items[index]?.saudaContractId || '';
    if (customerSaudaContracts.length > 0 && newSauId !== currentItemId) {
      let newPrice = String(currentCost / 1000);
      if (newSauId) {
        const sau = customerSaudaContracts.find((s: any) => s.id === newSauId);
        if (sau) newPrice = String(sau.ratePerKg);
      }
      setPendingSaudaChange({ index, sauId: newSauId, price: newPrice });
      setPinReason(newSauId 
        ? `Switching to a different Sauda contract (${customerSaudaContracts.find((s: any) => s.id === newSauId)?.contractNo}) requires Owner PIN authorization.`
        : 'Customer has active Sauda booking contract(s). Bypassing Sauda to sell at Spot Market Price requires Owner PIN authorization.'
      );
      setShowPinModal(true);
    } else {
      handleItemChange(index, 'saudaContractId', newSauId);
    }
  };

  const handleItemChange = (index: number, field: string, value: string) => updateItem(index, field as keyof SaleItem, value);

  let grandTotal = 0;
  items.forEach(item => {
    grandTotal += calculateItemTotal(item);
  });

  const submitMutation = useMutation({
    mutationFn: async (pinToUse?: string) => {
      const res = await fetch('/api/manager/sales', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          customerId, 
          date, 
          items,
          overridePin: pinToUse || overridePin || undefined
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || 'Failed to record sale');
      return data;
    },
    onSuccess: (data) => {
      const slipCustomer = customers.find((c: any) => c.id === customerId);
      const prevBal = slipCustomer?.currentBalance || 0;
      setCreatedSaleForSlip({
        invoiceNo: `VE-${Date.now().toString().slice(-6)}`,
        date: date ? new Date(date) : new Date(),
        customer: slipCustomer,
        previousBalance: prevBal,
        items: [...items],
        total: grandTotal,
        closingBalance: prevBal + grandTotal
      });

      reset();
      setDate('');
      setShowPinModal(false);
      setOverridePin('');
      setPinReason('');
      toast.success('Sale Invoice created successfully!');
      queryClient.invalidateQueries({ queryKey: ['recentSales'] });
      queryClient.invalidateQueries({ queryKey: ['copperCost'] });
      queryClient.invalidateQueries({ queryKey: ['finishedInventory'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['saudaContracts'] });
    },
    onError: (err: any) => {
      if (err.message.includes('DISPATCH_LOCKED')) {
        setPinReason(err.message.replace('DISPATCH_LOCKED:', '').trim());
        setShowPinModal(true);
      } else {
        toast.error(err.message);
      }
    }
  });

  const submitSale = async (pin?: string) => { submitMutation.mutate(pin); };

  const undoMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch('/api/manager/sales?id=' + id, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
    },
    onSuccess: () => {
      toast.success('Sale invoice cancelled & inventory restored');
      queryClient.invalidateQueries({ queryKey: ['recentSales'] });
      queryClient.invalidateQueries({ queryKey: ['finishedInventory'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
  });

  const handleUndo = (id: string) => {
    if (!confirm('Are you sure you want to undo this sale? This will soft-delete the ledger entry.')) return;
    undoMutation.mutate(id);
  };

  const handleViewSlip = (sale: any) => {
    const slipItems = sale.items.map((item: any) => ({
      productCategory: item.productCategory,
      brand: item.brand,
      wireType: item.wireType,
      qty: Number(item.qty),
      pricePerKg: Number(item.pricePerTon) / 1000
    }));

    const prevBal = (sale.customer?.currentBalance || 0) - Number(sale.totalValue);
    setCreatedSaleForSlip({
      invoiceNo: `VE-${sale.id.slice(-6).toUpperCase()}`,
      date: new Date(sale.date),
      customer: sale.customer,
      previousBalance: prevBal,
      items: slipItems,
      total: Number(sale.totalValue),
      closingBalance: Number(sale.totalValue) + prevBal
    });
  };

  const handleApplyExcessSplit = () => {
    if (!excessSaudaSplit) return;
    const { itemIndex, item, saudaQty, excessQty, sauda } = excessSaudaSplit;
    const spotRate = String(currentCost / 1000);

    const newItems = [...items];
    // 1. Cap current line item to exact remaining Sauda quota
    newItems[itemIndex] = {
      ...item,
      qty: String(Number(saudaQty).toFixed(2)),
      pricePerKg: String(sauda.ratePerKg),
      saudaContractId: sauda.id
    };

    // 2. Insert new line item right below it for excess quantity at Spot Price
    const excessItem: SaleItem = {
      productCategory: item.productCategory,
      brand: item.brand,
      wireType: item.wireType,
      qty: String(Number(excessQty).toFixed(2)),
      pricePerKg: spotRate,
      saudaContractId: ''
    };

    newItems.splice(itemIndex + 1, 0, excessItem);
    setItems(newItems);
    toast.success(`Split applied: ${Number(saudaQty).toFixed(2)}T fulfilled on Sauda #${sauda.contractNo}, and ${Number(excessQty).toFixed(2)}T created at Spot Market Price.`);
    setExcessSaudaSplit(null);
  };

  const handleCapAtSauda = () => {
    if (!excessSaudaSplit) return;
    const { itemIndex, saudaQty } = excessSaudaSplit;
    updateItem(itemIndex, 'qty', String(Number(saudaQty).toFixed(2)));
    toast.info(`Quantity capped to remaining Sauda quota of ${Number(saudaQty).toFixed(2)} Tons.`);
    setExcessSaudaSplit(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // 1. Strict Stock Check before opening confirmation modal
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const stock = getItemStock(it);
      const reqQty = parseFloat(it.qty || '0');
      if (reqQty <= 0) {
        toast.error(`Item #${i + 1}: Please enter a valid quantity.`);
        return;
      }
      if (reqQty > stock) {
        toast.error(`Item #${i + 1} (${it.brand || ''} ${it.wireType || ''} ${it.productCategory}): Cannot sell ${reqQty.toFixed(2)} Tons. Only ${stock.toFixed(2)} Tons available in stock!`);
        return;
      }
    }

    // 2. Check if any line item with a Sauda contract exceeds the Sauda remaining quota:
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.saudaContractId) {
        const sau = customerSaudaContracts.find((s: any) => s.id === it.saudaContractId);
        if (sau) {
          const remainingQuota = Number(sau.remainingQty);
          const reqQty = parseFloat(it.qty || '0');
          if (reqQty > remainingQuota + 0.001) {
            setExcessSaudaSplit({
              itemIndex: i,
              item: it,
              sauda: sau,
              saudaQty: remainingQuota,
              excessQty: reqQty - remainingQuota
            });
            return;
          }
        }
      }
    }

    setShowConfirmModal(true);
  };

  const handleConfirmAndRecord = async () => {
    setShowConfirmModal(false);

    // 1. Strict Stock Validation: prevent selling more than remaining stock
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const stock = getItemStock(it);
      const reqQty = parseFloat(it.qty || '0');
      if (reqQty <= 0) {
        toast.error(`Item #${i + 1}: Please enter a valid quantity.`);
        return;
      }
      if (reqQty > stock) {
        toast.error(`Item #${i + 1} (${it.brand || ''} ${it.wireType || ''} ${it.productCategory}): Cannot sell ${reqQty.toFixed(2)} Tons. Only ${stock.toFixed(2)} Tons available in stock!`);
        return;
      }
    }

    const currentCostPerKg = currentCost / 1000;
    const isLossMaking = items.some(item => parseFloat(item.pricePerKg) < currentCostPerKg);
    const isOverdue = selectedCustomer?.isOverdue;
    const isLimitExceeded = selectedCustomer && selectedCustomer.currentBalance > selectedCustomer.creditLimit;
    const hasActiveSauda = customerSaudaContracts.length > 0;
    const isBypassingSauda = hasActiveSauda && items.some(i => !i.saudaContractId);

    if (isLossMaking || isOverdue || isLimitExceeded || isBypassingSauda) {
       let reason = '';
       if (isBypassingSauda) reason += 'Customer has active Sauda booking contract(s). Selling at Spot Price or bypassing Sauda requires Owner Override PIN. ';
       if (isLossMaking) reason += 'Selling price is below FIFO raw material cost. ';
       if (isLimitExceeded) reason += `Existing credit limit exceeded (Prior Unpaid Balance ₹${(selectedCustomer?.currentBalance || 0).toLocaleString('en-IN')} > Limit ₹${(selectedCustomer?.creditLimit || 0).toLocaleString('en-IN')}). `;
       if (isOverdue) reason += `Customer has unpaid invoices overdue past ${selectedCustomer?.creditDays || 18} days. `;
       
       setPinReason(reason);
       setShowPinModal(true);
    } else {
       await submitSale();
    }
  };

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/manager/sales/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: overridePin }),
      });
      if (res.ok) {
        setPinError('');
        if (pendingSaudaChange) {
          handleItemChange(pendingSaudaChange.index, 'saudaContractId', pendingSaudaChange.sauId);
          handleItemChange(pendingSaudaChange.index, 'pricePerKg', pendingSaudaChange.price);
          setPendingSaudaChange(null);
          setShowPinModal(false);
          setOverridePin('');
          setPinReason('');
          toast.success('Owner PIN verified: Sauda rate override approved.');
        } else {
          submitSale(overridePin);
        }
      } else {
        setPinError('Invalid Owner PIN. Authorization aborted.');
      }
    } catch {
      setPinError('Failed to verify PIN. Please try again.');
    }
  };

  const handleWhatsAppShareImage = async () => {
    const element = document.getElementById('ledger-slip');
    if (!element || !createdSaleForSlip) return;
    setSharing(true);
    const disabledSheets: HTMLStyleElement[] = [];
    try {
      // Temporarily disable all document stylesheets to bypass Tailwind CSS v4 "lab()" color parsing crashes inside html2canvas
      const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
      styles.forEach((el: any) => {
        if (!el.disabled) {
          el.disabled = true;
          disabledSheets.push(el);
        }
      });

      const canvas = await html2canvas(element, {
        backgroundColor: '#fcfbf4',
        scale: 2,
        logging: false,
        allowTaint: false,
        useCORS: true
      });

      // Restore all stylesheets immediately after canvas render
      disabledSheets.forEach(el => el.disabled = false);

      const rawPhone = createdSaleForSlip.customer?.contact || '';
      // Format number for direct WhatsApp chat: strip spaces, non-digits, and auto-prefix '91' for 10-digit Indian numbers
      let cleanedPhone = rawPhone.replace(/\D/g, '');
      if (cleanedPhone.startsWith('91') && cleanedPhone.length === 12) {
        // already correct
      } else if (cleanedPhone.length === 10) {
        cleanedPhone = '91' + cleanedPhone;
      } else if (cleanedPhone.startsWith('0') && cleanedPhone.length === 11) {
        cleanedPhone = '91' + cleanedPhone.slice(1);
      }
      
      const dateStr = new Date(createdSaleForSlip.date).toLocaleDateString('en-IN');
      const partyName = createdSaleForSlip.customer?.name || 'Cash Sale';
      const transport = createdSaleForSlip.customer?.transport || '';
      
      let itemsListStr = '';
      createdSaleForSlip.items.forEach((item: any) => {
        const itemName = item.productCategory === 'Raw Copper Bundle' 
          ? 'Raw Copper Bundle' 
          : `${item.brand} ${item.wireType}`;
        const qtyVal = Number(item.qty);
        itemsListStr += `- ${itemName} (${qtyVal.toFixed(2)} Tons) @ ₹${item.pricePerKg}/Kg = ₹${calculateItemTotal(item).toLocaleString('en-IN', {maximumFractionDigits:0})}\n`;
      });

      const closingBal = createdSaleForSlip.closingBalance ?? ((createdSaleForSlip.customer?.currentBalance || 0) + createdSaleForSlip.total);

      let waText = `*LEDGER SLIP - MANUFACTURING COMPANY*\n`;
      waText += `----------------------------------------\n`;
      waText += `*Invoice No:* ${createdSaleForSlip.invoiceNo}\n`;
      waText += `*Date:* ${dateStr}\n`;
      waText += `*Party Name:* ${partyName}\n`;
      if (transport) {
        waText += `*Transport:* ${transport}\n`;
      }
      waText += `----------------------------------------\n`;
      waText += `*Items Details:*\n${itemsListStr}`;
      waText += `----------------------------------------\n`;
      waText += `*THIS INVOICE TOTAL: ₹${createdSaleForSlip.total.toLocaleString('en-IN', {maximumFractionDigits:0})}*\n`;
      waText += `*NET OUTSTANDING BALANCE: ₹${closingBal.toLocaleString('en-IN', {maximumFractionDigits:0})}*\n`;
      waText += `----------------------------------------`;

      // Copy image to clipboard automatically so the user can simply paste (Ctrl+V) it in the opened chat
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        try {
          const imgPromise = new Promise<Blob | null>((resolve) => {
            canvas.toBlob((blob) => resolve(blob), 'image/png');
          });
          const item = new ClipboardItem({
            'image/png': imgPromise as Promise<Blob>
          });
          await navigator.clipboard.write([item]);
          console.log('Invoice copied to clipboard successfully.');
        } catch (clipErr: any) {
          console.warn('Clipboard copy failed:', clipErr);
        }
      }

      // Trigger automatic image download first so the user has it ready in their gallery/downloads to attach as fallback
      try {
        const link = document.createElement('a');
        link.download = `ledger-slip-${createdSaleForSlip.invoiceNo}.png`;
        link.href = canvas.toDataURL('image/png');
        link.click();
      } catch (downloadErr) {
        console.error('Failed to trigger download:', downloadErr);
      }

      // Redirect directly to the customer's WhatsApp chat
      const waUrl = `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(waText)}`;
      window.open(waUrl, '_blank');
      setSharing(false);

    } catch (err: any) {
      // Clean up in case of error
      disabledSheets.forEach(el => el.disabled = false);
      console.error('Error generating image for share:', err);
      alert('Failed to generate image: ' + err.message + '\nStack: ' + (err.stack || ''));
      setSharing(false);
    }
  };

  const handleDownloadImage = async () => {
    const element = document.getElementById('ledger-slip');
    if (!element) return;
    const disabledSheets: HTMLStyleElement[] = [];
    try {
      const styles = document.querySelectorAll('style, link[rel="stylesheet"]');
      styles.forEach((el: any) => {
        if (!el.disabled) {
          el.disabled = true;
          disabledSheets.push(el);
        }
      });

      const canvas = await html2canvas(element, {
        backgroundColor: '#fcfbf4',
        scale: 2,
        logging: false,
        allowTaint: false,
        useCORS: true
      });

      // Restore all stylesheets immediately after canvas render
      disabledSheets.forEach(el => el.disabled = false);

      const link = document.createElement('a');
      link.download = `ledger-slip-${createdSaleForSlip?.invoiceNo || Date.now()}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (err: any) {
      disabledSheets.forEach(el => el.disabled = false);
      console.error('Error generating image:', err);
      alert('Failed to generate image: ' + err.message + '\nStack: ' + (err.stack || ''));
    }
  };

  return (
    <div className="max-w-3xl mx-auto">
      <style id="ledger-slip-styles">{`
        .ledger-slip-container {
          background-color: #fcfbf4;
          color: #1c3a6b !important;
          padding: 20px 12px;
          border-radius: 8px;
          border: 2px solid #4e4033;
          position: relative;
          overflow: hidden;
          user-select: none;
          width: 100%;
          max-width: 380px;
          margin: 0 auto;
          box-sizing: border-box;
          font-family: 'Segoe Print', 'Comic Sans MS', 'Apple Chancery', cursive;
        }
        .ledger-ruled-lines {
          position: absolute;
          inset: 0;
          opacity: 0.15;
          pointer-events: none;
          background-image: linear-gradient(#5a4b3b 1px, transparent 1px);
          background-size: 100% 28px;
          margin-top: 35px;
        }
        .ledger-margin-line {
          position: absolute;
          left: 25px;
          top: 0;
          bottom: 0;
          border-left: 1px solid red;
          opacity: 0.4;
        }
        .ledger-header {
          text-align: center;
          margin-bottom: 16px;
          padding-left: 25px;
          border-bottom: 1px solid rgba(28, 58, 107, 0.2);
          padding-bottom: 6px;
        }
        .ledger-title {
          font-size: 26px;
          font-weight: 900;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }
        .ledger-meta {
          padding-left: 25px;
          margin-bottom: 16px;
          border-bottom: 2px dashed rgba(78, 64, 51, 0.4);
          padding-bottom: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          font-size: 16px;
        }
        .ledger-meta-row {
          display: flex;
          justify-content: space-between;
        }
        .ledger-grid {
          padding-left: 25px;
          min-height: 140px;
          font-size: 16px;
          border-bottom: 2px solid #1c3a6b;
          padding-bottom: 12px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .ledger-grid-header {
          display: flex;
          font-weight: bold;
          border-bottom: 1px solid #1c3a6b;
          padding-bottom: 4px;
          font-size: 13px;
          text-transform: uppercase;
        }
        .ledger-grid-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 15px;
        }
        .ledger-col-name {
          width: 50%;
          line-height: 1.25;
          word-break: break-word;
        }
        .ledger-col-qty {
          width: 18%;
          text-align: center;
        }
        .ledger-col-amount {
          width: 32%;
          text-align: right;
          white-space: nowrap;
          font-size: 13px;
          font-weight: bold;
        }
        .ledger-total-section {
          padding-left: 25px;
          padding-top: 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          position: relative;
        }
        .ledger-total-box {
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .ledger-total-label {
          font-size: 16px;
          font-weight: bold;
        }
        .ledger-total-value {
          font-size: 20px;
          font-weight: 900;
          border-bottom: 4px double #1c3a6b;
          display: inline-block;
        }
        .ledger-balance-box {
          display: flex;
          justify-content: space-between;
          align-items: center;
          background-color: rgba(28, 58, 107, 0.08);
          padding: 6px 10px;
          border-radius: 4px;
          font-size: 14px;
          font-weight: bold;
        }
      `}</style>

      <h2 className="text-2xl font-bold mb-6 flex items-center gap-2 text-white">
        <span className="text-red-500">Record</span> Customer Sale Invoice
      </h2>

      {/* Selected Customer Credit & Sauda Status Card */}
      {selectedCustomer && (
        <div className="card bg-[#1a1a1a] p-4 sm:p-5 border border-[#333] space-y-3 mb-6">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b border-[#333]/50 pb-3">
            <div>
              <span className="text-xs text-gray-400 font-semibold uppercase">Party Account Status</span>
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                {selectedCustomer.name}
                {selectedCustomer.isOverdue || selectedCustomer.isLimitExceeded ? (
                  <span className="px-2 py-0.5 bg-red-950/40 text-red-400 border border-red-500/30 text-xs rounded font-black flex items-center gap-1">
                    🔒 DISPATCH LOCKED (PIN Required)
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-green-950/40 text-green-400 border border-green-500/30 text-xs rounded font-bold">
                    ✓ Credit Approved
                  </span>
                )}
              </h3>
            </div>
            <div className="flex gap-4 text-xs">
              <div className="text-right">
                <span className="text-gray-400 block">Credit Limit</span>
                <span className="font-bold text-white tabular-nums">₹{selectedCustomer.creditLimit.toLocaleString('en-IN')}</span>
              </div>
              <div className="text-right">
                <span className="text-gray-400 block">Current Outstanding</span>
                <span className={`font-bold tabular-nums ${selectedCustomer.currentBalance > 0 ? 'text-red-400' : 'text-green-400'}`}>
                  ₹{selectedCustomer.currentBalance.toLocaleString('en-IN')}
                </span>
              </div>
              <div className="text-right">
                <span className="text-gray-400 block">Oldest Unpaid</span>
                <span className={`font-bold tabular-nums ${selectedCustomer.oldestUnpaidDays > 18 ? 'text-red-500' : 'text-yellow-400'}`}>
                  {selectedCustomer.oldestUnpaidDays} Days
                </span>
              </div>
            </div>
          </div>

          {/* Active Sauda Booking Alert Banner */}
          {customerSaudaContracts.length > 0 && (
            <div className="p-3 bg-red-950/30 border border-red-500/40 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs text-yellow-300 font-bold">
                  ⚡ {customerSaudaContracts.length} Active Sauda Rate Contract(s) Available!
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {customerSaudaContracts.map((sau: any) => (
                  <span key={sau.id} className="text-xs bg-[#222] border border-[#444] px-2 py-0.5 rounded text-gray-200">
                    <strong className="text-red-400">{sau.contractNo}</strong>: {Number(sau.remainingQty).toFixed(2)}T @ ₹{Number(sau.ratePerKg).toFixed(2)}/Kg
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card flex flex-col gap-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Select Customer</label>
            <select
              className="input-field"
              value={customerId}
              onChange={e => setCustomerId(e.target.value)}
              required
            >
              {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Date of Record</label>
            <input
              type="datetime-local"
              className="input-field"
              min="2000-01-01"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="border border-[#333] p-4 rounded-md bg-[#1a1a1a]">
          <div className="flex justify-between items-center mb-4">
             <h3 className="font-bold text-gray-300">Invoice Items</h3>
             <button type="button" onClick={addItem} className="text-red-500 text-sm flex items-center gap-1 hover:text-red-400">
                <Plus size={16} /> Add Item
             </button>
          </div>

          <div className="space-y-4">
            {items.map((item, index) => {
              const isSaudaActiveOnItem = Boolean(
                item.saudaContractId && 
                customerSaudaContracts.some((s: any) => s.id === item.saudaContractId)
              );
              const activeSauda = isSaudaActiveOnItem ? customerSaudaContracts.find((s: any) => s.id === item.saudaContractId) : null;
              const saudaRemaining = activeSauda ? Number(activeSauda.remainingQty) : 0;
              const reqQty = parseFloat(item.qty || '0');

              return (
              <div key={index} className="p-3 sm:p-4 bg-[#222] rounded-lg border border-[#333] flex flex-col gap-3">
                <div className="flex justify-between items-center border-b border-[#333]/50 pb-2">
                  <span className="text-xs font-bold text-red-400 uppercase tracking-wider">Item #{index + 1}</span>
                  {items.length > 1 && (
                    <button 
                      type="button" 
                      onClick={() => removeItem(index)} 
                      className="p-1.5 text-gray-400 hover:text-red-500 rounded hover:bg-red-500/10 transition-colors"
                      aria-label="Remove item"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">Category</label>
                    <select className="input-field text-sm" value={item.productCategory} onChange={e => handleItemChange(index, 'productCategory', e.target.value)}>
                      <option value="CC Wires">CC Wires</option>
                      <option value="Submersible Winding Wire">Submersible Winding</option>
                      <option value="Raw Copper Bundle">Raw Copper Bundle</option>
                    </select>
                  </div>

                  {item.productCategory !== 'Raw Copper Bundle' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Brand</label>
                      <select className="input-field text-sm" value={item.brand} onChange={e => handleItemChange(index, 'brand', e.target.value)}>
                        {getBrands(item.productCategory).map(b => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                  )}

                  {item.productCategory !== 'Raw Copper Bundle' && (
                    <div>
                      <label className="block text-xs text-gray-400 mb-1">Size</label>
                      <select className="input-field text-sm" value={item.wireType} onChange={e => handleItemChange(index, 'wireType', e.target.value)}>
                        <option value="1mm">1mm</option>
                        <option value="2mm">2mm</option>
                        <option value="3mm">3mm</option>
                        <option value="4mm">4mm</option>
                      </select>
                    </div>
                  )}

                  {/* Sauda Contract Quota Selector - only shown when customer has active Saudas */}
                  {customerSaudaContracts.length > 0 && (
                    <div>
                      <label className="block text-xs text-yellow-400 font-bold mb-1">
                        Apply Sauda Quota
                      </label>
                      <select
                        className="input-field text-xs bg-[#1a1a1a] border-yellow-500/40 text-yellow-300"
                        value={item.saudaContractId || ''}
                        onChange={e => handleSaudaDropdownChange(index, e.target.value)}
                      >
                        <option value="">Spot Price (No Sauda)</option>
                        {customerSaudaContracts.map((sau: any) => (
                          <option key={sau.id} value={sau.id}>
                            {sau.contractNo} ({Number(sau.remainingQty).toFixed(2)}T left @ ₹{Number(sau.ratePerKg).toFixed(0)})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  <div>
                    <div className="flex justify-between items-end mb-1">
                       <label className="block text-xs text-gray-400">Quantity (Tons)</label>
                       <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${Number(getItemStock(item)) > 0 ? 'text-green-500 bg-green-500/10' : 'text-red-400 bg-red-950/40'}`}>
                         Stock: {Number(getItemStock(item)).toFixed(2)}T
                       </span>
                    </div>
                    <input
                      type="number" step="0.01" min="0.01" max={Number(getItemStock(item))}
                      className={`input-field text-sm ${parseFloat(item.qty || '0') > getItemStock(item) ? 'border-red-500 bg-red-950/40 text-red-300 ring-1 ring-red-500' : ''}`}
                      required
                      value={item.qty} onChange={e => handleItemChange(index, 'qty', e.target.value)}
                    />
                    {parseFloat(item.qty || '0') > getItemStock(item) && (
                      <p className="text-[10px] text-red-400 font-bold mt-1">
                        ⚠️ Exceeds stock (Max: {getItemStock(item).toFixed(2)}T)
                      </p>
                    )}
                    {activeSauda && reqQty > (saudaRemaining + 0.001) && (
                      <div className="mt-2 p-2 bg-yellow-950/40 border border-yellow-500/50 rounded-lg flex flex-col gap-1.5">
                        <div className="text-[11px] text-yellow-300">
                          ⚠️ Exceeds Sauda quota by <strong className="text-white font-bold">{(reqQty - saudaRemaining).toFixed(2)}T</strong> (Quota left: {saudaRemaining.toFixed(2)}T)
                        </div>
                        <button
                          type="button"
                          onClick={() => setExcessSaudaSplit({
                            itemIndex: index,
                            item,
                            sauda: activeSauda,
                            saudaQty: saudaRemaining,
                            excessQty: reqQty - saudaRemaining
                          })}
                          className="px-2 py-1 bg-yellow-500 hover:bg-yellow-400 text-black text-[11px] font-bold rounded shadow transition-all flex items-center justify-center gap-1 cursor-pointer"
                        >
                          ⚡ Split Excess at Spot Price
                        </button>
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="flex justify-between items-end mb-1">
                       <label className="block text-xs text-gray-400">
                         Price/KG (₹) {isSaudaActiveOnItem && <span className="text-yellow-400 font-bold ml-1">🔒 Locked by Sauda</span>}
                       </label>
                       <span className="text-[10px] text-orange-500 bg-orange-500/10 px-1 rounded">Cost: ₹{(currentCost / 1000).toLocaleString('en-IN', {maximumFractionDigits:2})}</span>
                    </div>
                    <input
                      type="number" step="0.01"
                      disabled={isSaudaActiveOnItem}
                      readOnly={isSaudaActiveOnItem}
                      className={`input-field text-sm ${isSaudaActiveOnItem ? 'bg-[#181818] text-yellow-300 font-bold border-yellow-500/40 cursor-not-allowed select-none opacity-90' : (parseFloat(item.pricePerKg) < (currentCost / 1000) ? 'border-red-500 bg-red-950/20' : '')}`}
                      required
                      value={item.pricePerKg} onChange={e => !isSaudaActiveOnItem && handleItemChange(index, 'pricePerKg', e.target.value)}
                    />
                  </div>

                  <div className="sm:col-span-2 lg:col-span-1 flex flex-col justify-end">
                    <div className="p-2 bg-[#1a1a1a] rounded border border-[#333] flex justify-between items-center">
                      <span className="text-xs text-gray-400">Line Total:</span>
                      <span className="font-bold text-emerald-400 tabular-nums">
                        ₹ {calculateItemTotal(item).toLocaleString('en-IN', {maximumFractionDigits:0})}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        </div>

        <div className="p-4 bg-red-950/20 border border-red-900/50 rounded-lg flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
          <span className="text-gray-300 font-medium text-base sm:text-lg">Grand Total Value:</span>
          <span className="text-2xl sm:text-3xl font-black text-white tabular-nums">₹ {grandTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
        </div>

        <button type="submit" className="btn-primary py-3.5 text-base sm:text-lg font-bold w-full">
          Generate Final Invoice & Record Sale
        </button>
      </form>

      <div className="mt-10">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
          <h3 className="text-xl font-bold text-gray-300">Recent Sales History</h3>
          <div className="flex gap-2 w-full sm:w-auto">
            <button
              onClick={() => {
                 const dataToExport = recentSales.map((sale: any) => ({
                    Date: formatDateIST(sale.date),
                    Customer: sale.customer.name,
                    TotalValue: sale.totalValue
                 }));
                 exportToExcel(dataToExport, `Sales_History_${new Date().toISOString().slice(0,10)}`);
              }}
              className="flex-1 sm:flex-initial bg-[#1f2937] hover:bg-gray-700 text-white font-bold py-2 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Download size={14}/> Export Excel
            </button>
            <button
              onClick={() => {
                 const headers = ['Date', 'Customer', 'Total Value'];
                 const rows = recentSales.map((sale: any) => [
                    formatDateIST(sale.date),
                    sale.customer.name,
                    `₹ ${sale.totalValue.toLocaleString('en-IN', {maximumFractionDigits:0})}`
                 ]);
                 exportToPDF(headers, rows, 'Recent Sales History Report');
              }}
              className="flex-1 sm:flex-initial bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-3 rounded text-xs transition-colors flex items-center justify-center gap-1.5"
            >
              <Download size={14}/> Export PDF
            </button>
          </div>
        </div>

        {/* Mobile Sales Cards (< 640px) */}
        <div className="sm:hidden space-y-3">
          {recentSales.map((sale: any) => (
            <div key={sale.id} className="p-4 bg-[#1a1a1a] rounded-lg border border-[#333] space-y-3">
              <div className="flex justify-between items-start">
                <div>
                  <h4 className="font-bold text-white text-base">{sale.customer.name}</h4>
                  <span className="text-xs text-gray-400">{formatDateIST(sale.date)}</span>
                </div>
                <div className="text-right">
                  <span className="font-bold text-green-400 text-base tabular-nums">
                    ₹ {sale.totalValue.toLocaleString('en-IN', {maximumFractionDigits:0})}
                  </span>
                </div>
              </div>
              <div className="flex gap-2 pt-2 border-t border-[#333]">
                <button 
                  type="button" 
                  onClick={() => handleViewSlip(sale)} 
                  className="flex-1 py-2 text-center text-indigo-400 hover:text-indigo-300 text-xs font-bold bg-indigo-500/10 rounded border border-indigo-500/20"
                >
                  View Slip
                </button>
                <button 
                  type="button" 
                  onClick={() => handleUndo(sale.id)} 
                  className="flex-1 py-2 text-center text-red-500 hover:text-red-400 text-xs font-bold bg-red-500/10 rounded border border-red-500/20"
                >
                  Undo / Delete
                </button>
              </div>
            </div>
          ))}
          {recentSales.length === 0 && (
            <div className="p-6 text-center text-gray-400 card">No recent sales found.</div>
          )}
        </div>

        {/* Desktop/Tablet Table (>= 640px) */}
        <div className="hidden sm:block overflow-x-auto rounded-lg border border-[#333]">
          <table className="w-full text-left bg-[#1a1a1a]">
            <thead className="bg-[#222]">
              <tr className="border-b border-[#333] text-gray-400 text-sm">
                <th className="p-3">Date</th>
                <th className="p-3">Customer</th>
                <th className="p-3 text-right">Total Value</th>
                <th className="p-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody>
              {recentSales.map((sale: any) => (
                <tr key={sale.id} className="border-b border-[#333] last:border-0 text-sm hover:bg-[#2a2a2a] transition-colors">
                  <td className="p-3 text-gray-300 whitespace-nowrap">{formatDateIST(sale.date)}</td>
                  <td className="p-3 font-medium text-white">{sale.customer.name}</td>
                  <td className="p-3 text-right font-bold text-green-400 whitespace-nowrap tabular-nums">₹ {sale.totalValue.toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                  <td className="p-3 text-center">
                    <div className="flex justify-center gap-2">
                      <button type="button" onClick={() => handleViewSlip(sale)} className="text-indigo-400 hover:text-indigo-300 text-xs font-bold px-2.5 py-1 bg-indigo-500/10 rounded border border-indigo-500/20 transition-colors">
                        View Slip
                      </button>
                      <button type="button" onClick={() => handleUndo(sale.id)} className="text-red-500 hover:text-red-400 text-xs font-bold px-2.5 py-1 bg-red-500/10 rounded border border-red-500/20 transition-colors">
                        Undo / Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {recentSales.length === 0 && (
                <tr><td colSpan={4} className="p-4 text-center text-gray-400">No recent sales found.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showConfirmModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto">
           <div className="bg-[#1a1a1a] border border-[#333] p-6 rounded-lg max-w-lg w-full shadow-2xl">
              <h3 className="text-2xl font-bold text-white mb-2 flex items-center gap-2">
                 <Check className="text-green-500" /> Confirm Sales Invoice Details
              </h3>
              <p className="text-sm text-gray-400 mb-4 border-b border-[#333]/50 pb-2">
                 Please review the details below before recording the sale.
              </p>

              <div className="space-y-3 mb-6 text-sm text-gray-300">
                 <div className="flex justify-between">
                    <span className="text-gray-400">Customer Name:</span>
                    <span className="font-bold text-white">
                       {customers.find((c: any) => c.id === customerId)?.name || 'Cash Sale'}
                    </span>
                 </div>
                 <div className="flex justify-between">
                    <span className="text-gray-400">Log Date:</span>
                    <span className="font-bold text-white">
                       {date ? formatDateIST(date) : 'Current Time (IST)'}
                    </span>
                 </div>
                 {customers.find((c: any) => c.id === customerId)?.transport && (
                    <div className="flex justify-between">
                       <span className="text-gray-400">Transport:</span>
                       <span className="font-bold text-white">
                          {customers.find((c: any) => c.id === customerId)?.transport}
                       </span>
                    </div>
                 )}

                 <div className="border border-[#333] rounded overflow-hidden mt-4">
                    <table className="w-full text-left text-xs bg-[#222]">
                       <thead className="bg-[#2a2a2a] text-gray-400">
                          <tr className="border-b border-[#333]">
                             <th className="p-2">Items Chosen</th>
                             <th className="p-2 text-center">Qty</th>
                             <th className="p-2 text-right">Total</th>
                          </tr>
                       </thead>
                       <tbody>
                          {items.map((item, idx) => (
                             <tr key={idx} className="border-b border-[#333]/50 last:border-0 text-gray-300">
                                <td className="p-2">
                                   {item.productCategory === 'Raw Copper Bundle' 
                                      ? 'Raw Copper Bundle' 
                                      : `${item.brand} ${item.wireType}`}
                                   <div className="text-[10px] text-gray-400">@ ₹{item.pricePerKg}/kg</div>
                                </td>
                                <td className="p-2 text-center">{Number(item.qty).toFixed(2)}T</td>
                                <td className="p-2 text-right">₹ {calculateItemTotal(item).toLocaleString('en-IN', {maximumFractionDigits:0})}</td>
                             </tr>
                          ))}
                       </tbody>
                    </table>
                 </div>

                 <div className="flex justify-between items-center bg-red-950/20 border border-red-900/50 p-3 rounded mt-4">
                    <span className="text-gray-400 font-medium">Grand Total Value:</span>
                    <span className="text-xl font-bold text-white">₹ {grandTotal.toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
                 </div>
              </div>

              <div className="flex gap-4">
                 <button 
                    onClick={handleConfirmAndRecord}
                    className="btn-primary flex-1 bg-green-600 hover:bg-green-700 font-bold"
                 >
                    Confirm & Record Sale
                 </button>
                 <button 
                    onClick={() => setShowConfirmModal(false)}
                    className="px-4 py-2 bg-[#2a2a2a] text-gray-300 hover:text-white rounded font-bold border border-[#333]"
                 >
                    Edit / Cancel
                 </button>
              </div>
           </div>
        </div>
      )}

      {showPinModal && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
           <div className="bg-[#1e1e1e] border border-[#333] p-6 sm:p-8 rounded-xl max-w-md w-full space-y-4">
              <h3 className="text-xl sm:text-2xl font-bold text-red-500 flex items-center gap-2">
                <span className="text-2xl">🔒</span> Dispatch Authorization Required
              </h3>
              <p className="text-xs sm:text-sm text-gray-300">
                {pinReason || 'You are attempting to proceed with a transaction requiring Owner PIN override (Loss-making rate or 18-day Credit Limit lock).'}
              </p>

              {pinError && <div className="bg-red-950/50 text-red-400 p-2 text-xs rounded border border-red-500/30">{pinError}</div>}

              <form onSubmit={handlePinSubmit} className="space-y-4">
                 <input
                   type="password"
                   maxLength={8}
                   placeholder="Enter Owner Override PIN"
                   className="input-field text-center text-2xl tracking-widest h-14"
                   value={overridePin}
                   onChange={(e) => setOverridePin(e.target.value)}
                   required
                   autoFocus
                 />
                 <div className="flex gap-3">
                    <button type="submit" className="btn-primary flex-1 bg-red-600 hover:bg-red-700 font-bold">Authorize & Confirm</button>
                    <button type="button" onClick={() => {setShowPinModal(false); setPinError(''); setOverridePin(''); setPendingSaudaChange(null);}} className="px-4 py-2 bg-[#2a2a2a] text-gray-300 hover:text-white rounded font-bold text-sm">Cancel</button>
                 </div>
              </form>
           </div>
        </div>
      )}

      {/* Sauda Quota Exceeded Split Modal */}
      {excessSaudaSplit && (
        <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4">
          <div className="bg-[#1e1e1e] border border-yellow-500/40 p-6 sm:p-7 rounded-xl max-w-lg w-full space-y-4 shadow-2xl animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-3 border-b border-[#333] pb-3">
              <span className="text-3xl">⚖️</span>
              <div>
                <h3 className="text-xl font-bold text-yellow-400">
                  Sauda Quota Exceeded (Item #{excessSaudaSplit.itemIndex + 1})
                </h3>
                <p className="text-xs text-gray-400">
                  Contract: <span className="text-white font-bold">{excessSaudaSplit.sauda.contractNo}</span> • Rate: <span className="text-emerald-400 font-bold">₹{Number(excessSaudaSplit.sauda.ratePerKg).toFixed(0)}/kg</span>
                </p>
              </div>
            </div>

            <div className="bg-[#141414] border border-[#2a2a2a] p-4 rounded-lg space-y-2.5 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-400">Total Requested Dispatch:</span>
                <span className="font-bold text-white">{(excessSaudaSplit.saudaQty + excessSaudaSplit.excessQty).toFixed(2)} Tons</span>
              </div>
              <div className="flex justify-between text-yellow-400 font-medium">
                <span>Sauda Balance Remaining:</span>
                <span className="font-bold">{excessSaudaSplit.saudaQty.toFixed(2)} Tons</span>
              </div>
              <div className="flex justify-between text-orange-400 font-bold border-t border-[#222] pt-2">
                <span>Excess Quantity Above Sauda:</span>
                <span>+{excessSaudaSplit.excessQty.toFixed(2)} Tons</span>
              </div>
            </div>

            <p className="text-xs text-gray-300 leading-relaxed">
              This party’s active Sauda contract only has <strong className="text-white">{excessSaudaSplit.saudaQty.toFixed(2)} Tons</strong> remaining at the locked rate of ₹{Number(excessSaudaSplit.sauda.ratePerKg).toFixed(0)}/kg. How would you like to handle the excess <strong className="text-orange-400">{excessSaudaSplit.excessQty.toFixed(2)} Tons</strong>?
            </p>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-2">
              <button
                type="button"
                onClick={handleApplyExcessSplit}
                className="btn-primary flex-1 bg-yellow-500 hover:bg-yellow-400 text-black font-bold text-xs sm:text-sm py-3 px-3 shadow cursor-pointer"
              >
                ⚡ Split Line & Set Spot Price for Excess ({excessSaudaSplit.excessQty.toFixed(2)}T)
              </button>
              <button
                type="button"
                onClick={handleCapAtSauda}
                className="px-4 py-3 bg-[#2a2a2a] text-gray-300 hover:text-white rounded-lg font-bold text-xs border border-[#444] transition-colors cursor-pointer"
              >
                Cap at {excessSaudaSplit.saudaQty.toFixed(2)}T
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dynamic Handwritten Ledger Slip Modal */}
      {createdSaleForSlip && (
         <div className="fixed inset-0 bg-black/85 flex items-center justify-center z-50 p-4 overflow-y-auto">
            <div className="max-w-md w-full flex flex-col gap-4">
               
               <div id="ledger-slip" className="ledger-slip-container select-none">
                   
                   {/* Ledger ruled lines pattern */}
                   <div className="ledger-ruled-lines"></div>

                   {/* Red margin line */}
                   <div className="ledger-margin-line"></div>

                   {/* Header Title & Company Logo */}
                   <div className="ledger-header" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginBottom: '8px' }}>
                      <img src="/logo.png" alt="Logo" style={{ width: '38px', height: '38px', objectFit: 'contain' }} />
                      <div style={{ textAlign: 'left' }}>
                        <h3 className="ledger-title" style={{ transform: 'rotate(-1deg)', margin: 0, lineHeight: 1.1, fontSize: '18px' }}>
                           MANUFACTURING COMPANY
                        </h3>
                        <span style={{ fontSize: '9px', color: '#555', fontWeight: 'bold', letterSpacing: '1px', textTransform: 'uppercase' }}>
                          Manufacturing Ledger Dispatch Slip
                        </span>
                      </div>
                   </div>

                   {/* Metadata block */}
                   <div className="ledger-meta">
                      <div className="ledger-meta-row">
                         <span>Party Name: <strong>{createdSaleForSlip.customer?.name || 'Cash Sale'}</strong></span>
                         <span>Date: <strong>{new Date(createdSaleForSlip.date).toLocaleDateString('en-IN')}</strong></span>
                      </div>
                      {createdSaleForSlip.customer?.transport && (
                         <div>
                            <span>Transport: <strong>{createdSaleForSlip.customer.transport}</strong></span>
                         </div>
                      )}
                   </div>

                   {/* Ruled Columns Ledger Grid */}
                   <div className="ledger-grid">
                      <div className="ledger-grid-header">
                         <span className="ledger-col-name">Particulars</span>
                         <span className="ledger-col-qty">Qty (Tons)</span>
                         <span className="ledger-col-amount">Amount</span>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                         {createdSaleForSlip.items.map((item: any, i: number) => (
                            <div key={i} className="ledger-grid-row">
                               <span className="ledger-col-name">
                                  {item.productCategory === 'Raw Copper Bundle' 
                                    ? 'Raw Copper Bundle' 
                                    : `${item.brand} ${item.wireType}`}
                                  <br />
                                  <span style={{ fontSize: '14px', color: '#666', opacity: 0.8 }}>@ ₹{item.pricePerKg}/kg</span>
                               </span>
                               <span className="ledger-col-qty">{Number(item.qty).toFixed(2)}T</span>
                               <span className="ledger-col-amount">₹ {calculateItemTotal(item).toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
                            </div>
                         ))}
                      </div>
                   </div>

                   {/* Total Value & Balance */}
                   <div className="ledger-total-section">
                      <div className="ledger-total-box">
                         <span className="ledger-total-label">Grand Total:</span>
                         <div className="ledger-total-value">
                            ₹ {createdSaleForSlip.total.toLocaleString('en-IN', {maximumFractionDigits:0})}
                         </div>
                      </div>
                      <div className="ledger-balance-box">
                         <span>Net Total Balance:</span>
                         <span>₹ {(createdSaleForSlip.closingBalance ?? ((createdSaleForSlip.customer?.currentBalance || 0) + createdSaleForSlip.total)).toLocaleString('en-IN', {maximumFractionDigits:0})}</span>
                      </div>
                   </div>

                </div>

               {/* Action Buttons */}
               <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                   <button
                     onClick={handleWhatsAppShareImage}
                     disabled={sharing}
                     className="sm:col-span-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 rounded-lg transition-colors text-center flex items-center justify-center gap-2 shadow disabled:opacity-50 min-h-[44px]"
                   >
                     <Share2 size={18} /> {sharing ? 'Generating Image...' : 'Share on WhatsApp'}
                   </button>
                  <button
                    onClick={() => window.print()}
                    className="bg-[#2a2a2a] hover:bg-[#333] text-white border border-[#444] font-bold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow min-h-[44px]"
                  >
                     <Printer size={18} /> Print Slip
                  </button>
                  <button
                    onClick={handleDownloadImage}
                    className="bg-indigo-600 hover:bg-indigo-500 text-white border border-indigo-500/20 font-bold py-2.5 px-4 rounded-lg transition-colors flex items-center justify-center gap-2 shadow min-h-[44px]"
                  >
                     <Download size={18} /> Download Image
                  </button>
                  <button
                    onClick={() => setCreatedSaleForSlip(null)}
                    className="sm:col-span-2 bg-red-950/30 hover:bg-red-900/50 text-red-400 border border-red-500/30 font-bold py-2.5 px-6 rounded-lg transition-colors min-h-[44px]"
                  >
                     Close Slip
                  </button>
               </div>

            </div>
         </div>
      )}
    </div>
  );
}
