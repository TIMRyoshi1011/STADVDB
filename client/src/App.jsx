import { useState } from 'react';
import { Bar } from 'react-chartjs-2';
import { Line } from 'react-chartjs-2';
import { Doughnut } from "react-chartjs-2";
import 'chart.js/auto';
import "./App.css";

function App() {
  const [selected, setSelected] = useState("Month");

  const options = ["Year", "Quarter", "Month", "Day"];

  const analytics = [
    {
      title: "Groups Sales",
      value: "Php 0.00"
    },
    {
      title: "Total Units Sold",
      value: "0.00 units"
    },
    {
      title: "Total Shipments",
      value: "0.00 orders"
    },
    {
      title: "Active Couriers",
      value: "0.00 couriers"
    },
  ];

const data1 = {
    labels: [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
    ],
    datasets: [
      {
        label: 'Monthly Sales',
        data: [4662889789.09, 4218529944.15, 4645613828.26, 4524619360.06, 4651692792.81, 4494058740.44, 4657874928.79, 4655495875.24, 3457438340.27],
        borderColor: '#3B82F6',
        backgroundColor: 'rgba(59, 130, 246, 0.2)',
        borderWidth: 3,
        pointBackgroundColor: '#3B82F6',
        pointRadius: 5,
        tension: 0.3,
        fill: true,
      },
    ],
  };

  const options1 = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Monthly Sales Report (2025)',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Sales',
        },
      },
      x: {
        title: {
          display: true,
          text: 'Month',
        },
      },
    },
  };

    const data2 = {
    labels: ['Toys', 'Appliances', 'Makeup', 'Bags', 'Gadgets'],
    datasets: [
      {
        label: 'Products Sold',
        data: [6678, 1292, 2633, 1278, 1251],
        backgroundColor: [
          '#3B82F6',
          '#10B981',
          '#F59E0B',
          '#8B5CF6',
          '#EF4444',
        ],
        borderRadius: 5,
        barThickness: 28,
      },
    ],
  };

  const options2 = {
    indexAxis: 'x',
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false,
      },
      title: {
        display: true,
        text: 'Products Sold',
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        title: {
          display: true,
          text: 'Quantity Sold',
        },
      },
      y: {
        grid: {
          display: false,
        },
      },
    },
  };

  const data3 = {
    labels: ['North Macedonia', 'French Southern Territories', 'Sudan', 'Slovakia', 'Reunion', 'Cook Islands', 'Afghanistan', 'Luxembourg', 'Kyrgyz Republic', 'Mayonette'],
    datasets: [
      {
        label: 'Total Customer Orders',
        data: [26, 21, 21, 20, 21, 20, 20, 21, 28, 20],
        backgroundColor: 'rgba(54, 162, 235, 0.6)',
        borderColor: 'rgb(54, 162, 235)',
        borderWidth: 1,
      },
    ],
  };

  const options3 = {
    indexAxis: 'y',
    responsive: true,
    plugins: {
      legend: {
        position: 'top',
      },
      title: {
        display: true,
        text: 'Total Customer Orders per Country',
      },
    },
    scales: {
      y: {
        beginAtZero: true,
      },
    },
  };

const data4 = {
  labels: ["Completed", "In Progress", "Pending", "Cancelled"],
  datasets: [
    {
      data: [45, 25, 20, 10],
      backgroundColor: [
        "#4F46E5",
        "#06B6D4",
        "#F59E0B",
        "#E5E7EB",
      ],
      borderWidth: 0,
      hoverOffset: 8,
    },
  ],
};

const options4 = {
  responsive: true,
  maintainAspectRatio: false,
  cutout: "72%",
  plugins: {
    legend: {
      position: "bottom",
      labels: {
        usePointStyle: true,
        pointStyle: "circle",
        padding: 20,
      },
    },
    tooltip: {
      callbacks: {
        label: (context) => {
          const value = context.raw;
          return ` ${context.label}: ${value}%`;
        },
      },
    },
  },
};

const centerTextPlugin = {
  id: "centerText",
  afterDraw(chart) {
    const { ctx, chartArea } = chart;

    if (!chartArea) return;

    const x = (chartArea.left + chartArea.right) / 2;
    const y = (chartArea.top + chartArea.bottom) / 2;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    ctx.font = "bold 28px sans-serif";
    ctx.fillStyle = "#9797af";
    ctx.fillText("100%", x, y - 8);

    ctx.font = "13px sans-serif";
    ctx.fillStyle = "#6B7280";
    ctx.fillText("Total", x, y + 18);

    ctx.restore();
  },
};

  return (
    <>
    <div className="time-filter">
      {options.map((option) => (
        <button
          key={option}
          className={`time-filter-button ${
            selected === option ? "active" : ""
          }`}
          onClick={() => setSelected(option)}
        >
          {option}
        </button>
      ))}
    </div>

    <hr />

    <div className="analytics-grid">
      {analytics.map((item) => (
        <div className="analytics-card" key={item.title}>
          <h3 className="analytics-title">{item.title}</h3>

          <div className="analytics-value">{item.value}</div>

          {/* <p className="analytics-change">
            <span className="change-positive">
              {item.change}
            </span>{" "}
            vs. last month
          </p> */}
        </div>
      ))}
    </div>

    <hr />

    <section style={{ position: 'relative', top: '50px', display: 'flex', justifyContent: 'center', gap: '50px' }}>
      <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius:'5%', width: '40%', maxWidth: '700px', height: '450px' }}>
        <Line data={data1} options={options1} />
      </div>

      <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius:'5%', width: '42%', maxWidth: '700px', height: '450px' }}>
        <Bar data={data2} options={options2} />
      </div>
    </section>

    <section style={{ position: 'relative', top: '100px', display: 'flex', justifyContent: 'center', gap: '50px' }}>
      <div style={{ backgroundColor: '#082238', border: '20px solid #082238', borderRadius:'5%', width: '48%', maxWidth: '700px' }}>
        <Bar data={data3} options={options3} />
      </div>

      <div style={{ padding: "30px", borderRadius:'5%', background: "#082238", height: '420px' }}>
        <div style={{ width: "90%", height: "380px", padding: "20px", background: "#082238", borderRadius: "16px" }}>
          <h2 style={{ fontSize: "20px", margin: "0 0 20px", color: "#8e9094" }}>
            Task Overview
          </h2>

          <div style={{ height: "290px", position: "relative" }}>
            <Doughnut data={data4} options={options4} plugins={[centerTextPlugin]}/>
          </div>
        </div>
      </div>
    </section>
    </>
  );
}

export default App;
