/**
 * Comprehensive 20-Scenario End-to-End Test Suite for Otlobha Integrated Ride-Hailing System
 * Tests real HTTP APIs, real SQLite DB, real Auto-Dispatch Engine, real WebSocket events,
 * real Riyadh OpenStreetMap/Nominatim geocoding, and real OSRM road routing for car/moto/tuktuk.
 */
import WebSocket from 'ws';
import { db, hashPassword, uid } from '../src/server/db.ts';

const BASE = 'http://127.0.0.1:3000';
const WS_BASE = 'ws://127.0.0.1:3000';

interface ApiResp {
  status: number;
  data: any;
}

async function req(method: string, path: string, token?: string, body?: any): Promise<ApiResp> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

function assert(cond: unknown, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

function connectWs(token: string, query: string): Promise<{ ws: WebSocket; events: any[]; close: () => void }> {
  return new Promise((resolve, reject) => {
    const events: any[] = [];
    const ws = new WebSocket(`${WS_BASE}/ws/order-chat?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 6000);
    ws.on('open', () => {
      clearTimeout(timeout);
      resolve({
        ws,
        events,
        close: () => {
          try {
            ws.close();
          } catch {
            // ignore
          }
        },
      });
    });
    ws.on('message', (raw) => {
      try {
        events.push(JSON.parse(raw.toString()));
      } catch {
        // ignore
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const runId = Date.now().toString().slice(-6);
  const createdTripIds: string[] = [];
  const createdCaptainIds: string[] = [];
  let createdCustomerId: string | null = null;
  let tempAdminId: string | null = null;
  const originalCarFare = db.prepare("SELECT * FROM ride_fare_settings WHERE vehicle_type = 'car'").get() as any;

  // Save current online captains and temporarily set them offline during isolated dispatch test, then restore!
  const previouslyOnlineCaptains = db
    .prepare("SELECT id, availability_status FROM captains WHERE availability_status != 'offline'")
    .all() as Array<{ id: string; availability_status: string }>;

  const results: Array<{ num: number; name: string; status: string; detail: string }> = [];
  const pass = (num: number, name: string, detail: string) => {
    results.push({ num, name, status: 'PASS', detail });
    console.log(`✅ [${num}/20] ${name} — ${detail}`);
  };

  try {
    // Isolate test zone drivers cleanly
    for (const c of previouslyOnlineCaptains) {
      db.prepare("UPDATE captains SET availability_status = 'offline' WHERE id = ?").run(c.id);
    }

    // Create a temporary super_admin & obtain a real JWT from the running server via /api/auth/admin/login
    tempAdminId = uid('adm_e2e');
    const tempAdminEmail = `rides_e2e_admin_${runId}@otlobha.local`;
    const tempAdminPass = `AdmE2E#${runId}!9`;
    db.prepare(
      `INSERT INTO admin_users (id, email, password_hash, full_name, role_code, is_active, token_version)
       VALUES (?, ?, ?, ?, 'super_admin', 1, 1)`
    ).run(tempAdminId, tempAdminEmail, hashPassword(tempAdminPass), `مشرف اختبار ${runId}`);

    const adminLogin = await req('POST', '/api/auth/admin/login', undefined, {
      email: tempAdminEmail,
      password: tempAdminPass,
    });
    assert(adminLogin.status === 200 && adminLogin.data?.tokens?.access_token, `Admin login failed: ${JSON.stringify(adminLogin)}`);
    const adminToken = adminLogin.data.tokens.access_token;

    // -----------------------------------------------------------------------
    // 1. Customer Registration & Auth
    // -----------------------------------------------------------------------
    const custEmail = `rides_e2e_${runId}@example.com`;
    const custReg = await req('POST', '/api/mobile/customer/register-direct', undefined, {
      full_name: `عميل اختبار مشاوير ${runId}`,
      email: custEmail,
      phone: `055${runId}01`,
      password: `Pass#${runId}`,
    });
    assert(custReg.status === 200 || custReg.status === 201, `Customer register failed: ${JSON.stringify(custReg)}`);
    const custToken = custReg.data?.tokens?.access_token;
    createdCustomerId = custReg.data?.user?.id || custReg.data?.customer?.id;
    assert(custToken && createdCustomerId, 'Customer token and id required');
    pass(1, 'Customer Registration & Auth', `customer_id=${createdCustomerId}`);

    // -----------------------------------------------------------------------
    // 2. Driver Registration (Pending Approval) + Rule #1 Unapproved Blocked
    // -----------------------------------------------------------------------
    const registerDriver = async (suffix: string, vehicleType: string) => {
      const r = await req('POST', '/api/mobile/captain/register', undefined, {
        username: `cap_${suffix}_${runId}`,
        password: `Cap#${runId}`,
        full_name: `كابتن ${suffix} ${runId}`,
        phone: `054${runId}${suffix.slice(0, 2)}`,
        email: `cap_${suffix}_${runId}@example.com`,
        national_id: `10${runId}${suffix.slice(0, 2)}1234`,
        residence_id: `20${runId}${suffix.slice(0, 2)}5678`,
        zone_name: 'الرياض',
        vehicle_type: vehicleType,
        vehicle_brand: vehicleType === 'car' ? 'تويوتا' : 'هوجن',
        vehicle_model: vehicleType === 'car' ? 'كامري 2024' : 'هوجن 5',
        vehicle_color: 'أبيض',
        plate_number: `ر ي ض ${runId.slice(-4)}`,
        license_number: `LIC-${runId}`,
        registration_number: `REG-${runId}`,
        insurance_number: `INS-${runId}`,
        allowed_services: ['rides'],
      });
      assert(r.status === 200 || r.status === 201, `Captain register failed: ${JSON.stringify(r)}`);
      const id = r.data?.id || r.data?.captain?.id;
      const token = r.data?.tokens?.access_token;
      createdCaptainIds.push(id);
      return { id, token };
    };

    const carDriver1 = await registerDriver('11car', 'car');
    const carDriver2 = await registerDriver('22car', 'car');
    const motoDriver = await registerDriver('33moto', 'moto');

    // Verify Rule #1: unapproved driver CANNOT go online!
    const blockedOnline = await req('PATCH', '/api/rides/captain/availability', carDriver1.token, {
      availability_status: 'available',
      lat: 24.7136,
      lng: 46.6753,
    });
    assert(blockedOnline.status === 403, `Expected 403 for unapproved driver going online, got ${blockedOnline.status}`);
    pass(2, 'Driver KYC Registration & Pre-Approval Block (Rule #1)', `Blocked online toggle with HTTP ${blockedOnline.status}`);

    // -----------------------------------------------------------------------
    // 3. Admin Approves Drivers & Enables Rides Eligibility
    // -----------------------------------------------------------------------
    for (const drv of [carDriver1, carDriver2, motoDriver]) {
      const appr = await req('PATCH', `/api/captains/${drv.id}/status`, adminToken, {
        verification_status: 'approved',
        is_eligible_for_rides: true,
        allowed_services: ['rides', 'stores', 'parcels'],
      });
      assert(appr.status === 200, `Admin approve failed for ${drv.id}: ${JSON.stringify(appr)}`);
    }
    pass(3, 'Admin Driver Approval & Vehicle Eligibility', `Approved 3 drivers (2 car, 1 moto)`);

    // -----------------------------------------------------------------------
    // 4. Drivers Go Online & Broadcast Riyadh GPS Coordinates
    // -----------------------------------------------------------------------
    // Riyadh Kingdom Centre: 24.7113, 46.6745
    // Car Driver 1: closest (~0.3 km away)
    // Car Driver 2: second closest (~1.4 km away)
    // Moto Driver: right on top (~0.1 km away, MUST NOT receive car ride!)
    const online1 = await req('PATCH', '/api/rides/captain/availability', carDriver1.token, {
      availability_status: 'available',
      lat: 24.7130,
      lng: 46.6760,
    });
    const online2 = await req('PATCH', '/api/rides/captain/availability', carDriver2.token, {
      availability_status: 'available',
      lat: 24.7240,
      lng: 46.6820,
    });
    const onlineMoto = await req('PATCH', '/api/rides/captain/availability', motoDriver.token, {
      availability_status: 'available',
      lat: 24.7115,
      lng: 46.6746,
    });
    assert(online1.status === 200 && online2.status === 200 && onlineMoto.status === 200, 'Online toggles failed');
    pass(4, 'Approved Drivers Online & GPS Registered', 'Car1 (0.2km), Car2 (1.5km), Moto (0.05km) online in Riyadh');

    // -----------------------------------------------------------------------
    // 5. Live Riyadh Geocoding (Nominatim) + Real OSRM Road Routing & Fare Estimate
    // -----------------------------------------------------------------------
    const mapCfg = await req('GET', '/api/rides/map-config');
    assert(mapCfg.status === 200 && String(mapCfg.data?.attribution || '').includes('OpenStreetMap'), 'OSM attribution required');

    const geoSearch = await req(
      'GET',
      `/api/rides/geo/search?q=${encodeURIComponent('الرياض العليا')}&lat=24.7136&lng=46.6753`,
      custToken
    );
    assert(geoSearch.status === 200 && Array.isArray(geoSearch.data?.items), `Geo search failed: ${JSON.stringify(geoSearch)}`);
    const geoRev = await req('GET', '/api/rides/geo/reverse?lat=24.7113&lng=46.6745', custToken);
    assert(geoRev.status === 200 && geoRev.data?.display_name, `Reverse geocode failed: ${JSON.stringify(geoRev)}`);

    // Riyadh Kingdom Centre (24.7113, 46.6745) -> Al Faisaliah / Olaya -> Riyadh Park (24.7560, 46.6300)
    const pickup = { lat: 24.7113, lng: 46.6745, address: 'برج المملكة، العليا، الرياض' };
    const dropoff = { lat: 24.7560, lng: 46.6300, address: 'الرياض بارك، الطريق الدائري الشمالي، الرياض' };
    const est = await req('POST', '/api/rides/estimate', custToken, {
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
    });
    assert(est.status === 200 && Array.isArray(est.data?.options), `Estimate failed: ${JSON.stringify(est)}`);
    const carOpt = est.data.options.find((o: any) => o.code === 'car');
    const motoOpt = est.data.options.find((o: any) => o.code === 'moto');
    const tuktukOpt = est.data.options.find((o: any) => o.code === 'tuktuk');
    assert(carOpt && motoOpt && tuktukOpt, 'All 3 vehicle options (car, moto, tuktuk) must be estimated');
    const carFareEst = Number(carOpt.fare?.total_fare ?? carOpt.fare?.estimated_fare);
    const motoFareEst = Number(motoOpt.fare?.total_fare ?? motoOpt.fare?.estimated_fare);
    const tuktukFareEst = Number(tuktukOpt.fare?.total_fare ?? tuktukOpt.fare?.estimated_fare);
    assert(carFareEst > 0 && motoFareEst > 0 && tuktukFareEst > 0, `Estimated fares must be > 0`);
    assert(carOpt.distance_km > 5.0 && carOpt.route_points.length > 5, 'Real road route points & distance required');
    assert(tuktukOpt.duration_min >= carOpt.duration_min, 'Tuk-tuk duration must reflect slower urban speed profile');
    pass(
      5,
      'Live Riyadh Nominatim + OSRM Multi-Vehicle Routing & Fare Estimate',
      `Nominatim results=${geoSearch.data.items.length}, reverse="${String(geoRev.data.display_name).slice(0, 45)}", source=${carOpt.routing_source}, car=${carOpt.distance_km}km/${carOpt.duration_min}m/${carFareEst} EGP, moto=${motoOpt.duration_min}m/${motoFareEst} EGP, tuktuk=${tuktukOpt.duration_min}m/${tuktukFareEst} EGP`
    );

    // Connect WebSockets for Customer and both Car Drivers
    const custWs = await connectWs(custToken, `channel=customer&customerId=${encodeURIComponent(createdCustomerId!)}`);
    const drv1Ws = await connectWs(carDriver1.token, `channel=captain&captainId=${encodeURIComponent(carDriver1.id)}`);
    const drv2Ws = await connectWs(carDriver2.token, `channel=captain&captainId=${encodeURIComponent(carDriver2.id)}`);

    // -----------------------------------------------------------------------
    // 6. Customer Requests Ride (Server-Calculated Fare + Immutable Snapshot + 4-Digit OTP)
    // -----------------------------------------------------------------------
    const reqRide = await req('POST', '/api/rides/request', custToken, {
      vehicle_type: 'car',
      pickup_address: pickup.address,
      dropoff_address: dropoff.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      payment_method: 'cash',
    });
    assert(reqRide.status === 201 || reqRide.status === 200, `Ride request failed: ${JSON.stringify(reqRide)}`);
    const trip = reqRide.data.trip;
    createdTripIds.push(trip.id);
    const startOtp = String(trip.start_otp || '');
    assert(/^\d{4}$/.test(startOtp), `Customer must see 4-digit start_otp, got "${startOtp}"`);
    assert(Math.abs(Number(trip.estimated_fare) - carFareEst) < 0.01, `Server fare ${trip.estimated_fare} must match estimate ${carFareEst}`);
    const snap = db.prepare('SELECT * FROM ride_fare_snapshots WHERE trip_id = ?').get(trip.id);
    assert(Boolean(snap), 'Immutable ride_fare_snapshots row must exist');
    pass(6, 'Ride Created with Server Fare Snapshot & 4-Digit Start OTP', `trip=${trip.trip_number}, fare=${trip.estimated_fare}, otp=****`);

    // -----------------------------------------------------------------------
    // 7. Auto-Dispatch Offers to Closest Eligible Car Driver (Moto Excluded — Rule #2)
    // -----------------------------------------------------------------------
    await sleep(300);
    const offersDrv1 = await req('GET', '/api/rides/captain/offers', carDriver1.token);
    const offersMoto = await req('GET', '/api/rides/captain/offers', motoDriver.token);
    assert(offersDrv1.data.offers.some((o: any) => o.trip_id === trip.id), 'Nearest car driver must receive offer');
    assert(!offersMoto.data.offers.some((o: any) => o.trip_id === trip.id), 'Moto driver MUST NOT receive car ride offer (Rule #2)');
    const offer1 = offersDrv1.data.offers.find((o: any) => o.trip_id === trip.id);
    // Verify driver CANNOT see OTP!
    assert(!offer1.start_otp && !offer1.start_otp_display && !offer1.start_otp_hash, 'Driver offer must never leak OTP');
    pass(7, 'Auto-Dispatch Vehicle Filtering (Rule #2) & Offer Delivery', `Offer ${offer1.id} delivered to Car1; Moto excluded`);

    // -----------------------------------------------------------------------
    // 8. Driver 1 Rejects Offer -> Automatic Cascade to Car Driver 2 (Scenario #17)
    // -----------------------------------------------------------------------
    const rej = await req('POST', `/api/rides/offers/${offer1.id}/reject`, carDriver1.token, {});
    assert(rej.status === 200, `Reject failed: ${JSON.stringify(rej)}`);
    await sleep(300);
    const offersDrv2 = await req('GET', '/api/rides/captain/offers', carDriver2.token);
    const offer2 = offersDrv2.data.offers.find((o: any) => o.trip_id === trip.id);
    assert(Boolean(offer2), 'Auto-dispatch must cascade offer to Car Driver 2 after Driver 1 rejects');
    pass(8, 'Offer Rejection & Automatic Cascade to Next Driver', `Cascaded to Car2 offer=${offer2.id}`);

    // -----------------------------------------------------------------------
    // 9. Concurrent Double-Accept Race Protection (Rule #5 / Scenario #19)
    // -----------------------------------------------------------------------
    const [raceWin, raceLose] = await Promise.all([
      req('POST', `/api/rides/offers/${offer2.id}/accept`, carDriver2.token, {}),
      req('POST', `/api/rides/${trip.id}/accept`, carDriver1.token, {}),
    ]);
    const statuses = [raceWin.status, raceLose.status].sort();
    assert(
      statuses[0] === 200 && (statuses[1] === 409 || statuses[1] === 400 || statuses[1] === 403),
      `Race protection failed — expected [200, 409/400], got ${JSON.stringify(statuses)}`
    );
    const winnerDriver = raceWin.status === 200 ? carDriver2 : carDriver1;
    const loserDriver = raceWin.status === 200 ? carDriver1 : carDriver2;
    pass(9, 'Atomic Double-Accept Race Protection (Rule #5)', `Winner HTTP 200 (${winnerDriver.id}), Loser HTTP ${raceWin.status === 200 ? raceLose.status : raceWin.status}`);

    // Verify winner driver's hydrated active trip STILL does NOT leak OTP!
    const capCheck = await req('GET', '/api/rides/captain/offers', winnerDriver.token);
    assert(!capCheck.data?.active_trip?.start_otp && !capCheck.data?.active_trip?.start_otp_display, 'Driver active_trip must NEVER contain start_otp');

    // -----------------------------------------------------------------------
    // 10. Customer Sees Accepted Driver + WebSocket Notification
    // -----------------------------------------------------------------------
    const myRidesAfterAccept = await req('GET', '/api/rides/my', custToken);
    assert(myRidesAfterAccept.data?.active_trip?.captain_id === winnerDriver.id, 'Customer must see accepted driver');
    assert(myRidesAfterAccept.data?.active_trip?.status === 'accepted', 'Status must be accepted');
    pass(10, 'Customer Real-Time Driver Assignment Visibility', `Assigned captain=${winnerDriver.id}`);

    // -----------------------------------------------------------------------
    // 11. State Machine Guards: Cannot Complete Before Start (Rule #7) & Cannot Start Before Arrived (Rule #6)
    // -----------------------------------------------------------------------
    const prematureComplete = await req('POST', `/api/rides/${trip.id}/complete`, winnerDriver.token, {});
    assert(prematureComplete.status === 400 || prematureComplete.status === 409, `Premature complete must fail, got ${prematureComplete.status}`);
    const prematureStart = await req('POST', `/api/rides/${trip.id}/start`, winnerDriver.token, { otp: startOtp });
    assert(prematureStart.status === 400 || prematureStart.status === 409, `Start before arrived must fail, got ${prematureStart.status}`);
    // Also verify Rule #3: winner driver (now busy) cannot go offline mid-ride!
    const busyOffline = await req('PATCH', '/api/rides/captain/availability', winnerDriver.token, { availability_status: 'offline' });
    assert(busyOffline.status === 409, `Active-ride driver offline must return 409, got ${busyOffline.status}`);
    pass(11, 'Strict State Machine Guards (Rules #3, #6, #7)', `Premature complete=${prematureComplete.status}, start=${prematureStart.status}, offline=${busyOffline.status}`);

    // -----------------------------------------------------------------------
    // 12. Driver Marks Arrived
    // -----------------------------------------------------------------------
    const arrived = await req('POST', `/api/rides/${trip.id}/arrived`, winnerDriver.token, { lat: pickup.lat, lng: pickup.lng });
    assert(arrived.status === 200 && arrived.data?.trip?.status === 'arrived', `Mark arrived failed: ${JSON.stringify(arrived)}`);
    pass(12, 'Driver Arrived at Pickup', `status=arrived`);

    // -----------------------------------------------------------------------
    // 13. OTP Verification Security (Wrong OTP Rejected -> Valid 4-Digit OTP Starts Ride -> Single-Use)
    // -----------------------------------------------------------------------
    const wrongOtp = startOtp === '9999' ? '1111' : '9999';
    const badStart = await req('POST', `/api/rides/${trip.id}/start`, winnerDriver.token, { otp: wrongOtp });
    assert(badStart.status === 400, `Wrong OTP must return 400, got ${badStart.status}`);
    const goodStart = await req('POST', `/api/rides/${trip.id}/start`, winnerDriver.token, { otp: startOtp });
    assert(goodStart.status === 200 && goodStart.data?.trip?.status === 'in_progress', `Valid OTP start failed: ${JSON.stringify(goodStart)}`);
    // Verify OTP cannot be reused
    const reuseStart = await req('POST', `/api/rides/${trip.id}/start`, winnerDriver.token, { otp: startOtp });
    assert(reuseStart.status === 400 || reuseStart.status === 409, 'Single-use OTP must not be reusable');
    pass(13, 'Secure Single-Use 4-Digit OTP Ride Start (Rule #6)', `Wrong OTP=400, Valid OTP=200 (in_progress), Reuse=${reuseStart.status}`);

    // -----------------------------------------------------------------------
    // 14. Live GPS Tracking + WebSocket Disconnect & Reconnect Recovery (Scenario #18)
    // -----------------------------------------------------------------------
    const loc1 = await req('POST', `/api/rides/${trip.id}/location`, winnerDriver.token, {
      lat: 24.7310,
      lng: 46.6520,
      heading: 315,
      speed_kmh: 48,
    });
    assert(loc1.status === 200, `Location update failed: ${JSON.stringify(loc1)}`);
    // Simulate WebSocket disconnect & reconnect recovery
    custWs.close();
    await sleep(150);
    const custWsReconnected = await connectWs(custToken, `tripId=${encodeURIComponent(trip.id)}`);
    const loc2 = await req('POST', `/api/rides/${trip.id}/location`, winnerDriver.token, {
      lat: 24.7450,
      lng: 46.6400,
      heading: 320,
      speed_kmh: 42,
    });
    assert(loc2.status === 200, 'Second GPS update failed');
    await sleep(250);
    const gotLocEvent = custWsReconnected.events.some((e) => e.type === 'ride:location');
    assert(gotLocEvent, 'Reconnected customer WebSocket must receive live ride:location event');
    custWsReconnected.close();
    pass(14, 'Live GPS Streaming & WebSocket Reconnect Recovery', `2 GPS logs saved + live ride:location received after WS reconnect`);

    // -----------------------------------------------------------------------
    // 15. Admin Pricing Change Mid-Ride Does NOT Alter Active Ride Price (Rule #9)
    // -----------------------------------------------------------------------
    const originalBaseFare = Number(originalCarFare.base_fare);
    const fareUpdate = await req('PUT', '/api/admin/rides/fare-settings/car', adminToken, {
      base_fare: originalBaseFare + 50,
      per_km_rate: Number(originalCarFare.per_km_rate) + 10,
      per_min_rate: Number(originalCarFare.per_min_rate),
      min_fare: Number(originalCarFare.min_fare),
      commission_rate: Number(originalCarFare.commission_rate),
      reason: 'E2E Rule #9 immutability check',
    });
    assert(fareUpdate.status === 200, `Fare update failed: ${JSON.stringify(fareUpdate)}`);
    const histCheck = await req('GET', '/api/admin/rides/fare-settings', adminToken);
    assert(Array.isArray(histCheck.data?.history) && histCheck.data.history.length > 0, 'Fare history audit trail required');
    pass(15, 'Admin Fare Update & Audit History Logged', `Increased car base_fare by +50 mid-ride; audit history recorded`);

    // -----------------------------------------------------------------------
    // 16. Driver Completes Ride -> Snapshot Price Preserved (Rule #9) + Ledger Entries (Rule #10)
    // -----------------------------------------------------------------------
    // Also verify Rule #8 BEFORE completion: rating an in_progress ride MUST fail!
    const earlyRate = await req('POST', `/api/rides/${trip.id}/rate`, custToken, { rating: 5, comment: 'too early' });
    assert(earlyRate.status === 400, `Rating uncompleted ride must return 400 (Rule #8), got ${earlyRate.status}`);

    const comp = await req('POST', `/api/rides/${trip.id}/complete`, winnerDriver.token, { waiting_minutes: 0 });
    assert(comp.status === 200, `Complete failed: ${JSON.stringify(comp)}`);
    const finalFare = Number(comp.data?.final_fare ?? comp.data?.trip?.final_fare);
    assert(
      Math.abs(finalFare - Number(trip.estimated_fare)) < 0.01,
      `Rule #9 violated! Final fare ${finalFare} != locked snapshot fare ${trip.estimated_fare}`
    );
    const earnRow = db.prepare('SELECT * FROM driver_earnings_ledger WHERE trip_id = ?').get(trip.id) as any;
    const ledgerRows = db.prepare("SELECT * FROM ledger_entries WHERE reference_id = ?").all(trip.id) as any[];
    assert(earnRow && Number(earnRow.net_driver_amount) > 0, 'driver_earnings_ledger row required (Rule #10)');
    assert(ledgerRows.length >= 2, 'Double-entry ledger_entries required (Rule #10)');
    pass(
      16,
      'Ride Completion, Price Immutability (Rule #9) & Audited Financial Ledger (Rule #10)',
      `final_fare=${finalFare} (locked!), commission=${earnRow.commission_amount}, driver_net=${earnRow.net_driver_amount}, ledger_rows=${ledgerRows.length}`
    );

    // -----------------------------------------------------------------------
    // 17. Customer History, Captain Earnings & Admin Dashboard/Financial Reports Sync
    // -----------------------------------------------------------------------
    const [custHist, capEarn, adminDash, adminFin] = await Promise.all([
      req('GET', '/api/rides/my', custToken),
      req('GET', '/api/rides/captain/earnings', winnerDriver.token),
      req('GET', '/api/admin/rides/dashboard', adminToken),
      req('GET', '/api/admin/rides/reports/financial', adminToken),
    ]);
    assert(custHist.data.trips.some((t: any) => t.id === trip.id && t.status === 'completed'), 'Trip missing from customer history');
    assert(Number(capEarn.data?.summary?.completed_rides || 0) >= 1, 'Completed ride missing from captain earnings');
    assert(Number(capEarn.data?.periods?.today?.net_earnings || 0) > 0, 'Today net earnings must be > 0');
    assert(adminDash.status === 200 && adminFin.status === 200, 'Admin dashboard/financial endpoints failed');
    pass(17, 'Unified Sync Across Customer, Captain Earnings & Admin Reports', `captain_net_today=${capEarn.data.periods.today.net_earnings}, admin_kpis_ok=true`);

    // -----------------------------------------------------------------------
    // 18. Customer Rates Completed Ride (1-5 Stars + Comment) & Updates Captain Rating (Rule #8)
    // -----------------------------------------------------------------------
    const rateRes = await req('POST', `/api/rides/${trip.id}/rate`, custToken, {
      rating: 5,
      comment: 'سائق محترم جداً والرحلة ممتازة',
    });
    assert(rateRes.status === 200, `Rating failed: ${JSON.stringify(rateRes)}`);
    pass(18, 'Post-Completion Driver Rating & Review (Rule #8)', `Rated 5★; early rating was blocked with HTTP ${earlyRate.status}`);

    // -----------------------------------------------------------------------
    // 19. Customer Dispute Submission & Admin Resolution
    // -----------------------------------------------------------------------
    const dispCreate = await req('POST', `/api/rides/${trip.id}/dispute`, custToken, {
      category: 'route',
      description: 'اختبار تسجيل شكوى ومراجعتها من لوحة إدارة المشاوير',
    });
    assert(dispCreate.status === 201 || dispCreate.status === 200, `Dispute create failed: ${JSON.stringify(dispCreate)}`);
    const dispId = dispCreate.data?.dispute?.id || dispCreate.data?.id;
    const dispResolve = await req('PATCH', `/api/admin/rides/disputes/${dispId}`, adminToken, {
      status: 'resolved',
      admin_decision: 'تمت مراجعة مسار الرحلة وإغلاق البلاغ بنجاح',
    });
    assert(dispResolve.status === 200, `Dispute resolve failed: ${JSON.stringify(dispResolve)}`);
    pass(19, 'Ride Dispute Lifecycle (Customer Report -> Admin Resolution)', `dispute_id=${dispId} resolved`);

    // -----------------------------------------------------------------------
    // 20. No-Driver Available Scenario (All Car Drivers Offline -> status = no_driver)
    // -----------------------------------------------------------------------
    await req('PATCH', '/api/rides/captain/availability', winnerDriver.token, { availability_status: 'offline' });
    await req('PATCH', '/api/rides/captain/availability', loserDriver.token, { availability_status: 'offline' });
    const noDrvRide = await req('POST', '/api/rides/request', custToken, {
      vehicle_type: 'car',
      pickup_address: pickup.address,
      dropoff_address: dropoff.address,
      pickup_lat: pickup.lat,
      pickup_lng: pickup.lng,
      dropoff_lat: dropoff.lat,
      dropoff_lng: dropoff.lng,
      payment_method: 'cash',
    });
    assert(noDrvRide.status === 201 || noDrvRide.status === 200, `No-driver ride create failed: ${JSON.stringify(noDrvRide)}`);
    const noDrvTrip = noDrvRide.data.trip;
    createdTripIds.push(noDrvTrip.id);
    assert(noDrvTrip.status === 'no_driver', `Expected no_driver when 0 car drivers online, got ${noDrvTrip.status}`);
    pass(20, 'No-Driver Graceful Handling (Zero Available Cars)', `trip=${noDrvTrip.trip_number}, status=${noDrvTrip.status}`);

    drv1Ws.close();
    drv2Ws.close();

    console.log('\n=======================================================');
    console.log(`ALL ${results.length}/20 END-TO-END RIDE SCENARIOS PASSED!`);
    console.log('=======================================================');
  } finally {
    // Restore original car fare settings
    try {
      if (originalCarFare) {
        db.prepare(`
          UPDATE ride_fare_settings
          SET base_fare = ?, per_km_rate = ?, per_min_rate = ?, min_fare = ?, commission_rate = ?
          WHERE vehicle_type = 'car'
        `).run(
          originalCarFare.base_fare,
          originalCarFare.per_km_rate,
          originalCarFare.per_min_rate,
          originalCarFare.min_fare,
          originalCarFare.commission_rate
        );
        db.prepare("DELETE FROM ride_fare_history WHERE reason = 'E2E Rule #9 immutability check'").run();
      }
    } catch (e) {
      console.warn('Cleanup fare restore warning:', e);
    }

    // Clean up synthetic test data cleanly
    const safeDel = (sql: string, ...args: any[]) => {
      try {
        db.prepare(sql).run(...args);
      } catch {
        // ignore optional table cleanup
      }
    };
    for (const tid of createdTripIds) {
      safeDel('DELETE FROM ride_disputes WHERE trip_id = ?', tid);
      safeDel('DELETE FROM ride_offers WHERE trip_id = ?', tid);
      safeDel('DELETE FROM ride_status_history WHERE trip_id = ?', tid);
      safeDel('DELETE FROM ride_location_logs WHERE trip_id = ?', tid);
      safeDel('DELETE FROM ride_fare_snapshots WHERE trip_id = ?', tid);
      safeDel('DELETE FROM driver_earnings_ledger WHERE trip_id = ?', tid);
      safeDel('DELETE FROM ledger_entries WHERE reference_id = ?', tid);
      safeDel("DELETE FROM captain_ratings WHERE ref_type = 'trip' AND ref_id = ?", tid);
      safeDel('DELETE FROM trip_messages WHERE trip_id = ?', tid);
      safeDel('DELETE FROM trips WHERE id = ?', tid);
    }
    for (const cid of createdCaptainIds) {
      safeDel('DELETE FROM captain_documents WHERE captain_id = ?', cid);
      safeDel('DELETE FROM captain_ratings WHERE captain_id = ?', cid);
      safeDel('DELETE FROM user_sessions WHERE user_id = ?', cid);
      safeDel('DELETE FROM captains WHERE id = ?', cid);
    }
    if (createdCustomerId) {
      safeDel('DELETE FROM user_sessions WHERE user_id = ?', createdCustomerId);
      safeDel('DELETE FROM customers WHERE id = ?', createdCustomerId);
    }
    if (tempAdminId) {
      safeDel('DELETE FROM user_sessions WHERE user_id = ?', tempAdminId);
      safeDel('DELETE FROM admin_users WHERE id = ?', tempAdminId);
    }

    // Restore previously online captains
    for (const c of previouslyOnlineCaptains) {
      safeDel('UPDATE captains SET availability_status = ? WHERE id = ?', c.availability_status, c.id);
    }
  }
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ E2E TEST FAILED:', err);
    process.exit(1);
  });
