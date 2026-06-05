import axios from "axios";
import type { BucketCount, Refill, RefillPage, RefillPatch, RefillPatchResponse } from "./types";

const api = axios.create({ baseURL: "/api" });

export async function getRefills(filters: {
  bucket?: string;
  coach?: string;
  pharmacy?: string;
  category?: string;
  search?: string;
  page?: number;
  page_size?: number;
}): Promise<RefillPage> {
  const params: Record<string, string | number> = {};
  if (filters.bucket && filters.bucket !== "ALL") params.bucket = filters.bucket;
  if (filters.coach) params.coach = filters.coach;
  if (filters.pharmacy) params.pharmacy = filters.pharmacy;
  if (filters.category) params.category = filters.category;
  if (filters.search) params.search = filters.search;
  if (filters.page) params.page = filters.page;
  if (filters.page_size) params.page_size = filters.page_size;
  const { data } = await api.get<RefillPage>("/refills", { params });
  return data;
}

export async function getBuckets(): Promise<BucketCount[]> {
  const { data } = await api.get<BucketCount[]>("/refills/buckets");
  return data;
}

export async function patchRefill(
  id: number,
  payload: RefillPatch
): Promise<RefillPatchResponse> {
  const { data } = await api.patch<RefillPatchResponse>(`/refills/${id}`, payload);
  return data;
}
