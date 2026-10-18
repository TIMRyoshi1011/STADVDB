export const MIN = '2024-09-24';
export const MAX = '2025-09-23';

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
  const response = await fetch(`${path}?${params}`);
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `Request failed with status ${response.status}`);
  }

  return body;
};

export const getMeta = () => request('/api/meta', new URLSearchParams());

export const getKpis = (filters) =>
  request('/api/kpis', filtersToParams(filters));

export const getReport = ({ tab, gb, path, A }) => {
  const params = filtersToParams(A);
  params.set('tab', tab);
  params.set('gb', gb);
  path.forEach((value) => params.append('path', value));
  return request('/api/report', params);
};

export const getPivot = ({ pr, pc, A }) => {
  const params = filtersToParams(A);
  params.set('pr', pr);
  params.set('pc', pc);
  return request('/api/pivot', params);
};
