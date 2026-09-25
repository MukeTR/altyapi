import type trDashboard from "../tr/dashboard";

const dashboard: typeof trDashboard = {
  viewAll: "View all",
  freshness: "Latest data:",
  orders: {
    title: "Last {days} days",
    description: "Orders with a captured payment, per day in the store's time zone.",
    paid: "Paid orders",
    placed: "{count} orders placed",
    revenue: "Revenue",
    revenueHint: "Before refunds",
    average: "Average order",
    toFulfill: "To fulfill",
    awaitingPayment: "{count} awaiting payment",
    atLeast: "at least",
    none: "No orders in the last 30 days.",
    truncated: "There are more than 3,000 orders in this period; figures cover the first 3,000 and are shown as lower bounds.",
  },
  chart: {
    summary: "Paid orders per day over the last 30 days. Total {total}; highest {peak} ({peakDay}). Use the arrow keys to move between days.",
    orders: "{count} orders",
    caption: "Days in the {timezone} time zone.",
    showTable: "Show data as a table",
    tableCaption: "Paid orders and revenue per day",
    day: "Day",
    paidOrders: "Paid orders",
    revenue: "Revenue ({currency})",
  },
  recent: {
    title: "Recent orders",
    empty: "No orders yet.",
    items: "{count} items",
  },
  lowStock: {
    title: "Low stock",
    description: "Variants with {threshold} or fewer available that stop selling when out of stock.",
    manage: "Manage inventory",
    noProducts: "No active products.",
    none: "No variants are running low.",
    out: "Sold out",
    left: "{count} left",
    partial: "The {checked} products with the least stock per variant were checked ({scanned} active products scanned).",
  },
  karmatik: {
    title: "Kârmatik profitability",
    description: "Profit and margin summary from Kârmatik.",
    lossMaking: "Loss-making",
    thinMargin: "Thin margin",
    missingCost: "Missing cost",
    alerts: "{count} open alerts",
    suggestions: "{count} applicable price suggestions",
  },
  yanit: {
    title: "Yanıt visibility",
    description: "How visible your brand is in AI assistants' answers.",
    visibility: "{days}-day visibility",
    opportunities: "Open opportunities",
    gaps: "{count} missing queries",
    topGaps: "Top missing queries",
  },
};

export default dashboard;
