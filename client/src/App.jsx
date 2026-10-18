import { useEffect, useState } from 'react';
import { Bar, Line } from 'react-chartjs-2';
import 'chart.js/auto';
import './App.css';

const periods = ['Year', 'Quarter', 'Month', 'Day'];

function App() {
  const [selected, setSelected] = useState('Month');
  const [dashboard, setDashboard] = useState(null);
  const [apiError, setApiError] = useState('');

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setApiError('');

      try {
        const response = await fetch(
          `/api/dashboard?period=${encodeURIComponent(selected)}`,
          { signal: controller.signal },
        );

        if (!response.ok) {
          throw new Error(`Dashboard request failed (${response.status})`);
        }

        const result = await response.json();
        setDashboard(result);
      } catch (error) {
        if (!controller.signal.aborted) {
          setApiError(error instanceof Error ? error.message : 'Unable to load dashboard data');
        }
      }
    }

    loadDashboard();
    return () => controller.abort();
  }, [selected]);

  const options1 = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Monthly Sales Report (2025)' },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Sales' },
      },
      x: {
        title: { display: true, text: 'Month' },
      },
    },
  };

  const options2 = {
    indexAxis: 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      title: { display: true, text: 'Products Sold' },
    },
    scales: {
      x: {
        beginAtZero: true,
        title: { display: true, text: 'Quantity Sold' },
      },
      y: { grid: { display: false } },
    },
  };

  const options3 = {
    indexAxis: 'y',
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Total Customer Orders per Country' },
    },
    scales: { y: { beginAtZero: true } },
  };

  const salesData = dashboard && {
    labels: dashboard.sales.labels,
    datasets: [{
      label: 'Monthly Sales',
      data: dashboard.sales.values,
      borderColor: '#3B82F6',
      backgroundColor: 'rgba(59, 130, 246, 0.2)',
      borderWidth: 3,
      pointBackgroundColor: '#3B82F6',
      pointRadius: 5,
      tension: 0.3,
      fill: true,
    }],
  };

  const productsData = dashboard && {
    labels: dashboard.products.labels,
    datasets: [{
      label: 'Products Sold',
      data: dashboard.products.values,
      backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#8B5CF6', '#EF4444'],
      borderRadius: 5,
      barThickness: 28,
    }],
  };

  const countriesData = dashboard && {
    labels: dashboard.countries.labels,
    datasets: [{
      label: 'Total Customer Orders',
      data: dashboard.countries.values,
      backgroundColor: 'rgba(54, 162, 235, 0.6)',
      borderColor: 'rgb(54, 162, 235)',
      borderWidth: 1,
    }],
  };

  return (
    <>
      <div className="time-filter">
        {periods.map((period) => (
          <button
            key={period}
            className={`time-filter-button ${selected === period ? 'active' : ''}`}
            onClick={() => setSelected(period)}
          >
            {period}
          </button>
        ))}
      </div>

      <p role={apiError ? 'alert' : 'status'} aria-live="polite">
        {apiError || (dashboard ? 'Connected to dashboard API' : 'Loading dashboard data...')}
      </p>
      <hr />

      {dashboard && (
        <>
          <div className="analytics-grid">
            {dashboard.analytics.map((item) => (
              <div className="analytics-card" key={item.title}>
                <h3 className="analytics-title">{item.title}</h3>
                <div className="analytics-value">{item.value}</div>
              </div>
            ))}
          </div>

          <hr />

          <section style={{ position: 'relative', top: '50px', display: 'flex', justifyContent: 'center', gap: '50px' }}>
            <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius: '5%', width: '70%', height: '550px' }}>
              <Line data={salesData} options={options1} />
            </div>

            
          </section>

          <section style={{ position: 'relative', top: '100px', display: 'flex', justifyContent: 'center', gap: '50px' }}>
            <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius: '5%', width: '30%', maxWidth: '700px', height: '450px' }}>
              <Bar data={productsData} options={options2} />
            </div>

            <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius: '5%', width: '35%' }}>
              <Bar data={countriesData} options={options3} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

export default App;
