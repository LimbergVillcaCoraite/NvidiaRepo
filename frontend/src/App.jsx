import { useEffect, useMemo, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "/api";
const PIPELINE_JOB_QUERY = "NVDA medallion";

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
  const [symbolInput, setSymbolInput] = useState("NVDA");
  const [symbol, setSymbol] = useState("NVDA");
  const [activeView, setActiveView] = useState("dashboard");
  const [latest, setLatest] = useState(null);
  const [history, setHistory] = useState([]);
  const [metrics, setMetrics] = useState([]);
  const [pipelineJob, setPipelineJob] = useState(null);
  const [pipelineRuns, setPipelineRuns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [jobError, setJobError] = useState("");
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

  const chartData = useMemo(() => {
    const forecastSeries = history.slice().reverse().map((row, index) => ({
      label: `D${index + 1}`,
      value: Number(row.pred_close || 0),
    }));

    const rangeSeries = history.slice(0, 8).map((row) => ({
      label: `D${row.horizon_day || "-"}`,
      value: Math.max(Number(row.pred_high_80 || 0) - Number(row.pred_low_80 || 0), 0),
    }));

    const metricSeries = metrics.slice(0, 5).map((row) => ({
      label: row.selected_model || "model",
      value: Number(row.best_cv_mae || 0),
    }));

    return { forecastSeries, rangeSeries, metricSeries };
  }, [history, metrics]);

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

  function submitSymbol(event) {
    event.preventDefault();
    const cleaned = symbolInput.toUpperCase().replace(/[^A-Z0-9._-]/g, "").slice(0, 10);
    if (!cleaned) return;
    setSymbolInput(cleaned);
    setSymbol(cleaned);
  }

  return (
    <div className="page-shell">
      <div className="ambient ambient-a" />
      <div className="ambient ambient-b" />

      <header className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Production Forecast Console</p>
          <h1>NVDA Medallion Serving Dashboard</h1>
          <p>Live predictions and training metrics from workspace.serving.*</p>
        </div>

        <form className="hero-actions" onSubmit={submitSymbol}>
          <label htmlFor="symbol-input" className="input-label">Symbol</label>
          <div className="input-group">
            <input
              id="symbol-input"
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
          <p className="last-update">Last updated: {lastUpdated ? asDate(lastUpdated.toISOString()) : "-"}</p>
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
            <article className="kpi-card kpi-highlight">
              <span>Predicted close</span>
              <strong>{asNumber(latest?.predicted_close)}</strong>
              <small>Next trading day: {asDate(latest?.next_trading_day)}</small>
            </article>

            <article className="kpi-card">
              <span>80% confidence band</span>
              <strong>{asNumber(latest?.predicted_low_80)} to {asNumber(latest?.predicted_high_80)}</strong>
              <small>Model: {latest?.model_name || "-"}</small>
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
          </section>

          <main className="layout">
            <section className="panel left-panel">
              <div className="panel-head">
                <h2>Recent forecast points</h2>
                <span className="chip">{symbol}</span>
              </div>

              <div className="horizon-list">
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
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((row, idx) => (
                      <tr key={`${row.forecast_ts}-${row.horizon_day}-${idx}`}>
                        <td>{asDateShort(row.forecast_date)}</td>
                        <td>{row.horizon_day || "-"}</td>
                        <td>{asNumber(row.pred_close)}</td>
                        <td>{asNumber(row.pred_low_80)}</td>
                        <td>{asNumber(row.pred_high_80)}</td>
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
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.map((row, idx) => (
                      <tr key={`${row.loaded_ts}-${idx}`}>
                        <td>{row.selected_model || "-"}</td>
                        <td>{asNumber(row.best_cv_mae, 4)}</td>
                        <td>{asNumber(row.pred_std, 6)}</td>
                        <td>{row.train_rows || "-"}</td>
                        <td>{asDate(row.loaded_ts)}</td>
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
            <div className="analysis-badge">
              <span>Decision signal</span>
              <strong className={`decision decision-${analysis.decision.toLowerCase().replace(/\s+/g, "-")}`}>
                {analysis.decision}
              </strong>
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
              </ul>
              <p className="analysis-note">
                This is a visual decision aid, not financial advice.
              </p>
            </article>

            <article className="analysis-card">
              <div className="panel-head">
                <h3>Forecast trajectory</h3>
                <span className="chip">{history.length} points</span>
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
                xAxisLabel="Future trading days"
                yAxisLabel="Predicted close price (USD)"
              />
            </article>

            <article className="analysis-card">
              <div className="panel-head">
                <h3>Confidence band width</h3>
                <span className="chip">Last 8 days</span>
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
