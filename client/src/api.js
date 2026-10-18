const filtersToParams = (filters) => {
  const params = new URLSearchParams({
    country: filters.country,
    courier: filters.courier,
    vehicle: filters.vehicle,
  });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
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
