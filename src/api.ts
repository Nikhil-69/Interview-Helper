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

export async function fetchMe(): Promise<User> {
  const data = await request<{ user: User }>('/auth/me');
  return data.user;
}

export async function fetchBalance(): Promise<number> {
  const data = await request<{ credits: number }>('/credits/balance');
  return data.credits;
}

export async function askCopilot(
  context: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  question: string,
  imageSrc?: string
): Promise<{ answer: string; credits: number; creditsCharged: number }> {
  return request('/ai/ask', {
    method: 'POST',
    body: { context, history, question, imageSrc: imageSrc || null },
  });
}
