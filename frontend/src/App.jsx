import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const PIPELINE_JOB_QUERY = "NVDA medallion";
const QUICK_SYMBOLS = ["NVDA", "MSFT", "AAPL", "AMD", "TSLA"];
const FAVORITES_STORAGE_KEY = "nvidiarepo.favorite.symbols";
const COMPARISON_WEIGHTS_STORAGE_KEY = "nvidiarepo.comparison.weights";
const CHART_RANGE_OPTIONS = [
  { value: "7", label: "7d" },
  { value: "30", label: "30d" },
  { value: "60", label: "60d" },
];
const COMPARISON_SORT_OPTIONS = [
  { value: "signal", label: "Signal first" },
  { value: "risk", label: "Lower risk" },
  { value: "price_desc", label: "Higher price" },
  { value: "symbol", label: "Symbol A-Z" },
];

function asNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return num.toFixed(digits);
}

function asDate(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleString();
}

function asDateShort(value) {
  if (!value) return "-";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  return dt.toLocaleDateString();
}

function getTrendTone(current, previous) {
  const curr = Number(current);
  const prev = Number(previous);
  if (!Number.isFinite(curr) || !Number.isFinite(prev)) return "flat";
  if (curr > prev) return "up";
  if (curr < prev) return "down";
  return "flat";
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatPercent(value, digits = 1) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "-";
  return `${num.toFixed(digits)}%`;
}

function SvgLineChart({
  data,
  width = 880,
  height = 260,
  stroke = "#0f867e",
  fill = "rgba(15,134,126,0.12)",
  label,
  xAxisLabel = "",
  yAxisLabel = "",
}) {
  const values = data.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return <div className="chart-empty">No data available for {label}.</div>;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const innerWidth = width - 24;
  const innerHeight = height - 24;
  const step = values.length > 1 ? innerWidth / (values.length - 1) : innerWidth;

  const points = values.map((value, index) => {
    const x = 12 + index * step;
    const y = 12 + (max - value) * (innerHeight / range);
    return { x, y, value };
  });

  const linePath = points.map((point, index) => `${index === 0 ? "M" : "L"}${point.x},${point.y}`).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1].x},${height - 12} L ${points[0].x},${height - 12} Z`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="chart-svg">
      <defs>
        <linearGradient id={`line-fill-${label.replace(/\s+/g, "-").toLowerCase()}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0.03" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((ratio) => {
        const y = 12 + innerHeight * ratio;
        return <line key={ratio} x1="12" x2={width - 12} y1={y} y2={y} className="chart-grid" />;
      })}
      <path d={areaPath} fill={`url(#line-fill-${label.replace(/\s+/g, "-").toLowerCase()})`} />
      <path d={linePath} fill="none" stroke={stroke} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      {yAxisLabel ? (
        <text x="18" y="26" className="chart-axis-title chart-axis-title-y" transform={`rotate(-90 18 26)`}>
          {yAxisLabel}
        </text>
      ) : null}
      {xAxisLabel ? (
        <text x={width / 2} y={height - 2} textAnchor="middle" className="chart-axis-title">
          {xAxisLabel}
        </text>
      ) : null}
      {points.map((point, index) => (
        <g key={`${index}-${point.value}`}>
          <circle cx={point.x} cy={point.y} r="4" fill={stroke} />
          {index === points.length - 1 ? (
            <text x={point.x - 4} y={point.y - 12} className="chart-label">
              {asNumber(point.value)}
            </text>
          ) : null}
        </g>
      ))}
    </svg>
  );
}

function SvgBarChart({ data, width = 880, height = 240, label, valueFormatter = (value) => value }) {
  const values = data.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
  if (!values.length) {
    return <div className="chart-empty">No data available for {label}.</div>;
  }

  const max = Math.max(...values) || 1;
  const barWidth = (width - 48) / values.length;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="chart-svg">
      {values.map((value, index) => {
        const barHeight = ((height - 42) * value) / max;
        const x = 24 + index * barWidth;
        const y = height - 18 - barHeight;
        return (
          <g key={`${index}-${value}`}>
            <rect x={x} y={y} width={barWidth - 10} height={barHeight} rx="10" fill="rgba(15,134,126,0.82)" />
            <text x={x + 4} y={y - 8} className="chart-label">
              {valueFormatter(value)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export default function App() {
  const symbolInputRef = useRef(null);
  const [symbolInput, setSymbolInput] = useState("NVDA");
  const [symbol, setSymbol] = useState("NVDA");
  const [activeView, setActiveView] = useState("dashboard");
  const [compactMode, setCompactMode] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [chartRange, setChartRange] = useState("30");
  const [comparisonSort, setComparisonSort] = useState("signal");
  const [comparisonWeights, setComparisonWeights] = useState(() => {
    try {
      const raw = window.localStorage.getItem(COMPARISON_WEIGHTS_STORAGE_KEY);
      if (!raw) return { delta: 1.0, risk: 0.25, mae: 0.4 };
      const parsed = JSON.parse(raw);
      const delta = clamp(Number(parsed?.delta), 0, 2) || 1.0;
      const risk = clamp(Number(parsed?.risk), 0, 2) || 0.25;
      const mae = clamp(Number(parsed?.mae), 0, 2) || 0.4;
      return { delta, risk, mae };
    } catch {
      return { delta: 1.0, risk: 0.25, mae: 0.4 };
    }
  });
  const [favoriteSymbols, setFavoriteSymbols] = useState(() => {
    try {
      const raw = window.localStorage.getItem(FAVORITES_STORAGE_KEY);
      if (!raw) return ["NVDA"];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return ["NVDA"];
      const cleaned = parsed
        .map((item) => String(item || "").toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 10))
        .filter(Boolean)
        .slice(0, 12);
      return cleaned.length ? cleaned : ["NVDA"];
    } catch {
      return ["NVDA"];
    }
  });
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [pipelineJob, setPipelineJob] = useState(null);
  const [pipelineRuns, setPipelineRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobError, setJobError] = useState("");
  const [bronzeStatus, setBronzeStatus] = useState(null);
  const [comparisonRows, setComparisonRows] = useState([]);
  const [comparisonLoading, setComparisonLoading] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  const avgForecast = useMemo(() => {
    if (!history.length) return null;
    const total = history.reduce((acc, row) => acc + Number(row.pred_close || 0), 0);
    return total / history.length;
  }, [history]);

  const maxForecast = useMemo(() => {
    if (!history.length) return null;
    return Math.max(...history.map((row) => Number(row.pred_close || 0)));
  }, [history]);

  const trendTone = useMemo(() => {
    if (history.length < 2) return "flat";
    return getTrendTone(history[0]?.pred_close, history[1]?.pred_close);
  }, [history]);

  const latestRun = useMemo(() => pipelineRuns[0] || null, [pipelineRuns]);

  const latestRunState = useMemo(() => {
    if (!latestRun) return "NO DATA";
    const lifeCycle = latestRun.state?.life_cycle_state || "UNKNOWN";
    const result = latestRun.state?.result_state || "IN_PROGRESS";
    return `${lifeCycle} / ${result}`;
  }, [latestRun]);

  const latestClose = useMemo(() => Number(history[0]?.pred_close || latest?.predicted_close || 0), [history, latest]);

  const historyInRange = useMemo(() => {
    const size = Number(chartRange);
    if (!Number.isFinite(size) || size <= 0) return history;
    return history.slice(0, size);
  }, [chartRange, history]);

  const comparisonSymbols = useMemo(() => {
    const merged = [symbol, ...favoriteSymbols, ...QUICK_SYMBOLS];
    const unique = [];
    for (const item of merged) {
      if (!item || unique.includes(item)) continue;
      unique.push(item);
      if (unique.length >= 4) break;
    }
    return unique;
  }, [symbol, favoriteSymbols]);

  const freshnessText = useMemo(() => {
    if (!lastUpdated) return "No updates yet";
    const elapsedMs = Date.now() - lastUpdated.getTime();
    const elapsedMinutes = Math.floor(elapsedMs / 60000);
    if (elapsedMinutes <= 0) return "Updated just now";
    if (elapsedMinutes === 1) return "Updated 1 minute ago";
    if (elapsedMinutes < 60) return `Updated ${elapsedMinutes} minutes ago`;
    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours === 1) return "Updated 1 hour ago";
    return `Updated ${elapsedHours} hours ago`;
  }, [lastUpdated]);

  const connectionState = useMemo(() => {
    if (error) return { tone: "degraded", label: "Degraded" };
    if (loading) return { tone: "syncing", label: "Syncing" };
    return { tone: "live", label: "Live" };
  }, [error, loading]);

  const analysis = useMemo(() => {
    const close = Number(latest?.predicted_close || history[0]?.pred_close || 0);
    const low = Number(latest?.predicted_low_80 || 0);
    const high = Number(latest?.predicted_high_80 || 0);
    const range = high - low;
    const rangePct = close ? (range / close) * 100 : null;
    const cvMae = Number(metrics[0]?.best_cv_mae || 0);
    const predStd = Number(metrics[0]?.pred_std || 0);

    const conditions = {
      trendUp: trendTone === "up",
      tightRange: Number.isFinite(rangePct) && rangePct < 1.2,
      lowError: Number.isFinite(cvMae) && cvMae < 1,
      healthyVolatility: Number.isFinite(predStd) && predStd < 5,
    };

    const score = [conditions.trendUp, conditions.tightRange, conditions.lowError, conditions.healthyVolatility].filter(Boolean).length;
    const decision = score >= 3 ? "BUY" : score === 2 ? "HOLD" : "AVOID";
    const confidence = clamp(48 + score * 12, 40, 92);

    return { close, low, high, range, rangePct, cvMae, predStd, conditions, score, decision, confidence };
  }, [history, latest, metrics, trendTone]);

  const uiAlerts = useMemo(() => {
    const alerts = [];
    const rangePct = Number(analysis.rangePct);
    const cvMae = Number(analysis.cvMae);

    if (!loading && trendTone === "down") {
      alerts.push({
        tone: "warn",
        title: "Short-term trend turned bearish",
        description: "Recent forecast points are moving down. Consider waiting for trend stabilization.",
      });
    }

    if (!loading && Number.isFinite(rangePct) && rangePct > 1.8) {
      alerts.push({
        tone: "warn",
        title: "Forecast uncertainty increased",
        description: `80% band width is ${formatPercent(rangePct, 1)}, which indicates wider variance than usual.`,
      });
    }

    if (!loading && Number.isFinite(cvMae) && cvMae > 1.0) {
      alerts.push({
        tone: "danger",
        title: "Model error is elevated",
        description: `Cross-validation MAE is ${asNumber(cvMae, 4)}. Review the selected model and recent pipeline runs.`,
      });
    }

    if (!loading && latestRunState.includes("FAILED")) {
      alerts.push({
        tone: "danger",
        title: "Latest pipeline run failed",
        description: "Databricks job did not complete successfully. Forecast freshness may be impacted.",
      });
    }

    return alerts.slice(0, 3);
  }, [analysis, latestRunState, loading, trendTone]);

  const sortedComparisonRows = useMemo(() => {
    const currentClose = Number(latest?.predicted_close);

    function riskIndexForRow(row) {
      const close = Number(row?.predicted_close);
      const low = Number(row?.predicted_low_80);
      const high = Number(row?.predicted_high_80);
      const cvMae = Number(row?.cv_mae);
      const bandPct = Number.isFinite(close) && close ? ((high - low) / close) * 100 : 0;
      const maeScore = Number.isFinite(cvMae) ? cvMae * 12 : 0;
      return Math.max(0, bandPct + maeScore);
    }

    const enriched = comparisonRows.map((item) => {
      const close = Number(item.row?.predicted_close);
      const cvMae = Number(item.row?.cv_mae);
      const delta = Number.isFinite(currentClose) && Number.isFinite(close) ? close - currentClose : 0;
      const deltaPct = Number.isFinite(currentClose) && currentClose ? (delta / currentClose) * 100 : 0;
      const riskIndex = riskIndexForRow(item.row);
      const maePenalty = Number.isFinite(cvMae) ? cvMae * 10 : 0;
      const signalScore =
        deltaPct * comparisonWeights.delta -
        riskIndex * comparisonWeights.risk -
        maePenalty * comparisonWeights.mae;
      return { ...item, close, delta, deltaPct, riskIndex, cvMae, signalScore };
    });

    return enriched.sort((a, b) => {
      if (comparisonSort === "risk") return a.riskIndex - b.riskIndex;
      if (comparisonSort === "price_desc") return b.close - a.close;
      if (comparisonSort === "symbol") return a.symbol.localeCompare(b.symbol);
      return b.signalScore - a.signalScore;
    });
  }, [comparisonRows, comparisonSort, comparisonWeights, latest]);

  const chartData = useMemo(() => {
    const forecastSeries = historyInRange.slice().reverse().map((row, index) => ({
      label: `D${index + 1}`,
      value: Number(row.pred_close || 0),
    }));

    const rangeSeries = historyInRange.slice(0, 8).map((row) => ({
      label: `D${row.horizon_day || "-"}`,
      value: Math.max(Number(row.pred_high_80 || 0) - Number(row.pred_low_80 || 0), 0),
    }));

    const metricSeries = metrics.slice(0, 5).map((row) => ({
      label: row.selected_model || "model",
      value: Number(row.best_cv_mae || 0),
    }));

    return { forecastSeries, rangeSeries, metricSeries };
  }, [historyInRange, metrics]);

  const chartInsights = useMemo(() => {
    const forecastValues = chartData.forecastSeries.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
    const rangeValues = chartData.rangeSeries.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));
    const metricValues = chartData.metricSeries.map((item) => Number(item.value)).filter((value) => Number.isFinite(value));

    return {
      forecast: {
        latest: forecastValues.at(-1),
        min: forecastValues.length ? Math.min(...forecastValues) : null,
        max: forecastValues.length ? Math.max(...forecastValues) : null,
        summary: forecastValues.length
          ? "The line shows the projected close over the full forecast horizon. The last point represents the next expected trading-day close."
          : "No forecast points are available yet.",
      },
      range: {
        latest: rangeValues.at(-1),
        min: rangeValues.length ? Math.min(...rangeValues) : null,
        max: rangeValues.length ? Math.max(...rangeValues) : null,
        summary: rangeValues.length
          ? "Bars represent the width of the 80% confidence band. Shorter bars mean a tighter, more stable forecast band."
          : "No confidence-band values are available yet.",
      },
      metrics: {
        latest: metricValues.at(-1),
        min: metricValues.length ? Math.min(...metricValues) : null,
        max: metricValues.length ? Math.max(...metricValues) : null,
        summary: metricValues.length
          ? "Lower bars indicate lower cross-validation error, which is preferred for the selected model comparison."
          : "No model metrics are available yet.",
      },
    };
  }, [chartData]);

  async function fetchForecastData(targetSymbol) {
    setLoading(true);
    setError("");
    setJobError("");

    try {
      const encoded = encodeURIComponent(targetSymbol);
      const [latestRes, historyRes, metricsRes] = await Promise.all([
        fetch(`${API_BASE}/databricks/forecast/latest?symbol=${encoded}`),
        fetch(`${API_BASE}/databricks/forecast/history?symbol=${encoded}&limit=60`),
        fetch(`${API_BASE}/databricks/forecast/metrics?symbol=${encoded}&limit=20`),
      ]);

      if (!latestRes.ok || !historyRes.ok || !metricsRes.ok) {
        throw new Error(`HTTP ${latestRes.status}/${historyRes.status}/${metricsRes.status}`);
      }

      const latestData = await latestRes.json();
      const historyData = await historyRes.json();
      const metricsData = await metricsRes.json();

      setLatest(latestData.row || null);
      setHistory(historyData.rows || []);
      setMetrics(metricsData.rows || []);

      try {
        const bronzeRes = await fetch(`${API_BASE}/databricks/bronze/status?symbol=${encoded}`);
        if (bronzeRes.ok) {
          const bronzeData = await bronzeRes.json();
          setBronzeStatus(bronzeData.row || null);
        }
      } catch {
        // non-critical
      }

      try {
        const searchRes = await fetch(
          `${API_BASE}/databricks/jobs/search?name=${encodeURIComponent(PIPELINE_JOB_QUERY)}`,
        );
        if (!searchRes.ok) {
          throw new Error(`HTTP ${searchRes.status}`);
        }
        const searchData = await searchRes.json();
        const firstJob = (searchData.jobs || [])[0] || null;
        setPipelineJob(firstJob);

        if (!firstJob?.job_id) {
          setPipelineRuns([]);
          setJobError("The NVDA Medallion Pipeline job was not found in Databricks.");
        } else {
          const runsRes = await fetch(`${API_BASE}/databricks/jobs/${firstJob.job_id}/runs?limit=10`);
          if (!runsRes.ok) {
            throw new Error(`HTTP ${runsRes.status}`);
          }
          const runsData = await runsRes.json();
          setPipelineRuns(runsData.runs || []);
        }
      } catch (err) {
        setPipelineJob(null);
        setPipelineRuns([]);
        setJobError(`Could not read NVDA Medallion Pipeline job status: ${err.message}`);
      }

      setLastUpdated(new Date());
    } catch (err) {
      setError(`Could not read forecast results: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchForecastData(symbol);
  }, [symbol]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const intervalId = setInterval(() => {
      fetchForecastData(symbol);
    }, 60000);
    return () => clearInterval(intervalId);
  }, [autoRefresh, symbol]);

  useEffect(() => {
    let cancelled = false;

    async function fetchComparisonRows() {
      setComparisonLoading(true);
      setComparisonError("");

      try {
        const rows = await Promise.all(
          comparisonSymbols.map(async (ticker) => {
            const response = await fetch(`${API_BASE}/databricks/forecast/latest?symbol=${encodeURIComponent(ticker)}`);
            if (!response.ok) {
              throw new Error(`HTTP ${response.status}`);
            }
            const data = await response.json();
            return {
              symbol: ticker,
              row: data.row || null,
            };
          }),
        );

        if (!cancelled) {
          setComparisonRows(rows);
        }
      } catch (err) {
        if (!cancelled) {
          setComparisonRows([]);
          setComparisonError(`Could not load comparison data: ${err.message}`);
        }
      } finally {
        if (!cancelled) {
          setComparisonLoading(false);
        }
      }
    }

    if (comparisonSymbols.length) {
      fetchComparisonRows();
    }

    return () => {
      cancelled = true;
    };
  }, [comparisonSymbols, lastUpdated]);

  useEffect(() => {
    window.localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteSymbols));
  }, [favoriteSymbols]);

  useEffect(() => {
    window.localStorage.setItem(COMPARISON_WEIGHTS_STORAGE_KEY, JSON.stringify(comparisonWeights));
  }, [comparisonWeights]);

  useEffect(() => {
    function onKeyDown(event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      const activeElement = document.activeElement;
      const tag = activeElement?.tagName;
      const isEditable = tag === "INPUT" || tag === "TEXTAREA" || activeElement?.isContentEditable;

      if (event.key === "/") {
        event.preventDefault();
        symbolInputRef.current?.focus();
        symbolInputRef.current?.select();
        return;
      }

      if (isEditable) return;

      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        fetchForecastData(symbol);
      } else if (event.key === "1") {
        event.preventDefault();
        setActiveView("dashboard");
      } else if (event.key === "2") {
        event.preventDefault();
        setActiveView("analysis");
      } else if (event.key === "c" || event.key === "C") {
        event.preventDefault();
        setCompactMode((prev) => !prev);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [symbol]);

  function submitSymbol(event) {
    event.preventDefault();
    const cleaned = symbolInput.toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 10);
    if (!cleaned) return;
    setSymbolInput(cleaned);
    setSymbol(cleaned);
  }

  function setQuickSymbol(nextSymbol) {
    setSymbolInput(nextSymbol);
    setSymbol(nextSymbol);
  }

  function toggleFavoriteSymbol(targetSymbol) {
    setFavoriteSymbols((prev) => {
      const alreadyFavorite = prev.includes(targetSymbol);
      if (alreadyFavorite) {
        const next = prev.filter((item) => item !== targetSymbol);
        return next.length ? next : ["NVDA"];
      }
      return [targetSymbol, ...prev].slice(0, 12);
    });
  }

  function setComparisonWeight(key, nextValue) {
    setComparisonWeights((prev) => ({
      ...prev,
      [key]: clamp(Number(nextValue), 0, 2),
    }));
  }

  return (
    <div className={compactMode ? "page-shell compact-mode" : "page-shell"}>
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Production Forecast Console</p>
          <h1>NVDA Medallion Serving Dashboard</h1>
          <p>Live predictions and training metrics from workspace.serving.*</p>
        </div>

        <form className="hero-actions" onSubmit={submitSymbol}>
          <div className="status-row">
            <span className={`status-pill ${connectionState.tone}`}>{connectionState.label}</span>
            <span className="data-freshness">{freshnessText}</span>
          </div>

          <label htmlFor="symbol-input" className="input-label">Symbol</label>
          <div className="input-group">
            <input
              id="symbol-input"
              ref={symbolInputRef}
              className="symbol-input"
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value.toUpperCase())}
              maxLength={10}
              aria-label="Forecast symbol"
            />
            <button type="submit" className="refresh-btn" disabled={loading}>
              Apply
            </button>
            <button
              type="button"
              className="ghost-btn"
              onClick={() => fetchForecastData(symbol)}
              disabled={loading}
            >
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>

          <div className="symbol-presets" aria-label="Quick symbols">
            {QUICK_SYMBOLS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={symbol === preset ? "preset-btn active" : "preset-btn"}
                onClick={() => setQuickSymbol(preset)}
                disabled={loading && symbol === preset}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="favorites-row" aria-label="Favorite symbols">
            <button
              type="button"
              className={favoriteSymbols.includes(symbol) ? "favorite-toggle active" : "favorite-toggle"}
              onClick={() => toggleFavoriteSymbol(symbol)}
              disabled={!symbol}
            >
              {favoriteSymbols.includes(symbol) ? "★ Remove favorite" : "☆ Add favorite"}
            </button>

            <div className="favorites-list">
              {favoriteSymbols.map((fav) => (
                <button
                  key={fav}
                  type="button"
                  className={symbol === fav ? "favorite-chip active" : "favorite-chip"}
                  onClick={() => setQuickSymbol(fav)}
                >
                  {fav}
                </button>
              ))}
            </div>
          </div>

          <div className="control-row">
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={(event) => setAutoRefresh(event.target.checked)}
              />
              Auto refresh every 60s
            </label>
            <label className="auto-refresh-toggle">
              <input
                type="checkbox"
                checked={compactMode}
                onChange={(event) => setCompactMode(event.target.checked)}
              />
              Compact mode
            </label>
            <p className="last-update">Last updated: {lastUpdated ? asDate(lastUpdated.toISOString()) : "-"}</p>
          </div>

          <p className="shortcut-hint">Shortcuts: / symbol, R refresh, 1 dashboard, 2 analysis, C compact</p>
        </form>
      </header>

      <nav className="view-switcher" aria-label="Section switcher">
        <button
          type="button"
          className={activeView === "dashboard" ? "view-btn active" : "view-btn"}
          onClick={() => setActiveView("dashboard")}
        >
          Dashboard
        </button>
        <button
          type="button"
          className={activeView === "analysis" ? "view-btn active" : "view-btn"}
          onClick={() => setActiveView("analysis")}
        >
          Charts & Recommendation
        </button>
      </nav>

      {error ? <div className="error-banner">{error}</div> : null}
      {jobError ? <div className="error-banner">{jobError}</div> : null}
      {!error && uiAlerts.length ? (
        <section className="alerts-strip" aria-live="polite">
          {uiAlerts.map((alert, idx) => (
            <article key={`${alert.title}-${idx}`} className={`alert-card ${alert.tone}`}>
              <h3>{alert.title}</h3>
              <p>{alert.description}</p>
            </article>
          ))}
        </section>
      ) : null}

      <section className="comparison-panel" aria-live="polite">
        <div className="panel-head">
          <h2>Multi-symbol snapshot</h2>
          <div className="panel-controls">
            <label className="mini-control">
              Sort
              <select value={comparisonSort} onChange={(event) => setComparisonSort(event.target.value)}>
                {COMPARISON_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <span className="chip">{comparisonSymbols.length} tracked</span>
          </div>
        </div>

        {comparisonError ? <p className="comparison-error">{comparisonError}</p> : null}

        <div className="comparison-grid">
          {comparisonLoading
            ? Array.from({ length: 4 }).map((_, idx) => (
                <article key={`compare-skeleton-${idx}`} className="comparison-card skeleton-card">
                  <span className="skeleton-box skeleton-title" />
                  <strong className="skeleton-box skeleton-value" />
                  <small className="skeleton-box skeleton-meta" />
                </article>
              ))
            : sortedComparisonRows.map((item) => {
                const close = Number(item.row?.predicted_close);
                const hasClose = Number.isFinite(close);
                const currentClose = Number(latest?.predicted_close);
                const delta = Number.isFinite(currentClose) && hasClose ? close - currentClose : null;
                const deltaTone = delta === null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";

                return (
                  <article key={item.symbol} className={`comparison-card tone-${deltaTone}`}>
                    <div className="comparison-top">
                      <strong>{item.symbol}</strong>
                      <span>{item.row?.model_name || "-"}</span>
                    </div>
                    <div className="comparison-price">{hasClose ? asNumber(close) : "-"}</div>
                    <small>
                      vs {symbol}: {delta === null ? "-" : `${delta > 0 ? "+" : ""}${asNumber(delta, 2)}`}
                    </small>
                    <small>Risk index: {asNumber(item.riskIndex, 2)}</small>
                  </article>
                );
              })}
        </div>

        <div className="weights-panel">
          <p>Ranking Weights</p>
          <div className="weights-grid">
            <label>
              Delta {asNumber(comparisonWeights.delta, 2)}
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={comparisonWeights.delta}
                onChange={(event) => setComparisonWeight("delta", event.target.value)}
              />
            </label>
            <label>
              Risk {asNumber(comparisonWeights.risk, 2)}
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={comparisonWeights.risk}
                onChange={(event) => setComparisonWeight("risk", event.target.value)}
              />
            </label>
            <label>
              MAE {asNumber(comparisonWeights.mae, 2)}
              <input
                type="range"
                min="0"
                max="2"
                step="0.05"
                value={comparisonWeights.mae}
                onChange={(event) => setComparisonWeight("mae", event.target.value)}
              />
            </label>
          </div>
        </div>
      </section>

      {activeView === "dashboard" ? (
        <>
          <section className="pipeline-panel">
            <div className="pipeline-head">
              <div>
                <p className="eyebrow">Databricks Job</p>
                <h2>{pipelineJob?.settings?.name || "NVDA Medallion Pipeline"}</h2>
              </div>
              <span className="chip">{pipelineJob?.job_id ? `Job ID ${pipelineJob.job_id}` : "Job not found"}</span>
            </div>

            <div className="pipeline-kpis">
              <article>
                <span>Latest run state</span>
                <strong>{latestRunState}</strong>
              </article>
              <article>
                <span>Started</span>
                <strong>{asDate(latestRun?.start_time_iso || latestRun?.start_time)}</strong>
              </article>
              <article>
                <span>Finished</span>
                <strong>{asDate(latestRun?.end_time_iso || latestRun?.end_time)}</strong>
              </article>
              <article>
                <span>Trigger</span>
                <strong>{latestRun?.trigger || "-"}</strong>
              </article>
              <article>
                <span>Bronze last price</span>
                <strong>{bronzeStatus?.last_price_date ? asDateShort(bronzeStatus.last_price_date) : "-"}</strong>
              </article>
              <article>
                <span>Bronze trading days</span>
                <strong>{bronzeStatus?.unique_trading_days ?? "-"}</strong>
              </article>
            </div>

            <div className="table-wrap pipeline-runs">
              <table>
                <thead>
                  <tr>
                    <th>Run ID</th>
                    <th>State</th>
                    <th>Result</th>
                    <th>Start</th>
                    <th>End</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 3 }).map((_, idx) => (
                        <tr key={`pipeline-skeleton-${idx}`} className="skeleton-row">
                          <td>
                            <span className="skeleton-box" />
                          </td>
                          <td>
                            <span className="skeleton-box" />
                          </td>
                          <td>
                            <span className="skeleton-box" />
                          </td>
                          <td>
                            <span className="skeleton-box" />
                          </td>
                          <td>
                            <span className="skeleton-box" />
                          </td>
                        </tr>
                      ))
                    : null}
                  {pipelineRuns.map((run) => (
                    <tr key={run.run_id}>
                      <td>{run.run_id || "-"}</td>
                      <td>{run.state?.life_cycle_state || "-"}</td>
                      <td>{run.state?.result_state || "IN_PROGRESS"}</td>
                      <td>{asDate(run.start_time_iso || run.start_time)}</td>
                      <td>{asDate(run.end_time_iso || run.end_time)}</td>
                    </tr>
                  ))}
                  {!loading && pipelineRuns.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="empty-cell">
                        No runs available.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>

          <section className="kpi-grid">
            {loading ? (
              Array.from({ length: 4 }).map((_, idx) => (
                <article key={`kpi-skeleton-${idx}`} className="kpi-card skeleton-card">
                  <span className="skeleton-box skeleton-title" />
                  <strong className="skeleton-box skeleton-value" />
                  <small className="skeleton-box skeleton-meta" />
                </article>
              ))
            ) : (
              <>
            <article className="kpi-card kpi-highlight">
              <span>Predicted close</span>
              <strong>{asNumber(latest?.predicted_close)}</strong>
              <small>Next trading day: {asDate(latest?.next_trading_day)}</small>
            </article>

            <article className="kpi-card">
              <span>80% confidence band</span>
              <strong>{asNumber(latest?.predicted_low_80)} to {asNumber(latest?.predicted_high_80)}</strong>
              <small>Model: {latest?.model_name || "-"} · <span className="adj-badge" title="Features trained on split-adjusted adj_close — NVDA 10:1 split corrected">adj. features</span></small>
            </article>

            <article className="kpi-card">
              <span>Average forecast</span>
              <strong>{asNumber(avgForecast)}</strong>
              <small>Across {history.length} rows</small>
            </article>

            <article className={`kpi-card trend-${trendTone}`}>
              <span>Short-term trend</span>
              <strong>{trendTone.toUpperCase()}</strong>
              <small>Based on the latest two forecast points</small>
            </article>
              </>
            )}
          </section>

          <div className="workspace-layout">
          <main className="layout">
            <section className="panel left-panel">
              <div className="panel-head">
                <h2>Recent forecast points</h2>
                <span className="chip">{symbol}</span>
              </div>

              <div className="horizon-list">
                {loading
                  ? Array.from({ length: 6 }).map((_, idx) => (
                      <article key={`horizon-skeleton-${idx}`} className="horizon-card skeleton-card">
                        <div className="horizon-top">
                          <span className="skeleton-box skeleton-title" />
                          <span className="skeleton-box skeleton-title" />
                        </div>
                        <div className="horizon-price skeleton-box skeleton-value" />
                        <div className="range-track">
                          <span style={{ width: "65%" }} />
                        </div>
                        <p className="horizon-range skeleton-box skeleton-meta" />
                      </article>
                    ))
                  : null}
                {history.slice(0, 8).map((row, idx) => (
                  <article key={`${row.forecast_ts}-${row.horizon_day}-${idx}`} className="horizon-card">
                    <div className="horizon-top">
                      <strong>Day {row.horizon_day || "-"}</strong>
                      <span>{asDate(row.forecast_date)}</span>
                    </div>
                    <div className="horizon-price">{asNumber(row.pred_close)}</div>
                    <div className="range-track">
                      <span style={{ width: `${Math.min(100, Math.max(5, (Number(row.pred_close || 0) % 100))) || 10}%` }} />
                    </div>
                    <p className="horizon-range">
                      Range: {asNumber(row.pred_low_80)} to {asNumber(row.pred_high_80)}
                    </p>
                  </article>
                ))}

                {!loading && history.length === 0 ? <p className="empty">No forecast points to show.</p> : null}
              </div>
            </section>

            <section className="panel right-panel">
              <div className="panel-head">
                <h2>Forecast history table</h2>
                <span className="chip">{history.length} rows</span>
              </div>

              <div className="table-wrap forecast-table">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Horizon</th>
                      <th>Pred Close</th>
                      <th>Low 80</th>
                      <th>High 80</th>
                      <th>Model</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 6 }).map((_, idx) => (
                          <tr key={`history-skeleton-${idx}`} className="skeleton-row">
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                          </tr>
                        ))
                      : null}
                    {history.map((row, idx) => (
                      <tr key={`${row.forecast_ts}-${row.horizon_day}-${idx}`}>
                        <td>{asDateShort(row.forecast_date)}</td>
                        <td>{row.horizon_day || "-"}</td>
                        <td>{asNumber(row.pred_close)}</td>
                        <td>{asNumber(row.pred_low_80)}</td>
                        <td>{asNumber(row.pred_high_80)}</td>
                        <td>{row.model_name || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="panel-head metrics-head">
                <h2>Training metrics</h2>
                <span className="chip">{metrics.length} rows</span>
              </div>

              <div className="table-wrap metrics-table">
                <table>
                  <thead>
                    <tr>
                      <th>Model</th>
                      <th>CV MAE</th>
                      <th>Pred Std</th>
                      <th>Train Rows</th>
                      <th>Loaded</th>
                      <th>Run ID</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading
                      ? Array.from({ length: 4 }).map((_, idx) => (
                          <tr key={`metrics-skeleton-${idx}`} className="skeleton-row">
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                            <td><span className="skeleton-box" /></td>
                          </tr>
                        ))
                      : null}
                    {metrics.map((row, idx) => (
                      <tr key={`${row.loaded_ts}-${idx}`}>
                        <td>{row.selected_model || "-"}</td>
                        <td>{asNumber(row.best_cv_mae, 4)}</td>
                        <td>{asNumber(row.pred_std, 6)}</td>
                        <td>{row.train_rows || "-"}</td>
                        <td>{asDate(row.loaded_ts)}</td>
                        <td className="run-id-cell" title={row.pipeline_run_id || ""}>{row.pipeline_run_id ? String(row.pipeline_run_id).slice(-10) : "-"}</td>
                      </tr>
                    ))}
                    {!loading && metrics.length === 0 ? (
                      <tr>
                        <td colSpan="5" className="empty-cell">
                          No metrics to show.
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
            </section>
          </main>

          <aside className="ops-panel">
            <div className="panel-head">
              <h2>Ops Side Panel</h2>
              <span className={`chip chip-${connectionState.tone}`}>{connectionState.label}</span>
            </div>

            <div className="ops-kpis">
              <article>
                <span>Active symbol</span>
                <strong>{symbol}</strong>
              </article>
              <article>
                <span>Pipeline state</span>
                <strong>{latestRunState}</strong>
              </article>
              <article>
                <span>Decision</span>
                <strong>{analysis.decision}</strong>
              </article>
              <article>
                <span>Confidence</span>
                <strong>{analysis.confidence}%</strong>
              </article>
            </div>

            <ul className="ops-list">
              <li>Backend health: {error ? "Degraded" : "Healthy"}</li>
              <li>Forecast rows loaded: {history.length}</li>
              <li>Metric rows loaded: {metrics.length}</li>
              <li>Comparison symbols: {comparisonSymbols.length}</li>
              <li>Auto refresh: {autoRefresh ? "Enabled" : "Disabled"}</li>
              <li>Last update: {lastUpdated ? asDate(lastUpdated.toISOString()) : "-"}</li>
            </ul>
          </aside>
          </div>
        </>
      ) : null}

      {activeView === "analysis" ? (
        <section className="analysis-window panel">
          <div className="analysis-header">
            <div>
              <p className="eyebrow">NVDA Signal Room</p>
              <h2 id="analysis-title">Interactive charts and recommendation</h2>
              <p>
                This analysis view combines the forecast shape, band width, model error, and job context to produce
                a simple buy / wait / avoid signal.
              </p>
            </div>
            <div className="analysis-side">
              <div className="analysis-badge">
                <span>Decision signal</span>
                <strong className={`decision decision-${analysis.decision.toLowerCase().replace(/\s+/g, "-")}`}>
                  {analysis.decision}
                </strong>
              </div>
              <label className="mini-control">
                Horizon range
                <select value={chartRange} onChange={(event) => setChartRange(event.target.value)}>
                  {CHART_RANGE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="analysis-grid">
            <article className="analysis-card analysis-summary">
              <div className="analysis-score">
                <span>Visual confidence</span>
                <strong>{analysis.confidence}%</strong>
              </div>
              <div className="progress-rail" aria-hidden="true">
                <span style={{ width: `${analysis.confidence}%` }} />
              </div>
              <ul className="analysis-list">
                <li>Expected price: {asNumber(analysis.close)}</li>
                <li>80% band: {asNumber(analysis.low)} - {asNumber(analysis.high)}</li>
                <li>Band width: {asNumber(analysis.range)}</li>
                <li>CV MAE: {asNumber(analysis.cvMae, 4)}</li>
                <li>Prediction std dev: {asNumber(analysis.predStd, 4)}</li>
                <li className="adj-feature-note" title="Lag, returns and rolling stats computed on adj_close to correct the June 2024 NVDA 10:1 stock split">Features: split-adjusted adj_close</li>
              </ul>
              <p className="analysis-note">
                This is a visual decision aid, not financial advice.
              </p>
            </article>

            <article className="analysis-card">
              <div className="panel-head">
                <h3>Forecast trajectory</h3>
                <span className="chip">{historyInRange.length} points</span>
              </div>
              <p className="chart-caption">
                X axis: future trading days in the forecast horizon. Y axis: predicted close price in USD.
              </p>
              <div className="chart-insight">
                <p>{chartInsights.forecast.summary}</p>
                <div className="chart-stats">
                  <div>
                    <span>Latest close</span>
                    <strong>{asNumber(chartInsights.forecast.latest)}</strong>
                  </div>
                  <div>
                    <span>Lowest close</span>
                    <strong>{asNumber(chartInsights.forecast.min)}</strong>
                  </div>
                  <div>
                    <span>Highest close</span>
                    <strong>{asNumber(chartInsights.forecast.max)}</strong>
                  </div>
                </div>
              </div>
              <SvgLineChart
                label="Forecast trajectory"
                data={chartData.forecastSeries}
                stroke="#0f867e"
                fill="rgba(15,134,126,0.12)"
                xAxisLabel={`Future trading days (${chartRange}d window)`}
                yAxisLabel="Predicted close price (USD)"
              />
            </article>

            <article className="analysis-card">
              <div className="panel-head">
                <h3>Confidence band width</h3>
                <span className="chip">Last {Math.min(8, historyInRange.length || 8)} days</span>
              </div>
              <p className="chart-caption">The width of the 80% band per horizon point.</p>
              <div className="chart-insight">
                <p>{chartInsights.range.summary}</p>
                <div className="chart-stats">
                  <div>
                    <span>Latest</span>
                    <strong>{asNumber(chartInsights.range.latest, 1)}</strong>
                  </div>
                  <div>
                    <span>Min</span>
                    <strong>{asNumber(chartInsights.range.min, 1)}</strong>
                  </div>
                  <div>
                    <span>Max</span>
                    <strong>{asNumber(chartInsights.range.max, 1)}</strong>
                  </div>
                </div>
              </div>
              <SvgBarChart
                label="Confidence band width"
                data={chartData.rangeSeries}
                valueFormatter={(value) => asNumber(value, 1)}
              />
            </article>

            <article className="analysis-card">
              <div className="panel-head">
                <h3>Model error comparison</h3>
                <span className="chip">CV MAE</span>
              </div>
              <p className="chart-caption">Lower bars indicate better cross-validation performance.</p>
              <div className="chart-insight">
                <p>{chartInsights.metrics.summary}</p>
                <div className="chart-stats">
                  <div>
                    <span>Latest</span>
                    <strong>{asNumber(chartInsights.metrics.latest, 4)}</strong>
                  </div>
                  <div>
                    <span>Best</span>
                    <strong>{asNumber(chartInsights.metrics.min, 4)}</strong>
                  </div>
                  <div>
                    <span>Worst</span>
                    <strong>{asNumber(chartInsights.metrics.max, 4)}</strong>
                  </div>
                </div>
              </div>
              <SvgBarChart
                label="Model error comparison"
                data={chartData.metricSeries}
                valueFormatter={(value) => asNumber(value, 3)}
              />
            </article>

            <article className="analysis-card conditions-card">
              <div className="panel-head">
                <h3>Decision factors</h3>
                <span className="chip">{analysis.score}/4</span>
              </div>
              <div className="condition-list">
                <span className={analysis.conditions.trendUp ? "good" : "bad"}>Bullish trend</span>
                <span className={analysis.conditions.tightRange ? "good" : "bad"}>Tight band</span>
                <span className={analysis.conditions.lowError ? "good" : "bad"}>Low error</span>
                <span className={analysis.conditions.healthyVolatility ? "good" : "bad"}>Healthy volatility</span>
              </div>
            </article>
          </div>

          <div className="analysis-footer">
            <div className="analysis-pill">Updated: {lastUpdated ? asDate(lastUpdated.toISOString()) : "-"}</div>
            <div className="analysis-pill">Model: {latest?.model_name || metrics[0]?.selected_model || "-"}</div>
            <div className="analysis-pill">Horizon points: {history.length || 0}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
