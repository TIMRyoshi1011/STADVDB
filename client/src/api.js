export const MIN = '2024-09-24';
export const MAX = '2025-09-23';

const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

const filtersToParams = (filters) => {
  const params = new URLSearchParams({
    from: filters.from,
    to: filters.to,
    country: filters.country,
    courier: filters.courier,
    vehicle: filters.vehicle,
  });
  filters.cats.forEach((category) => params.append('cats', category));
  return params;
};

const request = async (path, params) => {
  if (!import.meta.env.DEV && !API_BASE_URL) {
    throw new Error('VITE_API_URL is not configured for this deployment.');
  }

  const response = await fetch(`${API_BASE_URL}${path}?${params}`);
  const contentType = response.headers.get('content-type') || '';

  if (!contentType.includes('application/json')) {
    throw new Error(
      `Expected JSON from the API but received ${contentType || 'a non-JSON response'} (HTTP ${response.status}). Check that VITE_API_URL points to the backend.`,
    );
  }

  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  return body;
};

export const getMeta = () => request('/api/meta', new URLSearchParams());

export const getKpis = (filters) =>
  request('/api/kpis', filtersToParams(filters));

export const getReport = ({ tab, gb, path, A, locationYear }) => {
  const params = filtersToParams(A);
  params.set('tab', tab);
  params.set('gb', gb);
  if (tab === 'loc' && locationYear) params.set('year', locationYear);
  path.forEach((value) => params.append('path', value));
  return request('/api/report', params);
};

export const getPivot = ({ pivotYear }) => {
  const params = new URLSearchParams();
  if (pivotYear) params.set('year', pivotYear);
  return request('/api/pivot', params);
};
