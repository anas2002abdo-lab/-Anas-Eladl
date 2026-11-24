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
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
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

async function request<T>(url: string, options?: RequestInit, retryOn401 = true): Promise<T> {
  const method = (options?.method || 'GET').toUpperCase();
  const maxNetworkAttempts = method === 'GET' ? 3 : 1;
  let res: Response | null = null;
  let lastNetworkErr: unknown = null;
  const isAuthEndpoint = url.startsWith('/api/auth/');

  for (let attempt = 1; attempt <= maxNetworkAttempts; attempt++) {
    try {
      res = await fetch(url, {
        credentials: 'include',
        ...(isAuthEndpoint ? { cache: 'no-store' as RequestCache } : {}),
        ...options,
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          ...(options?.headers || {}),
        },
      });
      lastNetworkErr = null;
      break;
    } catch (err) {
      lastNetworkErr = err;
      if (attempt < maxNetworkAttempts) {
        await new Promise((r) => setTimeout(r, attempt * 450));
      }
    }
  }

  if (!res) {
    throw new Error(
      lastNetworkErr instanceof Error && lastNetworkErr.message && lastNetworkErr.message !== 'Failed to fetch'
        ? lastNetworkErr.message
        : 'تعذر الاتصال بالخادم مؤقتًا — يرجى المحاولة مرة أخرى'
    );
  }

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
  deleteCaptain: (id: string) =>
    request<{ ok: boolean; id: string; deleted_name: string }>('/api/captains/' + encodeURIComponent(id), {
      method: 'DELETE',
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
  getOrders: (opts?: { merchantId?: string; scope?: 'merchant' }) => {
    const qs = new URLSearchParams();
    if (opts?.merchantId) qs.set('merchant_id', opts.merchantId);
    if (opts?.scope) qs.set('scope', opts.scope);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any[]>(`/api/orders${suffix}`);
  },
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
    request<{ id: string; created_count?: number; full_path_ar?: string }>('/api/categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  importCategoriesExcel: (body: {
    paths?: string[];
    rows?: Array<{ path?: string; image_url?: string }>;
    scope?: 'merchant' | 'pharmacy' | 'market';
    merchant_id?: string | null;
  }) =>
    request<{ ok: boolean; processed_paths: number; created_count: number }>('/api/categories/import-excel', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCategory: (id: string, body: Record<string, unknown>) =>
    request('/api/categories/' + id, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteCategory: (id: string) => request('/api/categories/' + id, { method: 'DELETE' }),
  getProducts: (merchantId?: string) =>
    request<any[]>(`/api/products${merchantId ? `?merchant_id=${merchantId}` : ''}`),
  getProductsPaginated: (params?: {
    merchant_id?: string;
    category_id?: string;
    offers_only?: boolean;
    q?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('paginated', '1');
    if (params?.merchant_id && params.merchant_id !== 'all') qs.set('merchant_id', params.merchant_id);
    if (params?.category_id && params.category_id !== 'all') qs.set('category_id', params.category_id);
    if (params?.offers_only) qs.set('offers_only', '1');
    if (params?.q && params.q.trim()) qs.set('q', params.q.trim());
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<{
      items: any[];
      total: number;
      page: number;
      limit: number;
      total_pages: number;
      has_more: boolean;
    }>(`/api/products?${qs.toString()}`);
  },
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
  getAuthPublicConfig: () =>
    request<{ ok: boolean; google_web_client_id: string }>('/api/auth/public-config'),
  loginCustomerWithGoogle: (id_token: string) =>
    request<{ ok: boolean; role: 'customer'; is_new_user?: boolean; needs_profile_completion?: boolean; user: any; tokens?: any }>(
      '/api/mobile/customer/auth/google',
      {
        method: 'POST',
        body: JSON.stringify({ id_token }),
      }
    ),
  sendCustomerVerificationLink: (body: {
    full_name: string;
    email: string;
    phone?: string;
    password: string;
  }) =>
    request<{
      ok: boolean;
      email: string;
      already_verified?: boolean;
      message?: string;
      expires_in_sec?: number;
    }>('/api/mobile/customer/register/send-verification-link', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  checkCustomerEmailVerified: (email: string, password: string) =>
    request<{
      ok: boolean;
      verified: boolean;
      role?: 'customer';
      needs_profile_completion?: boolean;
      user?: any;
      tokens?: any;
      message?: string;
    }>('/api/mobile/customer/register/check-verified', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  sendCustomerPasswordResetLink: (email: string) =>
    request<{ ok: boolean; email: string; message?: string; expires_in_sec?: number }>(
      '/api/mobile/customer/forgot-password/send-link',
      {
        method: 'POST',
        body: JSON.stringify({ email }),
      }
    ),
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
    age?: number | null;
    country?: string;
    city?: string;
    phone?: string;
    secondary_phone?: string;
    address_landmark?: string;
    default_zone_id?: string;
    last_lat?: number;
    last_lng?: number;
    profile_completed?: boolean;
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
  getFcmStatus: (probe?: boolean) =>
    request<{
      configured: boolean;
      source: string;
      project_id: string | null;
      registered_devices: { total: number; customer: number; captain: number };
      auth_probe?: { ok: boolean; code?: string; message?: string };
    }>(`/api/notifications/fcm-status${probe ? '?probe=1' : ''}`),
  getNotifications: (targetApp?: string) =>
    request<any[]>(`/api/notifications${targetApp ? `?target_app=${targetApp}` : ''}`),
  sendNotification: (body: Record<string, unknown>) =>
    request<{
      id: string;
      fcm_topic: string;
      audience_count: number;
      fcm_delivery?: {
        fcm_enabled: boolean;
        reason?: string;
        targeted_devices: number;
        sent_count: number;
        failed_count: number;
        deactivated_tokens: number;
        topic_sent?: boolean;
        topic_name?: string;
        topic_message_id?: string;
      };
    }>('/api/notifications', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMobileNotifications: (app: 'customer' | 'captain' | 'merchant', recipientId?: string) =>
    request<any[]>(`/api/mobile/notifications?app=${app}${recipientId ? `&recipient_id=${recipientId}` : ''}`),
  markNotificationRead: (id: string) =>
    request('/api/mobile/notifications/' + id + '/read', { method: 'PATCH' }),
  markAllNotificationsRead: (opts?: { ids?: string[]; app?: 'customer' | 'captain' | 'merchant'; recipient_id?: string }) =>
    request<{ ok: boolean; updated: number }>('/api/mobile/notifications/read-all', {
      method: 'PATCH',
      body: JSON.stringify(opts || {}),
    }),
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
  getAdminCustomersPaginated: (params?: {
    q?: string;
    filter?: 'all' | 'active' | 'registered';
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    qs.set('paginated', '1');
    if (params?.q && params.q.trim()) qs.set('q', params.q.trim());
    if (params?.filter && params.filter !== 'all') qs.set('filter', params.filter);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    return request<{
      items: any[];
      total: number;
      page: number;
      limit: number;
      total_pages: number;
      has_more: boolean;
      stats: { total_customers: number; registered_count: number; active_users_count: number };
    }>(`/api/admin/customers?${qs.toString()}`);
  },
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

  // =========================================================================
  // Storefront, Multi-Store Comparison & Smart Assistant APIs
  // =========================================================================
  getStorefrontHome: (params?: {
    filter?: string;
    category_id?: string;
    merchant_id?: string;
    brand?: string;
    page?: number;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.filter) qs.set('filter', params.filter);
    if (params?.category_id) qs.set('category_id', params.category_id);
    if (params?.merchant_id) qs.set('merchant_id', params.merchant_id);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      banners: any[];
      categories: any[];
      products: any[];
      brands: string[];
      pagination: { page: number; limit: number; total: number; has_more: boolean };
    }>(`/api/storefront/home${suffix}`);
  },
  searchStorefront: (params?: {
    q?: string;
    merchant_id?: string;
    category_id?: string;
    brand?: string;
    min_price?: string | number;
    max_price?: string | number;
    sort?: string;
    limit?: number;
  }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.merchant_id) qs.set('merchant_id', params.merchant_id);
    if (params?.category_id) qs.set('category_id', params.category_id);
    if (params?.brand) qs.set('brand', params.brand);
    if (params?.min_price !== undefined && params?.min_price !== '') qs.set('min_price', String(params.min_price));
    if (params?.max_price !== undefined && params?.max_price !== '') qs.set('max_price', String(params.max_price));
    if (params?.sort) qs.set('sort', params.sort);
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      query: string;
      items: any[];
      top_offers: any[];
      trending_queries: string[];
      facets: { brands: string[]; stores: Array<{ id: string; business_name_ar: string; products_count: number }> };
    }>(`/api/storefront/search${suffix}`);
  },
  getStorefrontProductDetails: (productId: string) =>
    request<any>(`/api/storefront/products/${encodeURIComponent(productId)}/details`),
  askStorefrontAssistant: (
    message: string,
    history?: Array<{ role: 'user' | 'assistant'; text: string }>
  ) =>
    request<{
      reply_ar: string;
      suggested_products: any[];
      quick_prompts: string[];
      suggested_service?: '' | 'pharmacy' | 'rides' | 'parcels' | 'market' | 'free_order';
    }>('/api/storefront/assistant', {
      method: 'POST',
      body: JSON.stringify({ message, history: history || [] }),
    }),

  // =========================================================================
  // Merchant Master Catalog Matching, Linking & Savings Deals
  // =========================================================================
  matchMasterCatalog: (body: {
    name_ar?: string;
    name_en?: string;
    brand?: string;
    barcode?: string;
    size_label?: string;
    category_id?: string;
  }) =>
    request<{
      match_status: 'exact' | 'possible' | 'none';
      exact_match: any | null;
      candidates: any[];
      parsed_size: any | null;
      size_conflict_warning?: string | null;
    }>('/api/merchant/master-catalog/match', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  linkMerchantMasterListing: (body: Record<string, unknown>) =>
    request<{ ok: boolean; listing: any; updated_existing: boolean }>('/api/merchant/master-catalog/link-listing', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  requestNewMasterProduct: (body: Record<string, unknown>) =>
    request<{ ok: boolean; request: any; match_preview: any }>('/api/merchant/master-catalog/request-new', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMerchantMatchingRequests: (merchantId?: string) =>
    request<any[]>(
      `/api/merchant/master-catalog/my-requests${merchantId ? `?merchant_id=${encodeURIComponent(merchantId)}` : ''}`
    ),
  previewMerchantExcelMasterCatalog: (body: {
    rows: Array<Record<string, unknown>>;
    default_category_path?: string;
  }) =>
    request<{
      summary: {
        total_rows: number;
        valid_rows: number;
        skipped_empty_rows: number;
        matched_existing_count: number;
        matched_possible_count: number;
        new_products_count: number;
        images_completed_from_master: number;
        categories_completed_from_master: number;
        products_enriched_count: number;
        categories_count: number;
        new_categories_count: number;
      };
      categories_breakdown: Array<{
        category_path: string;
        display_label: string;
        count: number;
        matched_count: number;
        new_count: number;
        images_completed_count: number;
        is_new_category: boolean;
      }>;
      rows: Array<{
        row_index: number;
        product_name_ar: string;
        product_name_en: string;
        brand: string;
        size_label: string;
        barcode: string;
        description: string;
        image_url: string;
        image_source: 'excel' | 'master_catalog' | 'none';
        category_path: string;
        category_display: string;
        category_id: string | null;
        category_source: 'excel' | 'master_catalog' | 'default';
        is_new_category: boolean;
        proposed_price: number;
        proposed_sale_price: number | null;
        proposed_stock: number;
        merchant_sku: string;
        match_status: 'existing' | 'possible' | 'not_found';
        confidence_score: number;
        suggested_master_id: string | null;
        suggested_master_name: string | null;
        suggested_master_size: string | null;
        suggested_master_image: string | null;
        suggested_master_category: string | null;
        enriched_from_master: boolean;
        enriched_fields: string[];
        size_conflict_warning: string | null;
      }>;
    }>('/api/merchant/master-catalog/excel-preview', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  submitMerchantExcelMasterCatalog: (body: {
    merchant_id?: string;
    file_name?: string;
    batch_id?: string;
    default_category_path?: string;
    rows: Array<Record<string, unknown>>;
  }) =>
    request<{
      ok: boolean;
      batch_id: string;
      file_name: string;
      submitted_count: number;
      skipped_count: number;
      matched_in_master_count: number;
      images_completed_from_master: number;
      categories_completed_from_master: number;
      categories_breakdown: Array<{
        category_path: string;
        display_label: string;
        count: number;
        matched_count: number;
        new_count: number;
        images_completed_count: number;
        is_new_category: boolean;
      }>;
      request_ids: string[];
    }>('/api/merchant/master-catalog/excel-submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getProductDeals: (params?: { merchant_id?: string; product_id?: string }) => {
    const qs = new URLSearchParams();
    if (params?.merchant_id) qs.set('merchant_id', params.merchant_id);
    if (params?.product_id) qs.set('product_id', params.product_id);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<any[]>(`/api/deals${suffix}`);
  },
  createProductDeal: (body: Record<string, unknown>) =>
    request<{ ok: boolean; id: string }>('/api/deals', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  deleteProductDeal: (id: string) =>
    request<{ ok: boolean }>(`/api/deals/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // =========================================================================
  // Super Admin Master Catalog & Storefront Banners APIs
  // =========================================================================
  getAdminMasterProducts: (params?: { q?: string; status?: string; page?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.q) qs.set('q', params.q);
    if (params?.status) qs.set('status', params.status);
    if (params?.page) qs.set('page', String(params.page));
    if (params?.limit) qs.set('limit', String(params.limit));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return request<{
      items: any[];
      total: number;
      page: number;
      limit: number;
      stats: {
        approved_masters: number;
        pending_requests: number;
        linked_listings: number;
        multi_store_masters: number;
      };
    }>(`/api/admin/master-products${suffix}`);
  },
  getAdminMasterProductListings: (masterId: string) =>
    request<{ master: any; listings: any[]; attributes: any[] }>(
      `/api/admin/master-products/${encodeURIComponent(masterId)}/listings`
    ),
  createAdminMasterProduct: (body: Record<string, unknown>) =>
    request<{ ok: boolean; master: any }>('/api/admin/master-products', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAdminMasterProduct: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean; master: any }>(`/api/admin/master-products/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAdminMasterProduct: (id: string) =>
    request<{ ok: boolean; message: string }>(`/api/admin/master-products/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  deleteAllAdminMasterProducts: () =>
    request<{ ok: boolean; message: string }>('/api/admin/master-products/all', {
      method: 'DELETE',
    }),
  getAdminMasterDuplicates: () => request<any[]>('/api/admin/master-products/duplicates'),
  mergeAdminMasterProducts: (body: { source_master_id: string; target_master_id: string; reason?: string }) =>
    request<{ ok: boolean; moved_listings: number; deduplicated_listings: number }>(
      '/api/admin/master-products/merge',
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
  unlinkMasterListing: (listing_id: string, reason?: string) =>
    request<{ ok: boolean }>('/api/admin/master-products/unlink-listing', {
      method: 'POST',
      body: JSON.stringify({ listing_id, reason }),
    }),
  relinkMasterListing: (listing_id: string, target_master_id: string, reason?: string) =>
    request<{ ok: boolean }>('/api/admin/master-products/relink-listing', {
      method: 'POST',
      body: JSON.stringify({ listing_id, target_master_id, reason }),
    }),
  getAdminMatchingRequests: (status = 'pending') =>
    request<any[]>(`/api/admin/matching-requests?status=${encodeURIComponent(status)}`),
  updateAdminMatchingRequest: (
    requestId: string,
    body: {
      product_name_ar?: string;
      product_name_en?: string;
      brand?: string;
      category_id?: string | null;
      category_path?: string;
      barcode?: string | null;
      size_label?: string;
      image_url?: string;
      description?: string;
      proposed_price?: number;
      proposed_stock?: number;
      is_weighted?: boolean;
      weight_step?: number;
      weight_unit?: string;
    }
  ) =>
    request<{ ok: boolean; request: any }>(
      `/api/admin/matching-requests/${encodeURIComponent(requestId)}`,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
      }
    ),
  reviewAdminMatchingRequest: (
    requestId: string,
    body: {
      decision: 'approve_smart' | 'approve_new' | 'link_existing' | 'reject';
      target_master_id?: string | null;
      auto_create_listing?: boolean;
      admin_note?: string;
    }
  ) =>
    request<{ ok: boolean; request: any; master?: any; listing?: any }>(
      `/api/admin/matching-requests/${encodeURIComponent(requestId)}/review`,
      {
        method: 'POST',
        body: JSON.stringify(body),
      }
    ),
  bulkReviewAdminMatchingRequests: (body: {
    request_ids?: string[];
    batch_id?: string;
    merchant_id?: string;
    category_path?: string;
    decision: 'approve_smart' | 'approve_new' | 'link_existing' | 'reject';
    admin_note?: string;
  }) =>
    request<{
      ok: boolean;
      processed_count: number;
      approved_new_count: number;
      linked_existing_count: number;
      rejected_count: number;
      categories_created_count: number;
      error_count: number;
      errors: Array<{ id: string; error: string }>;
    }>('/api/admin/matching-requests/bulk-review', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  getMasterCatalogAudit: () => request<any[]>('/api/admin/master-catalog/audit'),
  getAdminStorefrontBanners: () => request<any[]>('/api/admin/storefront-banners'),
  createAdminStorefrontBanner: (body: Record<string, unknown>) =>
    request<{ ok: boolean; id: string }>('/api/admin/storefront-banners', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateAdminStorefrontBanner: (id: string, body: Record<string, unknown>) =>
    request<{ ok: boolean }>(`/api/admin/storefront-banners/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteAdminStorefrontBanner: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/storefront-banners/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),
  exportAllAdminMasterProducts: () =>
    request<{ items: any[]; total: number }>('/api/admin/master-products/export-all'),
  compareMasterProductsExcel: (rows: Array<Record<string, unknown>>) =>
    request<{
      summary: {
        total_rows: number;
        existing_count: number;
        not_found_count: number;
        possible_count: number;
        duplicate_in_file_count: number;
      };
      existing: any[];
      not_found: any[];
      possible: any[];
      all_rows: any[];
    }>('/api/admin/master-products/excel-compare', {
      method: 'POST',
      body: JSON.stringify({ rows }),
    }),
  importMasterProductsExcel: (body: {
    rows: Array<Record<string, unknown>>;
    default_category_id?: string;
    merchant_id?: string;
    publish_to_store?: boolean;
    skip_existing?: boolean;
    update_missing_fields?: boolean;
  }) =>
    request<{
      ok: boolean;
      created_count: number;
      skipped_existing_count: number;
      updated_existing_count: number;
      store_products_created?: number;
      store_products_updated?: number;
      categories_created_count?: number;
      merchant_id?: string | null;
      error_count: number;
      errors: Array<{ row_index: number; name_ar: string; error: string }>;
      created_ids: string[];
    }>('/api/admin/master-products/excel-import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

