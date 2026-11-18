import type { OrderRecord, OrderStoreSectionRecord } from '../shared/types.ts';

export function isStorePrepared(status: string): boolean {
  return status === 'ready_for_pickup' || status === 'on_the_way' || status === 'delivered';
}

export function isSectionPickedUpByCaptain(
  sec: Pick<OrderStoreSectionRecord, 'captain_picked_up_at' | 'prep_status'>,
  orderStatus?: string
): boolean {
  return (
    Boolean(sec.captain_picked_up_at) ||
    sec.prep_status === 'on_the_way' ||
    sec.prep_status === 'delivered' ||
    orderStatus === 'on_the_way' ||
    orderStatus === 'delivered'
  );
}

export function getSectionItemCount(sec: Pick<OrderStoreSectionRecord, 'items'>): number {
  if (Array.isArray(sec.items) && sec.items.length > 0) {
    return sec.items
      .filter((it) => it.status !== 'rejected')
      .reduce((sum, it) => sum + Math.max(1, Number(it.quantity || 1)), 0);
  }
  return 1;
}

export function getOrderStoreSections(o: OrderRecord): OrderStoreSectionRecord[] {
  if (Array.isArray(o.store_sections) && o.store_sections.length > 0) {
    return o.store_sections.slice().sort((a, b) => Number(a.sort_index || 0) - Number(b.sort_index || 0));
  }
  return [
    {
      id: `sec_${o.id}`,
      order_id: o.id,
      merchant_id: o.merchant_id,
      merchant_name: o.merchant_name,
      merchant_type: o.merchant_type,
      merchant_lat: o.merchant_lat ?? null,
      merchant_lng: o.merchant_lng ?? null,
      items: Array.isArray(o.items) ? o.items : [],
      free_order_text: o.free_order_text ?? null,
      prescription_image_url: o.prescription_image_url ?? null,
      subtotal: Number(o.subtotal || 0),
      commission_rate: null,
      prep_status: o.status,
      pharmacist_notes: o.pharmacist_notes ?? null,
      substitution_note: o.substitution_note ?? null,
      rejection_reason: o.rejection_reason ?? null,
      ready_at: o.ready_at ?? null,
      captain_picked_up_at: o.captain_picked_up_at ?? null,
      sort_index: 0,
    },
  ];
}

export function isMultiStoreOrder(o: OrderRecord): boolean {
  return Array.isArray(o.store_sections) && o.store_sections.length > 1;
}

export function getAnchorStoreSection(sections: OrderStoreSectionRecord[]): OrderStoreSectionRecord | null {
  const active = sections.filter((s) => s.prep_status !== 'cancelled');
  const pool = active.length > 0 ? active : sections;
  if (pool.length === 0) return null;
  let best = pool[0];
  let bestQty = -1;
  let bestSub = -1;
  for (const s of pool) {
    const qty = getSectionItemCount(s);
    const sub = Number(s.subtotal || 0);
    if (qty > bestQty || (qty === bestQty && sub > bestSub)) {
      best = s;
      bestQty = qty;
      bestSub = sub;
    }
  }
  return best;
}

export interface OrderStoreStats {
  sections: OrderStoreSectionRecord[];
  activeSections: OrderStoreSectionRecord[];
  isMultiStore: boolean;
  readyCount: number;
  allStoresReady: boolean;
  pickedUpCount: number;
  allStoresPickedUp: boolean;
  anchorSection: OrderStoreSectionRecord | null;
}

export function computeOrderStoreStats(o: OrderRecord): OrderStoreStats {
  const sections = getOrderStoreSections(o);
  const activeSections = sections.filter((s) => s.prep_status !== 'cancelled');
  const readyCount = activeSections.filter((s) => isStorePrepared(s.prep_status)).length;
  const pickedUpCount = activeSections.filter((s) => isSectionPickedUpByCaptain(s, o.status)).length;
  return {
    sections,
    activeSections,
    isMultiStore: sections.length > 1,
    readyCount,
    allStoresReady: activeSections.length > 0 && readyCount === activeSections.length,
    pickedUpCount,
    allStoresPickedUp: activeSections.length > 0 && pickedUpCount === activeSections.length,
    anchorSection: getAnchorStoreSection(activeSections),
  };
}

export function computeLiveEta(
  captainLat?: number | null,
  captainLng?: number | null,
  customerLat?: number | null,
  customerLng?: number | null
): { distanceKm: number; etaMin: number; arrivalTimeLabel: string } | null {
  if (
    captainLat === null ||
    captainLat === undefined ||
    captainLng === null ||
    captainLng === undefined ||
    !Number.isFinite(Number(captainLat)) ||
    !Number.isFinite(Number(captainLng))
  ) {
    return null;
  }
  const cLat = Number(captainLat);
  const cLng = Number(captainLng);
  const tLat = Number(customerLat || 31.1583);
  const tLng = Number(customerLng || 31.9369);
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(tLat - cLat);
  const dLng = toRad(tLng - cLng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(cLat)) * Math.cos(toRad(tLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const distanceKm = Number((R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))).toFixed(2));
  const etaMin = Math.max(2, Math.round(distanceKm * 3.5));
  const arrivalDate = new Date(Date.now() + etaMin * 60000);
  const arrivalTimeLabel = arrivalDate.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
  return { distanceKm, etaMin, arrivalTimeLabel };
}
