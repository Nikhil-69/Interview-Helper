// Backend client — all AI traffic goes through the Interview Helper server,
// which holds the provider key, deducts credits, and logs usage.

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';
const TOKEN_KEY = 'ih_token';

export type User = {
  id: number;
  email: string;
  name: string;
  role: 'user' | 'admin';
  status: 'active' | 'blocked';
  credits_balance: number;
};

export class ApiError extends Error {
  status: number;
  credits?: number;
  constructor(message: string, status: number, credits?: number) {
    super(message);
    this.status = status;
    this.credits = credits;
  }
}

export const getToken = () => localStorage.getItem(TOKEN_KEY);
export const clearToken = () => localStorage.removeItem(TOKEN_KEY);

async function request<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = options;
  const token = getToken();
  const res = await fetch(`${API_URL}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) clearToken();
    throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data.credits);
  }
  return data as T;
}

export async function login(email: string, password: string): Promise<User> {
  const data = await request<{ token: string; user: User }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    auth: false,
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.user;
}

export async function register(email: string, password: string, name: string): Promise<User> {
  const data = await request<{ token: string; user: User }>('/auth/register', {
    method: 'POST',
    body: { email, password, name },
    auth: false,
  });
  localStorage.setItem(TOKEN_KEY, data.token);
  return data.user;
}

export async function fetchMe(): Promise<User> {
  const data = await request<{ user: User }>('/auth/me');
  return data.user;
}

export async function fetchBalance(): Promise<number> {
  const data = await request<{ credits: number }>('/credits/balance');
  return data.credits;
}

// Downscale + JPEG-encode images before upload. Full-resolution PNG screenshots
// can exceed serverless body limits (Vercel: ~4.5 MB) and waste vision tokens;
// ~1920px JPEG keeps on-screen text readable for the model.
export async function compressImage(dataUrl: string, maxDim = 1920, quality = 0.85): Promise<string> {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = dataUrl;
  });

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  // Already small enough (< ~750 KB as base64) and needs no resize — keep as-is.
  if (scale === 1 && dataUrl.length < 1_000_000) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', quality);
}

// --- Credit packages / orders (Razorpay payment links) ----------------------

export type CreditPackage = {
  id: string;
  name: string;
  credits: number;
  price: number;
  currency: string;
};

export type OrderStatus = {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  status: 'pending' | 'paid' | 'failed';
  created_at: string;
  paid_at: string | null;
};

export async function fetchPackages(): Promise<CreditPackage[]> {
  const data = await request<{ packages: CreditPackage[] }>('/orders/packages', { auth: false });
  return data.packages;
}

export async function createOrder(packageId: string): Promise<{
  orderId: string;
  paymentUrl: string | null;
  amount: number;
  currency: string;
  credits: number;
}> {
  return request('/orders', { method: 'POST', body: { packageId } });
}

export async function fetchOrder(orderId: string): Promise<OrderStatus> {
  const data = await request<{ order: OrderStatus }>(`/orders/${orderId}`);
  return data.order;
}

// Dev-only fallback for the mock gateway (no hosted payment page).
export async function payOrderMock(orderId: string): Promise<{ credits: number }> {
  return request(`/orders/${orderId}/pay`, { method: 'POST' });
}

// --- Prompt modes ------------------------------------------------------------

export type PromptMode = { value: string; label: string };

// Fallback if the server can't be reached; must mirror the server catalog.
export const DEFAULT_PROMPT_MODES: PromptMode[] = [
  { value: 'coding-interview', label: 'Live Coding Interview' },
  { value: 'coding-oa', label: 'Coding Test (OA)' },
  { value: 'coding-learning', label: 'Coding Tutor' },
  { value: 'mcq-test', label: 'MCQ Quiz Solver' },
  { value: 'non-coding-learning', label: 'Concept Tutor' },
  { value: 'non-mcq', label: 'Written & HR Answers' },
  { value: 'mix', label: 'Smart Auto Mode' },
  { value: 'custom', label: 'Custom Prompt' },
];

export async function fetchPromptModes(): Promise<PromptMode[]> {
  const data = await request<{ modes: PromptMode[] }>('/ai/prompt-modes');
  return data.modes;
}

export async function askCopilot(
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  images: string[] = [],
  promptMode = '',
  customPrompt = '',
  webSearch = false
): Promise<{ answer: string; credits: number; creditsCharged: number }> {
  return request('/ai/ask', {
    method: 'POST',
    // imageSrc kept alongside images so an older server build still sees the first image.
    body: { context, history, question, images, imageSrc: images[0] || null, promptMode, customPrompt, webSearch },
  });
}
