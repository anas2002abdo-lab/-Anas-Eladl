let refreshInFlight: Promise<boolean> | null = null;

function shouldAttemptRefresh(url: string): boolean {
  const skipPrefixes = [
    '/api/auth/refresh',
    '/api/auth/logout',
    '/api/auth/admin/login',
    '/api/auth/merchant/login',
    '/api/auth/otp/verify',
    '/api/mobile/captain/login',
  ];
  return !skipPrefixes.some((p) => url.startsWith(p));
}

async function tryRefreshCookieSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      return res.ok;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

async function parseResponseBody(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function getPortalContextHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof window === 'undefined') return headers;
  try {
    const custRaw = localStorage.getItem('otlobha_customer_session_v1');
    if (custRaw) {
      const cust = JSON.parse(custRaw);
      if (cust?.id) headers['X-Otlobha-Customer-Id'] = String(cust.id);
    }
  } catch {
    // ignore
  }
  try {
    const merRaw = localStorage.getItem('otlobha_merchant_session_v1');
    if (merRaw) {
      const mer = JSON.parse(merRaw);
      if (mer?.id) headers['X-Otlobha-Merchant-Id'] = String(mer.id);
    }
  } catch {
    // ignore
  }
  try {
    const capRaw = localStorage.getItem('otlobha_captain_session_v1');
    if (capRaw) {
      const cap = JSON.parse(capRaw);
      if (cap?.id) headers['X-Otlobha-Captain-Id'] = String(cap.id);
    }
  } catch {
    // ignore
  }
  return headers;
}

async function request<T>(url: string, options?: RequestInit, retryOn401 = true): Promise<T> {
  const res = await fetch(url, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getPortalContextHeaders(),
      ...(options?.headers || {}),
    },
  });
  if (res.status === 401 && retryOn401 && shouldAttemptRefresh(url)) {
    const refreshed = await tryRefreshCookieSession();
    if (refreshed) {
      return request<T>(url, options, false);
    }
  }
  const data = await parseResponseBody(res);
  if (!res.ok) {
    throw new Error(data.error || 'حدث خطأ أثناء الاتصال بالخادم');
  }
  return data as T;
}

export const api = {
  getBootstrapStatus: () => request<{ ok: boolean; super_admin_configured: boolean }>('/api/auth/bootstrap-status'),
  adminLogin: (email: string, password: string) =>
    request<{ ok: boolean; user: any; tokens?: { access_token: string; refresh_token: string; token_type: string; expires_in: number } }>(
      '/api/auth/admin/login',
      {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }
    ),
  getMe: () => request<{ ok: boolean; authenticated: boolean; user: any }>('/api/auth/me'),
  refreshSession: (refresh_token?: string) =>
    request<{ ok: boolean; user: any; tokens?: { access_token: string; refresh_token: string; token_type: string; expires_in: number } }>(
      '/api/auth/refresh',
      {
        method: 'POST',
        body: JSON.stringify(refresh_token ? { refresh_token } : {}),
      }
    ),
  logoutSession: () =>
    request<{ ok: boolean; revoked: boolean }>('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  getOverview: () => request<Record<string, number>>('/api/dashboard/overview'),
  getServices: () => request<any[]>('/api/services'),
  updateService: (key: string, body: Record<string, unknown>) =>
    request('/api/services/' + key, { method: 'PATCH', body: JSON.stringify(body) }),
  getZones: () => request<any[]>('/api/zones'),
  createZone: (body: Record<string, unknown>) =>
    request('/api/zones', { method: 'POST', body: JSON.stringify(body) }),
  updateZone: (id: string, body: Record<string, unknown>) =>
    request('/api/zones/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  getPricing: () => request<any[]>('/api/pricing'),
  updatePricing: (id: string, body: Record<string, unknown>) =>
    request('/api/pricing/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  simulatePrice: (body: Record<string, unknown>) =>
    request<any>('/api/pricing/simulate', { method: 'POST', body: JSON.stringify(body) }),
  getDispatchConfig: () => request<any>('/api/dispatch-config'),
  updateDispatchConfig: (body: Record<string, unknown>) =>
    request('/api/dispatch-config', { method: 'PUT', body: JSON.stringify(body) }),
  testDispatch: (body: Record<string, unknown>) =>
    request<any>('/api/dispatch/test', { method: 'POST', body: JSON.stringify(body) }),
  getCaptains: () => request<any[]>('/api/captains'),
  updateCaptainStatus: (id: string, body: Record<string, unknown>) =>
    request('/api/captains/' + id + '/status', { method: 'PATCH', body: JSON.stringify(body) }),
  updateCaptainCredentials: (id: string, body: { username?: string; password?: string }) =>
    request<{ ok: boolean; username: string }>('/api/captains/' + id + '/credentials', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  reviewCaptainDoc: (docId: string, body: Record<string, unknown>) =>
    request('/api/captain-docs/' + docId, { method: 'PATCH', body: JSON.stringify(body) }),
  getMerchants: (approvedOnly?: boolean) =>
    request<any[]>(`/api/merchants${approvedOnly ? '?approved_only=1' : ''}`),
  getMerchantDetail: (id: string) => request<any>('/api/merchants/' + encodeURIComponent(id)),
  updateMerchant: (id: string, body: Record<string, unknown>) =>
    request('/api/merchants/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteMerchant: (id: string) =>
    request<{ ok: boolean; id: string; deleted_business_name: string }>('/api/merchants/' + id, {
      method: 'DELETE',
    }),
  getOrders: () => request<any[]>('/api/orders'),
  deleteOrder: (id: string) =>
    request<{ ok: boolean; id: string; message?: string }>('/api/orders/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),
  createOrder: (body: Record<string, unknown>) =>
    request<{ id: string; order_number: string }>('/api/orders', { method: 'POST', body: JSON.stringify(body) }),
  createOrderBundle: (body: Record<string, unknown>) =>
    request<{
      ok: boolean;
      id: string;
      order_number: string;
      store_count: number;
      order: any;
      orders: any[];
    }>('/api/orders/bundle', { method: 'POST', body: JSON.stringify(body) }),
  merchantOrderAction: (id: string, body: Record<string, unknown>) =>
    request<any>('/api/orders/' + id + '/merchant-action', { method: 'PATCH', body: JSON.stringify(body) }),
  getCategories: (scope?: string) => request<any[]>(`/api/categories${scope ? `?scope=${scope}` : ''}`),
  createCategory: (body: Record<string, unknown>) =>
    request<{ id: string }>('/api/categories', { method: 'POST', body: JSON.stringify(body) }),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    request('/api/categories/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (id: string) => request('/api/categories/' + id, { method: 'DELETE' }),
  getProducts: (merchantId?: string) =>
    request<any[]>(`/api/products${merchantId ? `?merchant_id=${merchantId}` : ''}`),
  createProduct: (body: Record<string, unknown>) =>
    request<{ id: string }>('/api/products', { method: 'POST', body: JSON.stringify(body) }),
  updateProduct: (id: string, body: Record<string, unknown>) =>
    request('/api/products/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteProduct: (id: string) => request('/api/products/' + id, { method: 'DELETE' }),
  getMarket: () => request<any[]>('/api/market'),
  createMarketListing: (body: Record<string, unknown>) =>
    request<{ id: string }>('/api/market', { method: 'POST', body: JSON.stringify(body) }),
  updateMarketListing: (id: string, body: Record<string, unknown>) =>
    request('/api/market/' + id, { method: 'PUT', body: JSON.stringify(body) }),
  deleteMarketListing: (id: string) => request('/api/market/' + id, { method: 'DELETE' }),
  moderateMarket: (id: string, body: Record<string, unknown>) =>
    request('/api/market/' + id + '/moderate', { method: 'PATCH', body: JSON.stringify(body) }),
  getFinance: () => request<any>('/api/finance/ledger'),
  adjustWallet: (body: Record<string, unknown>) =>
    request('/api/finance/wallet-adjust', { method: 'POST', body: JSON.stringify(body) }),
  updateSettlement: (id: string, body: Record<string, unknown>) =>
    request('/api/finance/settlements/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  getCoupons: () => request<any[]>('/api/coupons'),
  createCoupon: (body: Record<string, unknown>) =>
    request('/api/coupons', { method: 'POST', body: JSON.stringify(body) }),
  toggleCoupon: (id: string, is_active: boolean) =>
    request('/api/coupons/' + id, { method: 'PATCH', body: JSON.stringify({ is_active }) }),
  getComplaints: () => request<any[]>('/api/complaints'),
  updateComplaint: (id: string, body: Record<string, unknown>) =>
    request('/api/complaints/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  getRoles: () => request<any[]>('/api/roles'),
  getAdminUsers: () => request<import('../shared/types.ts').AdminUserDetail[]>('/api/admin/users'),
  createAdminUser: (body: {
    email: string;
    password?: string;
    full_name: string;
    role_code: string;
    permissions?: string[] | null;
  }) =>
    request<{ ok: boolean; user: import('../shared/types.ts').AdminUserDetail }>('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAdminUser: (
    id: string,
    body: {
      full_name?: string;
      email?: string;
      password?: string;
      role_code?: string;
      permissions?: string[] | null;
      is_active?: boolean;
    }
  ) =>
    request<{ ok: boolean; user: import('../shared/types.ts').AdminUserDetail }>(
      '/api/admin/users/' + encodeURIComponent(id),
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    ),
  deleteAdminUser: (id: string) =>
    request<{ ok: boolean; id: string; message?: string }>('/api/admin/users/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),
  getAuditLogs: () => request<any[]>('/api/audit-logs'),
  getFinancialModel: () => request<any>('/api/financial-model'),
  updateFinancialModel: (body: Record<string, unknown>) =>
    request<any>('/api/financial-model', { method: 'PUT', body: JSON.stringify(body) }),
  getPaymentSettings: () => request<import('../shared/types.ts').PaymentSettings>('/api/payment-settings'),
  updatePaymentSettings: (body: Partial<import('../shared/types.ts').PaymentSettings>) =>
    request<{ ok: boolean; settings: import('../shared/types.ts').PaymentSettings }>('/api/payment-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getCustomerBootstrap: () => request<any>('/api/mobile/customer/bootstrap'),
  getCustomerGuestBootstrap: () => request<any>('/api/mobile/customer/guest-bootstrap'),
  requestCustomerRegisterOtp: async (body: {
    full_name: string;
    email: string;
    phone?: string;
    password: string;
  }) => {
    try {
      const res = await request<{ ok: boolean; email: string; message?: string; expires_in_sec: number }>(
        '/api/mobile/customer/register/request-otp',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
      return { ...res, auth_flow: 'register_otp' as const };
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('404') || msg.includes('غير موجود')) {
        const fallback = await request<{ ok: boolean; email: string; message?: string; expires_in_sec: number }>(
          '/api/auth/otp/request',
          {
            method: 'POST',
            body: JSON.stringify({ email: body.email, role: 'customer' }),
          }
        );
        return { ...fallback, auth_flow: 'legacy_otp' as const };
      }
      throw err;
    }
  },
  registerCustomer: async (body: {
    full_name: string;
    email: string;
    phone?: string;
    password: string;
    code: string;
    address_landmark?: string;
    default_zone_id?: string;
  }) => {
    try {
      return await request<{ ok: boolean; role: 'customer'; user: any; tokens?: any }>(
        '/api/mobile/customer/register',
        {
          method: 'POST',
          body: JSON.stringify(body),
        }
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      if (msg.includes('404') || msg.includes('غير موجود')) {
        return request<{ ok: boolean; role: 'customer'; user: any; tokens?: any }>('/api/auth/otp/verify', {
          method: 'POST',
          body: JSON.stringify({
            email: body.email,
            code: body.code,
            role: 'customer',
            full_name: body.full_name,
            phone: body.phone,
            password: body.password,
          }),
        });
      }
      throw err;
    }
  },
  loginCustomer: (identifier: string, password: string) =>
    request<{ ok: boolean; role: 'customer'; user: any; tokens?: any }>('/api/mobile/customer/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  requestCustomerPasswordReset: (email: string) =>
    request<{ ok: boolean; email: string; message?: string; expires_in_sec: number }>(
      '/api/mobile/customer/forgot-password/request',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    ),
  resetCustomerPassword: (email: string, code: string, new_password: string) =>
    request<{ ok: boolean; message?: string; role: 'customer'; user: any; tokens?: any }>(
      '/api/mobile/customer/forgot-password/reset',
      {
        method: 'POST',
        body: JSON.stringify({ email, code, new_password }),
      }
    ),
  updateCustomerProfile: (body: {
    full_name?: string;
    phone?: string;
    address_landmark?: string;
    default_zone_id?: string;
  }) =>
    request<{ ok: boolean; customer: any }>('/api/mobile/customer/me', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  requestRide: (body: Record<string, unknown>) =>
    request<any>('/api/mobile/rides', { method: 'POST', body: JSON.stringify(body) }),
  getParcels: () => request<any[]>('/api/mobile/parcels'),
  requestParcel: (body: Record<string, unknown>) =>
    request<any>('/api/mobile/parcels', { method: 'POST', body: JSON.stringify(body) }),
  registerCaptainMobile: (body: Record<string, unknown>) =>
    request<any>('/api/mobile/captain/register', { method: 'POST', body: JSON.stringify(body) }),
  loginCaptainMobile: (username: string, password: string) =>
    request<{ captain: any }>('/api/mobile/captain/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  requestEmailOtp: (email: string, role: 'customer' | 'merchant') =>
    request<{
      ok: boolean;
      email: string;
      role: 'customer' | 'merchant';
      message?: string;
      expires_in_sec: number;
      delivery_channel: 'smtp' | 'sandbox';
      demo_otp?: string;
    }>('/api/auth/otp/request', {
      method: 'POST',
      body: JSON.stringify({ email, role }),
    }),
  verifyEmailOtp: (
    email: string,
    code: string,
    role: 'customer' | 'merchant',
    full_name?: string,
    phone?: string
  ) =>
    request<{ ok: boolean; role: 'customer' | 'merchant'; user: any }>('/api/auth/otp/verify', {
      method: 'POST',
      body: JSON.stringify({ email, code, role, full_name, phone }),
    }),
  requestMerchantRegOtp: (email: string) =>
    request<{
      ok: boolean;
      email: string;
      message?: string;
      expires_in_sec: number;
      delivery_channel: 'smtp' | 'sandbox';
      demo_otp?: string;
    }>('/api/auth/merchant/register/request-otp', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  verifyMerchantRegOtp: (email: string, code: string) =>
    request<{ ok: boolean; email: string; email_verification_token: string }>(
      '/api/auth/merchant/register/verify-otp',
      {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      }
    ),
  registerMerchant: (body: Record<string, unknown>) =>
    request<{ ok: boolean; merchant: any; message?: string }>('/api/auth/merchant/register', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  loginMerchant: (email: string, password: string) =>
    request<{ ok: boolean; role: 'merchant'; user: any }>('/api/auth/merchant/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  setCaptainAvailability: (id: string, availability_status: string) =>
    request('/api/mobile/captain/' + id + '/availability', {
      method: 'PATCH',
      body: JSON.stringify({ availability_status }),
    }),
  completeParcelWithOtp: (captainId: string, delivery_id: string, otp: string) =>
    request<any>('/api/mobile/captain/' + captainId + '/complete-parcel', {
      method: 'POST',
      body: JSON.stringify({ delivery_id, otp }),
    }),
  getNotifications: (targetApp?: string) =>
    request<any[]>(`/api/notifications${targetApp ? `?target_app=${targetApp}` : ''}`),
  sendNotification: (body: Record<string, unknown>) =>
    request<{ id: string; fcm_topic: string; audience_count: number }>('/api/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMobileNotifications: (app: 'customer' | 'captain' | 'merchant', recipientId?: string) =>
    request<any[]>(`/api/mobile/notifications?app=${app}${recipientId ? `&recipient_id=${recipientId}` : ''}`),
  markNotificationRead: (id: string) =>
    request('/api/mobile/notifications/' + id + '/read', { method: 'PATCH' }),
  validateCoupon: (code: string, subtotal: number, service_type: string) =>
    request<{ ok: boolean; code: string; discount_amount: number }>('/api/mobile/coupons/validate', {
      method: 'POST',
      body: JSON.stringify({ code, subtotal, service_type }),
    }),
  updateCaptainOrderStatus: (
    captainId: string,
    order_id: string,
    status: string,
    extra?: { delivery_proof_image_url?: string; store_section_id?: string; merchant_id?: string }
  ) =>
    request<{
      ok: boolean;
      all_stores_picked_up?: boolean;
      picked_up_count?: number;
      total_stores_count?: number;
      primary_order_id?: string;
      delivered_count?: number;
    }>('/api/mobile/captain/' + captainId + '/order-status', {
      method: 'PATCH',
      body: JSON.stringify({ order_id, status, ...(extra || {}) }),
    }),
  updateCaptainTripStatus: (captainId: string, trip_id: string, status: string) =>
    request<{
      ok: boolean;
      trip?: any;
      deleted?: boolean;
      fare?: number;
      fee_10pct?: number;
      penalty_10pct?: number;
      rating_prompt?: any;
    }>('/api/mobile/captain/' + captainId + '/trip-status', {
      method: 'PATCH',
      body: JSON.stringify({ trip_id, status }),
    }),
  getCaptainSettlements: (captainId: string) =>
    request<{ settlements: any[] }>('/api/mobile/captain/' + captainId + '/settlements'),
  requestCaptainSettlement: (captainId: string, amount: number, payout_method: string) =>
    request<{ id: string; status: string }>('/api/mobile/captain/' + captainId + '/settlement-request', {
      method: 'POST',
      body: JSON.stringify({ amount, payout_method }),
    }),
  getOrderChat: (orderId: string) =>
    request<{ order: any; messages: any[] }>('/api/orders/' + orderId + '/chat'),
  sendOrderChatMessage: (orderId: string, body: Record<string, unknown>) =>
    request<{ message: any; delivery_proof_image_url: string | null }>('/api/orders/' + orderId + '/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getTrips: () => request<any[]>('/api/trips'),
  getNearbyCaptains: (lat: number, lng: number, vehicleType?: string) =>
    request<any[]>(
      `/api/mobile/captains/nearby?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}${
        vehicleType ? `&vehicle_type=${encodeURIComponent(vehicleType)}` : ''
      }`
    ),
  updateCaptainLocation: (captainId: string, lat: number, lng: number) =>
    request<{ ok: boolean; lat: number; lng: number; updated_at: string }>(
      '/api/mobile/captain/' + captainId + '/location',
      {
        method: 'PATCH',
        body: JSON.stringify({ lat, lng }),
      }
    ),
  getOrderTracking: (orderId: string) =>
    request<{ order: any; captain_gps: any }>('/api/orders/' + orderId + '/tracking'),
  getRideTracking: (tripId: string) =>
    request<{ trip: any; captain_gps: any }>('/api/mobile/rides/' + tripId + '/tracking'),
  getRideChat: (tripId: string) =>
    request<{ trip: any; messages: any[] }>('/api/rides/' + tripId + '/chat'),
  sendRideChatMessage: (tripId: string, body: Record<string, unknown>) =>
    request<{ message: any }>('/api/rides/' + tripId + '/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateTripFare: (
    tripId: string,
    body: { final_fare: number; updated_by_role: 'customer' | 'captain' | 'admin'; updated_by_name: string }
  ) =>
    request<{ ok: boolean; final_fare: number; fee_10pct: number; trip: any; message: any }>(
      '/api/trips/' + tripId + '/fare',
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    ),
  updateTripCaptain: (tripId: string, preferred_captain_id: string | null) =>
    request<{ ok: boolean; preferred_captain_id: string | null; preferred_captain_name: string | null; trip: any }>(
      '/api/trips/' + tripId + '/captain',
      {
        method: 'PATCH',
        body: JSON.stringify({ preferred_captain_id }),
      }
    ),
  finishTrip: (
    tripId: string,
    body: { actor_role: 'customer' | 'captain' | 'admin'; actor_name: string; captain_id?: string | null }
  ) =>
    request<{
      ok: boolean;
      deleted: boolean;
      fare: number;
      fee_10pct: number;
      captain_id: string | null;
      rating_prompt: any;
    }>('/api/trips/' + tripId + '/finish', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  cancelTrip: (
    tripId: string,
    body: { actor_role: 'customer' | 'captain' | 'admin'; actor_name: string; captain_id?: string | null; reason?: string }
  ) =>
    request<{
      ok: boolean;
      deleted: boolean;
      fare: number;
      penalty_10pct: number;
      cancelled_by: string;
    }>('/api/trips/' + tripId + '/cancel', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getRatings: (params?: { captain_id?: string; status?: string; ref_type?: string }) => {
    const qs = new URLSearchParams();
    if (params?.captain_id) qs.set('captain_id', params.captain_id);
    if (params?.status) qs.set('status', params.status);
    if (params?.ref_type) qs.set('ref_type', params.ref_type);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any[]>(`/api/ratings${suffix}`);
  },
  getPendingRatings: (customerName?: string) =>
    request<any[]>(
      `/api/mobile/ratings/pending${customerName ? `?customer_name=${encodeURIComponent(customerName)}` : ''}`
    ),
  submitRating: (body: {
    rating_id?: string;
    captain_id?: string;
    customer_name?: string;
    customer_phone?: string;
    ref_type?: 'trip' | 'order' | 'parcel';
    ref_id?: string;
    ref_number?: string;
    final_amount?: number;
    rating: number;
    comment?: string;
  }) =>
    request<{ ok: boolean; rating: any; captain_rating_avg: number }>('/api/ratings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getAdminCustomers: () => request<any[]>('/api/admin/customers'),
  getAdminCustomerDetail: (id: string) => request<any>('/api/admin/customers/' + encodeURIComponent(id)),
  adminUpdateOrder: (orderId: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; order: any }>('/api/admin/orders/' + encodeURIComponent(orderId), {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  updateCustomerLocation: (body: {
    customer_id?: string;
    email?: string;
    phone?: string;
    full_name?: string;
    lat: number;
    lng: number;
    address_landmark?: string;
    default_zone_id?: string;
  }) =>
    request<{ ok: boolean; updated: boolean; lat: number; lng: number }>('/api/mobile/customer/location', {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  importProductsExcel: (body: {
    merchant_id: string;
    rows: Array<{
      product_code?: string;
      name_ar: string;
      price: number | string;
      category_name?: string;
      image_url?: string;
    }>;
  }) =>
    request<{
      ok: boolean;
      created: number;
      updated: number;
      skipped: number;
      categories_created: number;
      errors: string[];
    }>('/api/products/import-excel', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getInvoiceDesign: () => request<any>('/api/invoice-design'),
  updateInvoiceDesign: (body: Record<string, unknown>) =>
    request<{ ok: boolean; config: any }>('/api/invoice-design', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  getPosInvoices: (captainId?: string) =>
    request<any[]>(`/api/pos/invoices${captainId ? `?captain_id=${encodeURIComponent(captainId)}` : ''}`),
  createPosInvoice: (body: {
    captain_id: string;
    order_id?: string | null;
    customer_name?: string;
    customer_phone?: string;
    items: Array<{
      product_id?: string;
      product_code: string;
      name_ar: string;
      category_name?: string;
      unit_price: number;
      qty: number;
    }>;
    delivery_fee?: number;
    discount_amount?: number;
    payment_method?: string;
    printed_via?: 'bluetooth' | 'thermal_iframe' | 'saved_only';
  }) =>
    request<{ ok: boolean; invoice: any }>('/api/pos/invoices', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSupportTickets: (params?: { customer_email?: string; customer_id?: string; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.customer_email) qs.set('customer_email', params.customer_email);
    if (params?.customer_id) qs.set('customer_id', params.customer_id);
    if (params?.status) qs.set('status', params.status);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any[]>(`/api/support/tickets${suffix}`);
  },
  createSupportTicket: (body: {
    customer_id?: string;
    customer_name: string;
    customer_phone?: string;
    customer_email?: string;
    subject: string;
    category?: string;
    message_text: string;
  }) =>
    request<{ ok: boolean; ticket: any; messages: any[] }>('/api/support/tickets', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getSupportMessages: (ticketId: string) =>
    request<{ ticket: any; messages: any[] }>(`/api/support/tickets/${encodeURIComponent(ticketId)}/messages`),
  sendSupportMessage: (
    ticketId: string,
    body: { sender_role: 'customer' | 'admin'; sender_name: string; message_text: string }
  ) =>
    request<{ ok: boolean; message: any; ticket: any }>(
      `/api/support/tickets/${encodeURIComponent(ticketId)}/messages`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
  updateSupportTicketStatus: (ticketId: string, status: 'open' | 'in_progress' | 'resolved' | 'closed') =>
    request<{ ok: boolean; ticket: any }>(`/api/support/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

