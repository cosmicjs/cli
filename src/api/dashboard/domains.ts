/**
 * Dashboard API - Domains
 * Domain and DNS record management
 */

import { get, post, patch, del } from '../client.js';

// ============================================================================
// Types
// ============================================================================

export interface Domain {
  id: string;
  _id?: string;
  domain_name: string;
  status?: string;
  auto_renew?: boolean;
  expires_at?: string;
  created_at?: string;
  updated_at?: string;
  nameservers?: string[];
  custom_nameservers?: string[];
  cdn_enabled?: boolean;
  description?: string;
  repository_id?: string;
  verified?: boolean;
}

export interface DnsRecord {
  id: string;
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name: string;
  value: string;
  ttl?: number;
  priority?: number;
  comment?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DomainSuggestion {
  name: string;
  available?: boolean;
  price?: number;
  premium?: boolean;
}

export interface ImportDomainData {
  domain_name: string;
  description?: string;
}

export interface ConnectDomainData {
  repository_id: string;
  redirect_url?: string;
  redirect_status_code?: 301 | 302 | 307 | 308;
}

export interface DisconnectDomainData {
  repository_id: string;
}

export interface UpdateDomainSettingsData {
  auto_renew?: boolean;
  custom_nameservers?: string[];
  cdn_enabled?: boolean;
  description?: string;
}

export interface CreateDnsRecordData {
  type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name: string;
  value: string;
  ttl?: number;
  srv?: {
    priority: number;
    weight: number;
    port: number;
    target: string;
  };
  mx?: {
    priority: number;
  };
  comment?: string;
}

export interface UpdateDnsRecordData {
  type?: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT' | 'SRV' | 'NS';
  name?: string;
  value?: string;
  ttl?: number;
  srv?: {
    priority: number;
    weight: number;
    port: number;
    target: string;
  };
  mx?: {
    priority: number;
  };
  comment?: string;
}

// ============================================================================
// Domain API Functions
// ============================================================================

export async function listDomains(): Promise<Domain[]> {
  const response = await get<{ domains: Domain[] }>('/domains');
  return response.domains || [];
}

export async function getDomain(id: string): Promise<Domain> {
  const response = await get<{ domain: Domain }>(`/domains/${id}`);
  return response.domain;
}

export async function searchDomains(
  query: string,
  options: { limit?: number; skip?: number } = {}
): Promise<DomainSuggestion[]> {
  const params: Record<string, unknown> = { query };
  if (options.limit) params.limit = options.limit;
  if (options.skip) params.skip = options.skip;

  const response = await get<{ suggestions: DomainSuggestion[] }>(
    '/domains/suggestions',
    { params }
  );
  return response.suggestions || [];
}

export async function checkAvailability(
  domainName: string
): Promise<{ available: boolean; price?: number }> {
  const response = await get<{ available: boolean; price?: number }>(
    `/domains/availability/${domainName}`
  );
  return response;
}

export async function getDomainPricing(
  tld?: string
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  if (tld) params.tld = tld;

  const response = await get<Record<string, unknown>>('/domains/pricing', { params });
  return response;
}

export async function importDomain(
  data: ImportDomainData
): Promise<Domain> {
  const response = await post<{ domain: Domain }>('/domains/import', data);
  return response.domain;
}

export async function updateDomainSettings(
  id: string,
  data: UpdateDomainSettingsData
): Promise<Domain> {
  const response = await patch<{ domain: Domain }>(`/domains/${id}/settings`, data);
  return response.domain;
}

export async function deleteDomain(id: string): Promise<void> {
  await del(`/domains/${id}`);
}

export async function connectDomain(
  id: string,
  data: ConnectDomainData
): Promise<{ message: string }> {
  const response = await post<{ message: string }>(`/domains/${id}/connect`, data);
  return response;
}

export async function disconnectDomain(
  id: string,
  data: DisconnectDomainData
): Promise<{ message: string }> {
  const response = await post<{ message: string }>(`/domains/${id}/disconnect`, data);
  return response;
}

// ============================================================================
// DNS Record API Functions
// ============================================================================

export async function listDnsRecords(
  domainId: string
): Promise<DnsRecord[]> {
  const response = await get<{ records: DnsRecord[] }>(`/domains/${domainId}/dns`);
  return response.records || [];
}

export async function createDnsRecord(
  domainId: string,
  data: CreateDnsRecordData
): Promise<DnsRecord> {
  const response = await post<{ record: DnsRecord }>(`/domains/${domainId}/dns`, data);
  return response.record;
}

export async function updateDnsRecord(
  domainId: string,
  recordId: string,
  data: UpdateDnsRecordData
): Promise<DnsRecord> {
  const response = await patch<{ record: DnsRecord }>(
    `/domains/${domainId}/dns/${recordId}`,
    data
  );
  return response.record;
}

export async function deleteDnsRecord(
  domainId: string,
  recordId: string
): Promise<void> {
  await del(`/domains/${domainId}/dns/${recordId}`);
}
