import { db } from './db.ts';
import type { CaptainRecord, DispatchConfig, FinancialModelInput, PricingRule, ServiceZone } from '../shared/types.ts';

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((R * c).toFixed(2));
}

export interface PriceSimulationInput {
  service_type: 'stores' | 'pharmacy' | 'parcels' | 'rides' | 'market';
  vehicle_type?: 'moto' | 'tuktuk' | 'car';
  zone_id: string;
  distance_km: number;
  waiting_minutes?: number;
  is_express?: boolean;
  basket_or_item_amount?: number;
  apply_peak_override?: number;
}

export function calculateServicePrice(input: PriceSimulationInput) {
  const ruleRow = db
    .prepare(
      `SELECT * FROM pricing_rules
       WHERE service_type = ? AND (vehicle_type = ? OR vehicle_type = 'all') AND is_active = 1
       ORDER BY CASE WHEN vehicle_type = ? THEN 0 ELSE 1 END LIMIT 1`
    )
    .get(input.service_type, input.vehicle_type ?? 'all', input.vehicle_type ?? 'all') as PricingRule | undefined;

  if (!ruleRow) {
    throw new Error('لم يتم العثور على قاعدة تسعير فعالة لهذه الخدمة');
  }

  const zone = db.prepare('SELECT * FROM service_zones WHERE id = ?').get(input.zone_id) as ServiceZone | undefined;
  const remoteFee = input.service_type === 'rides' || input.service_type === 'market' ? 0 : zone?.remote_area_fee ?? 0;
  const peakMultiplier = input.apply_peak_override && input.apply_peak_override > 0 ? input.apply_peak_override : ruleRow.peak_multiplier;
  const basket = Math.max(0, input.basket_or_item_amount ?? 0);

  if (input.service_type === 'market') {
    const rawComm = (basket * ruleRow.commission_rate) / 100;
    const clampedComm = Math.min(
      Math.max(rawComm, ruleRow.min_commission),
      ruleRow.max_commission > 0 ? ruleRow.max_commission : rawComm
    );
    return {
      rule_used: ruleRow.title_ar,
      zone_name: zone?.name_ar ?? 'المنزلة',
      item_amount: basket,
      delivery_or_fare_fee: 0,
      remote_area_fee: 0,
      express_fee: 0,
      peak_multiplier: 1,
      customer_total: basket,
      platform_commission: Number(clampedComm.toFixed(2)),
      captain_payout: 0,
      merchant_or_seller_payout: Number((basket - clampedComm).toFixed(2)),
    };
  }

  if (input.service_type === 'rides') {
    const billableKm = Math.max(0, input.distance_km - ruleRow.base_distance_km);
    const waitingMin = Math.max(0, (input.waiting_minutes ?? 0) - ruleRow.waiting_grace_min);
    const rawFare =
      (ruleRow.base_fee + billableKm * ruleRow.per_km_rate + waitingMin * ruleRow.per_min_waiting_rate) * peakMultiplier;
    const finalFare = Math.max(ruleRow.min_fare, rawFare);
    const platformCommission = (finalFare * ruleRow.commission_rate) / 100;
    const captainPayout = finalFare - platformCommission;
    return {
      rule_used: ruleRow.title_ar,
      zone_name: zone?.name_ar ?? 'المنزلة',
      item_amount: 0,
      delivery_or_fare_fee: Number(finalFare.toFixed(2)),
      remote_area_fee: 0,
      express_fee: 0,
      peak_multiplier: peakMultiplier,
      customer_total: Number(finalFare.toFixed(2)),
      platform_commission: Number(platformCommission.toFixed(2)),
      captain_payout: Number(captainPayout.toFixed(2)),
      merchant_or_seller_payout: 0,
    };
  }

  // Stores, Pharmacy, Parcels
  const billableKm = Math.max(0, input.distance_km - ruleRow.base_distance_km);
  const expressFee = input.is_express ? ruleRow.express_fee : 0;
  const rawDelivery = (ruleRow.base_fee + billableKm * ruleRow.per_km_rate + remoteFee + expressFee) * peakMultiplier;
  const deliveryFee = Math.max(ruleRow.min_fare, rawDelivery);

  if (input.service_type === 'parcels') {
    const platformFee = (deliveryFee * ruleRow.commission_rate) / 100;
    const captainPayout = deliveryFee - platformFee;
    return {
      rule_used: ruleRow.title_ar,
      zone_name: zone?.name_ar ?? 'المنزلة',
      item_amount: 0,
      delivery_or_fare_fee: Number(deliveryFee.toFixed(2)),
      remote_area_fee: remoteFee,
      express_fee: expressFee,
      peak_multiplier: peakMultiplier,
      customer_total: Number(deliveryFee.toFixed(2)),
      platform_commission: Number(platformFee.toFixed(2)),
      captain_payout: Number(captainPayout.toFixed(2)),
      merchant_or_seller_payout: 0,
    };
  }

  // Stores & Pharmacy
  const merchantCommission = (basket * ruleRow.commission_rate) / 100;
  const captainShare = (deliveryFee * ruleRow.captain_delivery_share_pct) / 100;
  const platformDeliveryShare = deliveryFee - captainShare;
  const totalPlatformRevenue = merchantCommission + platformDeliveryShare;

  return {
    rule_used: ruleRow.title_ar,
    zone_name: zone?.name_ar ?? 'المنزلة',
    item_amount: basket,
    delivery_or_fare_fee: Number(deliveryFee.toFixed(2)),
    remote_area_fee: remoteFee,
    express_fee: expressFee,
    peak_multiplier: peakMultiplier,
    customer_total: Number((basket + deliveryFee).toFixed(2)),
    platform_commission: Number(totalPlatformRevenue.toFixed(2)),
    captain_payout: Number(captainShare.toFixed(2)),
    merchant_or_seller_payout: Number((basket - merchantCommission).toFixed(2)),
  };
}

export function runSmartDispatch(params: {
  service_type: 'stores' | 'pharmacy' | 'parcels' | 'rides';
  required_vehicle?: 'moto' | 'tuktuk' | 'car';
  pickup_lat: number;
  pickup_lng: number;
}) {
  const config = db.prepare('SELECT * FROM dispatch_config WHERE id = ?').get('default') as DispatchConfig;
  const rows = db.prepare('SELECT * FROM captains').all() as Array<
    Omit<CaptainRecord, 'allowed_services' | 'documents' | 'is_eligible_for_rides'> & {
      allowed_services_json: string;
      is_eligible_for_rides: number;
    }
  >;

  const excluded: Array<{ captain_name: string; reason: string }> = [];
  const candidates: Array<{
    captain_id: string;
    full_name: string;
    vehicle_type: string;
    plate_number: string;
    distance_km: number;
    acceptance_rate: number;
    rating_avg: number;
    idle_minutes: number;
    cash_on_hand: number;
    cash_limit: number;
    score: number;
  }> = [];

  for (const c of rows) {
    const allowed: string[] = JSON.parse(c.allowed_services_json || '[]');
    if (c.verification_status !== 'approved') {
      excluded.push({ captain_name: c.full_name, reason: `الحساب غير معتمد (${c.verification_status})` });
      continue;
    }
    if (c.availability_status !== 'available') {
      excluded.push({ captain_name: c.full_name, reason: `الحالة ليست متاح (${c.availability_status})` });
      continue;
    }
    if (!allowed.includes(params.service_type)) {
      excluded.push({ captain_name: c.full_name, reason: `غير مؤهل لخدمة ${params.service_type}` });
      continue;
    }
    if (params.service_type === 'rides' && c.is_eligible_for_rides !== 1) {
      excluded.push({ captain_name: c.full_name, reason: 'المركبة غير مصرح لها بنقل الركاب' });
      continue;
    }
    if (params.required_vehicle && c.vehicle_type !== params.required_vehicle) {
      excluded.push({ captain_name: c.full_name, reason: `نوع المركبة (${c.vehicle_type}) لا يطابق المطلوب` });
      continue;
    }
    if (c.cash_on_hand >= c.cash_limit) {
      excluded.push({ captain_name: c.full_name, reason: 'تجاوز السقف النقدي المسموح (Cash Cap)' });
      continue;
    }

    const distanceKm = haversineKm(params.pickup_lat, params.pickup_lng, c.lat, c.lng);
    if (distanceKm > config.max_radius_km) {
      excluded.push({ captain_name: c.full_name, reason: `خارج النطاق الأقصى (${distanceKm} كم)` });
      continue;
    }

    const proximityScore = Math.max(0, 1 - distanceKm / config.max_radius_km);
    const acceptanceScore = Math.min(1, c.acceptance_rate / 100);
    const ratingScore = Math.min(1, c.rating_avg / 5);
    const idleScore = Math.min(1, c.idle_minutes / 60);

    const totalScore =
      proximityScore * config.weight_proximity +
      acceptanceScore * config.weight_acceptance +
      ratingScore * config.weight_rating +
      idleScore * config.weight_idle_time;

    candidates.push({
      captain_id: c.id,
      full_name: c.full_name,
      vehicle_type: c.vehicle_type,
      plate_number: c.plate_number,
      distance_km: distanceKm,
      acceptance_rate: c.acceptance_rate,
      rating_avg: c.rating_avg,
      idle_minutes: c.idle_minutes,
      cash_on_hand: c.cash_on_hand,
      cash_limit: c.cash_limit,
      score: Number((totalScore * 100).toFixed(1)),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return {
    config,
    winner: candidates[0] ?? null,
    candidates,
    excluded,
  };
}

export function calculateFinancialModel(input: FinancialModelInput) {
  const sShare = input.store_share_pct / 100;
  const pShare = input.parcel_share_pct / 100;
  const rShare = input.ride_share_pct / 100;
  const mShare = input.market_share_pct / 100;

  const storeGmvUnit = input.avg_store_basket + input.avg_delivery_fee;
  const storeRevUnit =
    (input.avg_store_basket * input.store_commission_pct) / 100 +
    (input.avg_delivery_fee * input.platform_delivery_share_pct) / 100;
  const storeMerchantUnit = input.avg_store_basket * (1 - input.store_commission_pct / 100);
  const storeCaptainUnit = input.avg_delivery_fee * (1 - input.platform_delivery_share_pct / 100);

  const parcelRevUnit = (input.avg_parcel_fee * input.parcel_commission_pct) / 100;
  const parcelCaptainUnit = input.avg_parcel_fee - parcelRevUnit;

  const rideRevUnit = (input.avg_ride_fare * input.ride_commission_pct) / 100;
  const rideCaptainUnit = input.avg_ride_fare - rideRevUnit;

  const marketRevUnit = (input.avg_market_price * input.market_commission_pct) / 100;
  const marketSellerUnit = input.avg_market_price - marketRevUnit;

  const blendedGmv =
    sShare * storeGmvUnit + pShare * input.avg_parcel_fee + rShare * input.avg_ride_fare + mShare * input.avg_market_price;
  const blendedRev = sShare * storeRevUnit + pShare * parcelRevUnit + rShare * rideRevUnit + mShare * marketRevUnit;
  const blendedMerchantPayable = sShare * storeMerchantUnit + mShare * marketSellerUnit;
  const blendedCaptainPayable = sShare * storeCaptainUnit + pShare * parcelCaptainUnit + rShare * rideCaptainUnit;
  const contributionPerTx = blendedRev - input.variable_cost_per_tx;

  const buildScenario = (label: 'conservative' | 'moderate' | 'optimistic', orders: number, fixedCost: number) => {
    const gmv = orders * blendedGmv;
    const revenue = orders * blendedRev;
    const variableCosts = orders * input.variable_cost_per_tx;
    const contributionMargin = revenue - variableCosts;
    const netProfit = contributionMargin - fixedCost;
    const breakEvenOrders = contributionPerTx > 0 ? Math.ceil(fixedCost / contributionPerTx) : 0;

    return {
      scenario: label,
      orders,
      gmv: Number(gmv.toFixed(0)),
      merchant_payables: Number((orders * blendedMerchantPayable).toFixed(0)),
      captain_payables: Number((orders * blendedCaptainPayable).toFixed(0)),
      platform_revenue: Number(revenue.toFixed(0)),
      variable_costs: Number(variableCosts.toFixed(0)),
      contribution_margin: Number(contributionMargin.toFixed(0)),
      fixed_costs: Number(fixedCost.toFixed(0)),
      break_even_orders: breakEvenOrders,
      net_profit: Number(netProfit.toFixed(0)),
    };
  };

  return {
    unit_economics: {
      blended_gmv: Number(blendedGmv.toFixed(2)),
      blended_platform_revenue: Number(blendedRev.toFixed(2)),
      variable_cost_per_tx: input.variable_cost_per_tx,
      contribution_margin_per_tx: Number(contributionPerTx.toFixed(2)),
    },
    scenarios: [
      buildScenario('conservative', input.monthly_orders_conservative, input.fixed_cost_conservative),
      buildScenario('moderate', input.monthly_orders_moderate, input.fixed_cost_moderate),
      buildScenario('optimistic', input.monthly_orders_optimistic, input.fixed_cost_optimistic),
    ],
  };
}
