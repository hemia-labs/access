import { cookies } from "next/headers";

const API_URL = process.env.NEXT_PUBLIC_ACCESS_API_URL ?? "http://localhost:3019";

export type AccessOrganization = {
  id: string;
  code: string;
  name: string;
  slug: string;
  type: string;
  status: string;
};

export type AccessMembership = {
  id: string;
  status: string;
  membership_type?: string;
  identityReference?: {
    issuer: string;
    subjectId: string;
    emailSnapshot?: string | null;
    displayNameSnapshot?: string | null;
  };
};

export type AccessInvitation = {
  id: string;
  email: string;
  status: string;
  product_code?: string | null;
  role_codes?: string[];
  expires_at?: string;
};

export type AccessProduct = {
  code: string;
  name: string;
  status: string;
  audience: string;
  provisioning_mode: string;
};

export type AccessRole = {
  id: string;
  code: string;
  name: string;
  scope: string;
  status: string;
};

export type AccessPermission = {
  id: string;
  code: string;
  description?: string | null;
  scope: string;
  status: string;
};

async function authHeader(): Promise<Record<string, string>> {
  const jar = await cookies();
  const token =
    jar.get("access_token")?.value ??
    jar.get("hemia_access_token")?.value ??
    jar.get("context_token")?.value;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function accessFetch<T>(path: string): Promise<T> {
  const res = await fetch(new URL(path, API_URL), {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(await authHeader()),
    },
  });
  if (!res.ok) {
    throw new Error(`Access API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function getOrganizations() {
  return accessFetch<AccessOrganization[]>("/v1/organizations");
}

export async function getProducts() {
  return accessFetch<AccessProduct[]>("/v1/products");
}

export async function getRoles() {
  return accessFetch<AccessRole[]>("/v1/roles");
}

export async function getPermissions() {
  return accessFetch<AccessPermission[]>("/v1/permissions");
}

export async function getOrganizationMemberships(id: string) {
  return accessFetch<AccessMembership[]>(`/v1/organizations/${id}/memberships`);
}

export async function getOrganizationInvitations(id: string) {
  return accessFetch<AccessInvitation[]>(`/v1/organizations/${id}/invitations`);
}
